"""Pure, I/O-free logic shared between crawler/crawler/region_contact_discovery.py
and backend/app/services/region_contact_discovery.py: the domain-guessing
order, contact-path list, and phone/email extraction used by the
semi-automated ΥΔΟΜ/Πολεοδομία contact discovery pass (see KNOWN_DECISIONS.md).

The two callers differ only in how they fetch (crawler: sync requests +
PoliteFetcher; backend: async httpx + PoliteFetcher) and persist (crawler:
raw psycopg from CLI args; backend: SQLAlchemy Session from an admin-UI
batch, prioritized by region_requests count) - genuinely different
execution models tied to each service's own architecture, not duplicated
logic, so only the parts below are shared here.
"""

import re

DOMAIN_TEMPLATES = [
    "https://{s}.gov.gr",
    "https://www.{s}.gov.gr",
    "https://dimos{s}.gr",
    "https://www.dimos{s}.gr",
    "https://{s}.gr",
    "https://www.{s}.gr",
    "https://cityof{s}.gr",
]

CONTACT_PATHS = [
    "/organotiki-domi/",
    "/ypiresies/domisi",
    "/epikoinonia",
    "/poleodomia",
    "/contact",
]

# A loose digit-run scan (not an exact-length regex) so a real number
# written as "2410 500 200", "2410-500-200" or "2410500200" all match the
# same way - validated afterwards by cleaning and checking the result is
# EXACTLY 10 digits starting with 2. A pilot run against real municipality
# sites found the naive "8-11 digit, loosely bounded" version of this regex
# false-positive matching unrelated digit runs on the page (dates like
# "2026-08-01", VAT-adjacent numbers) - the exact-length check after
# cleaning is what filters those back out.
_PHONE_RUN_RE = re.compile(r"\b2[\d\s.\-]{8,13}\d\b")
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
# Image-asset filenames like "background@2x.png" satisfy a naive email
# regex (the "@2x.png" tail parses as local-part-lookalike + valid-looking
# TLD) - found live in the pilot run (komotini.gr matched
# "internal-page-background@2x.png" as an "email"). Excluded by extension,
# not by a smarter regex, since new asset-naming conventions would keep
# recreating the same false-positive class either way.
_NON_EMAIL_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".css", ".js")
# Preferred over a generic info@/grammateia@ address when both appear on the
# same page - a poleodomia/ydom-specific inbox is a much stronger candidate
# than the municipality's front-desk email.
_PREFERRED_EMAIL_HINTS = ("poleodom", "ydom", "domisi", "domhs", "domisis")


def extract_phone(html: str) -> str | None:
    for raw in _PHONE_RUN_RE.findall(html):
        cleaned = re.sub(r"[\s.\-]", "", raw)
        if len(cleaned) == 10:
            return cleaned
    return None


def extract_contact(html: str) -> tuple[str | None, str | None]:
    phone = extract_phone(html)

    emails = [e for e in _EMAIL_RE.findall(html) if not e.lower().endswith(_NON_EMAIL_EXTENSIONS)]
    email = None
    for e in emails:
        if any(hint in e.lower() for hint in _PREFERRED_EMAIL_HINTS):
            email = e
            break
    if email is None and emails:
        email = emails[0]
    return phone, email
