import logging
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Company, Invite, PasswordResetToken, User
from app.schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateLocaleRequest,
)
from app.security import create_access_token, hash_password, verify_password
from app.services.audit import log_action
from app.services.notifications import notify
from app.services.rate_limit import record_login_failure, reset_login_failures, seconds_until_login_unlocked

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
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
        company = Company(name=payload.company_name, type=payload.company_type)
        db.add(company)
        db.flush()
        role = "admin"

    user = User(
        company_id=company.id,
        email=payload.email,
        role=role,
        password_hash=hash_password(payload.password),
        preferred_locale=payload.preferred_locale,
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
        metadata={"via_invite": bool(payload.invite_token), "role": role},
    )
    db.commit()

    token = create_access_token(user_id=user.id, company_id=company.id, role=role)
    return TokenResponse(
        token=token,
        company_id=company.id,
        company_type=company.type,
        role=role,
        preferred_locale=user.preferred_locale,
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
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
    log_action(db, actor_user_id=user.id, company_id=user.company_id, action="login")
    db.commit()

    token = create_access_token(user_id=user.id, company_id=user.company_id, role=user.role)
    return TokenResponse(
        token=token,
        company_id=user.company_id,
        company_type=company.type if company else None,
        role=user.role,
        preferred_locale=user.preferred_locale,
    )


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> None:
    """Always 204 regardless of whether the email is registered - the
    response can't be allowed to reveal that, or it becomes an email-
    enumeration oracle. No email provider is configured yet, so instead of
    real delivery this logs the reset link (see KNOWN_DECISIONS.md) - the
    mechanism is real and testable end-to-end, just not yet wired to an
    inbox."""
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
        reset_link = f"{settings.frontend_url}/reset-password?token={token}"
        logger.info("Password reset requested for %s: %s", user.email, reset_link)


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


@router.patch("/me/locale", status_code=status.HTTP_204_NO_CONTENT)
async def update_preferred_locale(
    payload: UpdateLocaleRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    db_user = db.get(User, user.user_id)
    db_user.preferred_locale = payload.locale
    db.commit()
