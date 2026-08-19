import json
import secrets
from datetime import date, datetime, timedelta

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from openai import OpenAI, OpenAIError
from sqlalchemy import case, delete, func, or_, select, text
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import (
    AuditLog,
    ChatSession,
    Company,
    CompanySubscription,
    Customer,
    DataSource,
    Document,
    DocumentValidation,
    EmailSettings,
    EmailTemplate,
    Embedding,
    HelpSection,
    InfraHealthCheck,
    Invite,
    LegalDocument,
    MessageFeedback,
    PasswordResetToken,
    Plan,
    Project,
    Region,
    RegionContactCandidate,
    RegionDiscoverySettings,
    RegionRequest,
    SpendAlertCheck,
    SpendAlertThreshold,
    SubscriptionUsage,
    User,
    UserFeedback,
    UtilityProvider,
    Vertical,
    WeeklyDigest,
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
    AuditLogListResponse,
    BrowseResponse,
    BusinessHealthDayEntry,
    BusinessHealthResponse,
    CompanyCreateWithAdminRequest,
    CompanyCreateWithAdminResponse,
    CompanyDetail,
    CompanyDocumentsSummary,
    CompanyProjectSummary,
    CompanySummary,
    CompanyUserSummary,
    CustomerDocumentsSummary,
    DataSourceSummary,
    DataSourceSyncStatus,
    DataSourceUpdateRequest,
    DataSourcesByVertical,
    DocumentExtractionStatusUpdateRequest,
    DocumentReplacementRef,
    DocumentSummary,
    DocumentValidationResult,
    EmailSettingsEntry,
    EmailSettingsUpdateRequest,
    EmailStatusResponse,
    EmailTemplateDetail,
    EmailTemplateSaveRequest,
    EmailTemplateSummary,
    EmailTemplateTestSendRequest,
    EmailTestSendResponse,
    ExtendTrialRequest,
    FeedbackEntry,
    FeedbackListResponse,
    FeedbackStatusUpdateRequest,
    GapQueryEntry,
    HelpSectionAdminDetail,
    HelpSectionAdminSummary,
    HelpSectionReorderRequest,
    HelpSectionSaveRequest,
    InfraHealthCheckEntry,
    InfraHealthResponse,
    InternalActivityResponse,
    InternalAuditActivityEntry,
    InternalChatActivityEntry,
    InviteSummary,
    LegalDocumentAdminDetail,
    LegalDocumentAdminSummary,
    LegalDocumentSaveRequest,
    LegalDocumentUnpublishRequest,
    MarkReviewedRequest,
    MarkSupersededRequest,
    PlanCreateRequest,
    PlanSummary,
    PlanUpdateRequest,
    ReassignVerticalRequest,
    RegionAdminSummary,
    RegionAdminUpdateRequest,
    RegionContactCandidateConfirmRequest,
    RegionContactCandidateRejectRequest,
    RegionContactCandidateSummary,
    RegionDiscoveryBatchResult,
    RegionDiscoveryBatchRunRequest,
    RegionDiscoverySettingsSummary,
    RegionDiscoverySettingsUpdateRequest,
    RegionRequestSummary,
    RevalidateAllResponse,
    RevalidationStatusResponse,
    RoleChangeRequest,
    SpendAlertCheckEntry,
    SpendAlertsResponse,
    SpendAlertThresholdEntry,
    SpendAlertThresholdUpdateRequest,
    StaleDocumentSummary,
    SubscriptionEntry,
    SubscriptionListResponse,
    SuperAdminInviteCreateRequest,
    UndoSupersedeRequest,
    UserFeedbackEntry,
    UserFeedbackListResponse,
    UtilityProviderAdminSummary,
    UtilityProviderAdminUpdateRequest,
    VerticalStatsEntry,
    VerticalSummary,
    VerticalUpdateRequest,
    WeeklyDigestEntry,
    WeeklyDigestsResponse,
)
from app.security import generate_password, hash_password
from app.services.audit import log_action
from app.services.authorization import require_super_admin
from app.routers.companies import INVITE_VALID_DAYS
from app.services.bootstrap import is_demo_seed_email


def _solo_super_admin_user_ids():
    """Company-less super_admin accounts (role='super_admin', company_id IS
    NULL) - their own manual chat probing/admin actions are real activity in
    the database but not real customer activity, so every platform-wide
    aggregate below excludes it the same way is_test_account company data is
    excluded. This is a query-level filter only: nothing referencing these
    users is ever deleted. GET /admin/internal-activity is where this
    excluded activity is still visible to a super_admin."""
    return select(User.id).where(User.role == "super_admin", User.company_id.is_(None)).scalar_subquery()
from app.services.email import send_company_less_invite_email, send_invite_email, send_test_email
from app.services.email_templates import (
    ALLOWED_VARIABLES as EMAIL_TEMPLATE_VARIABLES,
    TEMPLATE_KEYS as EMAIL_TEMPLATE_KEYS,
    find_unknown_placeholders,
)
from app.services.embeddings import embed_document
from app.services.growth_alerts import check_company_count_thresholds, real_active_company_count
from app.services.legal_docs import SLUGS as LEGAL_SLUGS, find_placeholders
from app.services.politeness import CrawlBlocked, RobotsDisallowed
from app.services.region_contact_discovery import next_batch_region_ids, run_batch
from app.services.source_fetch import content_hash, extract_content, fetch_raw, fetch_url_content
from app.services.sources import group_label
from app.services.subscription import get_or_create_subscription, get_or_create_usage
from app.services.usage import company_token_usage
from app.services.weekly_digest import run_weekly_digest

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
        is_test_account=c.is_test_account,
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

    company = Company(
        name=payload.company_name,
        type=payload.company_type,
        vertical_id=vertical.id,
        is_test_account=payload.is_test_account,
    )
    db.add(company)
    db.flush()

    # Created explicitly here (not left to get_or_create_subscription's
    # lazy defensive path - see app/services/subscription.py) so trial_days
    # can differ from TRIAL_DAYS_DEFAULT, per the "Διάρκεια δοκιμής" field
    # on this same modal.
    beta_plan = db.scalar(select(Plan).where(Plan.vertical_id == vertical.id, Plan.is_beta.is_(True)))
    if not beta_plan:
        beta_plan = db.scalar(select(Plan).where(Plan.is_beta.is_(True)))
    db.add(
        CompanySubscription(
            company_id=company.id,
            plan_id=beta_plan.id,
            status="trial",
            billing_cycle="monthly",
            trial_ends_at=datetime.utcnow() + timedelta(days=payload.trial_days),
        )
    )

    generated_password = generate_password()
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
                ChatSession.true_gap(),
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
    companies = {c.id: c for c in db.scalars(select(Company))}
    vertical_slugs = {v.id: v.slug for v in db.scalars(select(Vertical))}

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
            company_name=companies[u.company_id].name if u.company_id in companies else "—",
            vertical_slug=vertical_slugs.get(companies[u.company_id].vertical_id) if u.company_id in companies else None,
            # Company.is_test_account has no signal for a company-less user
            # (company_id IS NULL - every super_admin) - falls back to the
            # email-domain check for those, so demo-superadmin@theke.gr
            # correctly lands in the demo tab instead of defaulting to
            # "real" the way a bare `else False` would (see
            # KNOWN_DECISIONS.md).
            is_test_account=(
                companies[u.company_id].is_test_account
                if u.company_id in companies
                else is_demo_seed_email(u.email)
            ),
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

    new_password = generate_password()
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


@router.post("/invites", response_model=InviteSummary, status_code=status.HTTP_201_CREATED)
async def create_super_admin_invite(
    payload: SuperAdminInviteCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> InviteSummary:
    """Company-less invite: super_admin only enters an email + vertical (via
    the same construction/municipality/accounting selector used everywhere
    else a company is created) - no company exists yet. The invitee creates
    their own company during onboarding and becomes its founding admin
    (role is always 'admin', never asked here). See auth.py's register()
    for the acceptance-side company-creation logic, and KNOWN_DECISIONS.md
    for why this is a separate endpoint from POST /companies/me/invites
    (that one requires an existing company_id via the caller's own JWT -
    a super_admin has none)."""
    require_super_admin(user)
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email is already registered")

    vertical_slug = "tax_accounting" if payload.company_type == "accounting" else "construction"
    vertical = db.scalar(select(Vertical).where(Vertical.slug == vertical_slug, Vertical.status == "active"))
    if not vertical:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown or inactive vertical_slug '{vertical_slug}'"
        )

    invite = Invite(
        company_id=None,
        company_type=payload.company_type,
        email=payload.email,
        token=secrets.token_urlsafe(24),
        role="admin",
        invited_by=user.user_id,
        vertical_id=vertical.id,
        expires_at=datetime.utcnow() + timedelta(days=INVITE_VALID_DAYS),
    )
    db.add(invite)
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="invite_created",
        resource_type="invite",
        metadata={"email": payload.email, "company_type": payload.company_type, "company_less": True},
    )
    db.commit()
    db.refresh(invite)

    accept_url = f"{settings.frontend_url}/register?invite_token={invite.token}"
    send_company_less_invite_email(
        db=db,
        to_email=invite.email,
        vertical_slug=vertical.slug,
        accept_url=accept_url,
        expiry_days=INVITE_VALID_DAYS,
    )

    return InviteSummary(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        token=invite.token,
        created_at=invite.created_at,
        expires_at=invite.expires_at,
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
            # None (not "—") for a still-pending company-less invite - the
            # frontend renders its own placeholder for that case.
            company_name=company_names.get(i.company_id) if i.company_id else None,
        )
        for i in invites
    ]


