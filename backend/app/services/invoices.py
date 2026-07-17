"""Manual invoice generation (Phase 0.5) - PDF rendering + sequential
numbering + on-disk storage for τιμολόγια a super_admin generates when a
payment is confirmed. Not automated billing.
"""

import os

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services.documents import UPLOAD_DIR

INVOICE_DIR = os.path.join(UPLOAD_DIR, "invoices")


def next_invoice_number(db: Session) -> str:
    """Draws from invoice_number_seq (see db/init.sql) - a real Postgres
    sequence, so numbers are assigned atomically under concurrent calls and
    are never reused, even across a rolled-back transaction (the sequence
    itself isn't transactional - a failed invoice creation after this call
    leaves a gap, not a collision, which is the direction Greek invoicing
    rules actually care about: no two invoices may ever share a number, a
    rare gap from a genuine failure is an accepted, documented tradeoff -
    see KNOWN_DECISIONS.md)."""
    seq_val = db.execute(text("SELECT nextval('invoice_number_seq')")).scalar()
    return f"INV-{seq_val:06d}"


def generate_invoice_pdf(
    *,
    invoice_number: str,
    business_name: str,
    business_afm: str,
    business_address: str,
    company_name: str,
    company_afm: str | None,
    company_address: str | None,
    plan_name: str,
    billing_cycle: str,
    period_start,
    period_end,
    amount_net_eur: float,
    vat_rate: float,
    amount_vat_eur: float,
    amount_total_eur: float,
    issued_at,
) -> bytes:
    """Single-page A4 layout via reportlab's low-level canvas (no external
    system dependencies - see KNOWN_DECISIONS.md on why reportlab over
    weasyprint/wkhtmltopdf). Deliberately plain: business/customer blocks,
    invoice metadata, one line item, and the net/VAT/total breakdown - a
    valid Greek τιμολόγιο needs those fields present and correct, not a
    fancy layout."""
    from io import BytesIO

    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    left = 20 * mm
    y = height - 20 * mm

    def line(text_: str, size: int = 10, bold: bool = False, dy: float = 6 * mm) -> None:
        nonlocal y
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(left, y, text_)
        y -= dy

    line("ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ", size=16, bold=True, dy=10 * mm)

    line(f"Αριθμός: {invoice_number}", bold=True)
    line(f"Ημερομηνία έκδοσης: {issued_at.strftime('%d/%m/%Y')}")
    line(f"Περίοδος χρέωσης: {period_start.strftime('%d/%m/%Y')} - {period_end.strftime('%d/%m/%Y')}", dy=10 * mm)

    line("Στοιχεία εκδότη", size=11, bold=True, dy=7 * mm)
    line(business_name)
    line(f"ΑΦΜ: {business_afm}")
    line(business_address, dy=10 * mm)

    line("Στοιχεία πελάτη", size=11, bold=True, dy=7 * mm)
    line(company_name)
    line(f"ΑΦΜ: {company_afm or '-'}")
    line(company_address or "-", dy=10 * mm)

    # Line item table
    c.setFont("Helvetica-Bold", 10)
    c.drawString(left, y, "Περιγραφή")
    c.drawString(left + 100 * mm, y, "Καθαρή αξία")
    y -= 6 * mm
    c.setFont("Helvetica", 10)
    c.drawString(left, y, f"Συνδρομή {plan_name} ({billing_cycle})")
    c.drawRightString(left + 130 * mm, y, f"€{amount_net_eur:.2f}")
    y -= 10 * mm

    c.line(left, y, left + 130 * mm, y)
    y -= 8 * mm

    c.drawString(left + 60 * mm, y, "Καθαρή αξία:")
    c.drawRightString(left + 130 * mm, y, f"€{amount_net_eur:.2f}")
    y -= 6 * mm
    c.drawString(left + 60 * mm, y, f"ΦΠΑ ({vat_rate:.0f}%):")
    c.drawRightString(left + 130 * mm, y, f"€{amount_vat_eur:.2f}")
    y -= 6 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left + 60 * mm, y, "Σύνολο:")
    c.drawRightString(left + 130 * mm, y, f"€{amount_total_eur:.2f}")

    c.showPage()
    c.save()
    return buf.getvalue()


def save_invoice_pdf(invoice_number: str, pdf_bytes: bytes) -> str:
    os.makedirs(INVOICE_DIR, exist_ok=True)
    path = os.path.join(INVOICE_DIR, f"{invoice_number}.pdf")
    with open(path, "wb") as f:
        f.write(pdf_bytes)
    return path
