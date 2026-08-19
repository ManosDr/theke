import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Company, EmailVerificationToken, Invite, LegalDocument, PasswordResetToken, RefreshToken, User, Vertical
from app.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    InviteInfoResponse,
    LoginRequest,
    RefreshTokenResponse,
    RegisterRequest,
    ResendVerificationResponse,
    ResetPasswordRequest,
    TokenResponse,
    UpdateLocaleRequest,
    UpdateThemeRequest,
    VerifyEmailRequest,
)
from app.security import create_access_token, create_refresh_token, hash_password, hash_refresh_token, verify_password
from app.services.audit import log_action
from app.services.email import send_password_reset_email, send_verification_email, send_welcome_email
from app.services.notifications import notify
from app.services.rate_limit import record_login_failure, reset_login_failures, seconds_until_login_unlocked

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE_NAME = "refresh_token"


def _issue_refresh_cookie(db: Session, response: Response, user_id: int) -> None:
    """Called alongside create_access_token() on every real login (register,
    /auth/login, /auth/refresh's own rotation) - mints a new opaque token,
    stores its hash (see security.py's hash_refresh_token), and sets it as
    an httpOnly cookie the frontend's JS never touches directly.

    Path="/" rather than scoping to "/auth": in production this endpoint is
    reached through nginx at /api/auth/... (see infra/nginx.conf, which
    strips the /api/ prefix before proxying) while the backend itself only
    ever sees "/auth/..." - a Path scoped to what the backend sees would be
    silently wrong for what the browser actually sends requests to. Path="/"
    sidesteps that mismatch entirely; the cookie is httpOnly and small, so
    being attached to every same-origin request costs nothing meaningful.

    SameSite="lax", not "none": frontend (:3000) and backend (:8000) are
    different origins in dev but the same "site" (browsers special-case
    "localhost" - differing ports don't cross the site boundary), and same-
    origin entirely in production (both served from theke.ai via nginx) -
    "lax" covers both without requiring Secure, which plain-http local dev
    can't satisfy anyway (SameSite=None cookies are dropped by browsers over
    http://)."""
    token = create_refresh_token()
    db.add(
        RefreshToken(
            user_id=user_id,
            token_hash=hash_refresh_token(token),
            expires_at=datetime.utcnow() + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    db.commit()
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path="/",
        max_age=settings.refresh_token_expire_days * 86400,
    )


def _issue_and_send_verification(db: Session, user: User) -> None:
    """Shared by /auth/register's self-serve branch and
    /auth/resend-verification - generates a fresh token (old ones, if any,
    are simply left to expire naturally rather than explicitly revoked,
    same laissez-faire approach as password-reset tokens) and sends the
    email via the admin-editable 'email_verification' template."""
    token = secrets.token_urlsafe(32)
    db.add(
        EmailVerificationToken(
            user_id=user.id,
            token=token,
            expires_at=datetime.utcnow() + timedelta(minutes=settings.email_verification_token_expire_minutes),
        )
    )
    db.commit()
    verify_url = f"{settings.frontend_url}/verify-email?token={token}"
    send_verification_email(db, user.email, verify_url)

@router.get("/invite-info/{token}", response_model=InviteInfoResponse)
async def invite_info(token: str, db: Session = Depends(get_db)) -> InviteInfoResponse:
    """Lets the registration frontend pre-populate and lock the company and
    vertical fields for an invite-based signup, so the invitee only ever
    fills in name/email/password - never re-picks a company or vertical
    that's already determined by who invited them. Same validity checks as
    /register's invite_token path (pending, unexpired), but doesn't require
    the email to match anything yet since no email has been submitted here."""
    invite = db.scalar(select(Invite).where(Invite.token == token))
    if not invite or invite.status != "pending" or invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired invite")

    if invite.company_id is None:
        # Company-less invite (see admin.py's create_super_admin_invite) -
        # the invitee names their own company as part of /auth/register
        # itself (see new_company_name below), so there's no existing
        # company to show yet.
        vertical = db.get(Vertical, invite.vertical_id) if invite.vertical_id else None
        return InviteInfoResponse(
            company_name=None,
            vertical_display_name=vertical.display_name if vertical else "",
            role=invite.role,
            requires_company_name=True,
            email=invite.email,
        )

    company = db.get(Company, invite.company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invalid or expired invite")
    vertical = db.get(Vertical, company.vertical_id)

    return InviteInfoResponse(
        company_name=company.name,
        vertical_display_name=vertical.display_name if vertical else "",
        role=invite.role,
        email=invite.email,
    )


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    # Rejects False explicitly, not just relying on the Pydantic field being
    # required (dpa_accepted: bool with no default already rejects a missing
    # key) - a request that sends `"dpa_accepted": false` is well-formed
    # JSON and would pass schema validation, so the actual business rule
    # ("must be true") has to be checked here, not just "must be present".
    if not payload.dpa_accepted:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You must accept the Terms of Service and Data Processing Agreement (DPA) to register",
        )

    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    if bool(payload.invite_token) == bool(payload.company_name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of invite_token (join) or company_name (create a new company)",
        )

    if payload.invite_token:
        invite = db.scalar(select(Invite).where(Invite.token == payload.invite_token))
        if (
            not invite
            or invite.status != "pending"
            or invite.expires_at < datetime.utcnow()
            or invite.email.lower() != payload.email.lower()
        ):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid, expired, or used invite")

        if invite.company_id is None:
            # Company-less invite (see admin.py's create_super_admin_invite)
            # - the invitee creates their own company right here, in the
            # same transaction as their account, rather than a separate
            # follow-up call: leaves no window where an account exists
            # without a company. See KNOWN_DECISIONS.md.
            if not payload.new_company_name or not payload.new_company_name.strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="new_company_name is required to accept this invite",
                )
            if db.scalar(select(Company).where(Company.name == payload.new_company_name)):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="A company with this name already exists - choose a different name",
                )
            # This person is genuinely establishing a new controller
            # relationship for the first time (same situation as the
            # company_name/self-serve path below), unlike joining an
            # existing company via a normal invite - so DPA acceptance is
            # recorded here too, not skipped.
            dpa_version = db.scalar(select(LegalDocument.version).where(LegalDocument.slug == "dpa"))
            company = Company(
                name=payload.new_company_name,
                type=invite.company_type or "construction",
                vertical_id=invite.vertical_id,
                dpa_accepted_at=datetime.utcnow(),
                dpa_version=str(dpa_version) if dpa_version is not None else None,
                acquisition_source=payload.acquisition_source,
            )
            db.add(company)
            db.flush()
            # Backfilled so this invite shows up correctly in the new
            # company's own "recent invites accepted" activity feed (see
            # companies.py's recent_invites query), exactly like any other
            # invite - not left dangling at NULL now that a company exists.
            invite.company_id = company.id
        else:
            company = db.get(Company, invite.company_id)

        role = invite.role
        invite.status = "accepted"
        invite.accepted_at = datetime.utcnow()
        notify(
            db,
            user_id=invite.invited_by,
            type="invite_accepted",
            title=f"{payload.email} accepted your invite",
            body=f"They've joined as {role}.",
            link="/dashboard",
        )
    else:
        if db.scalar(select(Company).where(Company.name == payload.company_name)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A company with this name already exists - ask an admin there for an invite",
            )
        if not payload.vertical_slug:
            valid_slugs = list(db.scalars(select(Vertical.slug).where(Vertical.status == "active")))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"message": "vertical_slug is required when creating a new company", "valid_slugs": valid_slugs},
            )
        vertical = db.scalar(select(Vertical).where(Vertical.slug == payload.vertical_slug, Vertical.status == "active"))
        if not vertical:
            valid_slugs = list(db.scalars(select(Vertical.slug).where(Vertical.status == "active")))
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"message": f"Unknown vertical_slug '{payload.vertical_slug}'", "valid_slugs": valid_slugs},
            )
        # DPA acceptance is recorded at the company level, not per-user - it
        # represents when the controller/processor relationship for THIS
        # company was established, not each individual employee's personal
        # ToS click. Only set on the new-company path: a teammate joining an
        # existing company via invite still must check the box (validated
        # above, same as any registration), but doesn't re-accept on the
        # company's behalf - that already happened when the founding admin
        # created it. See KNOWN_DECISIONS.md.
        # dpa_version stamps whichever legal_documents.version the 'dpa' row
        # currently holds - a real "which edition did they agree to" record,
        # not a hand-bumped constant. Read regardless of is_published: DPA
        # acceptance at registration is a separate requirement from whether
        # the text is publicly viewable yet (see KNOWN_DECISIONS.md).
        dpa_version = db.scalar(select(LegalDocument.version).where(LegalDocument.slug == "dpa"))
        company = Company(
            name=payload.company_name,
            type=payload.company_type,
            vertical_id=vertical.id,
            dpa_accepted_at=datetime.utcnow(),
            dpa_version=str(dpa_version) if dpa_version is not None else None,
            acquisition_source=payload.acquisition_source,
        )
        db.add(company)
        db.flush()
        role = "admin"

    # Self-serve (company_name path) registrations start unverified and get
    # a real verification email below, once the row has an id to send it
    # to. Invite-completions skip verification entirely - the inviting
    # admin already vouched for that exact email address by sending the
    # invite to it, so there's nothing a click-through link would add. See
    # KNOWN_DECISIONS.md.
    is_self_serve = not payload.invite_token
    user = User(
        company_id=company.id,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        role=role,
        password_hash=hash_password(payload.password),
        preferred_locale=payload.preferred_locale,
        email_verified=not is_self_serve,
        email_verified_at=None if is_self_serve else datetime.utcnow(),
    )
    db.add(user)
    db.flush()

    log_action(
        db,
        actor_user_id=user.id,
        company_id=company.id,
        action="register",
        resource_type="user",
        resource_id=user.id,
        # intended_tier (?intended_tier=<slug> on the pricing page's CTA)
        # has no company-level field to live on and is only ever needed for
        # manual sales follow-up - logged here rather than adding schema
        # for a single free-text hint. Only meaningful on the new-company
        # path; always None for an invite join.
        metadata={
            "via_invite": bool(payload.invite_token),
            "role": role,
            "intended_tier": payload.intended_tier if not payload.invite_token else None,
        },
    )
    db.commit()

    # Fires for both paths (invite-accepted and self-serve) - company.vertical_id
    # is always set by this point either way (carried over from the inviting
    # company, or set explicitly above on the new-company path).
    company_vertical = db.get(Vertical, company.vertical_id)
    if company_vertical:
        send_welcome_email(db, user.email, company_vertical.slug)

    if is_self_serve:
        _issue_and_send_verification(db, user)

    token = create_access_token(user_id=user.id, company_id=company.id, role=role)
    _issue_refresh_cookie(db, response, user.id)
    return TokenResponse(
        token=token,
        company_id=company.id,
        company_type=company.type,
        role=role,
        first_name=user.first_name,
        last_name=user.last_name,
        preferred_locale=user.preferred_locale,
        preferred_theme=user.preferred_theme,
        email_verified=user.email_verified,
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)) -> TokenResponse:
    # Client IP, not authenticated identity - this endpoint runs before
    # anyone's identity is known, so IP is the only thing to key a lockout
    # on. Doesn't account for a shared IP behind a proxy/NAT; revisit if
    # this ever sits behind one (X-Forwarded-For, trusted-proxy config).
    client_ip = request.client.host if request.client else "unknown"

    remaining = seconds_until_login_unlocked(client_ip)
    if remaining is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many failed login attempts. Try again in {remaining} seconds.",
        )

    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_hash):
        # Counts both "no such email" and "wrong password" the same way -
        # distinguishing them in the rate limiter (not just the error
        # message, which already doesn't distinguish them) would let an
        # attacker use the lockout itself as an email-enumeration oracle.
        record_login_failure(client_ip)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")

    company = db.get(Company, user.company_id) if user.company_id else None
    if company and company.is_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This company's access is suspended")

    reset_login_failures(client_ip)
    user.last_login_at = datetime.utcnow()
    log_action(db, actor_user_id=user.id, company_id=user.company_id, action="login")
    db.commit()

    token = create_access_token(user_id=user.id, company_id=user.company_id, role=user.role)
    _issue_refresh_cookie(db, response, user.id)
    return TokenResponse(
        token=token,
        company_id=user.company_id,
        company_type=company.type if company else None,
        role=user.role,
        first_name=user.first_name,
        last_name=user.last_name,
        preferred_locale=user.preferred_locale,
        preferred_theme=user.preferred_theme,
        email_verified=user.email_verified,
    )


