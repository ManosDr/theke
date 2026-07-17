from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Company, Plan, PlanRequest
from app.schemas import PlanRequestCreate, PlanRequestResponse
from app.services.notifications import notify_super_admins
from app.services.subscription import get_or_create_subscription

router = APIRouter(tags=["plan-requests"])


@router.post("/plan-requests", response_model=PlanRequestResponse, status_code=status.HTTP_201_CREATED)
async def create_plan_request(
    payload: PlanRequestCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> PlanRequestResponse:
    """Logs a sales lead - not a self-service plan change. direction is
    always derived here from price comparison, never trusted from the
    client, so the confirmation copy and the admin notification can never
    disagree about which way the request actually goes."""
    if user.company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This endpoint requires a company account")

    company = db.get(Company, user.company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")

    requested_plan = db.get(Plan, payload.requested_tier_id)
    if not requested_plan or not requested_plan.is_active or requested_plan.is_beta:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    sub = get_or_create_subscription(db, company)
    current_plan = db.get(Plan, sub.plan_id)

    direction = "downgrade" if float(requested_plan.price_eur) < float(current_plan.price_eur) else "upgrade"

    db.add(
        PlanRequest(
            company_id=company.id,
            requested_by=user.user_id,
            current_plan_id=current_plan.id,
            requested_plan_id=requested_plan.id,
            direction=direction,
        )
    )

    notify_super_admins(
        db,
        type="plan_request",
        title=f"Αίτημα αλλαγής πλάνου - {company.name}",
        body=f"{company.name}: {current_plan.name} -> {requested_plan.name} ({direction})",
    )
    db.commit()

    return PlanRequestResponse(direction=direction, requested_tier_name=requested_plan.name)
