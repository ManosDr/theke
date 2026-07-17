"""Manual (pre-Stripe) subscription enforcement - the message-pool and
trial/status checks POST /chat/message runs on every request, plus the
get-or-create helpers the admin subscription screen and
GET /subscription/status also share.
"""

from calendar import monthrange
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Company, CompanySubscription, Document, Plan, SubscriptionUsage

POOL_EXHAUSTED_MESSAGE = "Εξαντλήσατε τα μηνύματά σας για αυτόν τον μήνα. Αναβαθμίστε το πλάνο σας για να συνεχίσετε."
SUBSCRIPTION_EXPIRED_MESSAGE = "Η συνδρομή σας έχει λήξει. Ανανεώστε για να συνεχίσετε."
STORAGE_EXHAUSTED_MESSAGE = (
    "Έχετε φτάσει το όριο αποθηκευτικού χώρου του πλάνου σας. Αναβαθμίστε το πλάνο σας για να συνεχίσετε."
)

TRIAL_DAYS_DEFAULT = 60


def _current_period() -> tuple[date, date]:
    today = date.today()
    start = today.replace(day=1)
    end = date(today.year, today.month, monthrange(today.year, today.month)[1])
    return start, end


def get_or_create_subscription(db: Session, company: Company) -> CompanySubscription:
    """Defensive get-or-create - every company that existed when this
    feature shipped already has a row (see db/init.sql's one-time
    backfill), but a company created afterward (registration, direct admin
    creation) has no other step that assigns one yet, so this creates a
    fresh Beta-plan trial on first touch rather than leaving the company
    with no subscription at all."""
    sub = db.scalar(select(CompanySubscription).where(CompanySubscription.company_id == company.id))
    if sub:
        return sub
    beta_plan = db.scalar(select(Plan).where(Plan.vertical_id == company.vertical_id, Plan.is_beta.is_(True)))
    if not beta_plan:
        beta_plan = db.scalar(select(Plan).where(Plan.is_beta.is_(True)))
    sub = CompanySubscription(
        company_id=company.id,
        plan_id=beta_plan.id,
        status="trial",
        billing_cycle="monthly",
        trial_ends_at=datetime.utcnow() + timedelta(days=TRIAL_DAYS_DEFAULT),
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return sub


def get_or_create_usage(db: Session, company_id: int, messages_limit: int) -> SubscriptionUsage:
    period_start, period_end = _current_period()
    usage = db.scalar(
        select(SubscriptionUsage).where(
            SubscriptionUsage.company_id == company_id, SubscriptionUsage.period_start == period_start
        )
    )
    if usage:
        return usage
    usage = SubscriptionUsage(
        company_id=company_id,
        period_start=period_start,
        period_end=period_end,
        messages_used=0,
        messages_limit=messages_limit,
    )
    db.add(usage)
    db.commit()
    db.refresh(usage)
    return usage


def check_subscription(
    db: Session, company: Company
) -> tuple[CompanySubscription, Plan, SubscriptionUsage, dict | None]:
    """Returns (subscription, plan, usage, block). block is None if the
    company can send another message, otherwise the exact flat 402 body
    the route should return - a plain HTTPException(detail=...) nests
    under "detail" instead of matching the flat {detail, upgrade_required}
    shape the frontend expects, so the caller returns this as a
    JSONResponse directly rather than raising.

    Trial expiry is checked and (if past) persisted as 'expired' here, in
    the same pass that reads the row - not a separate scheduled job, since
    this is the only code path that actually needs the answer right now."""
    sub = get_or_create_subscription(db, company)
    plan = db.get(Plan, sub.plan_id)

    if sub.status == "trial" and sub.trial_ends_at and sub.trial_ends_at < datetime.utcnow():
        sub.status = "expired"
        db.commit()

    if sub.status in ("expired", "cancelled"):
        usage = get_or_create_usage(db, company.id, plan.message_pool)
        return sub, plan, usage, {"detail": SUBSCRIPTION_EXPIRED_MESSAGE, "renewal_required": True}

    usage = get_or_create_usage(db, company.id, plan.message_pool)

    # Beta plans bypass the pool entirely - unlimited usage during soft
    # launch regardless of the message_pool number on the row.
    if not plan.is_beta and usage.messages_used >= usage.messages_limit:
        return sub, plan, usage, {"detail": POOL_EXHAUSTED_MESSAGE, "upgrade_required": True}

    return sub, plan, usage, None


def get_company_storage_bytes(db: Session, company_id: int) -> int:
    """Sum of file_size_bytes across a company's own active documents only -
    superseded/removed documents don't count against the ceiling, and the
    shared regulatory knowledge base is structurally excluded (its
    documents.company_id is NULL, so it's never matched by this filter at
    all - not a zero-sum coincidence)."""
    return (
        db.scalar(
            select(func.coalesce(func.sum(Document.file_size_bytes), 0)).where(
                Document.company_id == company_id, Document.status == "active"
            )
        )
        or 0
    )


def check_storage_limit(db: Session, company: Company, plan: Plan, additional_bytes: int) -> dict | None:
    """Returns the flat 402 body (same {detail, upgrade_required} shape as
    check_subscription's pool-exhausted block) if uploading additional_bytes
    would push the company over plan.storage_limit_bytes, else None.
    storage_limit_bytes is NULL on Starter and beta plans - no ceiling is
    enforced there, matching Phase 1c's "Professional & Business tiers
    only" scope."""
    if plan.storage_limit_bytes is None:
        return None
    current = get_company_storage_bytes(db, company.id)
    if current + additional_bytes > plan.storage_limit_bytes:
        return {"detail": STORAGE_EXHAUSTED_MESSAGE, "upgrade_required": True}
    return None
