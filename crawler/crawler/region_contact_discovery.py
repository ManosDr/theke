"""Semi-automated ΥΔΟΜ/Πολεοδομία contact discovery for uncovered
(status='pending') municipalities. NEVER writes to Region.contact_phone/
Region.contact_email/Region.ydom_authority_name directly - every plausible
match is inserted into region_contact_candidates as an unverified row that
only becomes live through a super admin's explicit Confirm action
(POST /admin/region-contact-candidates/{id}/confirm). See KNOWN_DECISIONS.md
for why this stays report-only and batch-driven rather than an unattended
full-scale job: contact data that's wrong and presented as verified directly
contradicts this product's "cited, verified, honest-about-gaps" positioning.

Deliberately batch-driven (run(region_ids=[...])), not "run against every
pending region" - see the pilot-batch requirement this was built for. No
search-engine API is configured for this project, so "automated search" here
means: guess a small, ranked set of plausible official-domain patterns for
the municipality (observed from the 5 already-covered regions' real domains
- kavala.gov.gr, dimosdramas.gr, cityofxanthi.gr, dimospaggaiou.gr,
thassos.gr - genuinely inconsistent conventions), fetch whichever guess
resolves first, then scrape a handful of common contact-page paths for a
phone number and email. This is a real, reusable, honest mechanism - not a
search API - and its hit rate should be read as a lower bound on what a real
search-backed version could achieve.
"""

import re

import psycopg
import requests

from crawler.config import DATABASE_URL
from crawler.politeness import DEFAULT_FETCHER, CrawlBlocked, RobotsDisallowed

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


def _extract_phone(html: str) -> str | None:
    for raw in _PHONE_RUN_RE.findall(html):
        cleaned = re.sub(r"[\s.\-]", "", raw)
        if len(cleaned) == 10:
            return cleaned
    return None


def _extract_contact(html: str) -> tuple[str | None, str | None]:
    phone = _extract_phone(html)

    emails = [e for e in _EMAIL_RE.findall(html) if not e.lower().endswith(_NON_EMAIL_EXTENSIONS)]
    email = None
    for e in emails:
        if any(hint in e.lower() for hint in _PREFERRED_EMAIL_HINTS):
            email = e
            break
    if email is None and emails:
        email = emails[0]
    return phone, email


def _discover_one(slug: str, name_en: str) -> dict | None:
    """Returns a candidate dict (authority_name/phone/email/source_url) or
    None if nothing plausible was found. Tries each domain template in
    order, stopping at the first one that resolves with a real 200
    response; then tries each contact path on that domain, falling back to
    the homepage itself if none of the specific paths respond."""
    s = slug.replace("-", "")
    base_url = None
    for template in DOMAIN_TEMPLATES:
        candidate = template.format(s=s)
        try:
            resp = DEFAULT_FETCHER.get(candidate, timeout=8)
        except (CrawlBlocked, RobotsDisallowed, requests.RequestException):
            continue
        if resp.status_code == 200 and len(resp.text) > 500:
            base_url = candidate
            homepage_html = resp.text
            break
    if base_url is None:
        return None

    for path in CONTACT_PATHS:
        try:
            resp = DEFAULT_FETCHER.get(base_url.rstrip("/") + path, timeout=8)
        except (CrawlBlocked, RobotsDisallowed, requests.RequestException):
            continue
        if resp.status_code != 200:
            continue
        phone, email = _extract_contact(resp.text)
        if phone or email:
            return {
                "authority_name": f"Πολεοδομία/ΥΔΟΜ Δήμου {name_en}",
                "phone": phone,
                "email": email,
                "source_url": resp.url,
            }

    # Nothing on the dedicated contact paths - fall back to whatever the
    # homepage itself surfaces (small municipality sites often list a
    # general phone/email straight in the footer).
    phone, email = _extract_contact(homepage_html)
    if phone or email:
        return {
            "authority_name": f"Δήμος {name_en} (γενική επικοινωνία - όχι επιβεβαιωμένα στοιχεία ΥΔΟΜ)",
            "phone": phone,
            "email": email,
            "source_url": base_url,
        }
    return None


def run(region_ids: list[str]) -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    found = 0
    not_found = []

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT region_id, region_name_en, status FROM regions WHERE region_id = ANY(%s)",
                (region_ids,),
            )
            rows = {r[0]: (r[1], r[2]) for r in cur.fetchall()}

        for region_id in region_ids:
            if region_id not in rows:
                print(f"  SKIP {region_id}: not found in regions table")
                continue
            name_en, region_status = rows[region_id]
            name_en_clean = name_en.replace("Municipality of ", "")
            if region_status != "pending":
                print(f"  SKIP {region_id}: status={region_status!r}, not an uncovered region")
                continue

            candidate = _discover_one(region_id, name_en_clean)
            if candidate is None:
                print(f"  NOTHING FOUND  {region_id} ({name_en_clean})")
                not_found.append(region_id)
                continue

            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO region_contact_candidates "
                    "(region_id, candidate_authority_name, candidate_phone, candidate_email, source_url) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (region_id, candidate["authority_name"], candidate["phone"], candidate["email"], candidate["source_url"]),
                )
            conn.commit()
            found += 1
            print(
                f"  CANDIDATE      {region_id} ({name_en_clean}) -> "
                f"phone={candidate['phone']!r} email={candidate['email']!r} source={candidate['source_url']}"
            )

    total = len(region_ids)
    print(f"\nDiscovery pass complete: {found}/{total} municipalities produced a plausible candidate.")
    if not_found:
        print(f"No candidate found for: {', '.join(not_found)}")


if __name__ == "__main__":
    import sys

    ids = sys.argv[1:]
    if not ids:
        print("Usage: python -m crawler.region_contact_discovery <region_id> [<region_id> ...]")
        raise SystemExit(1)
    run(ids)
