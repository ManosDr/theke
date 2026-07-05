import logging

from fastapi import APIRouter, Depends, HTTPException, status
from openai import OpenAIError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.schemas import SearchRequest, SearchResponse, SearchResultItem
from app.services.rag import search_documents

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/search", tags=["search"])

MAX_QUERY_LENGTH = 500
QUERY_TOO_LONG_MESSAGE = f"Η ερώτηση δεν πρέπει να υπερβαίνει τους {MAX_QUERY_LENGTH} χαρακτήρες."
SERVICE_UNAVAILABLE_MESSAGE = "Η υπηρεσία δεν είναι διαθέσιμη αυτή τη στιγμή. Δοκιμάστε ξανά σε λίγο."


@router.post("", response_model=SearchResponse)
def search(
    payload: SearchRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SearchResponse:
    """Semantic (embedding) search only - no completion is generated here,
    deliberately: this stays a lightweight introspection endpoint (real
    distances, real visibility scoping) rather than gaining an off-topic
    guard or rate limit of its own - see /chat/message for those. Exists to
    let search quality be inspected directly before Phase 2.3 wired
    retrieval into /chat's GPT call. needs_review documents are excluded by
    visible_documents_filter regardless of how close a match they'd
    otherwise be - see app/services/visibility.py.
    """
    if len(payload.query) > MAX_QUERY_LENGTH:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=QUERY_TOO_LONG_MESSAGE)

    try:
        outcome = search_documents(db, user, payload.query, region_id=payload.region_id, top_k=payload.top_k)
    except OpenAIError as exc:
        logger.error("OpenAI embedding failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=SERVICE_UNAVAILABLE_MESSAGE) from exc

    if not outcome.hits:
        reason = (
            "No documents are available in your visible knowledge base for this query."
            if outcome.best_distance is None
            else (
                f"No results met the minimum confidence threshold "
                f"(closest match distance {outcome.best_distance:.3f}, threshold {settings.rag_max_distance})."
            )
        )
        return SearchResponse(results=[], reason=reason)

    return SearchResponse(
        results=[
            SearchResultItem(
                document_id=hit.document_id,
                title=hit.title,
                authority=hit.authority,
                source_url=hit.source,
                date=hit.date,
                content_type=hit.content_type,
                extraction_status=hit.extraction_status,
                chunk_text=hit.chunk_text,
                distance=hit.distance,
            )
            for hit in outcome.hits
        ],
        reason=None,
    )
