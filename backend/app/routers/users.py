from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import User
from app.schemas import MeSummary, UpdateMeRequest

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
