from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import UserFeedback
from app.schemas import UserFeedbackCreate

router = APIRouter(prefix="/user-feedback", tags=["user-feedback"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def submit_user_feedback(
    payload: UserFeedbackCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Product-level feedback from the floating beta widget - any
    authenticated user, any role, any page. Separate from POST
    /chat/feedback (a rating on one specific answer); this is "something
    about the app itself" (bug, suggestion, or a knowledge-base gap)."""
    feedback = UserFeedback(
        user_id=user.user_id,
        company_id=user.company_id,
        category=payload.category,
        message=payload.message,
        page_url=payload.page_url,
    )
    db.add(feedback)
    db.commit()
    return {"id": feedback.id}
