from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Notification
from app.schemas import NotificationListResponse, NotificationSummary

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> NotificationListResponse:
    items = db.scalars(
        select(Notification).where(Notification.user_id == user.user_id).order_by(Notification.created_at.desc()).limit(50)
    ).all()
    unread_count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
    )
    return NotificationListResponse(
        items=[
            NotificationSummary(
                id=n.id, type=n.type, title=n.title, body=n.body, link=n.link, is_read=n.is_read, created_at=n.created_at
            )
            for n in items
        ],
        unread_count=unread_count or 0,
    )


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")

    notification.is_read = True
    db.commit()


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_notifications_read(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    unread = db.scalars(
        select(Notification).where(Notification.user_id == user.user_id, Notification.is_read.is_(False))
    ).all()
    for notification in unread:
        notification.is_read = True
    db.commit()
