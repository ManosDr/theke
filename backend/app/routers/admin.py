from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import AuditLog, Company, Document
from app.schemas import AuditLogEntry, CompanySummary, DocumentSummary
from app.services.audit import log_action
from app.services.authorization import require_super_admin

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
            action=e.action,
            resource_type=e.resource_type,
            resource_id=e.resource_id,
            metadata=e.log_metadata,
            created_at=e.created_at,
        )
        for e in entries
    ]
