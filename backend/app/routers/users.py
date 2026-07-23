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
        first_name=db_user.first_name,
        last_name=db_user.last_name,
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
    if payload.first_name is not None:
        db_user.first_name = payload.first_name
    if payload.last_name is not None:
        db_user.last_name = payload.last_name
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
    limit's job) - lets a member see their own 30-day message footprint
    alongside the company-wide pool their admin already sees. Deliberately
    no token/cost figures here - see KNOWN_DECISIONS.md: showing a user
    their own AI cost incentivizes over-consumption to "get their money's
    worth", the same reasoning that already removed this from the company
    admin dashboard."""
    since_30d = datetime.utcnow() - timedelta(days=30)
    messages_30d = (
        db.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(ChatSession.user_id == user.user_id, ChatSession.created_at >= since_30d)
        )
        or 0
    )
    return UserUsageSummary(messages_30d=messages_30d)
