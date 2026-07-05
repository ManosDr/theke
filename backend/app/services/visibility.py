"""Single source of truth for which `documents` rows a user may see.

Every query against the `documents` table MUST go through
`visible_documents_filter()` rather than hand-rolling a WHERE clause -
that's how the previous inline version in documents.py silently granted
every user visibility into every municipality's uploads (see db/init.sql
for the intended three-tier model: public / own-company / matching-
municipality). This is application-level enforcement only; there is no
Postgres RLS backstop yet, so any raw SQL / psycopg access (e.g. the
crawler, or a future admin script) bypasses this entirely.
"""

from sqlalchemy import ColumnElement, or_, select
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser
from app.models import Document, Project


def company_region_ids(db: Session, user: CurrentUser) -> list[str]:
    """Distinct region_ids the user's company has an active project in -
    e.g. a construction company with a project in Kavala should see Kavala's
    regional KB documents, but not another municipality's."""
    if user.company_id is None:
        return []
    stmt = (
        select(Project.region_id)
        .where(Project.company_id == user.company_id, Project.region_id.isnot(None))
        .distinct()
    )
    return list(db.scalars(stmt).all())


def visible_documents_filter(db: Session, user: CurrentUser, municipality: str | None = None) -> ColumnElement[bool]:
    """
    - Public/crawled national-scope docs (company_id IS NULL, scope != 'regional'):
      always visible.
    - Public/crawled regional-scope docs (company_id IS NULL, scope == 'regional'):
      visible ONLY when one of the user's company's projects is in that same
      region - so a construction company with a Kavala project sees Kavala's
      ΥΔΟΜ/ΔΕΥΑ paperwork, but nothing tagged to a different municipality.
    - The requester's own company's private uploads: always visible.
    - A specific municipality's uploads: visible ONLY when the caller
      explicitly asks about that municipality (e.g. a project's municipality
      field, or a search param) - NOT a blanket "any municipality doc".
    - needs_review documents are excluded from all of the above, full stop -
      see crawler/crawler/ingest.py's ExtractedContent.ambiguous. A document
      flagged this way isn't just unverified, it may be confirmed wrong (e.g.
      a council-meeting agenda mislabeled as a building-permits page), so it
      must not appear as if it were normal searchable content anywhere a user
      can see it. The super admin's review queue (GET /admin/stale-documents)
      and KB management search (GET /admin/documents) query Document directly
      instead of through this filter, specifically so flagged rows stay
      visible there.
    """
    region_ids = company_region_ids(db, user)

    conditions: list[ColumnElement[bool]] = [
        Document.company_id.is_(None) & (Document.scope != "regional"),
    ]
    if region_ids:
        conditions.append(
            Document.company_id.is_(None) & (Document.scope == "regional") & Document.region_id.in_(region_ids)
        )
    if user.company_id is not None:
        conditions.append(Document.company_id == user.company_id)
    if municipality:
        conditions.append(Document.municipality == municipality)
    return or_(*conditions) & Document.needs_review.is_(False)
