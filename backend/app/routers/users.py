from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import ChatSession, User
from app.schemas import MeSummary, UpdateMeRequest, UserUsageSummary

router = APIRouter(prefix="/users", tags=["users"])


def _to_me_summary(db_user: User) -> MeSummary:
    return MeSummary(
        id=db_user.id,
        email=db_user.email,
        name=db_user.name,
        phone=db_user.phone,
        role=db_user.role,
        preferred_locale=db_user.preferred_locale,
        preferred_theme=db_user.preferred_theme,
    )


@router.get("/me", response_model=MeSummary)
async def get_me(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MeSummary:
    return _to_me_summary(db.get(User, user.user_id))


@router.patch("/me", response_model=MeSummary)
async def update_me(
    payload: UpdateMeRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> MeSummary:
    db_user = db.get(User, user.user_id)
    if payload.name is not None:
        db_user.name = payload.name
    if payload.phone is not None:
        db_user.phone = payload.phone
    if payload.preferred_locale is not None:
        db_user.preferred_locale = payload.preferred_locale
    db.commit()
    db.refresh(db_user)
    return _to_me_summary(db_user)


@router.get("/me/usage", response_model=UserUsageSummary)
async def get_my_usage(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> UserUsageSummary:
    """Informational only, no hard cap per user (that's the hourly rate
    limit's job) - lets a member see their own 30-day footprint alongside
    the company-wide total their admin already sees."""
    since_30d = datetime.utcnow() - timedelta(days=30)
    messages_30d = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(ChatSession.user_id == user.user_id, ChatSession.created_at >= since_30d)
        )
        or 0
    )
    total_tokens_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.total_tokens), 0))
            .where(ChatSession.user_id == user.user_id, ChatSession.created_at >= since_30d)
        )
        or 0
    )
    estimated_cost_eur_30d = (
        db.scalar(
            select(func.coalesce(func.sum(ChatSession.estimated_cost_eur), 0))
            .where(ChatSession.user_id == user.user_id, ChatSession.created_at >= since_30d)
        )
        or 0
    )
    return UserUsageSummary(
        messages_30d=messages_30d,
        total_tokens_30d=int(total_tokens_30d),
        estimated_cost_eur_30d=round(float(estimated_cost_eur_30d), 4),
    )
