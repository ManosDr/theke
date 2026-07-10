import os
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import AuditLog, ChatSession, Company, Customer, DataSource, Document, Invite, Project, User, Vertical
from app.schemas import (
    ActivityEventEntry,
    AuditLogEntry,
    CompanyDocumentSummary,
    CompanyOverviewResponse,
    InviteCreateRequest,
    InviteSummary,
    KbSourceStatusEntry,
    MyCompanySummary,
    RoleChangeRequest,
    UserSummary,
)
from app.services.audit import log_action
from app.services.authorization import require_company_admin
from app.services.documents import UPLOAD_DIR
from app.services.sources import group_label
from app.services.visibility import visible_documents_filter

router = APIRouter(prefix="/companies/me", tags=["companies"])
# Unauthenticated - serving a company's logo isn't sensitive, and the login/
# branding UI needs to fetch it before a user has a token.
public_router = APIRouter(prefix="/companies", tags=["companies"])

INVITE_VALID_DAYS = 7
LOGO_MAX_BYTES = 2 * 1024 * 1024  # 2MB
LOGO_CONTENT_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg"}


@router.get("", response_model=MyCompanySummary)
async def get_my_company(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MyCompanySummary:
    if not user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account has no company")

    company = db.get(Company, user.company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    vertical = db.get(Vertical, company.vertical_id)
    has_logo = bool(company.logo_path and os.path.exists(company.logo_path))
    return MyCompanySummary(
        id=company.id,
        name=company.name,
        type=company.type,
        has_logo=has_logo,
        logo_url=f"/companies/{company.id}/logo" if has_logo else None,
        vertical_slug=vertical.slug if vertical else "construction",
        vertical_display_name=vertical.display_name if vertical else "",
        vertical_tagline=vertical.tagline if vertical else None,
        vertical_welcome_message=vertical.welcome_message if vertical else None,
        vertical_disclaimer_text=vertical.disclaimer_text if vertical else None,
        vertical_uses_regional_scoping=vertical.uses_regional_scoping if vertical else True,
    )


@router.post("/logo", status_code=status.HTTP_204_NO_CONTENT)
async def upload_logo(
    file: UploadFile,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_company_admin(user)

    ext = LOGO_CONTENT_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be PNG, JPEG, WEBP, or SVG"
        )

    data = await file.read()
    if len(data) > LOGO_MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo must be under 2MB")

    logos_dir = os.path.join(UPLOAD_DIR, "logos")
    os.makedirs(logos_dir, exist_ok=True)
    # Fixed filename per company (not content-hashed) - a re-upload should
    # simply replace the old logo, not accumulate versions.
    logo_path = os.path.join(logos_dir, f"{user.company_id}.{ext}")
    with open(logo_path, "wb") as f:
        f.write(data)

    company = db.get(Company, user.company_id)
    company.logo_path = logo_path
    log_action(db, actor_user_id=user.user_id, company_id=user.company_id, action="logo_updated")
    db.commit()


@router.delete("/logo", status_code=status.HTTP_204_NO_CONTENT)
async def delete_logo(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_company_admin(user)

    company = db.get(Company, user.company_id)
    if company.logo_path and os.path.exists(company.logo_path):
        os.remove(company.logo_path)
    company.logo_path = None
    log_action(db, actor_user_id=user.user_id, company_id=user.company_id, action="logo_removed")
    db.commit()


@public_router.get("/{company_id}/logo")
async def get_company_logo(company_id: int, db: Session = Depends(get_db)) -> FileResponse:
    company = db.get(Company, company_id)
    if not company or not company.logo_path or not os.path.exists(company.logo_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set for this company")
    # The upload/removal endpoints reuse this same URL for every version of
    # a company's logo (fixed filename per company, see upload_logo) - with
    # no cache-control header, browsers apply heuristic caching from
    # FileResponse's own Last-Modified and can keep serving a stale image
    # indefinitely after a re-upload. no-cache forces revalidation (a cheap
    # 304 when unchanged) instead of a hard stale-forever cache.
    return FileResponse(company.logo_path, headers={"Cache-Control": "no-cache"})


@router.post("/invites", response_model=InviteSummary, status_code=status.HTTP_201_CREATED)
async def create_invite(
    payload: InviteCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> InviteSummary:
    require_company_admin(user)
    if payload.role not in ("admin", "member"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role must be 'admin' or 'member'")
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already registered")

    company = db.get(Company, user.company_id)
    invite = Invite(
        company_id=user.company_id,
        email=payload.email,
        token=secrets.token_urlsafe(24),
        role=payload.role,
        invited_by=user.user_id,
        # Derived from the inviting company, never chosen manually - see
        # GET /auth/invite-info/{token}, which is what the invitee's
        # registration form reads this back through.
        vertical_id=company.vertical_id if company else None,
        expires_at=datetime.utcnow() + timedelta(days=INVITE_VALID_DAYS),
    )
    db.add(invite)
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="invite_created",
        resource_type="invite",
        metadata={"email": payload.email, "role": payload.role},
    )
    db.commit()
    db.refresh(invite)

    return InviteSummary(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        token=invite.token,
        created_at=invite.created_at,
        expires_at=invite.expires_at,
    )


@router.get("/invites", response_model=list[InviteSummary])
async def list_invites(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[InviteSummary]:
    require_company_admin(user)
    invites = db.scalars(
        select(Invite).where(Invite.company_id == user.company_id).order_by(Invite.created_at.desc())
    ).all()
    return [
        InviteSummary(
            id=i.id,
            email=i.email,
            role=i.role,
            status=i.status,
            created_at=i.created_at,
            expires_at=i.expires_at,
        )
        for i in invites
    ]


@router.post("/invites/{invite_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_company_admin(user)
    invite = db.get(Invite, invite_id)
    if not invite or invite.company_id != user.company_id or invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending invite not found")

    invite.status = "revoked"
    log_action(
        db, actor_user_id=user.user_id, company_id=user.company_id, action="invite_revoked", resource_type="invite", resource_id=invite.id
    )
    db.commit()


@router.get("/users", response_model=list[UserSummary])
async def list_company_users(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[UserSummary]:
    require_company_admin(user)
    users = db.scalars(select(User).where(User.company_id == user.company_id)).all()

    since_30d = datetime.utcnow() - timedelta(days=30)
    message_counts: dict[int, int] = {}
    if users:
        rows = db.execute(
            select(ChatSession.user_id, func.count())
            .where(ChatSession.user_id.in_([u.id for u in users]), ChatSession.created_at >= since_30d)
            .group_by(ChatSession.user_id)
        ).all()
        message_counts = dict(rows)

    return [
        UserSummary(
            id=u.id,
            email=u.email,
            name=u.name,
            phone=u.phone,
            role=u.role,
            is_active=u.is_active,
            created_at=u.created_at,
            last_login_at=u.last_login_at,
            messages_30d=message_counts.get(u.id, 0),
        )
        for u in users
    ]


@router.post("/users/{user_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_company_admin(user)
    target = db.get(User, user_id)
    if not target or target.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in your company")
    if target.id == user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot revoke your own access")

    target.is_active = False
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="access_revoked",
        resource_type="user",
        resource_id=target.id,
    )
    db.commit()


@router.post("/users/{user_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def restore_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_company_admin(user)
    target = db.get(User, user_id)
    if not target or target.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in your company")

    target.is_active = True
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="access_restored",
        resource_type="user",
        resource_id=target.id,
    )
    db.commit()


@router.patch("/users/{user_id}/role", response_model=UserSummary)
async def change_user_role(
    user_id: int,
    payload: RoleChangeRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> UserSummary:
    require_company_admin(user)
    if payload.role not in ("admin", "member"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role must be 'admin' or 'member'")

    target = db.get(User, user_id)
    if not target or target.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in your company")

    if target.role == "admin" and payload.role == "member":
        other_admins = db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.company_id == user.company_id, User.role == "admin", User.id != target.id)
        )
        if other_admins == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot demote the company's only remaining admin"
            )

    previous_role = target.role
    target.role = payload.role
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="role_changed",
        resource_type="user",
        resource_id=target.id,
        metadata={"from": previous_role, "to": payload.role},
    )
    db.commit()
    db.refresh(target)

    return UserSummary(id=target.id, email=target.email, role=target.role, is_active=target.is_active, created_at=target.created_at)


@router.get("/audit-log", response_model=list[AuditLogEntry])
async def company_audit_log(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[AuditLogEntry]:
    require_company_admin(user)
    entries = db.scalars(
        select(AuditLog).where(AuditLog.company_id == user.company_id).order_by(AuditLog.created_at.desc()).limit(200)
    ).all()
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


@router.get("/overview", response_model=CompanyOverviewResponse)
async def company_overview(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CompanyOverviewResponse:
    require_company_admin(user)
    company_id = user.company_id

    since_30d = datetime.utcnow() - timedelta(days=30)

    users = db.scalars(select(User).where(User.company_id == company_id)).all()
    active_user_ids = set(
        db.scalars(
            select(ChatSession.user_id)
            .where(ChatSession.company_id == company_id, ChatSession.created_at >= since_30d)
            .distinct()
        ).all()
    )

    messages_30d = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(ChatSession.company_id == company_id, ChatSession.created_at >= since_30d)
        )
        or 0
    )
    gap_30d = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(
                ChatSession.company_id == company_id,
                ChatSession.created_at >= since_30d,
                ChatSession.gap.is_(True),
            )
        )
        or 0
    )

    customers_total = db.scalar(select(func.count()).select_from(Customer).where(Customer.company_id == company_id)) or 0
    projects_total = db.scalar(select(func.count()).select_from(Project).where(Project.company_id == company_id)) or 0
    private_documents_count = (
        db.scalar(
            select(func.count())
            .select_from(Document)
            .where(Document.company_id == company_id, Document.project_id.isnot(None), Document.status == "active")
        )
        or 0
    )
    vertical = db.get(Vertical, db.get(Company, company_id).vertical_id)
    public_documents_count = (
        db.scalar(
            select(func.count())
            .select_from(Document)
            .where(Document.company_id.is_(None), Document.status == "active")
            .where(visible_documents_filter(db, user, vertical.id))
        )
        or 0
    )

    # Last 10 events across chat/document/project/customer/invite - built as
    # a merge of each table's own recent rows (bounded per-table) rather than
    # a single audit_log query, since not every one of these event types is
    # audit-logged today (see log_action call sites) - project/customer
    # creation in particular have no actor column on their own tables, so
    # those two events surface without an actor_name rather than guessing one.
    events: list[ActivityEventEntry] = []

    recent_messages = db.scalars(
        select(ChatSession).where(ChatSession.company_id == company_id).order_by(ChatSession.created_at.desc()).limit(10)
    ).all()
    user_names = {u.id: (u.name or u.email) for u in users}
    for m in recent_messages:
        events.append(
            ActivityEventEntry(
                type="chat_message",
                created_at=m.created_at,
                description=(m.message or "")[:80],
                actor_name=user_names.get(m.user_id),
            )
        )

    recent_docs = db.scalars(
        select(Document)
        .where(Document.company_id == company_id, Document.project_id.isnot(None))
        .order_by(Document.created_at.desc())
        .limit(10)
    ).all()
    for d in recent_docs:
        events.append(
            ActivityEventEntry(
                type="document_uploaded",
                created_at=d.created_at,
                description=d.title or "Έγγραφο",
                actor_name=user_names.get(d.uploaded_by),
            )
        )

    recent_projects = db.scalars(
        select(Project).where(Project.company_id == company_id).order_by(Project.created_at.desc()).limit(10)
    ).all()
    for p in recent_projects:
        events.append(ActivityEventEntry(type="project_created", created_at=p.created_at, description=p.name or "Έργο"))

    recent_customers = db.scalars(
        select(Customer).where(Customer.company_id == company_id).order_by(Customer.created_at.desc()).limit(10)
    ).all()
    for c in recent_customers:
        events.append(ActivityEventEntry(type="customer_added", created_at=c.created_at, description=c.name))

    recent_invites = db.scalars(
        select(Invite)
        .where(Invite.company_id == company_id, Invite.status == "accepted", Invite.accepted_at.isnot(None))
        .order_by(Invite.accepted_at.desc())
        .limit(10)
    ).all()
    for i in recent_invites:
        events.append(
            ActivityEventEntry(
                type="user_joined",
                created_at=i.accepted_at,
                description=i.email,
                actor_name=user_names.get(i.invited_by),
            )
        )

    events.sort(key=lambda e: e.created_at, reverse=True)

    total_tokens_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.total_tokens), 0)).where(
                ChatSession.company_id == company_id, ChatSession.created_at >= since_30d
            )
        )
        or 0
    )
    estimated_cost_eur_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0)).where(
                ChatSession.company_id == company_id, ChatSession.created_at >= since_30d
            )
        )
        or 0
    )

    return CompanyOverviewResponse(
        users_total=len(users),
        users_active_30d=len(active_user_ids),
        messages_30d=messages_30d,
        gap_rate=round(gap_30d / messages_30d * 100, 1) if messages_30d else 0.0,
        customers_total=customers_total,
        projects_total=projects_total,
        private_documents_count=private_documents_count,
        public_documents_count=public_documents_count,
        total_tokens_30d=int(total_tokens_30d),
        estimated_cost_eur_30d=round(float(estimated_cost_eur_30d), 4),
        activity=events[:10],
    )


