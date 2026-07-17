"""Serves the three static legal documents (Terms of Service, Privacy
Policy, DPA) from app/legal_docs/*.md, with a permanent draft-state gate -
NOT a one-time check run against the source files as they existed when
this was built. Every request re-reads the file and re-checks it for `[...]`
placeholders, so replacing the drafts with final text (once the ΙΚΕ is
registered and the remaining business decisions in them are made) flips
every page/link in the app from draft to published with no code change and
no manual step to "remember" - see KNOWN_DECISIONS.md.
"""

import os
import re

LEGAL_DOCS_DIR = os.path.join(os.path.dirname(__file__), "..", "legal_docs")

# (filename, display title) - the three documents this app publishes.
LEGAL_DOCS: dict[str, tuple[str, str]] = {
    "terms": ("terms.md", "Όροι Χρήσης"),
    "privacy": ("privacy.md", "Πολιτική Απορρήτου"),
    "dpa": ("dpa.md", "Σύμβαση Επεξεργασίας Δεδομένων"),
}

# A bare `[...]` placeholder (e.g. `[ΗΜΕΡΟΜΗΝΙΑ]`), but NOT a markdown link
# `[text](url)` - the negative lookahead excludes the latter. None of these
# three documents currently use real markdown links, but this stays correct
# if they ever do.
_PLACEHOLDER_RE = re.compile(r"\[[^\]]+\](?!\()")

# Internal "note to Manos" asides (⚠️ for the top-of-document draft warning,
# 💬 for inline practical asides) - never meant for publication, stripped
# unconditionally regardless of draft/published state. Matches from the
# start of the blockquote through the last consecutive `>`-prefixed line.
_INTERNAL_NOTE_RE = re.compile(r"^>\s*[⚠️💬].*(?:\n>.*)*\n?", re.MULTILINE)


def _read_raw(slug: str) -> str:
    filename, _ = LEGAL_DOCS[slug]
    path = os.path.join(LEGAL_DOCS_DIR, filename)
    with open(path, encoding="utf-8") as f:
        return f.read()


def is_draft(slug: str) -> bool:
    """True if the source markdown still contains an unresolved `[...]`
    placeholder - checked against the RAW file (before internal-note
    stripping), so a bracket accidentally left inside a note would still
    correctly block publication rather than being silently ignored."""
    return bool(_PLACEHOLDER_RE.search(_read_raw(slug)))


def get_legal_status() -> dict[str, bool]:
    """{slug: is_draft} for all three documents - backs the lightweight
    status check used by the footer, registration checkbox, and Account
    page links, without those callers needing to fetch full content."""
    return {slug: is_draft(slug) for slug in LEGAL_DOCS}


def get_legal_doc(slug: str) -> dict:
    """Returns {slug, title, is_draft, content}. content is None while
    draft - the placeholder text is never sent to the client at all, not
    just hidden by the frontend, so a compromised/buggy client can't leak
    it either."""
    if slug not in LEGAL_DOCS:
        raise KeyError(slug)
    _, title = LEGAL_DOCS[slug]
    raw = _read_raw(slug)
    draft = bool(_PLACEHOLDER_RE.search(raw))
    if draft:
        return {"slug": slug, "title": title, "is_draft": True, "content": None}
    content = _INTERNAL_NOTE_RE.sub("", raw)
    return {"slug": slug, "title": title, "is_draft": False, "content": content}
