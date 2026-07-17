from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user_optional
from app.models import Company, CompanySubscription, Plan, Vertical
from app.schemas import PlanPublicEntry, PlansPublicResponse

# Unauthenticated - the public pricing page (and its logged-out CTAs into
# registration) needs this before a user has a token. Optionally
# personalized when a valid token IS present (see get_current_user_optional).
router = APIRouter(tags=["plans"])


def _resolve_vertical_slug(vertical: str) -> str:
    """The spec's own query values (`construction`, `tax`) don't match this
    codebase's real vertical slug (`tax_accounting`) - accept both `tax`
    and `tax_accounting` as the same thing rather than forcing the
    frontend/spec wording to change, since every other public-facing
    mapping in this codebase already does this same construction/accounting
    normalization (see app/routers/auth.py's register())."""
    return "tax_accounting" if vertical in ("tax", "tax_accounting") else "construction"


@router.get("/plans", response_model=PlansPublicResponse)
async def list_public_plans(
    vertical: str = Query("construction"),
    db: Session = Depends(get_db),
    user: CurrentUser | None = Depends(get_current_user_optional),
) -> PlansPublicResponse:
    vertical_slug = _resolve_vertical_slug(vertical)
    v = db.scalar(select(Vertical).where(Vertical.slug == vertical_slug))
    if not v:
        return PlansPublicResponse(vertical_slug=vertical_slug, tiers=[])

    # Only real, publicly listed tiers - is_active=False (every beta plan)
    # never appears here, matching that flag's whole purpose (see
    # Plan.is_active's own docstring in app/models.py).
    plans = db.scalars(
        select(Plan)
        .where(Plan.vertical_id == v.id, Plan.is_active.is_(True), Plan.is_beta.is_(False))
        .order_by(Plan.price_eur)
    ).all()

    # Personalization only applies when the caller is authenticated AND
    # their own company is on THIS vertical - viewing the other vertical's
    # tab while logged in must stay plain (see Phase 2b).
    current_plan_id: int | None = None
    subscription_status = None
    trial_ends_at = None
    if user and user.company_id is not None:
        company = db.get(Company, user.company_id)
        if company and company.vertical_id == v.id:
            sub = db.scalar(select(CompanySubscription).where(CompanySubscription.company_id == company.id))
            if sub:
                subscription_status = sub.status
                trial_ends_at = sub.trial_ends_at
                if sub.status == "active":
                    current_plan_id = sub.plan_id

    now = datetime.utcnow()
    tiers = []
    for p in plans:
        is_promo = bool(
            p.promo_price_eur is not None
            and p.promo_starts_at is not None
            and p.promo_ends_at is not None
            and p.promo_starts_at <= now < p.promo_ends_at
        )
        price_eur = float(p.promo_price_eur) if is_promo else float(p.price_eur)
        annual_total = float(p.annual_total_eur) if p.annual_total_eur is not None else None
        tiers.append(
            PlanPublicEntry(
                id=p.id,
                slug=p.slug,
                name=p.name,
                price_eur=price_eur,
                annual_total_eur=annual_total,
                annual_monthly_equiv_eur=round(annual_total / 12, 2) if annual_total is not None else None,
                is_promo=is_promo,
                user_limit=p.user_limit,
                message_pool=p.message_pool,
                project_limit=p.project_limit,
                client_limit=p.client_limit,
                storage_limit_bytes=p.storage_limit_bytes,
                max_file_size_bytes=p.max_file_size_bytes,
                is_current=(p.id == current_plan_id),
            )
        )

    return PlansPublicResponse(
        vertical_slug=vertical_slug,
        tiers=tiers,
        subscription_status=subscription_status,
        trial_ends_at=trial_ends_at,
    )
