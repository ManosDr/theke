import os
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import AuditLog, Company, Invite, User
from app.schemas import AuditLogEntry, InviteCreateRequest, InviteSummary, RoleChangeRequest, UserSummary
from app.services.audit import log_action
from app.services.authorization import require_company_admin
from app.services.documents import UPLOAD_DIR

router = APIRouter(prefix="/companies/me", tags=["companies"])
# Unauthenticated - serving a company's logo isn't sensitive, and the login/
# branding UI needs to fetch it before a user has a token.
public_router = APIRouter(prefix="/companies", tags=["companies"])

INVITE_VALID_DAYS = 7
LOGO_MAX_BYTES = 2 * 1024 * 1024  # 2MB
LOGO_CONTENT_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg"}


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


@public_router.get("/{company_id}/logo")
async def get_company_logo(company_id: int, db: Session = Depends(get_db)) -> FileResponse:
    company = db.get(Company, company_id)
    if not company or not company.logo_path or not os.path.exists(company.logo_path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo set for this company")
    return FileResponse(company.logo_path)


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

    invite = Invite(
        company_id=user.company_id,
        email=payload.email,
        token=secrets.token_urlsafe(24),
        role=payload.role,
        invited_by=user.user_id,
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
    return [UserSummary(id=u.id, email=u.email, role=u.role, is_active=u.is_active, created_at=u.created_at) for u in users]


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
            action=e.action,
            resource_type=e.resource_type,
            resource_id=e.resource_id,
            metadata=e.log_metadata,
            created_at=e.created_at,
        )
        for e in entries
    ]
