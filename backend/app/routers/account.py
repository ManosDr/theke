"""Data-retention/deletion compliance endpoints (Phase 0 - see
KNOWN_DECISIONS.md). Two things live here:
  - POST /account/request-deletion: starts the 30-day hard-delete clock
    (see crawler/crawler/retention_cleanup.py, the weekly job that actually
    performs the deletion this endpoint only schedules).
  - GET /account/export: the right-to-portability counterpart - a
    self-serve JSON export, independent of any deletion request.
"""

import json
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import ChatSession, Company, Document, User
from app.services.authorization import require_company_admin
from app.services.notifications import notify_super_admins

router = APIRouter(prefix="/account", tags=["account"])


@router.post("/request-deletion", status_code=204)
async def request_deletion(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Company-admin only. Idempotent: a second call after the first doesn't
    reset the clock - deletion_requested_at is set once and left alone,
    since re-arming a 30-day window every time someone re-clicks the button
    would let the deadline be pushed out indefinitely, defeating the point
    of a firm deadline. Works whether the company is active or already
    cancelled - the 30-day clock always overrides the 60-day
    post-cancellation window regardless of which state it started from (see
    retention_cleanup.py's _compute_deadline)."""
    require_company_admin(user)
    company = db.get(Company, user.company_id)
    if company.deletion_requested_at is None:
        company.deletion_requested_at = datetime.utcnow()
        deadline = company.deletion_requested_at + timedelta(days=30)
        notify_super_admins(
            db,
            type="deletion_requested",
            title=f"{company.name} requested data deletion",
            body=f"Hard-delete deadline: {deadline.date().isoformat()} (30 days from request, "
            "overrides any cancellation window). Handled automatically by the weekly retention job.",
            link="/admin/companies",
        )
        db.commit()


@router.get("/export")
async def export_data(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Every authenticated user can export their own company's data - not
    company-admin-gated, since this is the individual's right-to-portability
    request, not a company-management action. Document metadata only
    (title/type/date/status), never document content - content export would
    duplicate the whole KB upload, which isn't what "my data" means here."""
    db_user = db.get(User, user.user_id)
    company = db.get(Company, user.company_id) if user.company_id else None

    chat_sessions = (
        db.scalars(select(ChatSession).where(ChatSession.company_id == user.company_id).order_by(ChatSession.id))
        if user.company_id
        else []
    )
    documents = (
        db.scalars(select(Document).where(Document.company_id == user.company_id).order_by(Document.id))
        if user.company_id
        else []
    )

    payload = {
        "exported_at": datetime.utcnow().isoformat(),
        "account": {
            "email": db_user.email,
            "first_name": db_user.first_name,
            "last_name": db_user.last_name,
            "phone": db_user.phone,
            "role": db_user.role,
            "created_at": db_user.created_at.isoformat(),
        },
        "company": (
            {"name": company.name, "type": company.type, "created_at": company.created_at.isoformat()}
            if company
            else None
        ),
        "chat_history": [
            {
                "message": s.message,
                "response": s.response,
                "gap": s.gap,
                "created_at": s.created_at.isoformat(),
            }
            for s in chat_sessions
        ],
        "documents": [
            {
                "title": d.title,
                "doc_type": d.doc_type,
                "status": d.status,
                "created_at": d.created_at.isoformat(),
            }
            for d in documents
        ],
    }

    body = json.dumps(payload, ensure_ascii=False, indent=2)
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=theke-data-export.json"},
    )
