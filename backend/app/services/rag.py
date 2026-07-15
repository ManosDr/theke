"""Retrieval for the chat pipeline: embed the question, find the closest
chunks among documents the requesting user can actually see, and refuse to
hand back weak matches rather than let the model paper over a real gap.

Generation (the actual GPT call) lives in app/routers/chat.py, since the
system-prompt/citation-formatting concerns are specific to the one endpoint
that calls this - this module's only job is "what's actually relevant, and
is it relevant enough."
"""

from dataclasses import dataclass

from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import CurrentUser
from app.models import Document, Embedding, Project, Region
from app.services.embeddings import embed_texts
from app.services.visibility import visible_documents_filter


@dataclass
class RetrievedChunk:
    document_id: int
    title: str | None
    authority: str | None
    content_type: str | None
    source: str | None
    date: str | None
    extraction_status: str | None
    region_id: str | None
    chunk_text: str
    distance: float
    # Hybrid-search bookkeeping (see _retrieve()) - 1-indexed position in
    # each candidate list, or None if the chunk didn't appear in that list
    # at all. keyword_rank is the signal callers use to decide whether a
    # vector-threshold failure should still be let through: a chunk with
    # keyword_rank=None scored zero on full-text search, so a hybrid
    # exclusion rule can treat "failed vector AND keyword_rank is None" as
    # the actual gap case.
    vector_rank: int | None = None
    keyword_rank: int | None = None
    rrf_score: float = 0.0


@dataclass
class SearchOutcome:
    hits: list[RetrievedChunk]
    # Lowest cosine distance seen among ALL in-scope candidates, before the
    # rag_max_distance cutoff is applied - None means the visible scope had
    # zero embedded candidates at all (nothing to even be too weak). Lets a
    # caller distinguish "your knowledge base has nothing here" from "it has
    # something, just nothing confident enough" instead of collapsing both
    # into the same empty list.
    best_distance: float | None


# Size of each sub-query's candidate pool before RRF merging - independent
# of top_k (how many merged results a caller actually gets back).
_CANDIDATE_POOL_SIZE = 20
# Standard RRF damping constant (the usual default in hybrid-search
# literature/implementations - large enough that a #1 vs #2 rank swap
# doesn't wildly swing the score, small enough that rank still matters).
_RRF_K = 60

_DOC_COLUMNS = (
    # Explicitly labeled: both queries also select Embedding.id (as
    # embedding_id, the RRF merge key), and SQLAlchemy Row's attribute-style
    # access silently resolves an unlabeled duplicate-named column ("id")
    # to whichever one was selected first rather than raising - it doesn't
    # error, it just gives back the wrong value.
    Document.id.label("document_id"),
    Document.title,
    Document.authority,
    Document.content_type,
    Document.source,
    Document.date,
    Document.extraction_status,
    Document.region_id,
)