@router.post("/invites/{invite_id}/resend", response_model=AdminInviteSummary)
async def admin_resend_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AdminInviteSummary:
    """Platform-wide equivalent of POST /companies/me/invites/{id}/resend -
    covers both company-attached invites (created via that endpoint, visible
    here too) and company-less ones (see create_super_admin_invite above),
    since this list mixes both. Same token, fresh expires_at."""
    require_super_admin(user)
    invite = db.get(Invite, invite_id)
    if not invite or invite.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending invite not found")

    invite.expires_at = datetime.utcnow() + timedelta(days=INVITE_VALID_DAYS)
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=invite.company_id,
        action="invite_resent",
        resource_type="invite",
        resource_id=invite.id,
    )
    db.commit()
    db.refresh(invite)

    vertical = db.get(Vertical, invite.vertical_id) if invite.vertical_id else None
    accept_url = f"{settings.frontend_url}/register?invite_token={invite.token}"
    company = db.get(Company, invite.company_id) if invite.company_id else None
    if company:
        inviter = db.get(User, invite.invited_by)
        if inviter and vertical:
            send_invite_email(
                db=db,
                to_email=invite.email,
                inviter_name=inviter.display_name,
                company_name=company.name,
                vertical_slug=vertical.slug,
                role=invite.role,
                accept_url=accept_url,
                expiry_days=INVITE_VALID_DAYS,
            )
    elif vertical:
        send_company_less_invite_email(
            db=db,
            to_email=invite.email,
            vertical_slug=vertical.slug,
            accept_url=accept_url,
            expiry_days=INVITE_VALID_DAYS,
        )

    return AdminInviteSummary(
        id=invite.id,
        email=invite.email,
        role=invite.role,
        status=invite.status,
        created_at=invite.created_at,
        expires_at=invite.expires_at,
        company_id=invite.company_id,
        company_name=company.name if company else None,
    )


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


