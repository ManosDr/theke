from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company, Invite, User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.security import create_access_token, hash_password, verify_password
from app.services.audit import log_action

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

    user = User(company_id=company.id, email=payload.email, role=role, password_hash=hash_password(payload.password))
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
    return TokenResponse(token=token, company_id=company.id, company_type=company.type, role=role)


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")

    company = db.get(Company, user.company_id) if user.company_id else None
    if company and company.is_suspended:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This company's access is suspended")

    log_action(db, actor_user_id=user.id, company_id=user.company_id, action="login")
    db.commit()

    token = create_access_token(user_id=user.id, company_id=user.company_id, role=user.role)
    return TokenResponse(
        token=token,
        company_id=user.company_id,
        company_type=company.type if company else None,
        role=user.role,
    )
