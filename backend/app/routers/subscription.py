from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Company, Plan, User
from app.schemas import SubscriptionStatusResponse
from app.services.notifications import notify_super_admins
from app.services.subscription import get_or_create_subscription, get_or_create_usage

router = APIRouter(prefix="/subscription", tags=["subscription"])


@router.get("/status", response_model=SubscriptionStatusResponse)
async def subscription_status(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> SubscriptionStatusResponse:
    """Backs the trial banner and usage displays across the frontend
    (chat header, Account page, company admin Συνδρομή tab) - one call,
    same shape everywhere. super_admin has no company_id, so this 404s
    for that role rather than pretending a subscription exists."""
    if user.company_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No company associated with this user")
    company = db.get(Company, user.company_id)
    sub = get_or_create_subscription(db, company)
    plan = db.get(Plan, sub.plan_id)
    usage = get_or_create_usage(db, company.id, plan.message_pool)
    users_count = db.scalar(
        select(func.count()).select_from(User).where(User.company_id == company.id, User.is_active.is_(True))
    ) or 0

    # A trial that's already past trial_ends_at but hasn't been touched by
    # POST /chat/message yet (e.g. the user opens the app but hasn't sent a
    # message this session) would otherwise still read "trial" here - flip
    # it the same way check_subscription does, so the banner reacts
    # immediately rather than waiting for the next chat call.
    if sub.status == "trial" and sub.trial_ends_at and sub.trial_ends_at < datetime.utcnow():
        sub.status = "expired"
        db.commit()

    return SubscriptionStatusResponse(
        plan_name=plan.name,
        plan_slug=plan.slug,
        is_beta=plan.is_beta,
        status=sub.status,
        trial_ends_at=sub.trial_ends_at,
        trial_started_at=sub.started_at,
        current_period_end=sub.current_period_end,
        messages_used=usage.messages_used,
        messages_limit=usage.messages_limit,
        users_count=users_count,
        user_limit=plan.user_limit,
        is_test_account=company.is_test_account,
    )


@router.post("/message-pack-request", status_code=status.HTTP_204_NO_CONTENT)
async def request_message_pack(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """The lightweight equivalent of POST /plan-requests for the 200-message
    top-up pack (terms.md §3.1's "πρόσθετο πακέτο (200 μηνύματα / €15 +
    ΦΠΑ)"). Doesn't reuse PlanRequest/Plan - a top-up isn't a tier change
    and no Plan row represents it, so forcing it through that model would
    mean inventing a fake plan. Just logs a sales lead via
    notify_super_admins, same "not self-service, a human follows up" model
    plan-requests already uses - there's no self-serve payment yet."""
    if user.company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This endpoint requires a company account")
    company = db.get(Company, user.company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    notify_super_admins(
        db,
        type="message_pack_request",
        title=f"Αίτημα πακέτου μηνυμάτων - {company.name}",
        body=f"{company.name} ζήτησε πρόσθετο πακέτο 200 μηνυμάτων (€15 + ΦΠΑ).",
    )
    db.commit()
