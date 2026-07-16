"""Retrieval for the chat pipeline: embed the question, find the closest
chunks among documents the requesting user can actually see, and refuse to
hand back weak matches rather than let the model paper over a real gap.

Generation (the actual GPT call) lives in app/routers/chat.py, since the
system-prompt/citation-formatting concerns are specific to the one endpoint
that calls this - this module's only job is "what's actually relevant, and
is it relevant enough."
"""

import re
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
# Max chunks any single document may contribute to a final top_k result set.
# Without this, one imperfect-but-broad document can fill 2-3 of top_k's
# slots with its own near-duplicate chunks, crowding out the honest signal
# that no genuinely relevant document exists at all - confirmed against the
# July 2026 stress benchmark round 3 (C1/C3/A4), where the same document
# filled multiple top-3 slots in cases that were real content gaps.
_MAX_CHUNKS_PER_DOCUMENT = 2

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


def decompose_query(query: str) -> list[str]:
    """
    Detects compound questions with multiple distinct topics and returns
    sub-queries for independent retrieval. Returns [query] unchanged if
    the question is not compound.

    Heuristic: compound if query contains 3+ distinct question markers
    (ποιες, πώς, πότε, τι, ποιος, ποια) OR explicit numbered list
    structure OR explicit "και" joining 4+ distinct clauses.
    """
    question_markers = len(re.findall(
        r'\b(ποιες|ποιος|ποια|πώς|πότε|τι|πού)\b',
        query, re.IGNORECASE
    ))

    # Split on "και" clauses or bullet structure if clearly compound
    if question_markers >= 4 or query.count('\n-') >= 3:
        # Split into logical sub-queries around key conjunctions
        # and question words - keep each sub-query self-contained
        parts = re.split(r',\s*(?=ποι|πώς|πότε|τι\s)', query, flags=re.IGNORECASE)
        if len(parts) >= 3:
            return [p.strip() for p in parts if len(p.strip()) > 20]

    return [query]


def _merge_decomposed_hits(chunk_lists: list[list["RetrievedChunk"]], top_k: int) -> list["RetrievedChunk"]:
    """Merges the independent per-sub-query retrieval passes fired by
    decompose_query(): dedupes by (document_id, chunk_text) - the same
    chunk can legitimately rank in more than one sub-query's pass - keeping
    whichever instance has the lowest distance.

    Deliberately NOT a flat global sort by distance, even though that's the
    obvious first thing to try: verified against Accounting Q1 of the
    stress benchmark (5 unrelated income types in one question) that a
    plain "pool everything, sort by distance, take top_k" merge lets
    whichever sub-query happens to be the longest, richest piece of text
    dominate every slot. A long sub-query (e.g. the whole original question
    minus its trailing asks) matches many documents reasonably well in
    aggregate and so scores uniformly lower absolute distances than a
    short, topically sharp sub-query like "which double-taxation treaties
    might apply" - even when that short sub-query's own top hit is exactly
    the document the question needs and the long one's hits are all
    generic. Distance scale isn't comparable across differently-shaped
    queries, so a flat sort silently starves the very sub-topics
    decomposition exists to rescue. Round-robin across sub-queries instead:
    each one gets a guaranteed turn in its own distance order, so a narrow
    sub-query's best (single) match survives into the merged pool even
    against a broad sub-query's many merely-decent ones. See
    KNOWN_DECISIONS.md for the concrete before/after citation lists."""
    best_by_key: dict[tuple[int, str], RetrievedChunk] = {}
    for chunks in chunk_lists:
        for chunk in chunks:
            key = (chunk.document_id, chunk.chunk_text)
            existing = best_by_key.get(key)
            if existing is None or chunk.distance < existing.distance:
                best_by_key[key] = chunk

    # Rebuild each sub-query's own ranked list, restricted to the chunks it
    # actually won the global dedup for (so one physical chunk counts
    # toward exactly one sub-query's round-robin turn).
    per_query_ranked = [
        sorted(
            (c for c in chunks if best_by_key.get((c.document_id, c.chunk_text)) is c),
            key=lambda c: c.distance,
        )
        for chunks in chunk_lists
    ]

    merged: list[RetrievedChunk] = []
    cursors = [0] * len(per_query_ranked)
    i = 0
    while len(merged) < top_k and any(cursors[q] < len(per_query_ranked[q]) for q in range(len(per_query_ranked))):
        q = i % len(per_query_ranked)
        if cursors[q] < len(per_query_ranked[q]):
            merged.append(per_query_ranked[q][cursors[q]])
            cursors[q] += 1
        i += 1
    return merged


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
    """Entry point for retrieval: runs decompose_query() on the raw question
    first. A genuinely compound, multi-topic question (see decompose_query's
    heuristic) gets one independent retrieval pass per sub-query - each
    pass's single embedded vector only has to serve one sub-topic instead
    of competing against the whole question's other asks for space in the
    same embedding - and the results are merged (_merge_decomposed_hits)
    before being handed back. A simple question is a single-element list
    and takes the unchanged single-pass path. See KNOWN_DECISIONS.md's
    stress-benchmark entries for the crowding-out failure mode this exists
    to fix (a compound question's minority sub-topics losing their best
    chunk to the majority sub-topics' content within one top_k window)."""
    sub_queries = decompose_query(query)
    if len(sub_queries) <= 1:
        return _retrieve_single_pass(
            db, user, query, top_k, vertical_id,
            region_id=region_id, project_id=project_id, customer_id=customer_id, plot_in_plan=plot_in_plan,
        )

    chunk_lists = [
        _retrieve_single_pass(
            db, user, sub_query, top_k, vertical_id,
            region_id=region_id, project_id=project_id, customer_id=customer_id, plot_in_plan=plot_in_plan,
        )
        for sub_query in sub_queries
    ]
    return _merge_decomposed_hits(chunk_lists, top_k)


def _retrieve_single_pass(
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
    """One retrieval pass for a single query string - the shared core for
    both the chat pipeline and the standalone /search endpoint: hybrid
    search combining vector cosine similarity and PostgreSQL full-text
    search, merged via Reciprocal Rank Fusion (RRF), restricted to
    documents visible to this user. Returns the top_k merged results
    unfiltered by confidence - callers decide what to do with
    distance/keyword_rank themselves (see _passes_hybrid_threshold).
    Called once directly by _retrieve() for a simple question, or once per
    sub-query when decompose_query() detects a compound one.

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

    # Diversity cap: walk the RRF-ranked pool and keep at most
    # _MAX_CHUNKS_PER_DOCUMENT chunks per document_id before cutting to
    # top_k, so a document that's merely broad-but-imperfect can't crowd out
    # every slot and manufacture false confidence that something relevant
    # was found (see _MAX_CHUNKS_PER_DOCUMENT). A document's best-scoring
    # chunks are kept since `scored` is already sorted by rrf_score.
    diversified = []
    per_document_count: dict[int, int] = {}
    for item in scored:
        doc_id = item[1].document_id
        if per_document_count.get(doc_id, 0) >= _MAX_CHUNKS_PER_DOCUMENT:
            continue
        per_document_count[doc_id] = per_document_count.get(doc_id, 0) + 1
        diversified.append(item)
        if len(diversified) >= top_k:
            break

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
        for rrf_score, row, chunk_distance, vrank, krank in diversified
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
