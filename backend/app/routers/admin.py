import json
import secrets
import string
from datetime import date, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from openai import OpenAI, OpenAIError
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import (
    AuditLog,
    ChatSession,
    Company,
    CompanySubscription,
    DataSource,
    Document,
    DocumentValidation,
    Embedding,
    InfraHealthCheck,
    Invite,
    MessageFeedback,
    PasswordResetToken,
    Plan,
    Project,
    Region,
    SubscriptionUsage,
    User,
    UserFeedback,
    UtilityProvider,
    Vertical,
)
from app.schemas import (
    AddSubscriptionNoteRequest,
    AdminDocumentCreateRequest,
    AdminInviteSummary,
    AdminResetPasswordResponse,
    AdminStatsByVerticalResponse,
    AdminStatsResponse,
    AdminUserSummary,
    ApplySuggestionRequest,
    AssignPlanRequest,
    AuditLogEntry,
    BrowseResponse,
    CompanyCreateWithAdminRequest,
    CompanyCreateWithAdminResponse,
    CompanyDetail,
    CompanyProjectSummary,
    CompanySummary,
    CompanyUserSummary,
    DataSourceSummary,
    DataSourceSyncStatus,
    DataSourceUpdateRequest,
    DataSourcesByVertical,
    DocumentReplacementRef,
    DocumentSummary,
    DocumentValidationResult,
    EmailStatusResponse,
    ExtendTrialRequest,
    FeedbackEntry,
    FeedbackListResponse,
    FeedbackStatusUpdateRequest,
    GapQueryEntry,
    ImpersonateResponse,
    InfraHealthCheckEntry,
    InfraHealthResponse,
    MarkReviewedRequest,
    MarkSupersededRequest,
    PlanCreateRequest,
    PlanSummary,
    PlanUpdateRequest,
    ReassignVerticalRequest,
    RegionAdminSummary,
    RegionAdminUpdateRequest,
    RevalidateAllResponse,
    RevalidationStatusResponse,
    RoleChangeRequest,
    StaleDocumentSummary,
    SubscriptionEntry,
    SubscriptionListResponse,
    UndoSupersedeRequest,
    UserFeedbackEntry,
    UserFeedbackListResponse,
    UtilityProviderAdminSummary,
    UtilityProviderAdminUpdateRequest,
    VerticalStatsEntry,
    VerticalSummary,
    VerticalUpdateRequest,
)
from app.security import create_access_token, hash_password
from app.services.audit import log_action
from app.services.authorization import require_super_admin
from app.services.embeddings import embed_document
from app.services.source_fetch import content_hash, fetch_url_content
from app.services.sources import group_label
from app.services.subscription import get_or_create_subscription, get_or_create_usage
from app.services.usage import company_token_usage

_FREQUENCY_DAYS = {"daily": 1, "weekly": 7, "monthly": 30}

router = APIRouter(prefix="/admin", tags=["admin"])


def _to_company_summary(db: Session, c: Company, vertical_slugs: dict[int, str]) -> CompanySummary:
    users_count = db.scalar(
        select(func.count()).select_from(User).where(User.company_id == c.id, User.is_active.is_(True))
    ) or 0
    projects_count = db.scalar(select(func.count()).select_from(Project).where(Project.company_id == c.id)) or 0
    return CompanySummary(
        id=c.id,
        name=c.name,
        type=c.type,
        is_suspended=c.is_suspended,
        created_at=c.created_at,
        vertical_id=c.vertical_id,
        vertical_slug=vertical_slugs.get(c.vertical_id),
        active_users_count=users_count,
        active_projects_count=projects_count,
    )


@router.get("/companies", response_model=list[CompanySummary])
async def list_companies(
    vertical_id: int | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[CompanySummary]:
    require_super_admin(user)
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    stmt = select(Company)
    if vertical_id is not None:
        stmt = stmt.where(Company.vertical_id == vertical_id)
    companies = db.scalars(stmt.order_by(Company.created_at.desc())).all()
    return [_to_company_summary(db, c, vertical_slugs) for c in companies]


# Ambiguous characters excluded (0/O, l/1/I) - the generated password is
# shown once and typed in manually by whoever reads it off the confirmation
# screen, so visual ambiguity there is a real support-ticket risk.
_PASSWORD_ALPHABET = "".join(c for c in string.ascii_uppercase + string.ascii_lowercase + string.digits if c not in "0O1lI")


def _generate_password(length: int = 12) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


@router.post("/companies/create-with-admin", response_model=CompanyCreateWithAdminResponse, status_code=status.HTTP_201_CREATED)
async def create_company_with_admin(
    payload: CompanyCreateWithAdminRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CompanyCreateWithAdminResponse:
    require_super_admin(user)

    if db.scalar(select(User).where(User.email == payload.admin_email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if db.scalar(select(Company).where(Company.name == payload.company_name)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A company with this name already exists")

    vertical_slug = "tax_accounting" if payload.company_type == "accounting" else "construction"
    vertical = db.scalar(select(Vertical).where(Vertical.slug == vertical_slug, Vertical.status == "active"))
    if not vertical:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown or inactive vertical_slug '{vertical_slug}'"
        )

    company = Company(name=payload.company_name, type=payload.company_type, vertical_id=vertical.id)
    db.add(company)
    db.flush()

    generated_password = _generate_password()
    admin_user = User(
        company_id=company.id,
        email=payload.admin_email,
        first_name=payload.admin_first_name,
        last_name=payload.admin_last_name,
        role="admin",
        password_hash=hash_password(generated_password),
        phone=payload.admin_phone,
    )
    db.add(admin_user)
    db.flush()

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=company.id,
        action="company_created_by_super_admin",
        resource_type="company",
        resource_id=company.id,
        metadata={"admin_email": payload.admin_email, "message": f"Super admin created company {company.name} with admin user {payload.admin_email}"},
    )
    db.commit()

    return CompanyCreateWithAdminResponse(
        company_id=company.id,
        company_name=company.name,
        admin_user_id=admin_user.id,
        admin_first_name=payload.admin_first_name,
        admin_last_name=payload.admin_last_name,
        admin_email=payload.admin_email,
        generated_password=generated_password,
    )


@router.get("/companies/{company_id}", response_model=CompanyDetail)
async def get_company_detail(
    company_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CompanyDetail:
    require_super_admin(user)
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    summary = _to_company_summary(db, company, vertical_slugs)

    users = db.scalars(select(User).where(User.company_id == company.id).order_by(User.email)).all()
    projects = db.scalars(select(Project).where(Project.company_id == company.id).order_by(Project.created_at.desc())).all()

    since_30d = datetime.utcnow() - timedelta(days=30)
    messages_30d = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(ChatSession.company_id == company.id, ChatSession.created_at >= since_30d)
        )
        or 0
    )
    gap_30d = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(
                ChatSession.company_id == company.id,
                ChatSession.created_at >= since_30d,
                ChatSession.gap.is_(True),
            )
        )
        or 0
    )

    token_usage = company_token_usage(db, company.id, since_30d, users)

    return CompanyDetail(
        **summary.model_dump(),
        users=[
            CompanyUserSummary(id=u.id, email=u.email, first_name=u.first_name, last_name=u.last_name, role=u.role, is_active=u.is_active)
            for u in users
        ],
        projects=[
            CompanyProjectSummary(id=p.id, name=p.name, municipality=p.municipality, is_client=p.is_client)
            for p in projects
        ],
        messages_30d=messages_30d,
        gap_rate=round(gap_30d / messages_30d * 100, 1) if messages_30d else 0.0,
        token_usage=token_usage,
    )


@router.post("/companies/{company_id}/reassign-vertical", response_model=CompanySummary)
async def reassign_company_vertical(
    company_id: int,
    payload: ReassignVerticalRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CompanySummary:
    """Moving a company to a different vertical instantly cuts it off from
    every document in its old vertical (visible_documents_filter matches on
    Document.vertical_id == company's vertical) - same confirmed=True gate
    as the other judgment-call admin actions, since the frontend can compute
    and show the affected-document count itself (GET /admin/stats) before
    the admin commits."""
    require_super_admin(user)
    if not payload.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirm the vertical reassignment - the company will lose access to its current vertical's documents",
        )
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    new_vertical = db.get(Vertical, payload.vertical_id)
    if not new_vertical:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vertical not found")

    old_vertical_id = company.vertical_id
    company.vertical_id = new_vertical.id
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=company.id,
        action="company_vertical_reassigned",
        resource_type="company",
        resource_id=company.id,
        metadata={"old_vertical_id": old_vertical_id, "new_vertical_id": new_vertical.id},
    )
    db.commit()
    db.refresh(company)
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    return _to_company_summary(db, company, vertical_slugs)


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


