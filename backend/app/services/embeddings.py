"""Chunking + embedding (OpenAI text-embedding-3-small -> pgvector).

Only `full_text` documents are ever chunked and embedded - `reference_only`
docs have no `content` to embed at all, and `manual_entry_pending` /
`needs_review=true` documents are deliberately excluded even when they do
have some content, so a document known to be wrong or unverified can never
surface as a citation (see app/services/rag.py and KNOWN_DECISIONS.md's
needs_review entry - the same "don't let this pass as normal content"
principle applies here).
"""

import logging

from openai import BadRequestError, OpenAI
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Document, Embedding

logger = logging.getLogger(__name__)

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def _split_oversized(paragraph: str, chunk_size: int) -> list[str]:
    """PyMuPDF-extracted Greek government PDFs often have no double-newlines
    at all (a whole multi-page section can come out as one giant
    "paragraph"), which broke the embeddings API's combined-request token
    budget even after halving the batch - a single chunk that's inherently
    too long can't be fixed by batching. Falls back to splitting on single
    newlines, and finally to a hard character slice, so no chunk can ever
    exceed chunk_size regardless of how the source PDF was laid out."""
    if len(paragraph) <= chunk_size:
        return [paragraph]
    lines = [l.strip() for l in paragraph.split("\n") if l.strip()]
    if len(lines) > 1:
        pieces: list[str] = []
        current = ""
        for line in lines:
            # +1 accounts for the "\n" this line will be joined with below -
            # omitting it let `current` end up one character over chunk_size,
            # which then recursed on itself forever (the same lines,
            # repacked by the same deterministic logic, produce the same
            # oversized piece every time - see KNOWN_DECISIONS.md).
            if current and len(current) + 1 + len(line) > chunk_size:
                pieces.append(current)
                current = ""
            current = f"{current}\n{line}" if current else line
        if current:
            pieces.append(current)
        # Guaranteed-terminating recursion: only recurse on a piece that's
        # strictly smaller than the paragraph we were given. If packing
        # somehow didn't shrink it (a single line longer than chunk_size,
        # or any other edge case not accounted for above), hard-slice it
        # directly instead of recursing on effectively the same input.
        result = []
        for piece in pieces:
            if len(piece) < len(paragraph):
                result.extend(_split_oversized(piece, chunk_size))
            else:
                result.extend(paragraph[i : i + chunk_size] for i in range(0, len(paragraph), chunk_size))
        return result
    return [paragraph[i : i + chunk_size] for i in range(0, len(paragraph), chunk_size)]


def chunk_text(text: str, chunk_size: int = 1000, overlap_paragraphs: int = 1) -> list[str]:
    """Paragraph-aware greedy chunking: packs whole paragraphs into ~chunk_size
    -character windows rather than splitting mid-sentence. Repeats the last
    `overlap_paragraphs` paragraph(s) of each chunk at the start of the next,
    so a fact stated right at a chunk boundary isn't only ever half-visible
    to the embedding model.
    """
    raw_paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    paragraphs = [piece for para in raw_paragraphs for piece in _split_oversized(para, chunk_size)]
    if not paragraphs:
        return []

    def joined_len(paras: list[str]) -> int:
        return sum(len(p) for p in paras) + 2 * max(0, len(paras) - 1)

    chunks: list[str] = []
    current: list[str] = []

    for para in paragraphs:
        # `current` is always kept <= chunk_size (checked before every append,
        # below), so the overlap carried forward from it is too - the only
        # thing that can push a chunk over budget is this next `para`, which
        # is why both the overflow check and the overlap-fits check compare
        # against it directly rather than trusting current_len bookkeeping
        # (a prior version tracked current_len separately from `current` and
        # appended `para` unconditionally after carrying the overlap over,
        # which let overlap+para silently double chunk_size - see git log).
        if current and joined_len(current + [para]) > chunk_size:
            chunks.append("\n\n".join(current))
            overlap = current[-overlap_paragraphs:] if overlap_paragraphs else []
            current = overlap if joined_len(overlap + [para]) <= chunk_size else []
        current.append(para)

    if current:
        chunks.append("\n\n".join(current))

    return chunks


def _embed_batch(client: OpenAI, batch: list[str]) -> list[list[float]]:
    """Embeds one batch, splitting it in half and retrying on the API's
    "maximum context length" error - the limit is on the combined token
    count across the whole request, not per chunk, so no fixed batch_size
    is safe for every mix of chunk lengths. Halving converges quickly and
    avoids needing a tokenizer dependency just to pre-count tokens."""
    if len(batch) == 1:
        resp = client.embeddings.create(model=settings.embedding_model, input=batch)
        return [item.embedding for item in resp.data]
    try:
        resp = client.embeddings.create(model=settings.embedding_model, input=batch)
        return [item.embedding for item in resp.data]
    except BadRequestError as exc:
        if "maximum context length" not in str(exc):
            raise
        mid = len(batch) // 2
        return _embed_batch(client, batch[:mid]) + _embed_batch(client, batch[mid:])


def embed_texts(texts: list[str], batch_size: int = 100) -> list[list[float]]:
    if not texts:
        return []
    client = _get_client()
    vectors: list[list[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        vectors.extend(_embed_batch(client, batch))
    return vectors


def embed_document(db: Session, document: Document) -> int:
    """Chunk + embed a single document, storing rows in `embeddings`.
    Idempotent: does nothing if this document already has embeddings, so
    it's safe to call repeatedly from a catch-up sweep."""
    existing = db.scalar(select(Embedding.id).where(Embedding.document_id == document.id).limit(1))
    if existing is not None:
        return 0
    if not document.content:
        return 0

    chunks = chunk_text(document.content)
    if not chunks:
        return 0

    vectors = embed_texts(chunks)
    for idx, (chunk, vector) in enumerate(zip(chunks, vectors)):
        db.add(Embedding(document_id=document.id, chunk_index=idx, chunk_text=chunk, embedding=vector))
    db.commit()
    return len(chunks)


def embed_pending_documents(db: Session) -> dict[str, int]:
    """Catch-up sweep: embeds every eligible document that doesn't have
    embeddings yet. Eligible = active, full_text, not flagged needs_review.
    Run at backend startup and periodically (see app/main.py) rather than
    hooked directly into the crawler, since the crawler is a separate
    process/dependency stack with no OpenAI client of its own."""
    already_embedded = select(Embedding.document_id).distinct()
    stmt = select(Document).where(
        Document.status == "active",
        Document.extraction_status == "full_text",
        Document.needs_review.is_(False),
        Document.content.isnot(None),
        Document.id.notin_(already_embedded),
    )
    pending = db.scalars(stmt).all()

    documents_embedded = 0
    documents_failed = 0
    chunks_created = 0
    for doc in pending:
        try:
            count = embed_document(db, doc)
        except Exception:
            logger.exception("Failed to embed document id=%s, continuing with the rest", doc.id)
            db.rollback()
            documents_failed += 1
            continue
        if count:
            documents_embedded += 1
            chunks_created += count

    return {
        "documents_evaluated": len(pending),
        "documents_embedded": documents_embedded,
        "documents_failed": documents_failed,
        "chunks_created": chunks_created,
    }