@router.patch("/documents/{document_id}/extraction-status", response_model=DocumentSummary)
async def update_document_extraction_status(
    document_id: int,
    payload: DocumentExtractionStatusUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> DocumentSummary:
    """Repair tool for a document stuck with a wrong/missing
    extraction_status - e.g. the bug where POST /documents/upload never set
    it at all, permanently disqualifying otherwise-real documents from
    embed_pending_documents()'s eligibility filter regardless of restarts
    (see KNOWN_DECISIONS.md). Before this endpoint existed, fixing an
    already-broken row required either a raw DB write or impersonating the
    owning company's user to re-upload through the ordinary flow - neither
    of which a super admin should need for a one-field repair. Setting
    extraction_status="full_text" also embeds the document immediately
    (embed_document is idempotent-skip if it's already embedded), so a fix
    doesn't have to wait for the next backend restart."""
    require_super_admin(user)
    doc = db.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    doc.extraction_status = payload.extraction_status
    db.flush()
    if payload.extraction_status == "full_text":
        embed_document(db, doc)
    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=doc.company_id,
        action="document_extraction_status_fixed",
        resource_type="document",
        resource_id=doc.id,
        metadata={"new_extraction_status": payload.extraction_status},
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


# --- Full source visibility (Sources/Πηγές, super admin) ---
#
# The tenant-facing GET /documents/browse (routers/documents.py) 403s for a
# super_admin outright (it depends on get_company_vertical, which requires
# exactly one company) - a super_admin has no company_id, so it isn't just
# under-scoped for them, it's structurally the wrong endpoint. These three
# endpoints back a dedicated super-admin view instead: the existing
# GET /admin/documents above already covers the public KB tier
# (company_id IS NULL); these cover the other two tiers - company-wide docs
# (company_id set, project_id and customer_id both NULL) and customer-scoped
# docs (customer_id set) - across every company, since a super_admin isn't
# a member of any one of them.


@router.get("/companies-documents", response_model=list[CompanyDocumentsSummary])
async def list_companies_documents_summary(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[CompanyDocumentsSummary]:
    """Every company (not just ones with existing company-wide documents) -
    a company with zero company-wide docs can still have customers with
    their own documents, so it still needs a tile to drill into."""
    require_super_admin(user)
    companies = db.scalars(select(Company).order_by(Company.name)).all()
    if not companies:
        return []

    doc_rows = db.execute(
        select(Document.company_id, func.count(), func.coalesce(func.sum(Document.file_size_bytes), 0))
        .where(
            Document.status == "active",
            Document.company_id.is_not(None),
            Document.project_id.is_(None),
            Document.customer_id.is_(None),
        )
        .group_by(Document.company_id)
    ).all()
    doc_counts = {row[0]: row[1] for row in doc_rows}
    storage = {row[0]: row[2] for row in doc_rows}
    customer_counts = dict(db.execute(select(Customer.company_id, func.count()).group_by(Customer.company_id)).all())
    verticals = {v.id: v.slug for v in db.scalars(select(Vertical))}

    return [
        CompanyDocumentsSummary(
            company_id=c.id,
            company_name=c.name,
            company_type=c.type,
            vertical_slug=verticals.get(c.vertical_id),
            document_count=doc_counts.get(c.id, 0),
            storage_bytes=storage.get(c.id, 0),
            customer_count=customer_counts.get(c.id, 0),
        )
        for c in companies
    ]


@router.get("/companies/{company_id}/company-documents", response_model=BrowseResponse)
async def list_company_wide_documents(
    company_id: int,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> BrowseResponse:
    """A single company's company-wide documents (project_id and
    customer_id both NULL) - the "Έγγραφα Εταιρειών" tier's drill-down,
    clicking a company tile from list_companies_documents_summary above."""
    require_super_admin(user)
    stmt = select(Document).where(
        Document.status == "active",
        Document.company_id == company_id,
        Document.project_id.is_(None),
        Document.customer_id.is_(None),
    )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    results = db.scalars(stmt.order_by(Document.created_at.desc()).limit(limit).offset(offset)).all()
    return BrowseResponse(total=total, items=[_to_admin_summary(db, doc) for doc in results])


@router.get("/companies/{company_id}/customers-documents", response_model=list[CustomerDocumentsSummary])
async def list_company_customers_with_documents(
    company_id: int,
    q: str = "",
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[CustomerDocumentsSummary]:
    """Every customer of one company, with its document count - the
    "Έγγραφα Πελατών" tier's filterable customer list (item 8c), searchable
    by the same name/ΑΦΜ/phone fields the customers table already has.
    Unlike GET /customers (routers/customers.py), which is scoped to the
    caller's own company, company_id here is a path param - a super_admin
    has no company of their own to default to."""
    require_super_admin(user)
    stmt = select(Customer).where(Customer.company_id == company_id)
    term = q.strip()
    if term:
        stmt = stmt.where(
            or_(
                Customer.name.ilike(f"%{term}%"),
                Customer.afm.ilike(f"%{term}%"),
                Customer.phone.ilike(f"%{term}%"),
            )
        )
    customers = db.scalars(stmt.order_by(Customer.name)).all()
    if not customers:
        return []

    doc_counts = dict(
        db.execute(
            select(Document.customer_id, func.count())
            .where(Document.status == "active", Document.customer_id.in_([c.id for c in customers]))
            .group_by(Document.customer_id)
        ).all()
    )
    return [
        CustomerDocumentsSummary(
            id=c.id, name=c.name, afm=c.afm, phone=c.phone, email=c.email, document_count=doc_counts.get(c.id, 0)
        )
        for c in customers
    ]


@router.get("/customers/{customer_id}/customer-documents", response_model=BrowseResponse)
async def list_customer_scoped_documents(
    customer_id: int,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> BrowseResponse:
    """A single customer's customer-scoped documents - the "Έγγραφα
    Πελατών" tier's drill-down, selecting a customer from
    list_company_customers_with_documents above."""
    require_super_admin(user)
    stmt = select(Document).where(Document.status == "active", Document.customer_id == customer_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    results = db.scalars(stmt.order_by(Document.created_at.desc()).limit(limit).offset(offset)).all()
    return BrowseResponse(total=total, items=[_to_admin_summary(db, doc) for doc in results])


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
    vertical_slug_by_id = {v.id: v.slug for v in db.scalars(select(Vertical))}
    return [
        StaleDocumentSummary(
            id=doc.id,
            title=doc.title,
            source=doc.source,
            source_group=group_label(doc.source_name) if doc.source_name else None,
            region_id=doc.region_id,
            last_verified_at=doc.last_verified_at,
            auto_needs_review_reason=doc.auto_needs_review_reason,
            vertical_slug=vertical_slug_by_id[doc.vertical_id],
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
    if validation.status == "validated" and validation.still_accurate:
        # A clean AI pass is itself the review - without this, needs_review
        # only ever cleared via mark-reviewed or apply-suggestion, so a
        # document confirmed accurate stayed stuck in the queue forever and
        # revalidating it changed nothing the admin could see.
        doc.needs_review = False
        doc.last_verified_at = date.today()
        doc.auto_needs_review_reason = None
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
                        # Same as the single-document path: a clean AI pass
                        # is itself the review, so it must clear the flag -
                        # otherwise the needs-review count never drops for
                        # documents the AI actually confirmed were fine.
                        doc.needs_review = False
                        doc.last_verified_at = date.today()
                        doc.auto_needs_review_reason = None
                        db.commit()
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
    # is_test_account companies (see the super_admin "Νέα Εταιρεία" modal's
    # "Δοκιμαστικός χρήστης" toggle) are excluded from every platform-wide
    # number below via an OUTER join + explicit is_test_account/NULL check -
    # not a plain NOT IN (subquery), which would silently drop every row
    # with a NULL company_id (Document.company_id IS NULL for the entire
    # shared knowledge base, and NOT IN treats a NULL comparison as UNKNOWN,
    # dropping those rows too).
    #
    # A company-less super_admin's OWN chat activity has ChatSession.company_id
    # IS NULL too, which used to satisfy not_test_company's Company.id.is_(None)
    # branch and get counted as if it were real customer usage - that's the
    # structural gap this section closes. not_solo_super_admin excludes it by
    # actor (role='super_admin' AND company_id IS NULL), a query-level filter
    # only - nothing is deleted, see GET /admin/internal-activity for where
    # this activity is still visible. not_solo_super_admin is applied to
    # every ChatSession/MessageFeedback aggregate below; not_test_company is
    # now ALSO applied to MessageFeedback (previously deliberately absent -
    # see KNOWN_DECISIONS.md - now closed so feedback matches every other
    # platform-wide metric).
    not_test_company = (Company.id.is_(None)) | (Company.is_test_account.is_(False))
    not_solo_super_admin = ChatSession.user_id.not_in(_solo_super_admin_user_ids())
    total_messages = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(not_test_company, not_solo_super_admin)
        )
        or 0
    )
    gap_count = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(ChatSession.true_gap(), not_test_company, not_solo_super_admin)
        )
        or 0
    )
    gap_rate = round(gap_count / total_messages * 100, 1) if total_messages else 0.0
    active_documents = (
        db.scalar(
            select(func.count())
            .select_from(Document)
            .outerjoin(Company, Company.id == Document.company_id)
            .where(Document.status == "active", not_test_company)
        )
        or 0
    )
    # MessageFeedback is now filtered by is_test_account too (previously
    # deliberately not - see KNOWN_DECISIONS.md - but that left it the only
    # platform stat inconsistent with every other metric above; closing the
    # gap rather than special-casing feedback further). MessageFeedback has
    # no user_id/company_id of its own, so both exclusions require a join
    # through ChatSession to reach the actor/company.
    positive_feedback = (
        db.scalar(
            select(func.count())
            .select_from(MessageFeedback)
            .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(MessageFeedback.rating == "positive", not_test_company, not_solo_super_admin)
        )
        or 0
    )
    negative_feedback = (
        db.scalar(
            select(func.count())
            .select_from(MessageFeedback)
            .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(MessageFeedback.rating == "negative", not_test_company, not_solo_super_admin)
        )
        or 0
    )
    since_30d = datetime.utcnow() - timedelta(days=30)
    platform_tokens_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.total_tokens), 0))
            .select_from(ChatSession)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(ChatSession.created_at >= since_30d, not_test_company, not_solo_super_admin)
        )
        or 0
    )
    platform_cost_eur_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0))
            .select_from(ChatSession)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(ChatSession.created_at >= since_30d, not_test_company, not_solo_super_admin)
        )
        or 0
    )
    # Fires a one-time notification the first time this crosses a threshold a
    # KNOWN_DECISIONS.md entry is keyed on (see growth_alerts.py) - cheap and
    # idempotent, safe to check on every stats load.
    check_company_count_thresholds(db)

    total = AdminStatsResponse(
        total_messages=total_messages,
        gap_rate=gap_rate,
        active_documents=active_documents,
        positive_feedback=positive_feedback,
        negative_feedback=negative_feedback,
        platform_tokens_30d=int(platform_tokens_30d),
        platform_cost_eur_30d=round(float(platform_cost_eur_30d), 2),
        real_active_companies=real_active_company_count(db),
    )

    # Not_solo_super_admin is deliberately NOT applied anywhere in this loop:
    # every query here INNER joins ChatSession -> Company (not an outer join),
    # and a company-less super_admin's ChatSession.company_id is always NULL,
    # so the inner join already drops those rows on its own.
    by_vertical = []
    for v in db.scalars(select(Vertical).order_by(Vertical.id)):
        v_messages = (
            db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, Company.is_test_account.is_(False))
            )
            or 0
        )
        v_gap = (
            db.scalar(
                select(func.count())
                .select_from(ChatSession)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, ChatSession.true_gap(), Company.is_test_account.is_(False))
            )
            or 0
        )
        v_docs = (
            db.scalar(
                select(func.count())
                .select_from(Document)
                .outerjoin(Company, Company.id == Document.company_id)
                .where(Document.vertical_id == v.id, Document.status == "active", not_test_company)
            )
            or 0
        )
        v_companies = (
            db.scalar(
                select(func.count())
                .select_from(Company)
                .where(
                    Company.vertical_id == v.id,
                    Company.is_suspended.is_(False),
                    Company.is_test_account.is_(False),
                )
            )
            or 0
        )
        v_suspended = (
            db.scalar(
                select(func.count())
                .select_from(Company)
                .where(Company.vertical_id == v.id, Company.is_suspended.is_(True))
            )
            or 0
        )
        v_tokens_30d = (
            db.scalar(
                select(func.coalesce(func.sum(ChatSession.total_tokens), 0))
                .select_from(ChatSession)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, ChatSession.created_at >= since_30d, Company.is_test_account.is_(False))
            )
            or 0
        )
        v_cost_30d = (
            db.scalar(
                select(func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0))
                .select_from(ChatSession)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, ChatSession.created_at >= since_30d, Company.is_test_account.is_(False))
            )
            or 0
        )
        # Filtered by is_test_account, matching the total-level
        # positive_feedback/negative_feedback above.
        v_positive = (
            db.scalar(
                select(func.count())
                .select_from(MessageFeedback)
                .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, MessageFeedback.rating == "positive", Company.is_test_account.is_(False))
            )
            or 0
        )
        v_negative = (
            db.scalar(
                select(func.count())
                .select_from(MessageFeedback)
                .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
                .join(Company, Company.id == ChatSession.company_id)
                .where(Company.vertical_id == v.id, MessageFeedback.rating == "negative", Company.is_test_account.is_(False))
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
                suspended_companies=v_suspended,
                platform_tokens_30d=int(v_tokens_30d),
                platform_cost_eur_30d=round(float(v_cost_30d), 2),
                positive_feedback=v_positive,
                negative_feedback=v_negative,
            )
        )

    return AdminStatsByVerticalResponse(total=total, by_vertical=by_vertical)