@router.get("/users", response_model=list[AdminUserSummary])
async def list_all_users(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[AdminUserSummary]:
    """Platform-wide equivalent of GET /companies/me/users - every user
    across every company, not just the caller's own. See Sidebar.tsx's
    "Χρήστες" nav entry."""
    require_super_admin(user)
    users = db.scalars(select(User)).all()
    company_names = dict(db.execute(select(Company.id, Company.name)).all())

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
        AdminUserSummary(
            id=u.id,
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
            phone=u.phone,
            role=u.role,
            is_active=u.is_active,
            created_at=u.created_at,
            last_login_at=u.last_login_at,
            messages_30d=message_counts.get(u.id, 0),
            company_id=u.company_id,
            company_name=company_names.get(u.company_id, "—"),
        )
        for u in users
    ]


@router.post("/users/{user_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.id == user.user_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot revoke your own access")

    target.is_active = False
    log_action(
        db, actor_user_id=user.user_id, company_id=target.company_id, action="access_revoked", resource_type="user", resource_id=target.id
    )
    db.commit()


@router.post("/users/{user_id}/restore", status_code=status.HTTP_204_NO_CONTENT)
async def admin_restore_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    target.is_active = True
    log_action(
        db, actor_user_id=user.user_id, company_id=target.company_id, action="access_restored", resource_type="user", resource_id=target.id
    )
    db.commit()


@router.post("/users/{user_id}/impersonate", response_model=ImpersonateResponse)
async def impersonate_user(
    user_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ImpersonateResponse:
    """Soft-launch replacement for the old public demo-account login: once
    real invites go out, letting any visitor pick any account from the
    public login page is no longer acceptable, but a super admin still
    needs to spot-check what a given role/company actually sees. Issues a
    real token for the target user directly - no password involved, since
    the caller is already verified as super_admin."""
    require_super_admin(user)
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role == "super_admin":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot impersonate another super admin")
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")

    company = db.get(Company, target.company_id) if target.company_id else None
    log_action(
        db, actor_user_id=user.user_id, company_id=target.company_id, action="impersonate", resource_type="user", resource_id=target.id
    )
    db.commit()

    token = create_access_token(user_id=target.id, company_id=target.company_id, role=target.role)
    return ImpersonateResponse(
        token=token,
        company_id=target.company_id,
        company_type=company.type if company else None,
        role=target.role,
        first_name=target.first_name,
        last_name=target.last_name,
        preferred_locale=target.preferred_locale,
        preferred_theme=target.preferred_theme,
        email=target.email,
    )


@router.post("/users/{user_id}/reset-password", response_model=AdminResetPasswordResponse)
async def admin_reset_user_password(
    user_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AdminResetPasswordResponse:
    """Generates a new random password for a user directly - for support
    situations where a super admin needs to hand someone working
    credentials immediately, without waiting on email delivery (see
    POST /auth/forgot-password for the self-serve, email-based path, which
    a super admin can also trigger on a user's behalf from the same UI).
    The password is returned once in the response and never stored or
    logged in plain text."""
    require_super_admin(user)
    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    new_password = _generate_password()
    target.password_hash = hash_password(new_password)
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == target.id))
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=target.company_id,
        action="admin_reset_password",
        resource_type="user",
        resource_id=target.id,
        metadata={"target_email": target.email},
    )
    db.commit()

    return AdminResetPasswordResponse(new_password=new_password)


@router.get("/email-status", response_model=EmailStatusResponse)
async def get_email_status(user: CurrentUser = Depends(get_current_user)) -> EmailStatusResponse:
    """Lets the frontend decide whether to offer "send a reset link" as an
    alternative to the admin-forced reset above - showing that option when
    email delivery isn't actually configured would be a dead end."""
    require_super_admin(user)
    return EmailStatusResponse(email_enabled=settings.email_enabled and bool(settings.resend_api_key))


@router.patch("/users/{user_id}/role", response_model=AdminUserSummary)
async def admin_change_user_role(
    user_id: int,
    payload: RoleChangeRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AdminUserSummary:
    require_super_admin(user)
    if payload.role not in ("admin", "member"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role must be 'admin' or 'member'")

    target = db.get(User, user_id)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if target.role == "admin" and payload.role == "member":
        other_admins = db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.company_id == target.company_id, User.role == "admin", User.id != target.id)
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
        company_id=target.company_id,
        action="role_changed",
        resource_type="user",
        resource_id=target.id,
        metadata={"from": previous_role, "to": payload.role},
    )
    db.commit()
    db.refresh(target)

    company = db.get(Company, target.company_id)
    return AdminUserSummary(
        id=target.id,
        email=target.email,
        first_name=target.first_name,
        last_name=target.last_name,
        phone=target.phone,
        role=target.role,
        is_active=target.is_active,
        created_at=target.created_at,
        last_login_at=target.last_login_at,
        company_id=target.company_id,
        company_name=company.name if company else "—",
    )


