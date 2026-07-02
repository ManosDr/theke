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

from sqlalchemy import ColumnElement, or_

from app.dependencies import CurrentUser
from app.models import Document


def visible_documents_filter(user: CurrentUser, municipality: str | None = None) -> ColumnElement[bool]:
    """
    - Public/crawled docs (company_id IS NULL): always visible.
    - The requester's own company's private uploads: always visible.
    - A specific municipality's uploads: visible ONLY when the caller
      explicitly asks about that municipality (e.g. a project's municipality
      field, or a search param) - NOT a blanket "any municipality doc".
    """
    conditions: list[ColumnElement[bool]] = [Document.company_id.is_(None)]
    if user.company_id is not None:
        conditions.append(Document.company_id == user.company_id)
    if municipality:
        conditions.append(Document.municipality == municipality)
    return or_(*conditions)