def _retrieve(
    db: Session,
    user: CurrentUser,
    query: str,
    top_k: int,
    vertical_id: int,
    region_id: str | None = None,
    project_id: int | None = None,
    customer_id: int | None = None,
    plot_in_plan: bool | None = None,
) -> list[RetrievedChunk]:
    """Shared retrieval core for both the chat pipeline and the standalone
    /search endpoint: hybrid search combining vector cosine similarity and
    PostgreSQL full-text search, merged via Reciprocal Rank Fusion (RRF),
    restricted to documents visible to this user. Returns the top_k merged
    results unfiltered by confidence - callers decide what to do with
    distance/keyword_rank themselves (see _passes_hybrid_threshold).

    Two independent candidate pools (_CANDIDATE_POOL_SIZE each), then
    merged: a chunk that's a weak vector match but a strong keyword match
    (or vice versa) can still rank highly overall - this is what rescues
    exact-phrase/legal-terminology queries that the embedding model alone
    was scoring below every competitor's distance (see KNOWN_DECISIONS.md's
    "content-quality fixes don't reliably help" entry - this is the
    intended systemic fix for that whole class of miss, not another
    one-off content edit).

    plot_in_plan (a project's resolved εντός/εκτός σχεδίου status) is the
    one case where appending to the query is correct rather than biasing -
    unlike the removed municipality enrichment (which skewed retrieval
    toward regional content on questions that weren't about that region at
    all), in-plan/out-of-plan selects an entirely different regulatory
    framework, so narrowing toward it improves precision. None (not yet
    determined) leaves the query untouched.
    """
    if plot_in_plan is True:
        query = f"{query} εντός σχεδίου"
    elif plot_in_plan is False:
        query = f"{query} εκτός σχεδίου"

    query_vector = embed_texts([query])[0]

    # embeddings.idx_embeddings_vector is an ivfflat index, which is an
    # approximate search: its default probes=1 only scans 1 of the index's
    # 128 lists, which measurably missed real, well-under-threshold matches
    # at our current data scale (confirmed - a 0.246 cosine-distance match
    # was silently dropped with the default). At ~16k rows/128 lists the
    # extra scan cost of probing every list is negligible, so we trade
    # index-assisted speed for exact recall rather than risk an honest-gap
    # response papering over a real citation. Revisit (lower this, or add
    # a lists/probes retuning pass) once the corpus is orders of magnitude
    # bigger and full-list probing stops being cheap.
    db.execute(text("SET LOCAL ivfflat.probes = 128"))

    visibility = visible_documents_filter(db, user, vertical_id, project_id=project_id, customer_id=customer_id)

    # --- Query A: vector cosine similarity ---
    distance = Embedding.embedding.cosine_distance(query_vector)
    vector_stmt = (
        select(Embedding.id.label("embedding_id"), Embedding.chunk_text, distance.label("distance"), *_DOC_COLUMNS)
        .join(Document, Document.id == Embedding.document_id)
        .where(Document.status == "active")
        .where(visibility)
        .order_by(distance)
        .limit(_CANDIDATE_POOL_SIZE)
    )
    if region_id:
        # Narrows an already-visible result set to one region on request -
        # it can only shrink access, never grant it: a company with no
        # project in `region_id` already has that region's documents
        # excluded by visible_documents_filter above, regardless of this
        # clause. National documents (region_id IS NULL) stay included so
        # narrowing to a region doesn't hide the always-applicable rules.
        vector_stmt = vector_stmt.where(Document.region_id.is_(None) | (Document.region_id == region_id))
    vector_rows = db.execute(vector_stmt).all()

    # --- Query B: PostgreSQL full-text search ---
    # plainto_tsquery treats `query` as an unstructured phrase (splits on
    # whitespace/punctuation, ANDs the resulting lexemes) rather than
    # requiring tsquery operator syntax, so it's already resistant to most
    # malformed input - there's no user-facing syntax to get wrong. The
    # try/except is a second line of defense against anything that still
    # errors (e.g. a query that's pure punctuation/stopwords and produces
    # a degenerate tsquery), so a keyword-search failure degrades to
    # vector-only rather than 500ing the whole request.
    keyword_rows: list = []
    try:
        tsvector = func.to_tsvector("greek", Embedding.chunk_text)
        tsquery = func.plainto_tsquery("greek", query)
        rank = func.ts_rank_cd(tsvector, tsquery).label("rank")
        keyword_stmt = (
            select(Embedding.id.label("embedding_id"), Embedding.chunk_text, rank, *_DOC_COLUMNS)
            .join(Document, Document.id == Embedding.document_id)
            .where(Document.status == "active")
            .where(visibility)
            .where(tsvector.op("@@")(tsquery))
            .order_by(rank.desc())
            .limit(_CANDIDATE_POOL_SIZE)
        )
        if region_id:
            keyword_stmt = keyword_stmt.where(Document.region_id.is_(None) | (Document.region_id == region_id))
        keyword_rows = db.execute(keyword_stmt).all()
    except DBAPIError:
        db.rollback()
        keyword_rows = []

    vector_by_id = {row.embedding_id: row for row in vector_rows}
    keyword_by_id = {row.embedding_id: row for row in keyword_rows}
    vector_rank = {row.embedding_id: i + 1 for i, row in enumerate(vector_rows)}
    keyword_rank = {row.embedding_id: i + 1 for i, row in enumerate(keyword_rows)}
    all_ids = set(vector_by_id) | set(keyword_by_id)

    # A chunk that only showed up via keyword search never got a real
    # cosine distance from Query A - backfill it with one small follow-up
    # query (a handful of rows, primary-key lookup) so every returned
    # chunk still reports an honest distance instead of a placeholder.
    keyword_only_ids = [eid for eid in all_ids if eid not in vector_by_id]
    backfilled_distance: dict[int, float] = {}
    if keyword_only_ids:
        backfill_stmt = select(Embedding.id.label("embedding_id"), distance.label("distance")).where(
            Embedding.id.in_(keyword_only_ids)
        )
        backfilled_distance = {row.embedding_id: float(row.distance) for row in db.execute(backfill_stmt)}

    scored = []
    for eid in all_ids:
        vrank = vector_rank.get(eid)
        krank = keyword_rank.get(eid)
        # Missing from a list -> treated as just past that list's pool
        # size for RRF purposes (never a false rank-1).
        rrf_score = 1.0 / (_RRF_K + (vrank or _CANDIDATE_POOL_SIZE + 1)) + 1.0 / (
            _RRF_K + (krank or _CANDIDATE_POOL_SIZE + 1)
        )
        row = vector_by_id.get(eid) or keyword_by_id[eid]
        chunk_distance = float(vector_by_id[eid].distance) if eid in vector_by_id else backfilled_distance[eid]
        scored.append((rrf_score, row, chunk_distance, vrank, krank))

    scored.sort(key=lambda item: item[0], reverse=True)

    return [
        RetrievedChunk(
            document_id=row.document_id,
            title=row.title,
            authority=row.authority,
            content_type=row.content_type,
            source=row.source,
            date=row.date.isoformat() if row.date else None,
            extraction_status=row.extraction_status,
            region_id=row.region_id,
            chunk_text=row.chunk_text,
            distance=chunk_distance,
            vector_rank=vrank,
            keyword_rank=krank,
            rrf_score=rrf_score,
        )
        for rrf_score, row, chunk_distance, vrank, krank in scored[:top_k]
    ]


