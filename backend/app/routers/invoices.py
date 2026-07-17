"""Manual invoice generation (Phase 0.5) - a super_admin generates a real
τιμολόγιο when a payment is confirmed. Not automated billing, not Stripe.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Company, Invoice, Plan
from app.schemas import InvoiceCreateRequest, InvoiceEntry
from app.services.authorization import require_super_admin
from app.services.invoices import generate_invoice_pdf, next_invoice_number, save_invoice_pdf

router = APIRouter(prefix="/admin/invoices", tags=["invoices"])

VAT_RATE = 24.00


def _to_entry(inv: Invoice, plan_name: str) -> InvoiceEntry:
    return InvoiceEntry(
        id=inv.id,
        invoice_number=inv.invoice_number,
        company_id=inv.company_id,
        company_name=inv.company_name,
        plan_id=inv.plan_id,
        plan_name=plan_name,
        billing_cycle=inv.billing_cycle,
        amount_net_eur=float(inv.amount_net_eur),
        vat_rate=float(inv.vat_rate),
        amount_vat_eur=float(inv.amount_vat_eur),
        amount_total_eur=float(inv.amount_total_eur),
        issued_at=inv.issued_at,
        period_start=inv.period_start,
        period_end=inv.period_end,
    )


@router.post("", response_model=InvoiceEntry, status_code=status.HTTP_201_CREATED)
async def create_invoice(
    payload: InvoiceCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> InvoiceEntry:
    """Refuses to generate an invoice - with a clear, specific error, not a
    generic 500 - if either side's legal details are incomplete: our own
    business_afm (config, see app/config.py) or the customer company's
    afm/billing_address. A τιμολόγιο missing either isn't valid regardless
    of whether the PDF renders, so this is checked before any PDF work or
    DB write happens, not after."""
    require_super_admin(user)

    if not settings.business_afm or not settings.business_name or not settings.business_address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="theke's own business details (name/AFM/address) are not configured - "
            "set business_name, business_afm, business_address in the backend's environment before "
            "issuing any invoice.",
        )

    company = db.get(Company, payload.company_id)
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Company not found")
    missing = [
        field
        for field, value in (("afm", company.afm), ("billing_address", company.billing_address))
        if not value
    ]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"This company is missing required billing details before an invoice can be generated: "
            f"{', '.join(missing)}. Ask the company admin to fill these in (Account page).",
        )

    plan = db.get(Plan, payload.plan_id)
    if not plan:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")

    amount_net_eur = round(float(plan.price_eur), 2)
    amount_vat_eur = round(amount_net_eur * VAT_RATE / 100, 2)
    amount_total_eur = round(amount_net_eur + amount_vat_eur, 2)
    invoice_number = next_invoice_number(db)
    issued_at = datetime.utcnow()
    company_name = company.legal_name or company.name

    pdf_bytes = generate_invoice_pdf(
        invoice_number=invoice_number,
        business_name=settings.business_name,
        business_afm=settings.business_afm,
        business_address=settings.business_address,
        company_name=company_name,
        company_afm=company.afm,
        company_address=company.billing_address,
        plan_name=plan.name,
        billing_cycle=payload.billing_cycle,
        period_start=payload.period_start,
        period_end=payload.period_end,
        amount_net_eur=amount_net_eur,
        vat_rate=VAT_RATE,
        amount_vat_eur=amount_vat_eur,
        amount_total_eur=amount_total_eur,
        issued_at=issued_at,
    )
    pdf_path = save_invoice_pdf(invoice_number, pdf_bytes)

    invoice = Invoice(
        invoice_number=invoice_number,
        company_id=company.id,
        plan_id=plan.id,
        billing_cycle=payload.billing_cycle,
        amount_net_eur=amount_net_eur,
        vat_rate=VAT_RATE,
        amount_vat_eur=amount_vat_eur,
        amount_total_eur=amount_total_eur,
        company_name=company_name,
        company_afm=company.afm,
        company_address=company.billing_address,
        issued_at=issued_at,
        period_start=payload.period_start,
        period_end=payload.period_end,
        pdf_path=pdf_path,
        created_by=user.user_id,
    )
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    return _to_entry(invoice, plan.name)


@router.get("", response_model=list[InvoiceEntry])
async def list_invoices(
    company_id: int | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[InvoiceEntry]:
    require_super_admin(user)
    stmt = select(Invoice, Plan).join(Plan, Plan.id == Invoice.plan_id).order_by(Invoice.issued_at.desc())
    if company_id is not None:
        stmt = stmt.where(Invoice.company_id == company_id)
    rows = db.execute(stmt).all()
    return [_to_entry(inv, plan.name) for inv, plan in rows]


@router.get("/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> FileResponse:
    require_super_admin(user)
    invoice = db.get(Invoice, invoice_id)
    if not invoice or not invoice.pdf_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return FileResponse(
        invoice.pdf_path,
        media_type="application/pdf",
        filename=f"{invoice.invoice_number}.pdf",
    )