@router.get("/invites", response_model=list[AdminInviteSummary])
async def list_all_invites(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[AdminInviteSummary]:
    """Platform-wide equivalent of GET /companies/me/invites - every invite
    across every company. See Sidebar.tsx's "Προσκλήσεις" nav entry."""
    require_super_admin(user)
    invites = db.scalars(select(Invite).order_by(Invite.created_at.desc())).all()
    company_names = dict(db.execute(select(Company.id, Company.name)).all())

    return [
        AdminInviteSummary(
            id=i.id,
            email=i.email,
            role=i.role,
            status=i.status,
            created_at=i.created_at,
            expires_at=i.expires_at,
            company_id=i.company_id,
            company_name=company_names.get(i.company_id, "—"),
        )
        for i in invites
    ]


@router.post("/invites/{invite_id}/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def admin_revoke_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    require_super_admin(user)
    invite = db.get(Invite, invite_id)
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending invite not found")

    invite.status = "revoked"
    log_action(
        db, actor_user_id=user.user_id, company_id=invite.company_id, action="invite_revoked", resource_type="invite", resource_id=invite.id
    )
    db.commit()


def _latest_still_accurate(db: Session, document_ids: list[int]) -> dict[int, bool | None]:
    """One still_accurate value per document_id - whichever document_validations
    row is most recent for that document, or absent entirely if the document
    has never been AI-revalidated. Postgres DISTINCT ON, not a subquery-per-
    document, so this stays one query regardless of page size."""
    if not document_ids:
        return {}
    rows = db.execute(
        select(DocumentValidation.document_id, DocumentValidation.still_accurate)
        .where(DocumentValidation.document_id.in_(document_ids))
        .distinct(DocumentValidation.document_id)
        .order_by(DocumentValidation.document_id, DocumentValidation.created_at.desc())
    ).all()
    return {row.document_id: row.still_accurate for row in rows}


def _to_admin_summary(
    db: Session,
    doc: Document,
    vertical_slugs: dict[int, str] | None = None,
    still_accurate_map: dict[int, bool | None] | None = None,
) -> DocumentSummary:
    """Same fields as the tenant-facing DocumentSummary, plus the
    replacement-chain fields only admin KB management ever populates - see
    Document.replaces_document_id's direction note in db/init.sql (lives on
    the NEW document, points at the OLD one it supersedes)."""
    replaced_by = None
    replacement = db.scalar(select(Document).where(Document.replaces_document_id == doc.id))
    if replacement:
        replaced_by = DocumentReplacementRef(id=replacement.id, title=replacement.title)

    replaces = None
    if doc.replaces_document_id:
        original = db.get(Document, doc.replaces_document_id)
        if original:
            replaces = DocumentReplacementRef(id=original.id, title=original.title)

    return DocumentSummary(
        id=doc.id,
        title=doc.title,
        snippet=(doc.content[:280] if doc.content else None),
        source=doc.source,
        doc_type=doc.doc_type,
        municipality=doc.municipality,
        region_id=doc.region_id,
        date=doc.date,
        identifier=doc.identifier,
        series=doc.series,
        issue_number=doc.issue_number,
        source_name=doc.source_name,
        authority=doc.authority,
        content_type=doc.content_type,
        extraction_status=doc.extraction_status,
        status=doc.status,
        replaced_by=replaced_by,
        replaces=replaces,
        vertical_id=doc.vertical_id,
        vertical_slug=(vertical_slugs or {}).get(doc.vertical_id),
        last_verified_at=doc.last_verified_at,
        needs_review=doc.needs_review,
        auto_needs_review_reason=doc.auto_needs_review_reason,
        still_accurate=(still_accurate_map or {}).get(doc.id) if still_accurate_map is not None else _latest_still_accurate(db, [doc.id]).get(doc.id),
    )


@router.post("/documents", response_model=DocumentSummary, status_code=status.HTTP_201_CREATED)
async def create_admin_document(
    payload: AdminDocumentCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DocumentSummary:
    """Backs the admin "Νέο Έγγραφο" form - hand-authoring a public KB
    document (almost always extraction_status="manual_entry", the form's
    only real use case today; the crawler is the sole writer for
    full_text/reference_only documents). Enforces the going-forward KB
    staleness policy: a manual_entry document with no source is a document
    nobody can ever revalidate against a real source later (see
    KNOWN_DECISIONS.md) - every other extraction_status is exempt since
    those already carry a source by construction (crawled, or an upload).
    """
    require_super_admin(user)
    if payload.extraction_status == "manual_entry" and not payload.source:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Τα χειροκίνητα έγγραφα απαιτούν source_url που να δείχνει στο πρωτογενές νομικό κείμενο",
        )

    doc = Document(
        title=payload.title,
        content=payload.content,
        vertical_id=payload.vertical_id,
        source=payload.source,
        authority=payload.authority,
        content_type=payload.content_type,
        region_id=payload.region_id,
        extraction_status=payload.extraction_status,
        scope="regional" if payload.region_id else "national",
        status="active",
    )
    db.add(doc)
    db.flush()
    embed_document(db, doc)
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="document_created", resource_type="document", resource_id=doc.id,
    )
    db.commit()
    db.refresh(doc)
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    return _to_admin_summary(db, doc, vertical_slugs)


@router.get("/documents/revalidation-status", response_model=RevalidationStatusResponse)
async def revalidation_status(
    user: CurrentUser = Depends(get_current_user),
) -> RevalidationStatusResponse:
    """Registered before /documents/{document_id} deliberately - FastAPI/
    Starlette matches routes in registration order, and both are GET with
    the same path-segment shape, so this static path MUST come first or
    "revalidation-status" gets swallowed as an attempted document_id (a
    real 422 hit during Phase 4/5 testing, not a hypothetical)."""
    require_super_admin(user)
    state = _bulk_revalidation_state
    pending = max(0, state["total"] - state["completed"] - state["failed"])
    last_updated = state["finished_at"] or state["started_at"]
    return RevalidationStatusResponse(
        pending=pending,
        validated=state["completed"],
        failed=state["failed"],
        accurate=state["accurate"],
        changed=state["changed"],
        last_updated=last_updated,
    )


@router.get("/documents/{document_id}", response_model=DocumentSummary)
async def get_admin_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DocumentSummary:
    """Single-document lookup for the admin KB screen's replacement-chain
    cross-links in the detail drawer (clicking 'replaced by' / 'replaces'
    needs to open that document's drawer even if it isn't on the currently
    loaded page of /documents)."""
    require_super_admin(user)
    doc = db.get(Document, document_id)
    if not doc or doc.company_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    summary = _to_admin_summary(db, doc, vertical_slugs)
    summary.full_content = doc.content
    return summary


@router.get("/documents", response_model=BrowseResponse)
async def list_admin_documents(
    q: str | None = None,
    vertical_id: int | None = None,
    status_filter: str | None = None,
    authority: str | None = None,
    content_type: str | None = None,
    superseded_only: bool = False,
    auto_flagged_only: bool = False,
    needs_review_only: bool = False,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> BrowseResponse:
    """Browses/filters the crawled public knowledge base (company_id IS
    NULL) - the only management surface a super_admin has over it, since
    the crawler is otherwise the sole writer. Includes non-active docs
    (including superseded, with their replacement chain populated) so a bad
    removal or supersede can be reviewed/audited, unlike the tenant-facing
    /documents/search which never shows superseded/removed documents at
    all. `q` is optional (unlike the old search-only endpoint) so the KB
    management screen can browse the full corpus, not just search results.
    """
    require_super_admin(user)
    stmt = select(Document).where(Document.company_id.is_(None))
    if q:
        stmt = stmt.where(
            text(
                "to_tsvector('greek', coalesce(title, '') || ' ' || coalesce(content, '')) @@ plainto_tsquery('greek', :q)"
            )
        ).params(q=q)
    if vertical_id is not None:
        stmt = stmt.where(Document.vertical_id == vertical_id)
    if superseded_only:
        stmt = stmt.where(Document.status == "superseded")
    elif status_filter:
        stmt = stmt.where(Document.status == status_filter)
    if authority:
        stmt = stmt.where(Document.authority == authority)
    if content_type:
        stmt = stmt.where(Document.content_type == content_type)
    if auto_flagged_only:
        stmt = stmt.where(Document.auto_needs_review_reason.is_not(None))
    if needs_review_only:
        stmt = stmt.where(Document.needs_review.is_(True))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    results = db.scalars(stmt.order_by(Document.created_at.desc()).limit(limit).offset(offset)).all()
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    still_accurate_map = _latest_still_accurate(db, [doc.id for doc in results])
    return BrowseResponse(
        total=total, items=[_to_admin_summary(db, doc, vertical_slugs, still_accurate_map) for doc in results]
    )


@router.post("/documents/{document_id}/mark-superseded", response_model=list[DocumentSummary])
async def mark_document_superseded(
    document_id: int,
    payload: MarkSupersededRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[DocumentSummary]:
    """Marks an existing document (document_id) as superseded by another
    existing document (payload.replaced_by_document_id) - the post-hoc
    admin path for pairing two documents that already both exist, as
    opposed to the upload-time replaces_document_id flow in
    app/routers/documents.py (which only applies when a company re-uploads
    a new version of its own document). Same confirmed=True gate as
    mark-reviewed: superseding is a judgment call about content
    equivalence a human made, not something the API can verify itself.
    """
    require_super_admin(user)
    if not payload.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirm that the replacement document actually supersedes this one",
        )
    if payload.replaced_by_document_id == document_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A document cannot supersede itself")

    old_doc = db.get(Document, document_id)
    new_doc = db.get(Document, payload.replaced_by_document_id)
    if not old_doc or not new_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if old_doc.vertical_id != new_doc.vertical_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Both documents must belong to the same vertical"
        )

    new_doc.replaces_document_id = old_doc.id
    old_doc.status = "superseded"
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="document_marked_superseded",
        resource_type="document",
        resource_id=old_doc.id,
        metadata={"replaced_by_document_id": new_doc.id},
    )
    db.commit()
    db.refresh(old_doc)
    db.refresh(new_doc)
    return [_to_admin_summary(db, old_doc), _to_admin_summary(db, new_doc)]