@router.post("/refresh", response_model=RefreshTokenResponse)
async def refresh(
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: str | None = Cookie(default=None),
) -> RefreshTokenResponse:
    """Exchanges the httpOnly refresh_token cookie for a new access token,
    called silently by the frontend's fetch interceptor on any 401 caused by
    access-token expiry (see api.ts) - the user never sees this happen.

    Rotation-on-use: the presented row is revoked in the same request that
    issues its replacement, so a stolen-and-replayed refresh token only ever
    works once before the legitimate client's next use (or the thief's)
    finds it already revoked - see KNOWN_DECISIONS.md."""
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")
    if not refresh_token:
        raise invalid

    token_hash = hash_refresh_token(refresh_token)
    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    if not record or record.revoked_at is not None or record.expires_at < datetime.utcnow():
        raise invalid

    user = db.get(User, record.user_id)
    if not user or not user.is_active:
        raise invalid
    company = db.get(Company, user.company_id) if user.company_id else None
    if company and company.is_suspended:
        raise invalid

    record.revoked_at = datetime.utcnow()
    access_token = create_access_token(user_id=user.id, company_id=user.company_id, role=user.role)
    _issue_refresh_cookie(db, response, user.id)
    db.commit()
    return RefreshTokenResponse(token=access_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: Session = Depends(get_db),
    refresh_token: str | None = Cookie(default=None),
) -> None:
    """Best-effort revocation, not auth-gated on the access token: the whole
    point is a user can log out even with an already-expired/missing access
    token, as long as the browser still holds the refresh cookie. Always
    clears the cookie and returns 204 regardless of whether a matching row
    was found - a client-side "log out" always succeeds from the caller's
    point of view."""
    if refresh_token:
        token_hash = hash_refresh_token(refresh_token)
        record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if record and record.revoked_at is None:
            record.revoked_at = datetime.utcnow()
            db.commit()
    response.delete_cookie(key=REFRESH_COOKIE_NAME, path="/")


