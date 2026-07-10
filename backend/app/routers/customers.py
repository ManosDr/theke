from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Customer, Document, Project, Region
from app.schemas import (
    CustomerCreateRequest,
    CustomerDetailResponse,
    CustomerProjectSummary,
    CustomerSummary,
    CustomerUpdateRequest,
)

router = APIRouter(prefix="/customers", tags=["customers"])

_SEARCH_LIMIT = 10


def _require_customer_membership(db: Session, user: CurrentUser, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if not customer or customer.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found in your company")
    return customer


@router.get("", response_model=list[CustomerSummary])
async def search_customers(
    q: str = "",
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[CustomerSummary]:
    """Two callers, two shapes, same endpoint:
    - the project-creation combobox's autocomplete (q set) - name/AFM prefix
      match, case-insensitive, capped at _SEARCH_LIMIT, sorted by name.
    - the dashboard's customer list (q omitted) - every customer for the
      company, uncapped, sorted by most recent project activity (customers
      with no projects yet sort last, by creation date).
    """
    if not user.company_id:
        return []

    stmt = select(Customer).where(Customer.company_id == user.company_id)
    term = q.strip()
    if term:
        stmt = stmt.where(or_(Customer.name.ilike(f"%{term}%"), Customer.afm.ilike(f"{term}%")))
        stmt = stmt.order_by(Customer.name).limit(_SEARCH_LIMIT)
    customers = db.scalars(stmt).all()

    project_stats: dict[int, tuple[int, object]] = {}
    if customers:
        rows = db.execute(
            select(Project.customer_id, func.count(), func.max(Project.created_at))
            .where(Project.customer_id.in_([c.id for c in customers]))
            .group_by(Project.customer_id)
        ).all()
        project_stats = {row[0]: (row[1], row[2]) for row in rows}

    summaries = [
        CustomerSummary(
            id=c.id,
            name=c.name,
            afm=c.afm,
            phone=c.phone,
            email=c.email,
            notes=c.notes,
            created_at=c.created_at,
            project_count=project_stats.get(c.id, (0, None))[0],
            last_project_at=project_stats.get(c.id, (0, None))[1],
        )
        for c in customers
    ]
    if not term:
        summaries.sort(key=lambda s: s.last_project_at or s.created_at, reverse=True)
    return summaries


@router.post("", response_model=CustomerSummary, status_code=status.HTTP_201_CREATED)
async def create_customer(
    payload: CustomerCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CustomerSummary:
    if not user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account has no company")

    afm = payload.afm.strip() if payload.afm and payload.afm.strip() else None
    if afm and db.scalar(
        select(Customer).where(Customer.company_id == user.company_id, Customer.afm == afm)
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A customer with this ΑΦΜ already exists")

    customer = Customer(
        company_id=user.company_id,
        name=payload.name.strip(),
        afm=afm,
        phone=payload.phone,
        email=payload.email,
        notes=payload.notes,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return CustomerSummary(
        id=customer.id,
        name=customer.name,
        afm=customer.afm,
        phone=customer.phone,
        email=customer.email,
        notes=customer.notes,
        created_at=customer.created_at,
        project_count=0,
        last_project_at=None,
    )


@router.get("/{customer_id}", response_model=CustomerDetailResponse)
async def get_customer(
    customer_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CustomerDetailResponse:
    customer = _require_customer_membership(db, user, customer_id)
    rows = db.execute(
        select(Project, Region.region_name_el)
        .outerjoin(Region, Region.region_id == Project.region_id)
        .where(Project.customer_id == customer_id)
        .order_by(Project.created_at.desc())
    ).all()
    doc_counts: dict[int, int] = {}
    if rows:
        doc_rows = db.execute(
            select(Document.project_id, func.count())
            .where(Document.project_id.in_([p.id for p, _ in rows]), Document.status == "active")
            .group_by(Document.project_id)
        ).all()
        doc_counts = dict(doc_rows)
    return CustomerDetailResponse(
        id=customer.id,
        name=customer.name,
        afm=customer.afm,
        phone=customer.phone,
        email=customer.email,
        notes=customer.notes,
        created_at=customer.created_at,
        projects=[
            CustomerProjectSummary(
                id=p.id, name=p.name, region_id=p.region_id, region_name_el=region_name_el,
                created_at=p.created_at, is_client=p.is_client, document_count=doc_counts.get(p.id, 0),
            )
            for p, region_name_el in rows
        ],
    )


@router.patch("/{customer_id}", response_model=CustomerSummary)
async def update_customer(
    customer_id: int,
    payload: CustomerUpdateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> CustomerSummary:
    customer = _require_customer_membership(db, user, customer_id)

    if payload.afm is not None:
        afm = payload.afm.strip() or None
        if afm and afm != customer.afm:
            existing = db.scalar(
                select(Customer).where(
                    Customer.company_id == user.company_id, Customer.afm == afm, Customer.id != customer_id
                )
            )
            if existing:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A customer with this ΑΦΜ already exists")
        customer.afm = afm
    if payload.name is not None:
        customer.name = payload.name.strip()
    if payload.phone is not None:
        customer.phone = payload.phone
    if payload.email is not None:
        customer.email = payload.email
    if payload.notes is not None:
        customer.notes = payload.notes

    db.commit()
    db.refresh(customer)

    project_count = db.scalar(select(func.count()).select_from(Project).where(Project.customer_id == customer_id)) or 0
    last_project_at = db.scalar(select(func.max(Project.created_at)).where(Project.customer_id == customer_id))
    return CustomerSummary(
        id=customer.id,
        name=customer.name,
        afm=customer.afm,
        phone=customer.phone,
        email=customer.email,
        notes=customer.notes,
        created_at=customer.created_at,
        project_count=project_count,
        last_project_at=last_project_at,
    )