@router.get("/business-health", response_model=BusinessHealthResponse)
async def business_health(
    days: int = Query(default=30, ge=7, le=180),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> BusinessHealthResponse:
    """Single view combining real cost, real usage, and real quality over
    time, so a super_admin doesn't have to cross-reference GET /admin/stats,
    /spend-alerts, /digests and /feedback by hand. Every number here uses
    the exact same not_test_company/not_solo_super_admin exclusion as GET
    /admin/stats - see that endpoint's docstring for why both are needed
    (is_test_account alone misses a company-less super_admin's own
    activity, which has company_id IS NULL just like the shared KB).

    Deliberately NOT built: any composite/weighted "health score". Cost,
    usage, growth, and the two quality signals (gap rate, feedback ratio)
    are exposed as their own independent numbers - combining them would
    fabricate a precision this data doesn't support (a rising gap rate and
    a falling feedback ratio are different problems, not one number)."""
    require_super_admin(user)
    not_test_company = (Company.id.is_(None)) | (Company.is_test_account.is_(False))
    not_solo_super_admin = ChatSession.user_id.not_in(_solo_super_admin_user_ids())
    since = datetime.utcnow() - timedelta(days=days)
    since_day = since.date()
    today = datetime.utcnow().date()

    day_col = func.date(ChatSession.created_at)
    session_rows = db.execute(
        select(
            day_col.label("day"),
            func.count().label("messages"),
            func.coalesce(func.sum(case((ChatSession.true_gap(), 1), else_=0)), 0).label("gap_count"),
            func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0).label("spend"),
        )
        .select_from(ChatSession)
        .outerjoin(Company, Company.id == ChatSession.company_id)
        .where(ChatSession.created_at >= since, not_test_company, not_solo_super_admin)
        .group_by(day_col)
    ).all()
    session_by_day = {r.day: r for r in session_rows}

    # Bucketed by the feedback row's own created_at (when the rating was
    # given), not the underlying chat session's - a quality trend should
    # reflect when the platform's answers were judged, not when they were
    # asked.
    feedback_day_col = func.date(MessageFeedback.created_at)
    feedback_rows = db.execute(
        select(
            feedback_day_col.label("day"),
            func.coalesce(func.sum(case((MessageFeedback.rating == "positive", 1), else_=0)), 0).label("positive"),
            func.coalesce(func.sum(case((MessageFeedback.rating == "negative", 1), else_=0)), 0).label("negative"),
        )
        .select_from(MessageFeedback)
        .join(ChatSession, ChatSession.id == MessageFeedback.session_id)
        .outerjoin(Company, Company.id == ChatSession.company_id)
        .where(MessageFeedback.created_at >= since, not_test_company, not_solo_super_admin)
        .group_by(feedback_day_col)
    ).all()
    feedback_by_day = {r.day: r for r in feedback_rows}

    # Cumulative real-company/real-user growth curve - a registration
    # count, not a live "active now" count (historical suspension state
    # isn't tracked, so that reconstruction isn't possible). Pulling every
    # creation date (not just within the window) since the cumulative
    # count at the window's start already includes everything registered
    # before it.
    real_company_dates = sorted(
        d for (d,) in db.execute(select(func.date(Company.created_at)).where(Company.is_test_account.is_(False))).all()
    )
    solo_ids = _solo_super_admin_user_ids()
    real_user_dates = sorted(
        d
        for (d,) in db.execute(
            select(func.date(User.created_at))
            .outerjoin(Company, Company.id == User.company_id)
            .where(User.id.not_in(solo_ids), (Company.id.is_(None)) | (Company.is_test_account.is_(False)))
        ).all()
    )

    timeline: list[BusinessHealthDayEntry] = []
    company_idx = 0
    user_idx = 0
    n_days = (today - since_day).days + 1
    for i in range(n_days):
        d = since_day + timedelta(days=i)
        while company_idx < len(real_company_dates) and real_company_dates[company_idx] <= d:
            company_idx += 1
        while user_idx < len(real_user_dates) and real_user_dates[user_idx] <= d:
            user_idx += 1
        s = session_by_day.get(d)
        f = feedback_by_day.get(d)
        messages = s.messages if s else 0
        gap_count = s.gap_count if s else 0
        positive = f.positive if f else 0
        negative = f.negative if f else 0
        total_feedback = positive + negative
        timeline.append(
            BusinessHealthDayEntry(
                date=d.isoformat(),
                spend_eur=round(float(s.spend), 4) if s else 0.0,
                messages=messages,
                gap_rate=round(gap_count / messages * 100, 1) if messages else 0.0,
                positive_feedback=positive,
                negative_feedback=negative,
                feedback_ratio=round(positive / total_feedback * 100, 1) if total_feedback else None,
                real_companies_cumulative=company_idx,
                real_users_cumulative=user_idx,
            )
        )

    total_spend_eur = round(sum(day.spend_eur for day in timeline), 2)
    real_active_users_period = (
        db.scalar(
            select(func.count(func.distinct(ChatSession.user_id)))
            .select_from(ChatSession)
            .outerjoin(Company, Company.id == ChatSession.company_id)
            .where(ChatSession.created_at >= since, not_test_company, not_solo_super_admin)
        )
        or 0
    )
    cost_per_real_active_user_eur = (
        round(total_spend_eur / real_active_users_period, 2) if real_active_users_period else None
    )

    return BusinessHealthResponse(
        days=days,
        timeline=timeline,
        total_spend_eur=total_spend_eur,
        real_active_users_period=real_active_users_period,
        cost_per_real_active_user_eur=cost_per_real_active_user_eur,
    )


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


def _get_or_create_spend_alert_thresholds(db: Session) -> SpendAlertThreshold:
    row = db.get(SpendAlertThreshold, 1)
    if row is None:
        row = SpendAlertThreshold(id=1, daily_eur=5.00, weekly_eur=25.00)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/spend-alerts", response_model=SpendAlertsResponse)
