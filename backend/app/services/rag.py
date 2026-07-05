"""Retrieval for the chat pipeline: embed the question, find the closest
chunks among documents the requesting user can actually see, and refuse to
hand back weak matches rather than let the model paper over a real gap.

Generation (the actual GPT call) lives in app/routers/chat.py, since the
system-prompt/citation-formatting concerns are specific to the one endpoint
that calls this - this module's only job is "what's actually relevant, and
is it relevant enough."
"""

from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import CurrentUser
from app.models import Document, Embedding
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
    chunk_text: str
    distance: float


def search_regulation(db: Session, user: CurrentUser, query: str, top_k: int | None = None) -> list[RetrievedChunk]:
    """Returns the top_k closest chunks by cosine distance, restricted to
    documents visible to this user (region-scoped access, needs_review
    suppression - the same visible_documents_filter used everywhere else),
    and further filtered to only those within rag_max_distance. An empty
    result means "nothing relevant enough was found," not "nothing exists" -
    the caller (chat.py) treats that as an honest gap, not a reason to
    lower the bar.
    """
    query_vector = embed_texts([query])[0]
    k = top_k or settings.rag_top_k

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

    distance = Embedding.embedding.cosine_distance(query_vector)
    stmt = (
        select(
            Embedding.chunk_text,
            distance.label("distance"),
            Document.id,
            Document.title,
            Document.authority,
            Document.content_type,
            Document.source,
            Document.date,
        )
        .join(Document, Document.id == Embedding.document_id)
        .where(Document.status == "active")
        .where(visible_documents_filter(db, user))
        .order_by(distance)
        .limit(k)
    )
    rows = db.execute(stmt).all()

    return [
        RetrievedChunk(
            document_id=row.id,
            title=row.title,
            authority=row.authority,
            content_type=row.content_type,
            source=row.source,
            date=row.date.isoformat() if row.date else None,
            chunk_text=row.chunk_text,
            distance=float(row.distance),
        )
        for row in rows
        if row.distance <= settings.rag_max_distance
    ]
