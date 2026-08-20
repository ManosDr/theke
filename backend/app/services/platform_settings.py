"""Γενικές Ρυθμίσεις (System Settings) - currently just the one flag Phase 3
of the beta/trial rollout needs (beta_ended). Its own module, not folded
into services/subscription.py, since auth.py's register() needs to read it
without importing from admin.py (which owns the write side) - same reason
services/email_templates.py stays separate from the admin CRUD that uses it.
"""

from sqlalchemy.orm import Session

from app.models import PlatformSettings


def get_or_create_platform_settings(db: Session) -> PlatformSettings:
    row = db.get(PlatformSettings, 1)
    if row is None:
        row = PlatformSettings(id=1, beta_ended=False)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row
