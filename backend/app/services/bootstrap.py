from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Company, Project, User
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
# the platform-wide super_admin.
DEMO_ACCOUNTS = [
    ("demo-superadmin@theke.gr", "super_admin", None, None),
    ("demo-admin@construction.theke.gr", "admin", "Demo Construction Co", "construction"),
    ("demo-member@construction.theke.gr", "member", "Demo Construction Co", "construction"),
    ("demo-admin@municipality.theke.gr", "admin", "Demo Municipality", "municipality"),
    ("demo-member@municipality.theke.gr", "member", "Demo Municipality", "municipality"),
]


def seed_demo_data() -> None:
    if not settings.seed_demo_data:
        return

    db = SessionLocal()
    try:
        if db.scalar(select(User).where(User.email == DEMO_ACCOUNTS[0][0])):
            return  # already seeded

        companies_by_name: dict[str, Company] = {}
        for email, role, company_name, company_type in DEMO_ACCOUNTS:
            company_id = None
            if company_name:
                company = companies_by_name.get(company_name)
                if not company:
                    company = Company(name=company_name, type=company_type)
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

        db.commit()
        print(f"Seeded {len(DEMO_ACCOUNTS)} demo accounts (password: {DEMO_PASSWORD})")
    finally:
        db.close()