async def spend_alerts(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SpendAlertsResponse:
    """Read-only view of the daily platform-wide spend snapshots written by
    crawler/crawler/spend_alert_check.py - this endpoint never writes a
    trend row itself, only the current editable thresholds (via PATCH
    below). history is oldest-first (chart-ready), mirrors
    GET /admin/infra-health's shape."""
    require_super_admin(user)
    thresholds = _get_or_create_spend_alert_thresholds(db)
    rows = list(db.scalars(select(SpendAlertCheck).order_by(SpendAlertCheck.created_at.desc()).limit(30)))
    history = [
        SpendAlertCheckEntry(
            spend_24h_eur=float(r.spend_24h_eur),
            spend_7d_eur=float(r.spend_7d_eur),
            daily_breached=r.daily_breached,
            weekly_breached=r.weekly_breached,
            created_at=r.created_at,
        )
        for r in reversed(rows)
    ]
    latest = history[-1] if history else None
    return SpendAlertsResponse(
        thresholds=SpendAlertThresholdEntry(
            daily_eur=float(thresholds.daily_eur),
            weekly_eur=float(thresholds.weekly_eur),
            updated_at=thresholds.updated_at,
        ),
        latest=latest,
        history=history,
    )


@router.patch("/spend-alerts/thresholds", response_model=SpendAlertThresholdEntry)
async def update_spend_alert_thresholds(
    payload: SpendAlertThresholdUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SpendAlertThresholdEntry:
    """Edits the daily/weekly EUR thresholds spend_alert_check.py compares
    trailing spend against on its next run - takes effect on the next
    scheduled run, not retroactively."""
    require_super_admin(user)
    if payload.daily_eur <= 0 or payload.weekly_eur <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Thresholds must be positive")
    row = _get_or_create_spend_alert_thresholds(db)
    row.daily_eur = payload.daily_eur
    row.weekly_eur = payload.weekly_eur
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return SpendAlertThresholdEntry(daily_eur=float(row.daily_eur), weekly_eur=float(row.weekly_eur), updated_at=row.updated_at)


def _to_weekly_digest_entry(row: WeeklyDigest) -> WeeklyDigestEntry:
    return WeeklyDigestEntry(
        total_messages=row.total_messages,
        gap_rate=float(row.gap_rate),
        spend_7d_eur=float(row.spend_7d_eur),
        active_companies=row.active_companies,
        open_feedback=row.open_feedback,
        needs_review=row.needs_review,
        recipients_sent=row.recipients_sent,
        recipients_total=row.recipients_total,
        triggered_manually=row.triggered_manually,
        created_at=row.created_at,
    )


@router.get("/digests", response_model=WeeklyDigestsResponse)
async def weekly_digests(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> WeeklyDigestsResponse:
    """Read-only history of every weekly digest send (Section 6a) - both
    crawler/crawler/weekly_digest.py's scheduled Monday run and any manual
    "resend now" trigger below. Most-recent-first."""
    require_super_admin(user)
    rows = list(db.scalars(select(WeeklyDigest).order_by(WeeklyDigest.created_at.desc()).limit(20)))
    history = [_to_weekly_digest_entry(r) for r in rows]
    return WeeklyDigestsResponse(latest=history[0] if history else None, history=history)


@router.post("/digests/resend", response_model=WeeklyDigestEntry)
async def resend_weekly_digest(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> WeeklyDigestEntry:
    """Triggers the same digest computation+send as the Monday cron job, on
    demand and independent of that schedule - always computes fresh stats
    at call time rather than replaying a stored one, so "resend" reflects
    the platform's current state."""
    require_super_admin(user)
    row = run_weekly_digest(db, triggered_manually=True)
    return _to_weekly_digest_entry(row)


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
        last_health_check_at=ds.last_health_check_at,
        last_health_check_status=ds.last_health_check_status,
        last_health_check_error=ds.last_health_check_error,
        consecutive_failures=ds.consecutive_failures,
        failing_since=ds.failing_since,
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

    The fetch itself goes through app/services/politeness.py's shared
    PoliteFetcher (per-host delay, robots.txt respect, ban detection) -
    this endpoint used to issue a plain unthrottled request, its own
    separate risk from the crawler package's now-protected one. A ban/403
    is reported as its own distinct last_crawl_status ('blocked') rather
    than folded into the generic 'failed' bucket, so a super admin sees it
    and doesn't keep re-triggering a sync against a host that's actively
    rejecting the traffic.
    """
    require_super_admin(user)
    source = db.get(DataSource, source_id)
    if not source:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")

    now = datetime.utcnow()
    try:
        resp = await fetch_raw(source.base_url)
        fetched_text = extract_content(resp, source.base_url)
    except CrawlBlocked as exc:
        source.last_crawl_status = "blocked"
        source.last_crawl_error = f"Η πηγή απέκλεισε το αίτημα ({exc.reason}) - πιθανό μπλοκάρισμα IP, μην επαναλάβετε άμεσα"
        log_action(
            db, actor_user_id=user.user_id, company_id=None,
            action="data_source_sync_blocked", resource_type="data_source", resource_id=source.id,
            metadata={"host": exc.host, "status_code": exc.status_code, "reason": exc.reason},
        )
        db.commit()
        db.refresh(source)
        return DataSourceSyncStatus(
            id=source.id, last_crawled_at=source.last_crawled_at, next_crawl_at=source.next_crawl_at,
            last_crawl_status=source.last_crawl_status, last_crawl_document_count=source.last_crawl_document_count,
            last_crawl_error=source.last_crawl_error,
        )
    except (httpx.HTTPError, RobotsDisallowed):
        fetched_text = None

    if fetched_text is None:
        # Crawl failed (unreachable, non-2xx, JS SPA with no server-rendered
        # content, robots.txt disallowed, etc.) - record the failure but
        # leave last_crawled_at, next_crawl_at, last_content_hash, and every
        # linked document untouched. A transient fetch failure must never
        # look like "the source was checked and found unchanged".
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
            f"Το περιεχόμενο της πηγής άλλαξε στις {now.strftime('%d/%m/%Y')}. "
            "Επαληθεύστε ότι το έγγραφο παραμένει ακριβές."
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


@router.get("/region-requests", response_model=list[RegionRequestSummary])
async def list_region_requests(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[RegionRequestSummary]:
    """Ranks accumulated "request coverage" clicks (POST
    /projects/regions/{region_id}/request) by request_count, so which
    uncovered municipality to ingest next is a data-driven call rather than
    a guess. Report-only - see KNOWN_DECISIONS.md for why this never
    triggers an automatic crawl."""
    require_super_admin(user)
    rows = db.execute(
        select(
            RegionRequest.region_id,
            Region.region_name_el,
            Region.region_name_en,
            func.count(RegionRequest.id).label("request_count"),
            func.max(RegionRequest.created_at).label("last_requested_at"),
        )
        .join(Region, Region.region_id == RegionRequest.region_id)
        .group_by(RegionRequest.region_id, Region.region_name_el, Region.region_name_en)
        .order_by(func.count(RegionRequest.id).desc(), func.max(RegionRequest.created_at).desc())
    ).all()
    return [
        RegionRequestSummary(
            region_id=r.region_id,
            region_name_el=r.region_name_el,
            region_name_en=r.region_name_en,
            request_count=r.request_count,
            last_requested_at=r.last_requested_at,
        )
        for r in rows
    ]


@router.get("/region-contact-candidates", response_model=list[RegionContactCandidateSummary])
async def list_region_contact_candidates(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    status_filter: str = Query("pending_review", alias="status"),
) -> list[RegionContactCandidateSummary]:
    """Review queue for the semi-automated ΥΔΟΜ contact discovery pass - same
    needs_review pattern as document review, but for a wholly separate
    concern (contact info, not KB content). Nothing here is live until a
    super admin explicitly confirms it (see the confirm/reject actions
    below and KNOWN_DECISIONS.md)."""
    require_super_admin(user)
    query = select(RegionContactCandidate, Region.region_name_el).join(
        Region, Region.region_id == RegionContactCandidate.region_id
    )
    if status_filter != "all":
        query = query.where(RegionContactCandidate.status == status_filter)
    query = query.order_by(RegionContactCandidate.discovered_at.desc())
    rows = db.execute(query).all()
    return [
        RegionContactCandidateSummary(
            id=c.id,
            region_id=c.region_id,
            region_name_el=region_name_el,
            candidate_authority_name=c.candidate_authority_name,
            candidate_phone=c.candidate_phone,
            candidate_email=c.candidate_email,
            source_url=c.source_url,
            discovered_at=c.discovered_at,
            status=c.status,
        )
        for c, region_name_el in rows
    ]


@router.post("/region-contact-candidates/{candidate_id}/confirm", response_model=RegionContactCandidateSummary)
async def confirm_region_contact_candidate(
    candidate_id: int,
    payload: RegionContactCandidateConfirmRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RegionContactCandidateSummary:
    """The only path that writes discovered contact info into the live
    Region row chat retrieval reads from. Confirming only ever moves
    Region.status pending -> stub ("basic contact info confirmed") - never
    -> active, since that's reserved for regions with real regulatory
    content ingested (a wholly separate, unaffected process). See
    KNOWN_DECISIONS.md."""
    require_super_admin(user)
    candidate = db.get(RegionContactCandidate, candidate_id)
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    if candidate.status != "pending_review":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate already reviewed")

    region = db.get(Region, candidate.region_id)
    if not region:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Region not found")

    # The frontend always pre-fills these fields with the candidate's own
    # discovered values and sends whatever is currently in them - so the
    # payload IS the final desired state, whether untouched or edited
    # (including a field the reviewer deliberately cleared to blank). An
    # earlier version of this endpoint fell back to the candidate's value
    # whenever a payload field was falsy, which made clearing a field
    # before confirming impossible - a blanked field just silently came
    # back. Caught live while verifying the edit-then-confirm path.
    was_edited = (
        payload.authority_name != candidate.candidate_authority_name
        or payload.phone != candidate.candidate_phone
        or payload.email != candidate.candidate_email
    )

    region.ydom_authority_name = payload.authority_name
    region.contact_phone = payload.phone
    region.contact_email = payload.email
    if region.status == "pending":
        region.status = "stub"

    candidate.status = "confirmed"
    candidate.reviewed_by = user.user_id
    candidate.reviewed_at = datetime.utcnow()
    if was_edited:
        candidate.review_note = "Edited before confirming"

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="region_contact_candidate_confirmed",
        resource_type="region_contact_candidate",
        resource_id=candidate.id,
        metadata={"region_id": region.region_id},
    )
    db.commit()
    db.refresh(candidate)
    return RegionContactCandidateSummary(
        id=candidate.id,
        region_id=candidate.region_id,
        region_name_el=region.region_name_el,
        candidate_authority_name=candidate.candidate_authority_name,
        candidate_phone=candidate.candidate_phone,
        candidate_email=candidate.candidate_email,
        source_url=candidate.source_url,
        discovered_at=candidate.discovered_at,
        status=candidate.status,
    )


@router.post("/region-contact-candidates/{candidate_id}/reject", response_model=RegionContactCandidateSummary)
async def reject_region_contact_candidate(
    candidate_id: int,
    payload: RegionContactCandidateRejectRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RegionContactCandidateSummary:
    require_super_admin(user)
    candidate = db.get(RegionContactCandidate, candidate_id)
    if not candidate:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found")
    if candidate.status != "pending_review":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate already reviewed")

    candidate.status = "rejected"
    candidate.reviewed_by = user.user_id
    candidate.reviewed_at = datetime.utcnow()
    candidate.review_note = payload.review_note

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="region_contact_candidate_rejected",
        resource_type="region_contact_candidate",
        resource_id=candidate.id,
        metadata={"region_id": candidate.region_id},
    )
    db.commit()
    db.refresh(candidate)
    region = db.get(Region, candidate.region_id)
    return RegionContactCandidateSummary(
        id=candidate.id,
        region_id=candidate.region_id,
        region_name_el=region.region_name_el if region else candidate.region_id,
        candidate_authority_name=candidate.candidate_authority_name,
        candidate_phone=candidate.candidate_phone,
        candidate_email=candidate.candidate_email,
        source_url=candidate.source_url,
        discovered_at=candidate.discovered_at,
        status=candidate.status,
    )


@router.get("/region-discovery-settings", response_model=RegionDiscoverySettingsSummary)
async def get_region_discovery_settings(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RegionDiscoverySettingsSummary:
    require_super_admin(user)
    row = db.get(RegionDiscoverySettings, 1)
    if row is None:
        # Matches the seeded db/init.sql row - only missing if a DB was
        # created before this migration ran; create it rather than 500ing.
        row = RegionDiscoverySettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return RegionDiscoverySettingsSummary(
        cadence_type=row.cadence_type, default_batch_size=row.default_batch_size, updated_at=row.updated_at
    )


@router.patch("/region-discovery-settings", response_model=RegionDiscoverySettingsSummary)
async def update_region_discovery_settings(
    payload: RegionDiscoverySettingsUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RegionDiscoverySettingsSummary:
    """cadence_type is stored but, deliberately, not yet read by any
    scheduled job - same as data_sources' crawl_frequency_type/_days before
    a source is ever actually auto-synced. Kept manual-only given the pilot's
    ~40% failure/false-positive rate; see KNOWN_DECISIONS.md."""
    require_super_admin(user)
    row = db.get(RegionDiscoverySettings, 1)
    if row is None:
        row = RegionDiscoverySettings(id=1)
        db.add(row)

    if payload.cadence_type is not None:
        row.cadence_type = payload.cadence_type
    if payload.default_batch_size is not None:
        row.default_batch_size = payload.default_batch_size
    row.updated_at = datetime.utcnow()

    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="region_discovery_settings_updated", resource_type="region_discovery_settings", resource_id=1,
    )
    db.commit()
    db.refresh(row)
    return RegionDiscoverySettingsSummary(
        cadence_type=row.cadence_type, default_batch_size=row.default_batch_size, updated_at=row.updated_at
    )


@router.post("/region-contact-discovery/run", response_model=RegionDiscoveryBatchResult)
async def run_region_contact_discovery_batch(
    payload: RegionDiscoveryBatchRunRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RegionDiscoveryBatchResult:
    """Admin-UI trigger for the semi-automated ΥΔΟΜ contact discovery pass -
    same discovery algorithm and the same region_contact_candidates staging
    table as the CLI pilot (crawler/crawler/region_contact_discovery.py; see
    app/services/region_contact_discovery.py's module docstring for why this
    is a mirrored port rather than a cross-container import). Only how a
    batch gets triggered changes: the next N `pending` regions, prioritized
    by accumulated region_requests count (desc) then alphabetically, instead
    of a hand-picked CLI argument list. Runs synchronously and returns the
    batch's own summary, same shape as the pilot's report - no change to the
    actual discovery or review logic."""
    require_super_admin(user)
    settings_row = db.get(RegionDiscoverySettings, 1)
    default_size = settings_row.default_batch_size if settings_row else 15
    batch_size = payload.batch_size or default_size

    region_ids = next_batch_region_ids(db, batch_size)
    if not region_ids:
        return RegionDiscoveryBatchResult(
            region_ids_attempted=[], candidates_found=0, not_found_region_ids=[], skipped=[]
        )

    result = await run_batch(db, region_ids)

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=None,
        action="region_contact_discovery_batch_run",
        resource_type="region_discovery_batch",
        resource_id=None,
        metadata={
            "regions_attempted": result["regions_attempted"],
            "candidates_found": result["candidates_found"],
        },
    )
    db.commit()

    return RegionDiscoveryBatchResult(
        region_ids_attempted=region_ids,
        candidates_found=result["candidates_found"],
        not_found_region_ids=result["not_found"],
        skipped=result["skipped"],
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
            tagline_en=v.tagline_en,
            welcome_message=v.welcome_message,
            welcome_message_en=v.welcome_message_en,
            disclaimer_text=v.disclaimer_text,
            disclaimer_text_en=v.disclaimer_text_en,
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
    needed - get_system_prompt()/get_topic_guard_prompt() in
    app/routers/chat.py, and the chat page's own disclaimerBar (sourced from
    GET /companies/me's vertical_disclaimer_text[_en]), all read straight
    from this row per-request, never cached at startup."""
    require_super_admin(user)
    vertical = db.get(Vertical, vertical_id)
    if not vertical:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vertical not found")

    if payload.tagline is not None:
        vertical.tagline = payload.tagline
    if payload.tagline_en is not None:
        vertical.tagline_en = payload.tagline_en
    if payload.welcome_message is not None:
        vertical.welcome_message = payload.welcome_message
    if payload.welcome_message_en is not None:
        vertical.welcome_message_en = payload.welcome_message_en
    if payload.disclaimer_text is not None:
        vertical.disclaimer_text = payload.disclaimer_text
    if payload.disclaimer_text_en is not None:
        vertical.disclaimer_text_en = payload.disclaimer_text_en
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
        tagline_en=vertical.tagline_en,
        welcome_message=vertical.welcome_message,
        welcome_message_en=vertical.welcome_message_en,
        disclaimer_text=vertical.disclaimer_text,
        disclaimer_text_en=vertical.disclaimer_text_en,
        system_prompt_override=vertical.system_prompt_override,
        off_topic_hint=vertical.off_topic_hint,
        uses_regional_scoping=vertical.uses_regional_scoping,
        status=vertical.status,
    )


def _legal_summary(doc: LegalDocument, updated_by_name: str | None) -> LegalDocumentAdminSummary:
    return LegalDocumentAdminSummary(
        slug=doc.slug,
        title=doc.title,
        is_published=doc.is_published,
        version=doc.version,
        placeholder_count=len(find_placeholders(doc.content)),
        published_at=doc.published_at,
        updated_at=doc.updated_at,
        updated_by_name=updated_by_name,
    )


def _updated_by_names(db: Session, docs: list[LegalDocument]) -> dict[int, str]:
    user_ids = {d.updated_by for d in docs if d.updated_by is not None}
    if not user_ids:
        return {}
    rows = db.scalars(select(User).where(User.id.in_(user_ids)))
    return {u.id: f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email for u in rows}


@router.get("/legal-documents", response_model=list[LegalDocumentAdminSummary])
async def list_legal_documents(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[LegalDocumentAdminSummary]:
    require_super_admin(user)
    docs = list(db.scalars(select(LegalDocument).order_by(LegalDocument.slug)))
    names = _updated_by_names(db, docs)
    return [_legal_summary(d, names.get(d.updated_by)) for d in docs]


@router.get("/legal-documents/{slug}", response_model=LegalDocumentAdminDetail)
async def get_legal_document(
    slug: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> LegalDocumentAdminDetail:
    require_super_admin(user)
    if slug not in LEGAL_SLUGS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    doc = db.scalar(select(LegalDocument).where(LegalDocument.slug == slug))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    names = _updated_by_names(db, [doc])
    placeholders = find_placeholders(doc.content)
    return LegalDocumentAdminDetail(
        **_legal_summary(doc, names.get(doc.updated_by)).model_dump(),
        content=doc.content,
        placeholders=placeholders,
    )


@router.patch("/legal-documents/{slug}", response_model=LegalDocumentAdminDetail)
async def save_legal_document(
    slug: str,
    payload: LegalDocumentSaveRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> LegalDocumentAdminDetail:
    """Save only - never touches is_published/published_at/version. A
    published document can be edited freely without going offline; the new
    text only reaches the public route once /publish is called again."""
    require_super_admin(user)
    if slug not in LEGAL_SLUGS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    doc = db.scalar(select(LegalDocument).where(LegalDocument.slug == slug))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")

    doc.title = payload.title
    doc.content = payload.content
    doc.updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="legal_document_saved", resource_type="legal_document", resource_id=doc.id,
        metadata={"slug": slug},
    )
    db.commit()
    db.refresh(doc)
    names = _updated_by_names(db, [doc])
    return LegalDocumentAdminDetail(
        **_legal_summary(doc, names.get(doc.updated_by)).model_dump(),
        content=doc.content,
        placeholders=find_placeholders(doc.content),
    )


@router.post("/legal-documents/{slug}/publish", response_model=LegalDocumentAdminDetail)
async def publish_legal_document(
    slug: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> LegalDocumentAdminDetail:
    """Hard-blocked (422) while the saved content still has an unresolved
    `[...]` placeholder - the specific remaining placeholders are returned
    so the admin UI can point at exactly what's left, not just say "no"."""
    require_super_admin(user)
    if slug not in LEGAL_SLUGS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    doc = db.scalar(select(LegalDocument).where(LegalDocument.slug == slug))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")

    placeholders = find_placeholders(doc.content)
    if placeholders:
        # {message, placeholders} - the message half surfaces automatically
        # via the frontend api.ts's existing detail.message handling (same
        # shape as auth.py's vertical_slug validation); placeholders is for
        # the admin UI to list the specific blockers, not parsed from the
        # error - it re-reads the document's own placeholders field instead.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": f"Δεν είναι δυνατή η δημοσίευση όσο υπάρχουν {len(placeholders)} αγκύλες προς συμπλήρωση",
                "placeholders": placeholders,
            },
        )

    doc.is_published = True
    doc.published_at = datetime.utcnow()
    doc.version += 1
    doc.updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="legal_document_published", resource_type="legal_document", resource_id=doc.id,
        metadata={"slug": slug, "version": doc.version},
    )
    db.commit()
    db.refresh(doc)
    names = _updated_by_names(db, [doc])
    return LegalDocumentAdminDetail(
        **_legal_summary(doc, names.get(doc.updated_by)).model_dump(),
        content=doc.content,
        placeholders=[],
    )


@router.post("/legal-documents/{slug}/unpublish", response_model=LegalDocumentAdminDetail)
async def unpublish_legal_document(
    slug: str,
    payload: LegalDocumentUnpublishRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> LegalDocumentAdminDetail:
    """Reverts the public page to draft-banner state. Requires explicit
    confirmation, same pattern as mark_document_reviewed's confirmed gate -
    taking a live legal page offline is not something a stray click should
    do. Content/version are untouched; only is_published flips."""
    require_super_admin(user)
    if not payload.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirm before reverting a published document to draft",
        )
    if slug not in LEGAL_SLUGS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    doc = db.scalar(select(LegalDocument).where(LegalDocument.slug == slug))
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")

    doc.is_published = False
    doc.updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="legal_document_unpublished", resource_type="legal_document", resource_id=doc.id,
        metadata={"slug": slug},
    )
    db.commit()
    db.refresh(doc)
    names = _updated_by_names(db, [doc])
    return LegalDocumentAdminDetail(
        **_legal_summary(doc, names.get(doc.updated_by)).model_dump(),
        content=doc.content,
        placeholders=find_placeholders(doc.content),
    )


def _email_template_updated_by_names(db: Session, rows: list[EmailTemplate]) -> dict[int, str]:
    user_ids = {r.updated_by for r in rows if r.updated_by is not None}
    if not user_ids:
        return {}
    rows_ = db.scalars(select(User).where(User.id.in_(user_ids)))
    return {u.id: f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email for u in rows_}


def _email_template_summary(row: EmailTemplate, updated_by_name: str | None) -> EmailTemplateSummary:
    return EmailTemplateSummary(
        template_key=row.template_key,
        subject_el=row.subject_el,
        updated_at=row.updated_at,
        updated_by_name=updated_by_name,
    )


@router.get("/email-templates", response_model=list[EmailTemplateSummary])
async def list_email_templates(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[EmailTemplateSummary]:
    require_super_admin(user)
    rows = list(db.scalars(select(EmailTemplate).order_by(EmailTemplate.template_key)))
    names = _email_template_updated_by_names(db, rows)
    return [_email_template_summary(r, names.get(r.updated_by)) for r in rows]


@router.get("/email-templates/{template_key}", response_model=EmailTemplateDetail)
async def get_email_template(
    template_key: str,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> EmailTemplateDetail:
    require_super_admin(user)
    if template_key not in EMAIL_TEMPLATE_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown email template")
    row = db.scalar(select(EmailTemplate).where(EmailTemplate.template_key == template_key))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown email template")
    names = _email_template_updated_by_names(db, [row])
    return EmailTemplateDetail(
        **_email_template_summary(row, names.get(row.updated_by)).model_dump(),
        subject_en=row.subject_en,
        body_el=row.body_el,
        body_en=row.body_en,
        available_variables=sorted(EMAIL_TEMPLATE_VARIABLES.get(template_key, set())),
    )


@router.patch("/email-templates/{template_key}", response_model=EmailTemplateDetail)
async def save_email_template(
    template_key: str,
    payload: EmailTemplateSaveRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> EmailTemplateDetail:
    """Blocked (422) if any field contains a `{{variable}}` this template
    doesn't recognize - same reasoning as the legal-document placeholder
    gate: catch a typo'd/foreign variable name immediately rather than let
    it show up as a blank spot (or worse, leak raw) in a real send."""
    require_super_admin(user)
    if template_key not in EMAIL_TEMPLATE_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown email template")
    row = db.scalar(select(EmailTemplate).where(EmailTemplate.template_key == template_key))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown email template")

    unknown = find_unknown_placeholders(template_key, payload.subject_el, payload.subject_en, payload.body_el, payload.body_en)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": f"Άγνωστες μεταβλητές: {', '.join(unknown)}",
                "placeholders": unknown,
            },
        )

    row.subject_el = payload.subject_el
    row.subject_en = payload.subject_en
    row.body_el = payload.body_el
    row.body_en = payload.body_en
    row.updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="email_template_saved", resource_type="email_template", resource_id=row.id,
        metadata={"template_key": template_key},
    )
    db.commit()
    db.refresh(row)
    names = _email_template_updated_by_names(db, [row])
    return EmailTemplateDetail(
        **_email_template_summary(row, names.get(row.updated_by)).model_dump(),
        subject_en=row.subject_en,
        body_el=row.body_el,
        body_en=row.body_en,
        available_variables=sorted(EMAIL_TEMPLATE_VARIABLES.get(template_key, set())),
    )


def _get_or_create_email_settings(db: Session) -> EmailSettings:
    row = db.get(EmailSettings, 1)
    if row is None:
        row = EmailSettings(id=1, test_email_address="manos_drams@hotmail.com")
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@router.get("/email-settings", response_model=EmailSettingsEntry)
async def get_email_settings(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> EmailSettingsEntry:
    require_super_admin(user)
    row = _get_or_create_email_settings(db)
    return EmailSettingsEntry(test_email_address=row.test_email_address, updated_at=row.updated_at)


@router.patch("/email-settings", response_model=EmailSettingsEntry)
async def update_email_settings(
    payload: EmailSettingsUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> EmailSettingsEntry:
    require_super_admin(user)
    if "@" not in payload.test_email_address:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Not a valid email address")
    row = _get_or_create_email_settings(db)
    row.test_email_address = payload.test_email_address
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return EmailSettingsEntry(test_email_address=row.test_email_address, updated_at=row.updated_at)


@router.post("/email-templates/{template_key}/test-send", response_model=EmailTestSendResponse)
async def test_send_email_template(
    template_key: str,
    payload: EmailTemplateTestSendRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> EmailTestSendResponse:
    """Sends the given (possibly unsaved, in-editor) subject/body content
    for real to the admin-configured test address, with realistic sample
    data substituted - lets an admin preview a change before saving it.
    Returns a structured `reason` rather than raising, so the frontend can
    show "email sending is disabled here" as a distinct, specific message
    instead of a generic error - the same "clear message, not a silent
    failure" bar this file already holds every other admin action to."""
    require_super_admin(user)
    if template_key not in EMAIL_TEMPLATE_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown email template")
    if not settings.email_enabled or not settings.resend_api_key:
        return EmailTestSendResponse(sent=False, reason="disabled")
    settings_row = _get_or_create_email_settings(db)
    ok = send_test_email(
        template_key, settings_row.test_email_address, payload.subject_el, payload.subject_en, payload.body_el, payload.body_en
    )
    return EmailTestSendResponse(sent=ok, reason=None if ok else "send_failed")


def _help_section_updated_by_names(db: Session, rows: list[HelpSection]) -> dict[int, str]:
    user_ids = {r.updated_by for r in rows if r.updated_by is not None}
    if not user_ids:
        return {}
    rows_ = db.scalars(select(User).where(User.id.in_(user_ids)))
    return {u.id: f"{u.first_name or ''} {u.last_name or ''}".strip() or u.email for u in rows_}


def _help_section_summary(row: HelpSection, updated_by_name: str | None) -> HelpSectionAdminSummary:
    return HelpSectionAdminSummary(
        id=row.id,
        slug=row.slug,
        title_el=row.title_el,
        visible_to_roles=row.visible_to_roles,
        vertical_scope=row.vertical_scope,
        display_order=row.display_order,
        is_active=row.is_active,
        updated_at=row.updated_at,
        updated_by_name=updated_by_name,
    )


def _help_section_detail(row: HelpSection, updated_by_name: str | None) -> HelpSectionAdminDetail:
    return HelpSectionAdminDetail(
        **_help_section_summary(row, updated_by_name).model_dump(),
        title_en=row.title_en,
        body_el=row.body_el,
        body_en=row.body_en,
    )


@router.get("/help-sections", response_model=list[HelpSectionAdminSummary])
async def list_help_sections(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[HelpSectionAdminSummary]:
    require_super_admin(user)
    rows = list(db.scalars(select(HelpSection).order_by(HelpSection.display_order, HelpSection.id)))
    names = _help_section_updated_by_names(db, rows)
    return [_help_section_summary(r, names.get(r.updated_by)) for r in rows]


@router.get("/help-sections/{section_id}", response_model=HelpSectionAdminDetail)
async def get_help_section(
    section_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> HelpSectionAdminDetail:
    require_super_admin(user)
    row = db.get(HelpSection, section_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown help section")
    names = _help_section_updated_by_names(db, [row])
    return _help_section_detail(row, names.get(row.updated_by))


@router.post("/help-sections", response_model=HelpSectionAdminDetail, status_code=status.HTTP_201_CREATED)
async def create_help_section(
    payload: HelpSectionSaveRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> HelpSectionAdminDetail:
    require_super_admin(user)
    if db.scalar(select(HelpSection).where(HelpSection.slug == payload.slug)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A help section with this slug already exists")

    max_order = db.scalar(select(func.max(HelpSection.display_order))) or 0
    row = HelpSection(
        slug=payload.slug,
        title_el=payload.title_el,
        title_en=payload.title_en,
        body_el=payload.body_el,
        body_en=payload.body_en,
        visible_to_roles=payload.visible_to_roles,
        vertical_scope=payload.vertical_scope,
        is_active=payload.is_active,
        display_order=max_order + 1,
        updated_by=user.user_id,
    )
    db.add(row)
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="help_section_created", resource_type="help_section", resource_id=None,
        metadata={"slug": payload.slug},
    )
    db.commit()
    db.refresh(row)
    names = _help_section_updated_by_names(db, [row])
    return _help_section_detail(row, names.get(row.updated_by))


@router.patch("/help-sections/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder_help_sections(
    payload: HelpSectionReorderRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Rewrites display_order for every id in payload.ordered_ids to match
    its position in that list (1-indexed) - always the full sequence, not a
    partial move, so the frontend just sends its current on-screen order
    after a drag/up-down action."""
    require_super_admin(user)
    rows = {r.id: r for r in db.scalars(select(HelpSection).where(HelpSection.id.in_(payload.ordered_ids)))}
    missing = [i for i in payload.ordered_ids if i not in rows]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown help section id(s): {missing}")

    for position, section_id in enumerate(payload.ordered_ids, start=1):
        rows[section_id].display_order = position
        rows[section_id].updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="help_sections_reordered", resource_type="help_section", resource_id=None,
        metadata={"ordered_ids": payload.ordered_ids},
    )
    db.commit()


@router.patch("/help-sections/{section_id}", response_model=HelpSectionAdminDetail)
async def update_help_section(
    section_id: int,
    payload: HelpSectionSaveRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> HelpSectionAdminDetail:
    require_super_admin(user)
    row = db.get(HelpSection, section_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown help section")
    if payload.slug != row.slug and db.scalar(select(HelpSection).where(HelpSection.slug == payload.slug)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A help section with this slug already exists")

    row.slug = payload.slug
    row.title_el = payload.title_el
    row.title_en = payload.title_en
    row.body_el = payload.body_el
    row.body_en = payload.body_en
    row.visible_to_roles = payload.visible_to_roles
    row.vertical_scope = payload.vertical_scope
    row.is_active = payload.is_active
    row.updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="help_section_updated", resource_type="help_section", resource_id=row.id,
        metadata={"slug": row.slug},
    )
    db.commit()
    db.refresh(row)
    names = _help_section_updated_by_names(db, [row])
    return _help_section_detail(row, names.get(row.updated_by))


@router.delete("/help-sections/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_help_section(
    section_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Soft-delete only (is_active=false) - matches this project's established
    preference for reversible admin actions over hard deletes; the row (and
    its edit history) stays intact and can be reactivated via PATCH."""
    require_super_admin(user)
    row = db.get(HelpSection, section_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown help section")
    row.is_active = False
    row.updated_by = user.user_id
    log_action(
        db, actor_user_id=user.user_id, company_id=None,
        action="help_section_deactivated", resource_type="help_section", resource_id=row.id,
        metadata={"slug": row.slug},
    )
    db.commit()


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


@router.get("/internal-activity", response_model=InternalActivityResponse)
async def internal_activity(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> InternalActivityResponse:
    """Where the activity GET /admin/stats now structurally excludes (see
    _solo_super_admin_user_ids' docstring) is still visible - company-less
    super_admin accounts' own chat probing, and their admin actions taken
    outside any customer-company context (AuditLog.company_id IS NULL).
    Nothing here was ever deleted, just kept out of the platform-wide/
    customer-facing aggregates. Deliberately NOT part of GET /admin/stats or
    the main dashboard's stat cards - this is a separate internal-only view."""
    require_super_admin(user)
    solo_ids = _solo_super_admin_user_ids()
    chat_rows = db.execute(
        select(ChatSession, User.email)
        .join(User, User.id == ChatSession.user_id)
        .where(ChatSession.user_id.in_(solo_ids))
        .order_by(ChatSession.created_at.desc())
        .limit(100)
    ).all()
    audit_rows = db.execute(
        select(AuditLog, User.email)
        .join(User, User.id == AuditLog.actor_user_id)
        .where(AuditLog.actor_user_id.in_(solo_ids), AuditLog.company_id.is_(None))
        .order_by(AuditLog.created_at.desc())
        .limit(100)
    ).all()
    return InternalActivityResponse(
        chat_activity=[
            InternalChatActivityEntry(id=cs.id, actor_email=email, message=cs.message, gap=cs.gap, created_at=cs.created_at)
            for cs, email in chat_rows
        ],
        audit_activity=[
            InternalAuditActivityEntry(
                id=a.id,
                actor_email=email,
                action=a.action,
                resource_type=a.resource_type,
                resource_id=a.resource_id,
                created_at=a.created_at,
            )
            for a, email in audit_rows
        ],
    )


@router.get("/audit-log", response_model=AuditLogListResponse)
async def platform_audit_log(
    limit: int = Query(default=200, le=200),
    offset: int = Query(default=0, ge=0),
    company_id: int | None = None,
    q: str | None = None,
    exclude_solo_super_admin: bool = False,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> AuditLogListResponse:
    """Defaults (limit=200, offset=0) match the dashboard's own preview call
    exactly, so that call site's behavior is unchanged - the drill-through
    page (/admin/audit-log) is the only caller that passes a non-default
    offset/company_id/q to page through the full table.

    exclude_solo_super_admin defaults False so the drill-through page (a
    genuine audit trail - it should show everything, including a solo
    super_admin's own actions) is unaffected. The dashboard's activity
    chart/recent-activity preview opts in, using the same
    _solo_super_admin_user_ids exclusion already applied to the platform
    stat cards, weekly digest, and spend-alert checks - their own manual
    probing shouldn't inflate the "platform activity" story."""
    require_super_admin(user)
    stmt = select(AuditLog)
    if exclude_solo_super_admin:
        stmt = stmt.where(AuditLog.actor_user_id.not_in(_solo_super_admin_user_ids()))
    if company_id is not None:
        stmt = stmt.where(AuditLog.company_id == company_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(AuditLog.action.ilike(like), AuditLog.resource_type.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    entries = db.scalars(stmt.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)).all()
    return AuditLogListResponse(
        items=[
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
        ],
        total=total,
    )


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
        annual_total_eur=float(plan.annual_total_eur) if plan.annual_total_eur is not None else None,
        user_limit=plan.user_limit,
        message_pool=plan.message_pool,
        storage_limit_bytes=plan.storage_limit_bytes,
        project_limit=plan.project_limit,
        client_limit=plan.client_limit,
        max_file_size_bytes=plan.max_file_size_bytes,
        promo_price_eur=float(plan.promo_price_eur) if plan.promo_price_eur is not None else None,
        promo_starts_at=plan.promo_starts_at,
        promo_ends_at=plan.promo_ends_at,
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
        annual_total_eur=payload.annual_total_eur,
        user_limit=payload.user_limit,
        message_pool=payload.message_pool,
        storage_limit_bytes=payload.storage_limit_bytes,
        project_limit=payload.project_limit,
        client_limit=payload.client_limit,
        max_file_size_bytes=payload.max_file_size_bytes,
        promo_price_eur=payload.promo_price_eur,
        promo_starts_at=payload.promo_starts_at,
        promo_ends_at=payload.promo_ends_at,
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
    for field in (
        "name",
        "billing_cycle",
        "price_eur",
        "annual_total_eur",
        "user_limit",
        "message_pool",
        "storage_limit_bytes",
        "project_limit",
        "client_limit",
        "max_file_size_bytes",
        "promo_price_eur",
        "promo_starts_at",
        "promo_ends_at",
        "is_beta",
        "is_active",
    ):
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
