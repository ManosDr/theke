from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Company, Project, User, Vertical
from app.security import hash_password


def bootstrap_super_admin() -> None:
    if not settings.super_admin_email or not settings.super_admin_password:
        return

    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.email == settings.super_admin_email)):
            return
        db.add(
            User(
                company_id=None,
                email=settings.super_admin_email,
                role="super_admin",
                password_hash=hash_password(settings.super_admin_password),
            )
        )
        db.commit()
        print(f"Bootstrapped super_admin account: {settings.super_admin_email}")
    finally:
        db.close()


DEMO_PASSWORD = "demo1234"

# (email, role, company_name, company_type) - company_name/type are None for
# the platform-wide super_admin. company_type drives vertical_id below
# (construction/municipality -> the construction vertical, accounting -> the
# tax_accounting vertical) - it is otherwise just a display-only tag (see
# COMPANY_TYPES in schemas.py, which "accounting" is deliberately not added
# to: that tuple only gates the public self-serve registration endpoint,
# and self-serve accounting signup isn't wired up yet - see Multi-vertical
# Phase 8.5 in KNOWN_DECISIONS.md - so this demo account is seeded directly
# rather than through a path a real user could reach today).
DEMO_ACCOUNTS = [
    ("demo-superadmin@theke.gr", "super_admin", None, None),
    ("demo-admin@construction.theke.gr", "admin", "Demo Construction Co", "construction"),
    ("demo-member@construction.theke.gr", "member", "Demo Construction Co", "construction"),
    ("demo-admin@municipality.theke.gr", "admin", "Demo Municipality", "municipality"),
    ("demo-member@municipality.theke.gr", "member", "Demo Municipality", "municipality"),
    ("demo-admin@accounting.theke.gr", "admin", "Demo Λογιστικό Γραφείο", "accounting"),
    ("demo-member@accounting.theke.gr", "member", "Demo Λογιστικό Γραφείο", "accounting"),
]


def seed_demo_data() -> None:
    if not settings.seed_demo_data:
        return

    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.email == DEMO_ACCOUNTS[0][0])):
            return  # already seeded

        construction_vertical_id = db.scalar(select(Vertical.id).where(Vertical.slug == "construction"))
        tax_vertical_id = db.scalar(select(Vertical.id).where(Vertical.slug == "tax_accounting"))

        companies_by_name: dict[str, Company] = {}
        for email, role, company_name, company_type in DEMO_ACCOUNTS:
            company_id = None
            if company_name:
                company = companies_by_name.get(company_name)
                if not company:
                    vertical_id = tax_vertical_id if company_type == "accounting" else construction_vertical_id
                    company = Company(name=company_name, type=company_type, vertical_id=vertical_id)
                    db.add(company)
                    db.flush()
                    companies_by_name[company_name] = company
                company_id = company.id

            db.add(
                User(company_id=company_id, email=email, role=role, password_hash=hash_password(DEMO_PASSWORD))
            )

        construction_company = companies_by_name["Demo Construction Co"]
        db.add(
            Project(
                company_id=construction_company.id,
                name="Ανακαίνιση Πολυκατοικίας",
                municipality="Demo Municipality",
                address="Demo Address 1",
            )
        )

        accounting_company = companies_by_name["Demo Λογιστικό Γραφείο"]
        db.add(
            Project(
                company_id=accounting_company.id,
                name="Εμπορική Α.Ε. Καβάλας",
                is_client=True,
                client_notes="Ετήσιο κλείσιμο ισολογισμού και μηνιαία υποβολή ΦΠΑ.",
            )
        )

        db.commit()
        print(f"Seeded {len(DEMO_ACCOUNTS)} demo accounts (password: {DEMO_PASSWORD})")
    finally:
        db.close()
