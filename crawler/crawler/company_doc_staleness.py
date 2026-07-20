"""Weekly content-hash check for company-wide uploaded documents that
identify an external source (documents.reference_url set) - the narrow
exception to staleness.py's "private uploads have no external source to
re-verify against" rule. Scoped to company_id IS NOT NULL, project_id AND
customer_id both NULL (company-wide only - project/customer-scoped uploads
carry lower staleness risk and stay out of this feature), reference_url IS
NOT NULL, status = 'active'.

Flags into the SAME documents.needs_review column the public-KB staleness
sweep uses, but the company admin's own queue (backend/app/routers/
companies.py's GET .../documents/needs-review) reads it back company-scoped
- never the super admin's public-KB queue, which explicitly refuses any
document with a non-NULL company_id (see admin.py's mark_document_reviewed).

Mirrors backend/app/services/source_fetch.py's extraction approach (prefer
<article>, fall back to <main>, then a cleaned <body>) rather than importing
that module directly - the crawler is a separate deployable service with its
own container/dependencies (see docker-compose.yml), not something it can
import from the backend at runtime. Sync/requests here instead of source_fetch's
async/httpx, matching every other module in this package.
"""

import hashlib

import psycopg
import requests
from bs4 import BeautifulSoup

from crawler.config import DATABASE_URL

USER_AGENT = "thekebot/0.1 (regulatory compliance assistant; contact: manos.drams@gmail.com)"
FETCH_TIMEOUT = 30


def _extract_html_text(html: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")

    article = soup.find("article")
    if article:
        text = article.get_text(separator="\n", strip=True)
        if text:
            return text

    main = soup.find("main")
    if main:
        text = main.get_text(separator="\n", strip=True)
        if text:
            return text

    body = soup.find("body")
    if not body:
        return None
    for tag in body.find_all(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    text = body.get_text(separator="\n", strip=True)
    return text or None


def fetch_reference_text(url: str) -> str | None:
    """Fetches `url` and returns its extracted plain text, or None on any
    failure (unreachable, non-2xx, no extractable content) - every failure
    mode collapses to None so a transient fetch error never gets treated as
    "checked, unchanged" (see run()'s handling below)."""
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={"User-Agent": USER_AGENT})
        resp.raise_for_status()
    except requests.RequestException:
        return None
    return _extract_html_text(resp.text)


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    checked = 0
    flagged = 0
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, reference_url, reference_content_hash
                FROM documents
                WHERE company_id IS NOT NULL AND project_id IS NULL AND customer_id IS NULL
                  AND reference_url IS NOT NULL AND status = 'active'
                """
            )
            rows = cur.fetchall()

            for doc_id, reference_url, prev_hash in rows:
                text = fetch_reference_text(reference_url)
                if text is None:
                    # Unreachable this run - leave everything untouched and
                    # try again next week, same as staleness.py's approach
                    # to transient failures.
                    continue
                checked += 1
                new_hash = content_hash(text)

                if prev_hash is None:
                    # First check since reference_url was set - establish
                    # the baseline silently, nothing to compare against yet.
                    cur.execute(
                        "UPDATE documents SET reference_content_hash = %s, reference_checked_at = now() WHERE id = %s",
                        (new_hash, doc_id),
                    )
                elif new_hash != prev_hash:
                    cur.execute(
                        """
                        UPDATE documents
                        SET reference_content_hash = %s, reference_checked_at = now(),
                            needs_review = true,
                            auto_needs_review_reason = %s
                        WHERE id = %s
                        """,
                        (
                            new_hash,
                            "Η εξωτερική πηγή που δηλώσατε για αυτό το έγγραφο άλλαξε — επαληθεύστε ότι το έγγραφο παραμένει ακριβές",
                            doc_id,
                        ),
                    )
                    flagged += 1
                else:
                    cur.execute("UPDATE documents SET reference_checked_at = now() WHERE id = %s", (doc_id,))
        conn.commit()
    print(f"Company-doc staleness check complete: {checked} checked, {flagged} newly flagged")


if __name__ == "__main__":
    run()