FORGOT_PASSWORD_MESSAGE = "Εάν το email είναι εγγεγραμμένο, θα λάβετε σύντομα οδηγίες επαναφοράς κωδικού."


def _mask_email(email: str) -> str:
    """First 3 chars + domain only - enough to spot-check in logs which
    account triggered an event, without the full address being readable by
    anyone with log access."""
    local, _, domain = email.partition("@")
    return f"{local[:3]}***@{domain}" if domain else f"{local[:3]}***"


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> ForgotPasswordResponse:
    """Always the same 200 + body regardless of whether the email is
    registered, or (when email is enabled) whether the send actually
    succeeded - the response can't be allowed to reveal any of that, or it
    becomes an email-enumeration oracle. Real delivery via Resend when
    settings.email_enabled is true (see app/services/email.py); either way,
    the token/reset link itself is never logged (see KNOWN_DECISIONS.md -
    it used to be, and a raw unexpired reset token in a log line is a real
    credential leak, not a theoretical one) - query password_reset_tokens
    directly if you need the link for local testing with email disabled."""
    user = db.scalar(select(User).where(User.email == payload.email))
    if user and user.is_active:
        token = secrets.token_urlsafe(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token=token,
                expires_at=datetime.utcnow() + timedelta(minutes=settings.password_reset_token_expire_minutes),
            )
        )
        db.commit()
        reset_url = f"{settings.frontend_url}/reset-password?token={token}"
        send_password_reset_email(db, user.email, reset_url)
        # This line exists only so "a reset was requested" is observable in
        # logs, not to substitute for real delivery - see the docstring on
        # why the token/link itself never appears here.
        logger.info("Password reset requested for %s", _mask_email(user.email))
    return ForgotPasswordResponse(message=FORGOT_PASSWORD_MESSAGE)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)) -> None:
    reset = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token == payload.token))
    if not reset or reset.used_at is not None or reset.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired reset link")

    user = db.get(User, reset.user_id)
    user.password_hash = hash_password(payload.new_password)
    reset.used_at = datetime.utcnow()
    log_action(db, actor_user_id=user.id, company_id=user.company_id, action="password_reset")
    db.commit()