@router.post("/documents/{document_id}/undo-supersede", response_model=list[DocumentSummary])
async def undo_document_supersede(
    document_id: int,
    payload: UndoSupersedeRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[DocumentSummary]:
    """Reverses mark-superseded: document_id is the OLD (superseded)
    document - restores its status to active and clears replaces_document_id
    on whichever document was superseding it. The escape hatch for an
    accidental supersede pairing."""
    require_super_admin(user)
    if not payload.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Confirm you want to undo this supersede"
        )

    old_doc = db.get(Document, document_id)
    if not old_doc or old_doc.status != "superseded":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Superseded document not found")
    new_doc = db.scalar(select(Document).where(Document.replaces_document_id == old_doc.id))

    old_doc.status = "active"
    if new_doc:
        new_doc.replaces_document_id = None
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="document_supersede_undone",
        resource_type="document",
        resource_id=old_doc.id,
        metadata={"undone_replaced_by_document_id": new_doc.id if new_doc else None},
    )
    db.commit()
    db.refresh(old_doc)
    results = [_to_admin_summary(db, old_doc)]
    if new_doc:
        db.refresh(new_doc)
        results.append(_to_admin_summary(db, new_doc))
    return results


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
    auto_only: bool = False,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[StaleDocumentSummary]:
    """Manual review queue populated by the weekly staleness sweep
    (crawler/crawler/staleness.py) - flags public KB documents whose
    last_verified_at is missing or older than 6 months - plus, since the
    content-hash feature shipped, documents auto-flagged by a data-source
    sync detecting a real source change (see sync_data_source).
    auto_only=True restricts to that second group specifically (the
    admin Documents screen's "Αυτόματη σήμανση" filter), rather than every
    needs_review cause mixed together. Oldest first, since that's the most
    overdue.
    """
    require_super_admin(user)
    stmt = select(Document).where(
        Document.company_id.is_(None), Document.status == "active", Document.needs_review.is_(True)
    )
    if auto_only:
        stmt = stmt.where(Document.auto_needs_review_reason.is_not(None))
    docs = db.scalars(stmt.order_by(Document.last_verified_at.asc().nullsfirst())).all()
    return [
        StaleDocumentSummary(
            id=doc.id,
            title=doc.title,
            source=doc.source,
            source_group=group_label(doc.source_name) if doc.source_name else None,
            region_id=doc.region_id,
            last_verified_at=doc.last_verified_at,
            auto_needs_review_reason=doc.auto_needs_review_reason,
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
    doc.auto_needs_review_reason = None
    if payload.validation_id is not None:
        validation = db.get(DocumentValidation, payload.validation_id)
        if validation and validation.document_id == doc.id:
            validation.admin_action = "dismissed"
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="document_marked_reviewed",
        resource_type="document",
        resource_id=doc.id,
    )
    db.commit()


_REVALIDATION_SYSTEM_PROMPT = """You are a legal document accuracy checker for a Greek regulatory
intelligence system. Your job is to compare a stored document against its
current source and identify whether it needs updating.

Be precise and conservative. Only flag genuine factual or legal changes —
not formatting differences, minor wording variations, or additions that
don't affect the document's accuracy. If the document is still accurate,
say so clearly."""


def _revalidation_user_prompt(document: Document, fetched_content: str) -> str:
    # Both sides capped to 8000 chars (~2-3K tokens each) - real KB
    # documents can be an entire codified law (one stored full_text
    # document measured 147K chars, ~37K tokens on its own), which blew
    # past this org's 30K-tokens-per-minute rate limit on its own before
    # this cap existed (confirmed via a live 429 during Phase 4 testing,
    # not a hypothetical). GPT-4o only needs enough of each side to judge
    # whether the document is still accurate, not the complete text.
    return f"""STORED DOCUMENT:
Title: {document.title}
Content: {(document.content or "")[:8000]}

CURRENT SOURCE CONTENT (fetched from {document.source}):
{fetched_content[:8000]}

Task:
1. Is the stored document still accurate based on the current source?
2. If not, what specifically has changed?
3. Suggest the exact updated text for the stored document.

Respond in JSON:
{{
  "still_accurate": true/false,
  "changes_detected": "brief description of what changed, or null if accurate",
  "suggested_content": "full updated document content, or null if no changes needed",
  "confidence": "high/medium/low",
  "reasoning": "one sentence explaining your assessment"
}}"""


async def _run_revalidation(db: Session, doc: Document, validated_by: int | None) -> DocumentValidation:
    """Shared core for the single-document and bulk revalidation paths:
    fetch doc.source, ask GPT-4o to compare it against the stored content,
    persist a document_validations row either way. Never raises - a fetch
    failure or a malformed GPT-4o response both resolve to a stored,
    inspectable row rather than a 500, since the bulk queue needs to keep
    going past one bad document."""
    now = datetime.utcnow()

    if not doc.source:
        validation = DocumentValidation(
            document_id=doc.id, validated_by=validated_by, status="source_unavailable",
            reasoning="Το έγγραφο δεν έχει καταχωρημένη πηγή (source_url).",
        )
        db.add(validation)
        db.commit()
        db.refresh(validation)
        return validation

    fetched_content = await fetch_url_content(doc.source)
    if fetched_content is None:
        validation = DocumentValidation(
            document_id=doc.id, validated_by=validated_by, status="source_unavailable",
            reasoning="Η πηγή δεν ήταν προσβάσιμη ή δεν επέστρεψε εξαγώγιμο περιεχόμενο.",
        )
        db.add(validation)
        db.commit()
        db.refresh(validation)
        return validation

    try:
        client = OpenAI(api_key=settings.openai_api_key)
        completion = client.chat.completions.create(
            model=settings.chat_model,
            messages=[
                {"role": "system", "content": _REVALIDATION_SYSTEM_PROMPT},
                {"role": "user", "content": _revalidation_user_prompt(doc, fetched_content)},
            ],
            response_format={"type": "json_object"},
        )
        parsed = json.loads(completion.choices[0].message.content or "{}")
    except (OpenAIError, json.JSONDecodeError) as exc:
        validation = DocumentValidation(
            document_id=doc.id, validated_by=validated_by, status="source_unavailable",
            reasoning=f"Η κλήση GPT-4o απέτυχε ή επέστρεψε μη έγκυρο JSON: {exc}",
        )
        db.add(validation)
        db.commit()
        db.refresh(validation)
        return validation

    validation = DocumentValidation(
        document_id=doc.id,
        validated_by=validated_by,
        status="validated",
        still_accurate=parsed.get("still_accurate"),
        changes_detected=parsed.get("changes_detected"),
        suggested_content=parsed.get("suggested_content"),
        confidence=parsed.get("confidence"),
        reasoning=parsed.get("reasoning"),
        source_fetched_at=now,
    )
    db.add(validation)
    db.commit()
    db.refresh(validation)
    return validation


@router.post("/documents/{document_id}/revalidate", response_model=DocumentValidationResult)
async def revalidate_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DocumentValidationResult:
    require_super_admin(user)
    doc = db.get(Document, document_id)
    if not doc or doc.company_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Public document not found")

    validation = await _run_revalidation(db, doc, user.user_id)
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="document_revalidated", resource_type="document", resource_id=doc.id,
        metadata={"status": validation.status, "validation_id": validation.id},
    )
    db.commit()

    return DocumentValidationResult(
        status=validation.status,
        reason=validation.reasoning if validation.status == "source_unavailable" else None,
        still_accurate=validation.still_accurate,
        changes_detected=validation.changes_detected,
        suggested_content=validation.suggested_content,
        confidence=validation.confidence,
        reasoning=validation.reasoning,
        source_fetched_at=validation.source_fetched_at,
        source_url=doc.source,
        validation_id=validation.id,
    )


@router.post("/documents/{document_id}/apply-suggestion", response_model=DocumentSummary)
async def apply_document_suggestion(
    document_id: int,
    payload: ApplySuggestionRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DocumentSummary:
    require_super_admin(user)
    doc = db.get(Document, document_id)
    if not doc or doc.company_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Public document not found")
    validation = db.get(DocumentValidation, payload.validation_id)
    if not validation or validation.document_id != doc.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Validation not found for this document")

    doc.content = payload.content
    doc.needs_review = False
    doc.last_verified_at = date.today()
    doc.auto_needs_review_reason = None
    validation.admin_action = payload.action

    # Re-generate embeddings for the new content immediately - delete the
    # old chunks first since embed_document() is idempotent-skip (it does
    # nothing if the document already has embeddings, by design for the
    # crawler's catch-up sweep - see app/services/embeddings.py), which
    # would otherwise silently leave the OLD content's embeddings in place.
    db.execute(delete(Embedding).where(Embedding.document_id == doc.id))
    db.flush()
    embed_document(db, doc)

    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="document_suggestion_applied", resource_type="document", resource_id=doc.id,
        metadata={"validation_id": validation.id, "action": payload.action},
    )
    db.commit()
    db.refresh(doc)
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}
    return _to_admin_summary(db, doc, vertical_slugs)


# Single-process, in-memory bulk-run tracker - deliberately not a real task
# queue (Celery/RQ): this backend has no such infrastructure today (see
# KNOWN_DECISIONS.md), and introducing one for an infrequent, single-admin
# bulk action would be a disproportionate amount of new infrastructure.
# FastAPI's BackgroundTasks already gives "return immediately, keep
# working after the response is sent", which is the actual requirement.
# Known limitation: doesn't survive a process restart and isn't correct
# under multiple uvicorn workers - acceptable for this dev-scale deployment,
# revisit if either changes.
_bulk_revalidation_state: dict = {
    "total": 0, "completed": 0, "failed": 0, "accurate": 0, "changed": 0,
    "started_at": None, "finished_at": None,
}