def _passes_hybrid_threshold(hit: RetrievedChunk) -> bool:
    """Replaces the old plain `distance <= rag_max_distance` filter now that
    retrieval is hybrid: a hit is only excluded if it BOTH failed the
    vector distance threshold AND scored zero on keyword search (never
    matched the full-text query at all, keyword_rank is None). A hit that's
    a strong keyword match but a weak vector match is exactly what hybrid
    search exists to rescue, so it passes even with distance above
    rag_max_distance. Distance itself is still meaningful for a pure
    vector hit (keyword_rank is None), so that case falls back to the
    original threshold check unchanged.
    """
    return hit.distance <= settings.rag_max_distance or hit.keyword_rank is not None


def build_location_context(db: Session, project: Project | None) -> str | None:
    """Renders a project's resolved plot location as a Greek prose block for
    injection into the chat system prompt - returns None when the project
    has no lat/lon yet (nothing to say), rather than an empty/placeholder
    section."""
    if project is None or project.lat is None or project.lon is None:
        return None

    lines = [f"Συντεταγμένες: {project.lat}, {project.lon}"]
    if project.plot_address:
        lines.append(f"Διεύθυνση οικοπέδου: {project.plot_address}")
    if project.plot_municipality:
        lines.append(f"Δήμος: {project.plot_municipality}")
    if project.kaek:
        lines.append(f"ΚΑΕΚ: {project.kaek}")
    if project.plot_area_sqm:
        lines.append(f"Εμβαδόν οικοπέδου: {project.plot_area_sqm} τ.μ.")
    if project.gis_zone_name:
        lines.append(f"Πολεοδομική ζώνη: {project.gis_zone_name}")
    if project.plot_in_plan is True:
        lines.append("Ζώνη: Εντός σχεδίου πόλης")
    elif project.plot_in_plan is False:
        lines.append("Ζώνη: Εκτός σχεδίου πόλεως")
    if project.archaeological_flag:
        # archaeological_notes (set by check_archaeological_flag()) already
        # opens with "εντός Nμ. από τον αρχαιολογικό χώρο X" when site_name/
        # distance_m are known, so it's used as-is rather than having this
        # function prepend its own restatement of the same distance/site
        # fact ahead of it.
        lines.append(f"⚠ Αρχαιολογική Ζώνη: {project.archaeological_notes or 'πιθανή αρχαιολογική ζώνη στην περιοχή'}")

    # ΥΔΟΜ contact info is curated per-region (see admin.py's
    # /admin/regions endpoints), not part of the GIS resolve response, so
    # it's looked up here rather than stored on the project itself - a
    # region's curated contact details can change after the project's
    # location was resolved, and should reflect the current value.
    if project.region_id:
        region = db.get(Region, project.region_id)
        if region and (region.contact_phone or region.contact_email):
            contact_bits = []
            if region.ydom_authority_name:
                contact_bits.append(region.ydom_authority_name)
            if region.contact_phone:
                contact_bits.append(f"τηλ. {region.contact_phone}")
            if region.contact_email:
                contact_bits.append(f"email {region.contact_email}")
            lines.append(f"Στοιχεία επικοινωνίας ΥΔΟΜ: {', '.join(contact_bits)}")

    return "\n".join(lines)


def search_regulation(
    db: Session,
    user: CurrentUser,
    query: str,
    vertical_id: int,
    top_k: int | None = None,
    project_id: int | None = None,
    customer_id: int | None = None,
    plot_in_plan: bool | None = None,
) -> list[RetrievedChunk]:
    """Returns the top_k hybrid-ranked chunks, restricted to documents
    visible to this user (vertical/region-scoped access, needs_review
    suppression - the same visible_documents_filter used everywhere else),
    and further filtered by the hybrid threshold (see
    _passes_hybrid_threshold). An empty result means "nothing relevant
    enough was found," not "nothing exists" - the caller (chat.py) treats
    that as an honest gap, not a reason to lower the bar.
    """
    hits = _retrieve(
        db,
        user,
        query,
        top_k or settings.rag_top_k,
        vertical_id,
        project_id=project_id,
        customer_id=customer_id,
        plot_in_plan=plot_in_plan,
    )
    return [h for h in hits if _passes_hybrid_threshold(h)]


def search_documents(
    db: Session,
    user: CurrentUser,
    query: str,
    vertical_id: int,
    region_id: str | None = None,
    top_k: int | None = None,
) -> SearchOutcome:
    """Same retrieval as search_regulation, but for the standalone /search
    endpoint: reports the best distance seen even when nothing clears the
    bar, so the caller can explain *why* the result is empty (no candidates
    at all vs. candidates that were all too weak) instead of returning a
    bare empty list either way.
    """
    hits = _retrieve(db, user, query, top_k or settings.rag_top_k, vertical_id, region_id=region_id)
    best_distance = hits[0].distance if hits else None
    return SearchOutcome(
        hits=[h for h in hits if _passes_hybrid_threshold(h)],
        best_distance=best_distance,
    )
