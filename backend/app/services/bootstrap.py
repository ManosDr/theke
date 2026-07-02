from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import User
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