def _run_bulk_revalidation(document_ids: list[int], validated_by: int) -> None:
    import asyncio

    db = SessionLocal()
    try:
        for doc_id in document_ids:
            doc = db.get(Document, doc_id)
            if not doc:
                _bulk_revalidation_state["failed"] += 1
                continue
            try:
                validation = asyncio.run(_run_revalidation(db, doc, validated_by))
                if validation.status == "validated":
                    _bulk_revalidation_state["completed"] += 1
                    if validation.still_accurate:
                        _bulk_revalidation_state["accurate"] += 1
                    else:
                        _bulk_revalidation_state["changed"] += 1
                else:
                    _bulk_revalidation_state["failed"] += 1
            except Exception:  # noqa: BLE001 - one bad document must not stop the batch
                _bulk_revalidation_state["failed"] += 1
    finally:
        _bulk_revalidation_state["finished_at"] = datetime.utcnow()
        db.close()


@router.post("/documents/revalidate-all", response_model=RevalidateAllResponse)
async def revalidate_all_documents(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RevalidateAllResponse:
    require_super_admin(user)
    doc_ids = list(
        db.scalars(
            select(Document.id).where(
                Document.company_id.is_(None), Document.status == "active", Document.needs_review.is_(True)
            )
        )
    )
    n = len(doc_ids)
    # ~15s/document (source fetch + GPT-4o call), sequential.
    estimated_minutes = max(1, round(n * 15 / 60)) if n else 0

    _bulk_revalidation_state["total"] = n
    _bulk_revalidation_state["completed"] = 0
    _bulk_revalidation_state["failed"] = 0
    _bulk_revalidation_state["accurate"] = 0
    _bulk_revalidation_state["changed"] = 0
    _bulk_revalidation_state["started_at"] = datetime.utcnow()
    _bulk_revalidation_state["finished_at"] = None

    if n:
        background_tasks.add_task(_run_bulk_revalidation, doc_ids, user.user_id)

    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="document_revalidate_all_triggered", resource_type="document", resource_id=None,
        metadata={"queued": n},
    )
    db.commit()
    return RevalidateAllResponse(queued=n, estimated_minutes=estimated_minutes)


@router.get("/stats", response_model=AdminStatsByVerticalResponse)
async def platform_stats(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AdminStatsByVerticalResponse:
    """Live-queried, not cached - this is a soft-launch-scale dashboard
    (see KNOWN_DECISIONS.md on when to revisit), not a metrics pipeline.
    by_vertical breaks the same totals down per vertical - N+1 queries per
    vertical is fine at today's scale (2 verticals, soft-launch traffic)."""
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
    since_30d = datetime.utcnow() - timedelta(days=30)
    platform_tokens_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.total_tokens), 0)).where(ChatSession.created_at >= since_30d)
        )
        or 0
    )
    platform_cost_eur_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0)).where(ChatSession.created_at >= since_30d)
        )
        or 0
    )
    total = AdminStatsResponse(
        total_messages=total_messages,
        gap_rate=gap_rate,
        active_documents=active_documents,
        positive_feedback=positive_feedback,
        negative_feedback=negative_feedback,
        platform_tokens_30d=int(platform_tokens_30d),
        platform_cost_eur_30d=round(float(platform_cost_eur_30d), 2),
    )

    by_vertical = []
    for v in db.scalars(select(Vertical).order_by(Vertical.id)):
        v_messages = (
            db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id)
            )
            or 0
        )
        v_gap = (
            db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, ChatSession.gap.is_(True))
            )
            or 0
        )
        v_docs = (
            db.scalar(
                select(func.count())
                .select_from(Document)
                .where(Document.vertical_id == v.id, Document.status == "active")
            )
            or 0
        )
        v_companies = (
            db.scalar(
                select(func.count())
                .select_from(Company)
                .where(Company.vertical_id == v.id, Company.is_suspended.is_(False))
            )
            or 0
        )
        by_vertical.append(
            VerticalStatsEntry(
                slug=v.slug,
                messages=v_messages,
                gap_rate=round(v_gap / v_messages * 100, 1) if v_messages else 0.0,
                active_documents=v_docs,
                active_companies=v_companies,
            )
        )

    return AdminStatsByVerticalResponse(total=total, by_vertical=by_vertical)


