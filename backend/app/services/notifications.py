from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, Project, User


def notify(
    db: Session,
    *,
    user_id: int,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    """Create one notification. Caller is responsible for db.commit()."""
    db.add(Notification(user_id=user_id, type=type, title=title, body=body, link=link))


def notify_company_admins(
    db: Session,
    *,
    company_id: int,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    admin_ids = db.scalars(
        select(User.id).where(User.company_id == company_id, User.role == "admin", User.is_active.is_(True))
    ).all()
    for user_id in admin_ids:
        notify(db, user_id=user_id, type=type, title=title, body=body, link=link)


def notify_super_admins(
    db: Session,
    *,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    """Platform-wide notification, e.g. a company requesting data deletion.
    The crawler's scheduled jobs (canary_benchmark.py, retention_cleanup.py)
    have their own raw-psycopg equivalent of this same query, since they run
    outside the backend's SQLAlchemy Session - see KNOWN_DECISIONS.md."""
    admin_ids = db.scalars(select(User.id).where(User.role == "super_admin", User.is_active.is_(True))).all()
    for user_id in admin_ids:
        notify(db, user_id=user_id, type=type, title=title, body=body, link=link)


def notify_users_by_municipality(
    db: Session,
    *,
    municipality: str,
    exclude_company_id: int | None,
    type: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
) -> None:
    """Notify every active user at a construction company that has a project
    in `municipality`, excluding the company that triggered the event (e.g.
    the municipality tenant that just uploaded the document)."""
    company_ids_stmt = select(Project.company_id).where(Project.municipality == municipality).distinct()
    if exclude_company_id is not None:
        company_ids_stmt = company_ids_stmt.where(Project.company_id != exclude_company_id)
    company_ids = db.scalars(company_ids_stmt).all()
    if not company_ids:
        return

    user_ids = db.scalars(
        select(User.id).where(User.company_id.in_(company_ids), User.is_active.is_(True))
    ).all()
    for user_id in user_ids:
        notify(db, user_id=user_id, type=type, title=title, body=body, link=link)