@router.post("/verify-email", status_code=status.HTTP_204_NO_CONTENT)
async def verify_email(payload: VerifyEmailRequest, db: Session = Depends(get_db)) -> None:
    """No auth required - possession of the token IS the proof, same as
    /reset-password. Reachable whether or not the clicking browser happens
    to be logged in as that user (a verification link is often opened from
    a different device/browser than the one that registered)."""
    record = db.scalar(select(EmailVerificationToken).where(EmailVerificationToken.token == payload.token))
    if not record or record.used_at is not None or record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired verification link")

    user = db.get(User, record.user_id)
    user.email_verified = True
    user.email_verified_at = datetime.utcnow()
    record.used_at = datetime.utcnow()
    log_action(db, actor_user_id=user.id, company_id=user.company_id, action="email_verified")
    db.commit()


@router.post("/resend-verification", response_model=ResendVerificationResponse)
async def resend_verification(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ResendVerificationResponse:
    """Authenticated (unlike /forgot-password, there's no email-enumeration
    concern here - the caller already proved who they are via their JWT),
    so no need for the same "always identical response" discipline that
    endpoint uses."""
    db_user = db.get(User, user.user_id)
    if db_user.email_verified:
        return ResendVerificationResponse(message="Η διεύθυνση email σας είναι ήδη επιβεβαιωμένη.")
    _issue_and_send_verification(db, db_user)
    return ResendVerificationResponse(message="Στείλαμε νέο email επιβεβαίωσης. Ελέγξτε τα εισερχόμενά σας.")


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    db_user = db.get(User, user.user_id)
    if not verify_password(payload.current_password, db_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Λανθασμένος τρέχων κωδικός")
    # Existing JWTs stay valid until they naturally expire - see
    # KNOWN_DECISIONS.md for the documented MVP limitation (no server-side
    # token revocation exists anywhere else in this codebase either).
    db_user.password_hash = hash_password(payload.new_password)
    log_action(db, actor_user_id=db_user.id, company_id=db_user.company_id, action="password_changed")
    db.commit()


@router.patch("/me/locale", status_code=status.HTTP_204_NO_CONTENT)
async def update_preferred_locale(
    payload: UpdateLocaleRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    db_user = db.get(User, user.user_id)
    db_user.preferred_locale = payload.locale
    db.commit()


@router.patch("/me/theme", status_code=status.HTTP_204_NO_CONTENT)
async def update_preferred_theme(
    payload: UpdateThemeRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    db_user = db.get(User, user.user_id)
    db_user.preferred_theme = payload.theme
    db.commit()