@router.get("/infra-health", response_model=InfraHealthResponse)
async def infra_health(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> InfraHealthResponse:
    """Read-only view of the weekly pgvector index-size snapshots written by
    crawler/crawler/infra_health_check.py (cron, Monday mornings) - this
    endpoint never writes a row itself, it only surfaces what the scheduled
    job already recorded. history is oldest-first (chart-ready); trend
    compares latest against the reading closest to 7 days before it, so a
    single week's noise doesn't flip the arrow - None until there are at
    least two readings roughly a week apart."""
    require_super_admin(user)
    rows = list(db.scalars(select(InfraHealthCheck).order_by(InfraHealthCheck.created_at.desc()).limit(12)))
    if not rows:
        return InfraHealthResponse(latest=None, history=[], trend=None)

    history = [
        InfraHealthCheckEntry(
            total_chunks=r.total_chunks,
            index_size_mb=float(r.index_size_mb),
            threshold_level=r.threshold_level,
            created_at=r.created_at,
        )
        for r in reversed(rows)
    ]
    latest = history[-1]

    trend: str | None = None
    if len(history) >= 2:
        target = latest.created_at - timedelta(days=7)
        # Closest reading to 7 days ago, excluding latest itself.
        comparison = min(history[:-1], key=lambda h: abs((h.created_at - target).total_seconds()))
        if latest.total_chunks > comparison.total_chunks:
            trend = "up"
        elif latest.total_chunks < comparison.total_chunks:
            trend = "down"
        else:
            trend = "flat"

    return InfraHealthResponse(latest=latest, history=history, trend=trend)


def _to_data_source_summary(ds: DataSource) -> DataSourceSummary:
    return DataSourceSummary(
        id=ds.id,
        name=ds.name,
        base_url=ds.base_url,
        source_type=ds.source_type,
        crawl_frequency_type=ds.crawl_frequency_type,
        crawl_frequency_days=ds.crawl_frequency_days,
        last_crawled_at=ds.last_crawled_at,
        next_crawl_at=ds.next_crawl_at,
        last_crawl_status=ds.last_crawl_status,
        last_crawl_document_count=ds.last_crawl_document_count,
        last_crawl_error=ds.last_crawl_error,
        is_active=ds.is_active,
        notes=ds.notes,
    )


@router.get("/data-sources", response_model=list[DataSourcesByVertical])
async def list_data_sources(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[DataSourcesByVertical]:
    require_super_admin(user)
    result = []
    for v in db.scalars(select(Vertical).order_by(Vertical.id)):
        sources = db.scalars(select(DataSource).where(DataSource.vertical_id == v.id).order_by(DataSource.name)).all()
        result.append(
            DataSourcesByVertical(
                vertical_slug=v.slug,
                vertical_display_name=v.display_name,
                sources=[_to_data_source_summary(s) for s in sources],
            )
        )
    return result


@router.patch("/data-sources/{source_id}", response_model=DataSourceSummary)
async def update_data_source(
    source_id: int,
    payload: DataSourceUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DataSourceSummary:
    require_super_admin(user)
    source = db.get(DataSource, source_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")

    if payload.name is not None:
        source.name = payload.name
    if payload.is_active is not None:
        source.is_active = payload.is_active
    if payload.notes is not None:
        source.notes = payload.notes

    frequency_changed = payload.crawl_frequency_type is not None or payload.crawl_frequency_days is not None
    if payload.crawl_frequency_type is not None:
        source.crawl_frequency_type = payload.crawl_frequency_type
    if payload.crawl_frequency_days is not None:
        source.crawl_frequency_days = payload.crawl_frequency_days
    elif payload.crawl_frequency_type is not None and payload.crawl_frequency_type in _FREQUENCY_DAYS:
        # A named frequency (daily/weekly/monthly) implies its day count even
        # if the caller didn't also pass crawl_frequency_days explicitly -
        # 'custom' has no implied value, so crawl_frequency_days must be
        # given for that one.
        source.crawl_frequency_days = _FREQUENCY_DAYS[payload.crawl_frequency_type]

    if payload.next_crawl_at is not None:
        # Explicit manual override always wins, even if frequency also changed.
        source.next_crawl_at = payload.next_crawl_at
    elif frequency_changed:
        base = source.last_crawled_at or datetime.utcnow()
        source.next_crawl_at = base + timedelta(days=source.crawl_frequency_days)

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="data_source_updated",
        resource_type="data_source",
        resource_id=source.id,
    )
    db.commit()
    db.refresh(source)
    return _to_data_source_summary(source)


@router.post("/data-sources/{source_id}/sync", response_model=DataSourceSyncStatus)
async def sync_data_source(
    source_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DataSourceSyncStatus:
    """Fetches this source's base_url directly and content-hash-compares it
    against the last sync, flagging linked documents for review on a real
    change. Scope note, honestly stated: this fetches and hashes base_url
    itself - it does NOT run the separate crawler/ package's per-source
    scrapers (discovery of linked PDFs, ΦΕΚ parsing, etc; that package is a
    different deployable service with its own container - see
    docker-compose.yml - and there's still no per-row dispatch from a
    data_sources id to one of its scraper functions). What this DOES give a
    super admin: a real "has this source's page content changed since I
    last checked" signal for any base_url that's itself the content (an
    e-nomothesia.gr or aade.gr guidance/law page), which is exactly the
    staleness gap this feature exists to close.
    """
    require_super_admin(user)
    source = db.get(DataSource, source_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")

    now = datetime.utcnow()
    fetched_text = await fetch_url_content(source.base_url)

    if fetched_text is None:
        # Crawl failed (unreachable, non-2xx, JS SPA with no server-rendered
        # content, etc.) - record the failure but leave last_crawled_at,
        # next_crawl_at, last_content_hash, and every linked document
        # untouched. A transient fetch failure must never look like "the
        # source was checked and found unchanged".
        source.last_crawl_status = "failed"
        source.last_crawl_error = "Η πηγή δεν ήταν προσβάσιμη ή δεν επέστρεψε εξαγώγιμο περιεχόμενο"
        log_action(
            db, actor_user_id=user.user_id, company_id=None,
            action="data_source_sync_failed", resource_type="data_source", resource_id=source.id,
        )
        db.commit()
        db.refresh(source)
        return DataSourceSyncStatus(
            id=source.id, last_crawled_at=source.last_crawled_at, next_crawl_at=source.next_crawl_at,
            last_crawl_status=source.last_crawl_status, last_crawl_document_count=source.last_crawl_document_count,
            last_crawl_error=source.last_crawl_error,
        )

    new_hash = content_hash(fetched_text)
    # NULL previous hash means this is the first sync since the feature
    # shipped (or the source's first-ever sync) - there is nothing to
    # compare against, so this establishes the baseline silently rather
    # than flagging every linked document as "changed" purely because a
    # baseline didn't exist yet.
    hash_changed = source.last_content_hash is not None and source.last_content_hash != new_hash
    is_first_baseline = source.last_content_hash is None

    source.last_crawled_at = now
    source.next_crawl_at = now + timedelta(days=source.crawl_frequency_days)
    source.last_crawl_status = "healthy"
    source.last_crawl_error = None
    source.last_content_hash = new_hash

    flagged_count = 0
    if hash_changed:
        source.content_changed_at = now
        reason = (
            f"Το περιεχόμενο της πηγής άλλαξε στις {now.strftime('%d/%m/%Y')} — "
            "επαληθεύστε ότι το έγγραφο παραμένει ακριβές"
        )
        linked_docs = db.scalars(
            select(Document).where(Document.source.startswith(source.base_url))
        ).all()
        for doc in linked_docs:
            doc.needs_review = True
            doc.auto_needs_review_reason = reason
            doc.source_verified_at = now
        flagged_count = len(linked_docs)
    elif not is_first_baseline:
        # Unchanged - still record that we successfully re-checked every
        # linked document's source, even though nothing needs flagging.
        linked_docs = db.scalars(
            select(Document).where(Document.source.startswith(source.base_url))
        ).all()
        for doc in linked_docs:
            doc.source_verified_at = now

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="data_source_sync_triggered",
        resource_type="data_source",
        resource_id=source.id,
        metadata={"hash_changed": hash_changed, "documents_flagged": flagged_count},
    )
    db.commit()
    db.refresh(source)
    return DataSourceSyncStatus(
        id=source.id,
        last_crawled_at=source.last_crawled_at,
        next_crawl_at=source.next_crawl_at,
        last_crawl_status=source.last_crawl_status,
        last_crawl_document_count=source.last_crawl_document_count,
        last_crawl_error=source.last_crawl_error,
    )


@router.get("/data-sources/{source_id}/sync-status", response_model=DataSourceSyncStatus)
async def data_source_sync_status(
    source_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DataSourceSyncStatus:
    require_super_admin(user)
    source = db.get(DataSource, source_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")
    return DataSourceSyncStatus(
        id=source.id,
        last_crawled_at=source.last_crawled_at,
        next_crawl_at=source.next_crawl_at,
        last_crawl_status=source.last_crawl_status,
        last_crawl_document_count=source.last_crawl_document_count,
        last_crawl_error=source.last_crawl_error,
    )


@router.get("/regions", response_model=list[RegionAdminSummary])
async def list_admin_regions(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[RegionAdminSummary]:
    require_super_admin(user)
    regions = db.scalars(select(Region).order_by(Region.region_name_el)).all()
    return [
        RegionAdminSummary(
            region_id=r.region_id,
            region_name_el=r.region_name_el,
            ydom_authority_name=r.ydom_authority_name,
            contact_phone=r.contact_phone,
            contact_email=r.contact_email,
            status=r.status,
        )
        for r in regions
    ]


@router.patch("/regions/{region_id}", response_model=RegionAdminSummary)
async def update_admin_region(
    region_id: str,
    payload: RegionAdminUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RegionAdminSummary:
    require_super_admin(user)
    region = db.get(Region, region_id)
    if not region:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Region not found")

    fields_set = payload.model_fields_set
    if "contact_phone" in fields_set:
        region.contact_phone = payload.contact_phone
    if "contact_email" in fields_set:
        region.contact_email = payload.contact_email
    if "ydom_authority_name" in fields_set:
        region.ydom_authority_name = payload.ydom_authority_name

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="region_contact_info_updated",
        resource_type="region",
        resource_id=None,
        metadata={"region_id": region.region_id},
    )
    db.commit()
    db.refresh(region)
    return RegionAdminSummary(
        region_id=region.region_id,
        region_name_el=region.region_name_el,
        ydom_authority_name=region.ydom_authority_name,
        contact_phone=region.contact_phone,
        contact_email=region.contact_email,
        status=region.status,
    )


@router.get("/utility-providers", response_model=list[UtilityProviderAdminSummary])
async def list_admin_utility_providers(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[UtilityProviderAdminSummary]:
    require_super_admin(user)
    providers = db.scalars(select(UtilityProvider).order_by(UtilityProvider.provider_name)).all()
    return [
        UtilityProviderAdminSummary(
            provider_id=p.provider_id,
            provider_name=p.provider_name,
            provider_type=p.provider_type,
            coverage_region_ids=p.coverage_region_ids,
            contact_phone=p.contact_phone,
            contact_email=p.contact_email,
        )
        for p in providers
    ]


@router.patch("/utility-providers/{provider_id}", response_model=UtilityProviderAdminSummary)
async def update_admin_utility_provider(
    provider_id: str,
    payload: UtilityProviderAdminUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> UtilityProviderAdminSummary:
    require_super_admin(user)
    provider = db.get(UtilityProvider, provider_id)
    if not provider:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utility provider not found")

    fields_set = payload.model_fields_set
    if "contact_phone" in fields_set:
        provider.contact_phone = payload.contact_phone
    if "contact_email" in fields_set:
        provider.contact_email = payload.contact_email
    if "provider_name" in fields_set:
        provider.provider_name = payload.provider_name

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="utility_provider_contact_info_updated",
        resource_type="utility_provider",
        resource_id=None,
        metadata={"provider_id": provider.provider_id},
    )
    db.commit()
    db.refresh(provider)
    return UtilityProviderAdminSummary(
        provider_id=provider.provider_id,
        provider_name=provider.provider_name,
        provider_type=provider.provider_type,
        coverage_region_ids=provider.coverage_region_ids,
        contact_phone=provider.contact_phone,
        contact_email=provider.contact_email,
    )


@router.get("/verticals", response_model=list[VerticalSummary])
async def list_verticals(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[VerticalSummary]:
    require_super_admin(user)
    verticals = db.scalars(select(Vertical).order_by(Vertical.id)).all()
    return [
        VerticalSummary(
            id=v.id,
            slug=v.slug,
            display_name=v.display_name,
            tagline=v.tagline,
            welcome_message=v.welcome_message,
            disclaimer_text=v.disclaimer_text,
            system_prompt_override=v.system_prompt_override,
            off_topic_hint=v.off_topic_hint,
            uses_regional_scoping=v.uses_regional_scoping,
            status=v.status,
        )
        for v in verticals
    ]


@router.patch("/verticals/{vertical_id}", response_model=VerticalSummary)
async def update_vertical(
    vertical_id: int,
    payload: VerticalUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> VerticalSummary:
    """Editable fields take effect on the next chat request with no restart
    needed - get_system_prompt()/get_disclaimer()/get_topic_guard_prompt()
    in app/routers/chat.py all read straight from this row per-request,
    never cached at startup."""
    require_super_admin(user)
    vertical = db.get(Vertical, vertical_id)
    if not vertical:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vertical not found")

    if payload.tagline is not None:
        vertical.tagline = payload.tagline
    if payload.welcome_message is not None:
        vertical.welcome_message = payload.welcome_message
    if payload.disclaimer_text is not None:
        vertical.disclaimer_text = payload.disclaimer_text
    if payload.system_prompt_override is not None:
        vertical.system_prompt_override = payload.system_prompt_override
    if payload.off_topic_hint is not None:
        vertical.off_topic_hint = payload.off_topic_hint

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="vertical_updated",
        resource_type="vertical",
        resource_id=vertical.id,
    )
    db.commit()
    db.refresh(vertical)
    return VerticalSummary(
        id=vertical.id,
        slug=vertical.slug,
        display_name=vertical.display_name,
        tagline=vertical.tagline,
        welcome_message=vertical.welcome_message,
        disclaimer_text=vertical.disclaimer_text,
        system_prompt_override=vertical.system_prompt_override,
        off_topic_hint=vertical.off_topic_hint,
        uses_regional_scoping=vertical.uses_regional_scoping,
        status=vertical.status,
    )


@router.get("/gap-queries", response_model=list[GapQueryEntry])
async def list_gap_queries(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[GapQueryEntry]:
    """Recent real questions the chat couldn't confidently answer
    (ChatSession.gap=true - no relevant KB match, an off-topic guard, or a
    low-confidence answer). Gives the admin something concrete to act on
    beyond the aggregate gap-rate percentage: what people are actually
    asking that the knowledge base doesn't cover yet."""
    require_super_admin(user)
    rows = db.scalars(
        select(ChatSession)
        .where(ChatSession.gap.is_(True), ChatSession.message.isnot(None))
        .order_by(ChatSession.created_at.desc())
        .limit(50)
    ).all()
    company_ids = {r.company_id for r in rows if r.company_id}
    company_names = {}
    if company_ids:
        company_names = {c.id: c.name for c in db.scalars(select(Company).where(Company.id.in_(company_ids)))}
    return [
        GapQueryEntry(
            id=r.id,
            message=r.message,
            company_name=company_names.get(r.company_id) if r.company_id else None,
            created_at=r.created_at,
        )
        for r in rows
    ]


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


@router.get("/feedback", response_model=FeedbackListResponse)
async def list_feedback(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FeedbackListResponse:
    """Every thumbs-up/down rating across the whole platform, most recent
    first - the triage queue behind the Ανατροφοδότηση admin screen. One
    joined query rather than per-row lookups since this can return every
    rating ever recorded, unlike the single-row PATCH below."""
    require_super_admin(user)
    rows = db.execute(
        select(MessageFeedback, ChatSession, User, Company, Vertical)
        .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
        .outerjoin(User, User.id == ChatSession.user_id)
        .outerjoin(Company, Company.id == ChatSession.company_id)
        .outerjoin(Vertical, Vertical.id == Company.vertical_id)
        .order_by(MessageFeedback.created_at.desc())
    ).all()
    return FeedbackListResponse(
        items=[
            FeedbackEntry(
                id=fb.id,
                rating=fb.rating,
                feedback_text=fb.feedback_text,
                status=fb.status,
                created_at=fb.created_at,
                question=session.message or "",
                answer_excerpt=(session.response or "")[:200],
                user_name=u.display_name if u else "—",
                company_name=company.name if company else None,
                vertical=vertical.slug if vertical else None,
            )
            for fb, session, u, company, vertical in rows
        ]
    )


@router.patch("/feedback/{feedback_id}", response_model=FeedbackEntry)
async def update_feedback_status(
    feedback_id: int,
    payload: FeedbackStatusUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FeedbackEntry:
    require_super_admin(user)
    fb = db.get(MessageFeedback, feedback_id)
    if not fb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feedback not found")
    fb.status = payload.status
    db.commit()

    session = db.get(ChatSession, fb.session_id)
    u = db.get(User, session.user_id) if session and session.user_id else None
    company = db.get(Company, session.company_id) if session and session.company_id else None
    vertical = db.get(Vertical, company.vertical_id) if company else None
    return FeedbackEntry(
        id=fb.id,
        rating=fb.rating,
        feedback_text=fb.feedback_text,
        status=fb.status,
        created_at=fb.created_at,
        question=(session.message if session else None) or "",
        answer_excerpt=((session.response if session else None) or "")[:200],
        user_name=u.display_name if u else "—",
        company_name=company.name if company else None,
        vertical=vertical.slug if vertical else None,
    )


@router.get("/user-feedback", response_model=UserFeedbackListResponse)
async def list_user_feedback(
    category: str | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> UserFeedbackListResponse:
    """Product-level feedback from the floating beta widget (bug/suggestion/
    content-gap reports), most recent first - the "Σχόλια Χρηστών" section on
    the Ανατροφοδότηση screen. Optionally filtered to one category; the UI
    also gives 'content_gap' its own prominently-separated view, since those
    items feed directly into the KB gap workflow rather than being a general
    triage queue like the other two categories."""
    require_super_admin(user)
    stmt = select(UserFeedback, User, Company).outerjoin(User, User.id == UserFeedback.user_id).outerjoin(
        Company, Company.id == UserFeedback.company_id
    )
    if category:
        stmt = stmt.where(UserFeedback.category == category)
    rows = db.execute(stmt.order_by(UserFeedback.created_at.desc())).all()
    return UserFeedbackListResponse(
        items=[
            UserFeedbackEntry(
                id=fb.id,
                category=fb.category,
                message=fb.message,
                page_url=fb.page_url,
                created_at=fb.created_at,
                user_name=u.display_name if u else "—",
                company_name=company.name if company else None,
            )
            for fb, u, company in rows
        ]
    )


def _to_plan_summary(db: Session, plan: Plan, subscriber_count: int | None = None) -> PlanSummary:
    vertical = db.get(Vertical, plan.vertical_id) if plan.vertical_id else None
    if subscriber_count is None:
        subscriber_count = (
            db.scalar(select(func.count()).select_from(CompanySubscription).where(CompanySubscription.plan_id == plan.id))
            or 0
        )
    return PlanSummary(
        id=plan.id,
        vertical_id=plan.vertical_id,
        vertical_slug=vertical.slug if vertical else None,
        name=plan.name,
        slug=plan.slug,
        billing_cycle=plan.billing_cycle,
        price_eur=float(plan.price_eur),
        user_limit=plan.user_limit,
        message_pool=plan.message_pool,
        is_beta=plan.is_beta,
        is_active=plan.is_active,
        subscriber_count=subscriber_count,
    )


@router.get("/plans", response_model=list[PlanSummary])
async def list_plans(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[PlanSummary]:
    require_super_admin(user)
    plans = db.scalars(select(Plan).order_by(Plan.vertical_id, Plan.price_eur)).all()
    subscriber_counts = dict(
        db.execute(select(CompanySubscription.plan_id, func.count()).group_by(CompanySubscription.plan_id)).all()
    )
    return [_to_plan_summary(db, p, subscriber_counts.get(p.id, 0)) for p in plans]


@router.post("/plans", response_model=PlanSummary, status_code=status.HTTP_201_CREATED)
async def create_plan(
    payload: PlanCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> PlanSummary:
    require_super_admin(user)
    plan = Plan(
        vertical_id=payload.vertical_id,
        name=payload.name,
        slug=payload.slug,
        billing_cycle=payload.billing_cycle,
        price_eur=payload.price_eur,
        user_limit=payload.user_limit,
        message_pool=payload.message_pool,
        is_beta=payload.is_beta,
        is_active=payload.is_active,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return _to_plan_summary(db, plan, subscriber_count=0)


@router.patch("/plans/{plan_id}", response_model=PlanSummary)
async def update_plan(
    plan_id: int,
    payload: PlanUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> PlanSummary:
    require_super_admin(user)
    plan = db.get(Plan, plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    for field in ("name", "billing_cycle", "price_eur", "user_limit", "message_pool", "is_beta", "is_active"):
        value = getattr(payload, field)
        if value is not None:
            setattr(plan, field, value)
    db.commit()
    db.refresh(plan)
    return _to_plan_summary(db, plan)


def _to_subscription_entry(db: Session, sub: CompanySubscription, company: Company, plan: Plan) -> SubscriptionEntry:
    vertical = db.get(Vertical, company.vertical_id) if company.vertical_id else None
    usage = get_or_create_usage(db, company.id, plan.message_pool)
    users_count = (
        db.scalar(select(func.count()).select_from(User).where(User.company_id == company.id, User.is_active.is_(True)))
        or 0
    )
    return SubscriptionEntry(
        company_id=company.id,
        company_name=company.name,
        vertical_slug=vertical.slug if vertical else None,
        plan_id=plan.id,
        plan_name=plan.name,
        plan_price_eur=float(plan.price_eur),
        is_beta=plan.is_beta,
        status=sub.status,
        billing_cycle=sub.billing_cycle,
        trial_ends_at=sub.trial_ends_at,
        current_period_end=sub.current_period_end,
        messages_used=usage.messages_used,
        messages_limit=usage.messages_limit,
        users_count=users_count,
        user_limit=plan.user_limit,
        notes=sub.notes,
        legal_name=company.legal_name,
        afm=company.afm,
        billing_address=company.billing_address,
    )


def _get_subscription_or_404(db: Session, company_id: int) -> tuple[CompanySubscription, Company, Plan]:
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    sub = get_or_create_subscription(db, company)
    plan = db.get(Plan, sub.plan_id)
    return sub, company, plan


@router.get("/subscriptions", response_model=SubscriptionListResponse)
async def list_subscriptions(
    sub_status: str | None = Query(default=None, alias="status"),
    vertical: str | None = None,
    plan_id: int | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionListResponse:
    """Every company's subscription, most-recently-created company first -
    the triage table behind the Συνδρομές admin screen's Εταιρείες tab."""
    require_super_admin(user)
    stmt = (
        select(CompanySubscription, Company, Plan)
        .join(Company, Company.id == CompanySubscription.company_id)
        .join(Plan, Plan.id == CompanySubscription.plan_id)
    )
    if sub_status:
        stmt = stmt.where(CompanySubscription.status == sub_status)
    if plan_id:
        stmt = stmt.where(CompanySubscription.plan_id == plan_id)
    if vertical:
        stmt = stmt.join(Vertical, Vertical.id == Company.vertical_id).where(Vertical.slug == vertical)
    rows = db.execute(stmt.order_by(Company.created_at.desc())).all()
    return SubscriptionListResponse(items=[_to_subscription_entry(db, sub, company, plan) for sub, company, plan in rows])


@router.post("/subscriptions/{company_id}", response_model=SubscriptionEntry)
async def assign_plan(
    company_id: int,
    payload: AssignPlanRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionEntry:
    """Assigns or changes a company's plan - the one entry point both
    'give this new company a real plan' and 'move this company between
    tiers' go through. trial_days present means the new assignment starts
    as a trial (e.g. a paid-plan trial, not just the original Beta trial);
    omitted means it's active immediately (manual, pre-Stripe billing)."""
    require_super_admin(user)
    company = db.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    plan = db.get(Plan, payload.plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    sub = db.scalar(select(CompanySubscription).where(CompanySubscription.company_id == company_id))
    now = datetime.utcnow()
    new_status = "trial" if payload.trial_days else "active"
    trial_ends_at = now + timedelta(days=payload.trial_days) if payload.trial_days else None
    period_days = 365 if payload.billing_cycle == "annual" else 30

    if sub:
        sub.plan_id = plan.id
        sub.billing_cycle = payload.billing_cycle
        sub.status = new_status
        sub.trial_ends_at = trial_ends_at
        if payload.notes is not None:
            sub.notes = payload.notes
        if new_status == "active":
            sub.current_period_start = now
            sub.current_period_end = now + timedelta(days=period_days)
    else:
        sub = CompanySubscription(
            company_id=company_id,
            plan_id=plan.id,
            status=new_status,
            billing_cycle=payload.billing_cycle,
            trial_ends_at=trial_ends_at,
            current_period_start=now if new_status == "active" else None,
            current_period_end=now + timedelta(days=period_days) if new_status == "active" else None,
            notes=payload.notes,
        )
        db.add(sub)
    db.flush()  # populates sub.id for a brand-new row, before log_action references it
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=company_id,
        action="subscription_plan_assigned",
        resource_type="company_subscription",
        resource_id=sub.id,
    )
    db.commit()
    db.refresh(sub)
    return _to_subscription_entry(db, sub, company, plan)


@router.patch("/subscriptions/{company_id}/extend-trial", response_model=SubscriptionEntry)
async def extend_trial(
    company_id: int,
    payload: ExtendTrialRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionEntry:
    require_super_admin(user)
    sub, company, plan = _get_subscription_or_404(db, company_id)
    # Extends from the later of "now" and the existing trial_ends_at - a
    # trial that already expired gets N days from today, not N days added
    # onto a date already in the past.
    now = datetime.utcnow()
    base = sub.trial_ends_at if sub.trial_ends_at and sub.trial_ends_at > now else now
    sub.trial_ends_at = base + timedelta(days=payload.days)
    if sub.status == "expired":
        sub.status = "trial"
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=company_id,
        action="subscription_trial_extended",
        resource_type="company_subscription",
        resource_id=sub.id,
        metadata={"days": payload.days},
    )
    db.commit()
    db.refresh(sub)
    return _to_subscription_entry(db, sub, company, plan)


@router.patch("/subscriptions/{company_id}/cancel", response_model=SubscriptionEntry)
async def cancel_subscription(
    company_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionEntry:
    require_super_admin(user)
    sub, company, plan = _get_subscription_or_404(db, company_id)
    sub.status = "cancelled"
    sub.cancelled_at = datetime.utcnow()
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=company_id,
        action="subscription_cancelled",
        resource_type="company_subscription",
        resource_id=sub.id,
    )
    db.commit()
    db.refresh(sub)
    return _to_subscription_entry(db, sub, company, plan)


@router.patch("/subscriptions/{company_id}/reactivate", response_model=SubscriptionEntry)
async def reactivate_subscription(
    company_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionEntry:
    require_super_admin(user)
    sub, company, plan = _get_subscription_or_404(db, company_id)
    sub.status = "active"
    sub.cancelled_at = None
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=company_id,
        action="subscription_reactivated",
        resource_type="company_subscription",
        resource_id=sub.id,
    )
    db.commit()
    db.refresh(sub)
    return _to_subscription_entry(db, sub, company, plan)


@router.patch("/subscriptions/{company_id}/notes", response_model=SubscriptionEntry)
async def update_subscription_notes(
    company_id: int,
    payload: AddSubscriptionNoteRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionEntry:
    require_super_admin(user)
    sub, company, plan = _get_subscription_or_404(db, company_id)
    sub.notes = payload.notes
    db.commit()
    db.refresh(sub)
    return _to_subscription_entry(db, sub, company, plan)
