"""Weekly staleness sweep (see crawler/crontab) for the public knowledge
base. Flags documents.needs_review so a human has a stable queue to work
from (backend/app/routers/admin.py's GET /admin/stale-documents) instead of
recomputing "is this stale" on every page load. Scoped to company_id IS NULL
(the crawled KB) - a company's own uploads have no external source to
re-verify against, so staleness doesn't apply to them the same way.

Only ever raises the flag (false -> true), never clears it. needs_review is
shared with other reasons a document might need a human look - e.g.
crawler.ingest.ingest_html_page sets it on a freshly-crawled document whose
<article> tag was ambiguous. That document has today's last_verified_at, so
a staleness-only condition ("is this row stale?") would immediately clear
the flag on the very next sweep, often before anyone's had a chance to
review it. Not clearing anything here means a document only drops off the
queue when someone actually addresses it (see backend/app/routers/admin.py).
"""

import psycopg

from crawler.config import DATABASE_URL

STALE_AFTER = "6 months"


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE documents
                SET needs_review = true
                WHERE company_id IS NULL AND status = 'active' AND needs_review = false
                  AND (last_verified_at IS NULL OR last_verified_at < CURRENT_DATE - INTERVAL '{STALE_AFTER}')
                """
            )
            newly_flagged = cur.rowcount
            cur.execute(
                "SELECT count(*) FROM documents WHERE company_id IS NULL AND status = 'active' AND needs_review = true"
            )
            row = cur.fetchone()
            total_flagged = row[0] if row else 0
        conn.commit()
    print(f"Staleness sweep complete: {newly_flagged} newly flagged for staleness, {total_flagged} total in the review queue")


if __name__ == "__main__":
    run()
