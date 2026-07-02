from sqlalchemy.orm import Session

from app.models import AuditLog


def log_action(
    db: Session,
    *,
    actor_user_id: int | None,
    company_id: int | None,
    action: str,
    resource_type: str | None = None,
    resource_id: int | None = None,
    metadata: dict | None = None,
) -> None:
    """Record an audit entry. Caller is responsible for db.commit()."""
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            company_id=company_id,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            log_metadata=metadata,
        )
    )
