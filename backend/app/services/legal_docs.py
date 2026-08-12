"""Serves the three public legal documents (Terms of Service, Privacy
Policy, DPA) from the `legal_documents` table, with an explicit
`is_published` gate - NOT inferred from placeholder presence the way the
old file-based system worked (see KNOWN_DECISIONS.md). Placeholder
scanning still exists here, but only to decide whether an admin is ALLOWED
to publish, not to decide what the public sees.
"""

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LegalDocument

SLUGS = ("terms", "privacy", "dpa")

# A bare `[...]` placeholder (e.g. `[ΗΜΕΡΟΜΗΝΙΑ]`), but NOT a markdown link
# `[text](url)` - the negative lookahead excludes the latter.
_PLACEHOLDER_RE = re.compile(r"\[[^\]]+\](?!\()")


def find_placeholders(content: str) -> list[str]:
    """Every remaining `[...]` placeholder in content, in document order -
    used both for the admin editor's live count and to name the specific
    blockers in a blocked-publish error."""
    return _PLACEHOLDER_RE.findall(content)


def _get_or_404(db: Session, slug: str) -> LegalDocument:
    if slug not in SLUGS:
        raise KeyError(slug)
    doc = db.scalar(select(LegalDocument).where(LegalDocument.slug == slug))
    if not doc:
        raise KeyError(slug)
    return doc


def get_legal_status(db: Session) -> dict[str, bool]:
    """{slug: is_draft} for all three documents, is_draft = not
    is_published - backs the lightweight status check used by the footer,
    registration checkbox, and Account page links."""
    rows = db.execute(select(LegalDocument.slug, LegalDocument.is_published)).all()
    published = {slug: is_pub for slug, is_pub in rows}
    return {slug: not published.get(slug, False) for slug in SLUGS}


def get_legal_doc(db: Session, slug: str) -> dict:
    """Returns {slug, title, is_draft, content}. content is None while
    unpublished - the draft text is never sent to an unauthenticated
    client at all, not just hidden by the frontend."""
    doc = _get_or_404(db, slug)
    if not doc.is_published:
        return {"slug": slug, "title": doc.title, "is_draft": True, "content": None}
    return {"slug": slug, "title": doc.title, "is_draft": False, "content": doc.content}
