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


def visible_documents_filter(
    db: Session,
    user: CurrentUser,
    vertical_id: int,
    municipality: str | None = None,
    project_id: int | None = None,
) -> ColumnElement[bool]:
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
    - `vertical_id` scopes every branch above to one vertical - a construction
      company can never see a tax_accounting document and vice versa,
      regardless of company/municipality/region matching.
    - `status == 'superseded'` documents never appear here - they're
      retired-but-kept-for-history, visible only in admin KB management
      (which queries Document directly, same reasoning as needs_review).
    - Client/project-scoped documents (project_id set on the row) are
      invisible by default (project_id IS NULL keeps the general/public KB
      as the only thing a no-project query ever sees) - but when the caller
      explicitly scopes to a project_id, that project's own private
      documents are ADDED to the visible set, not substituted for it, so
      "ask about this client" can draw on both public law and the client's
      uploaded documents in the same answer.
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

    project_condition = Document.project_id.is_(None)
    if project_id:
        # Belt-and-suspenders on company ownership even though callers (e.g.
        # chat.py's _resolve_project) already 403 a project_id belonging to
        # another company before it ever reaches here - this filter should
        # stay correct on its own if a future caller skips that pre-check.
        project_condition = project_condition | (
            (Document.project_id == project_id) & (Document.company_id == user.company_id)
        )

    return (
        or_(*conditions)
        & Document.needs_review.is_(False)
        & (Document.status != "superseded")
        & (Document.vertical_id == vertical_id)
        & project_condition
    )
