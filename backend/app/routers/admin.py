from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import AuditLog, ChatSession, Company, Document, MessageFeedback
from app.schemas import (
    AdminStatsResponse,
    AuditLogEntry,
    CompanySummary,
    DocumentSummary,
    MarkReviewedRequest,
    StaleDocumentSummary,
)
from app.services.audit import log_action
from app.services.authorization import require_super_admin
from app.services.sources import group_label

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/companies", response_model=list[CompanySummary])
async def list_companies(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[CompanySummary]:
    require_super_admin(user)
    companies = db.scalars(select(Company)).all()
    return [
        CompanySummary(id=c.id, name=c.name, type=c.type, is_suspended=c.is_suspended, created_at=c.created_at)
        for c in companies
    ]


@router.post("/companies/{company_id}/suspend", status_code=status.HTTP_204_NO_CONTENT)
async def suspend_company(
    company_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    company.is_suspended = True
    log_action(db, actor_user_id=user.user_id, company_id=company.id, action="company_suspended")
    db.commit()


@router.post("/companies/{company_id}/unsuspend", status_code=status.HTTP_204_NO_CONTENT)
async def unsuspend_company(
    company_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    company.is_suspended = False
    log_action(db, actor_user_id=user.user_id, company_id=company.id, action="company_unsuspended")
    db.commit()


@router.get("/documents", response_model=list[DocumentSummary])
async def search_public_documents(
    q: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[DocumentSummary]:
    """Search the crawled public knowledge base (company_id IS NULL) - the
    only management surface a super_admin has over it, since the crawler is
    otherwise the sole writer. Includes non-active docs so a bad removal can
    be reviewed/audited, unlike the tenant-facing /documents/search.
    """
    require_super_admin(user)
    stmt = (
        select(Document)
        .where(Document.company_id.is_(None))
        .where(
            text("to_tsvector('greek', coalesce(title, '') || ' ' || coalesce(content, '')) @@ plainto_tsquery('greek', :q)")
        )
        .params(q=q)
        .limit(50)
    )
    results = db.scalars(stmt).all()
    return [
        DocumentSummary(
            id=doc.id,
            title=doc.title,
            snippet=(doc.content[:280] if doc.content else None),
            source=doc.source,
            doc_type=doc.doc_type,
            municipality=doc.municipality,
        )
        for doc in results
    ]


@router.post("/documents/{document_id}/remove", status_code=status.HTTP_204_NO_CONTENT)
async def remove_public_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    doc = db.get(Document, document_id)
    if not doc or doc.company_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Public document not found")

    doc.status = "removed"
    log_action(db, actor_user_id=user.user_id, company_id=None, action="document_removal_approved", resource_type="document", resource_id=doc.id)
    db.commit()


@router.get("/stale-documents", response_model=list[StaleDocumentSummary])
async def list_stale_documents(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[StaleDocumentSummary]:
    """Manual review queue populated by the weekly staleness sweep
    (crawler/crawler/staleness.py) - flags public KB documents whose
    last_verified_at is missing or older than 6 months. Oldest first, since
    that's the most overdue.
    """
    require_super_admin(user)
    docs = db.scalars(
        select(Document)
        .where(Document.company_id.is_(None), Document.status == "active", Document.needs_review.is_(True))
        .order_by(Document.last_verified_at.asc().nullsfirst())
    ).all()
    return [
        StaleDocumentSummary(
            id=doc.id,
            title=doc.title,
            source=doc.source,
            source_group=group_label(doc.source_name) if doc.source_name else None,
            region_id=doc.region_id,
            last_verified_at=doc.last_verified_at,
        )
        for doc in docs
    ]


@router.post("/stale-documents/{document_id}/mark-reviewed", status_code=status.HTTP_204_NO_CONTENT)
async def mark_document_reviewed(
    document_id: int,
    payload: MarkReviewedRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """The mechanism KNOWN_DECISIONS.md flagged as missing: clears
    needs_review once a human has actually looked at the document, and
    resets last_verified_at to today so the weekly staleness sweep doesn't
    immediately re-flag it for being 6+ months old. Doesn't re-trigger a
    re-crawl - that's a separate, unbuilt concern (see KNOWN_DECISIONS.md).

    Requires payload.confirmed=True: clearing the flag can't itself verify
    the underlying content was actually fixed (confirmed concretely while
    testing this - a document whose content was still the original decoy-
    bug garbage became fully visible in chat/search the moment the flag
    was cleared). The confirmation is enforced here, not just as a
    disabled frontend button, so a direct API call can't bypass the same
    judgment call a human is supposed to be making.
    """
    require_super_admin(user)
    if not payload.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirm the content has actually been verified before clearing needs_review",
        )
    doc = db.get(Document, document_id)
    if not doc or doc.company_id is not None or not doc.needs_review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flagged public document not found")

    doc.needs_review = False
    doc.last_verified_at = date.today()
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="document_marked_reviewed",
        resource_type="document",
        resource_id=doc.id,
    )
    db.commit()


@router.get("/stats", response_model=AdminStatsResponse)
async def platform_stats(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AdminStatsResponse:
    """Live-queried, not cached - this is a soft-launch-scale dashboard
    (see KNOWN_DECISIONS.md on when to revisit), not a metrics pipeline."""
    require_super_admin(user)
    total_messages = db.scalar(select(func.count()).select_from(ChatSession)) or 0
    gap_count = db.scalar(select(func.count()).select_from(ChatSession).where(ChatSession.gap.is_(True))) or 0
    gap_rate = round(gap_count / total_messages * 100, 1) if total_messages else 0.0
    active_documents = db.scalar(select(func.count()).select_from(Document).where(Document.status == "active")) or 0
    positive_feedback = (
        db.scalar(select(func.count()).select_from(MessageFeedback).where(MessageFeedback.rating == "positive")) or 0
    )
    negative_feedback = (
        db.scalar(select(func.count()).select_from(MessageFeedback).where(MessageFeedback.rating == "negative")) or 0
    )
    return AdminStatsResponse(
        total_messages=total_messages,
        gap_rate=gap_rate,
        active_documents=active_documents,
        positive_feedback=positive_feedback,
        negative_feedback=negative_feedback,
    )


@router.get("/audit-log", response_model=list[AuditLogEntry])
async def platform_audit_log(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[AuditLogEntry]:
    require_super_admin(user)
    entries = db.scalars(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200)).all()
    return [
        AuditLogEntry(
            id=e.id,
            actor_user_id=e.actor_user_id,
            company_id=e.company_id,
            action=e.action,
            resource_type=e.resource_type,
            resource_id=e.resource_id,
            metadata=e.log_metadata,
            created_at=e.created_at,
        )
        for e in entries
    ]