@router.get("/documents", response_model=list[CompanyDocumentSummary])
async def company_documents(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[CompanyDocumentSummary]:
    require_company_admin(user)
    rows = db.execute(
        select(Document, Project.name)
        .outerjoin(Project, Project.id == Document.project_id)
        .where(Document.company_id == user.company_id, Document.project_id.isnot(None), Document.status == "active")
        .order_by(Document.created_at.desc())
    ).all()
    return [
        CompanyDocumentSummary(
            id=d.id,
            title=d.title,
            project_id=d.project_id,
            project_name=project_name,
            doc_type=d.doc_type,
            extraction_status=d.extraction_status,
            created_at=d.created_at,
        )
        for d, project_name in rows
    ]


@router.get("/kb-status", response_model=list[KbSourceStatusEntry])
async def company_kb_status(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[KbSourceStatusEntry]:
    require_company_admin(user)
    company = db.get(Company, user.company_id)
    vertical = db.get(Vertical, company.vertical_id)

    sources = db.scalars(select(DataSource).where(DataSource.vertical_id == vertical.id).order_by(DataSource.name)).all()

    # Several raw DataSource rows can share one human-facing group label
    # (e.g. e-ΕΦΚΑ has two crawler entries) - same grouping list_sources()
    # already applies for the Sources page, aggregated here rather than
    # shown as separate rows so the count/health reflects the whole group.
    groups: dict[str, dict] = {}
    for s in sources:
        doc_count = (
            db.scalar(
                select(func.count())
                .select_from(Document)
                .where(Document.source_name == s.name, Document.status == "active")
                .where(visible_documents_filter(db, user, vertical.id))
            )
            or 0
        )
        if doc_count == 0:
            # A source with no documents visible to this company (e.g. a
            # different region's utility provider) isn't relevant to show -
            # this is the same scoping DataSourcesPanel would apply if it
            # were company-scoped instead of admin-global.
            continue

        if not s.is_active:
            health = "inactive"
        elif not s.last_crawled_at:
            health = "never_synced"
        elif s.last_crawl_status and "fail" in s.last_crawl_status.lower():
            health = "failed"
        elif s.next_crawl_at and s.next_crawl_at < datetime.utcnow():
            health = "overdue"
        else:
            health = "healthy"

        label = group_label(s.name)
        existing = groups.get(label)
        if not existing:
            groups[label] = {
                "document_count": doc_count,
                "last_crawled_at": s.last_crawled_at,
                "next_crawl_at": s.next_crawl_at,
                "health": health,
            }
        else:
            existing["document_count"] += doc_count
            if s.last_crawled_at and (not existing["last_crawled_at"] or s.last_crawled_at > existing["last_crawled_at"]):
                existing["last_crawled_at"] = s.last_crawled_at
            if s.next_crawl_at and (not existing["next_crawl_at"] or s.next_crawl_at < existing["next_crawl_at"]):
                existing["next_crawl_at"] = s.next_crawl_at
            _HEALTH_PRIORITY = ["failed", "overdue", "inactive", "never_synced", "healthy"]
            if _HEALTH_PRIORITY.index(health) < _HEALTH_PRIORITY.index(existing["health"]):
                existing["health"] = health

    return [
        KbSourceStatusEntry(source_name=label, **fields)
        for label, fields in sorted(groups.items())
    ]
