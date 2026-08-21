"""Daily crawl-health check (see crawler/crontab) - a lightweight reachability
probe against every active data_source's base_url, run daily (not
Monday-only) for the same reason spend_alert_check.py is daily: catching a
persistently-failing source in days rather than sitting silently until an
admin happens to notice a stuck needs_review queue. That's exactly what
happened with document 1145 (Ν.3028/2002) - its data_sources row sat at
last_crawl_status='failed' from 2026-07-12 until manually discovered over a
month later.

Deliberately separate from admin.py's sync_data_source / "Sync now" flow:
this never does content-hash comparison, never touches last_content_hash,
and never flags a linked document for review - it only asks "is this source
reachable right now", tracked as a consecutive-failure streak
(data_sources.consecutive_failures/failing_since) so a single transient
network blip doesn't trigger noise. A super admin is notified once per
streak, the first time it reaches FAILURE_THRESHOLD consecutive daily
checks - see _notify_super_admins's ON CONFLICT DO NOTHING against
data_source_failure_alerts, keyed on (data_source_id, failing_since), which
is what makes re-running this job (including the same day, e.g. during
manual verification) never double-notify.

Reuses this package's own PoliteFetcher (see crawler/politeness.py) - not
the backend's async version - since this runs as a separate cron-triggered
process, same reasoning as every other script in this package.

Also detects the reverse transition - a source coming back healthy after a
notified failure streak - and fires a "source reachable again" super-admin
notification. Deliberately keyed off data_source_failure_alerts (did we
actually tell anyone this source was down?) rather than firing on every
failed->healthy flip: a streak that never crossed FAILURE_THRESHOLD was
never surfaced to anyone, so a "recovered" notice for it would reference a
problem no admin ever heard about. No new table/column needed - the
existing (data_source_id, failing_since) row is proof of a real streak, and
this UPDATE's own reset of failing_since to NULL is what naturally prevents
a second recovery notification on the next run (nothing to compare against
once it's cleared).
"""

from datetime import datetime

import requests
import psycopg

from crawler.config import DATABASE_URL
from crawler.politeness import DEFAULT_FETCHER, CrawlBlocked, RobotsDisallowed

# 3 consecutive daily checks - long enough that one bad network day doesn't
# alert, short enough that a real ban/dead-link is caught within a week.
FAILURE_THRESHOLD = 3


def _check_source(url: str) -> tuple[str, str | None]:
    """Returns (status, error) where status is 'healthy', 'failed', or
    'blocked'. 'blocked' means PoliteFetcher's own ban-detection fired
    (HTTP 403/429, or a response body matching a known block-page
    signature - see theke_shared.politeness_shared.BLOCK_PAGE_SIGNATURES) -
    a more urgent signal than an ordinary failure, since it means our IP/
    user-agent has been actively rejected rather than the page having moved
    or the network having hiccuped once."""
    try:
        resp = DEFAULT_FETCHER.get(url)
    except CrawlBlocked as exc:
        return "blocked", exc.reason
    except RobotsDisallowed:
        return "failed", "robots.txt disallowed"
    except requests.Timeout:
        return "failed", "timeout"
    except requests.ConnectionError:
        return "failed", "connection-error"
    except requests.RequestException as exc:
        return "failed", str(exc)[:300]
    if resp.status_code >= 400:
        return "failed", f"HTTP {resp.status_code}"
    return "healthy", None


def _linked_document_count(conn: psycopg.Connection, base_url: str) -> int:
    escaped = base_url.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM documents WHERE source LIKE %s ESCAPE '\\'", (escaped + "%",))
        return cur.fetchone()[0]


def _days_failing(failing_since) -> int:
    return max(0, (datetime.utcnow() - failing_since).days)


def _notify_super_admins(
    conn: psycopg.Connection,
    *,
    source_id: int,
    name: str,
    base_url: str,
    status: str,
    error: str | None,
    failing_since,
    consecutive_failures: int,
) -> bool:
    """Returns True if a notification was actually sent, False if this
    failure streak was already notified (the ON CONFLICT DO NOTHING below is
    the source of truth for "already fired", not the caller's threshold
    check - so re-running this job, including multiple times the same day
    during manual verification, never double-notifies)."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO data_source_failure_alerts (data_source_id, failing_since, is_ban_pattern) "
            "VALUES (%s, %s, %s) ON CONFLICT (data_source_id, failing_since) DO NOTHING RETURNING id",
            (source_id, failing_since, status == "blocked"),
        )
        if cur.fetchone() is None:
            return False

    doc_count = _linked_document_count(conn, base_url)
    days = _days_failing(failing_since)

    if status == "blocked":
        title = f"ΠΗΓΗ ΑΠΟΚΛΕΙΣΜΕΝΗ (IP ban): {name}"
        urgency_line = (
            "Πιθανό μπλοκάρισμα IP από την πηγή - πιο επείγον από συνηθισμένη αποτυχία, "
            "μην ξαναδοκιμάσετε άμεσα, ενδέχεται να χρειάζεται εναλλακτικό URL."
        )
    else:
        title = f"Πηγή αποτυγχάνει επίμονα: {name}"
        urgency_line = "Πιθανή αλλαγή/κατάργηση σελίδας ή προσωρινό πρόβλημα δικτύου."

    body = (
        f"{urgency_line}\n"
        f"URL: {base_url}\n"
        f"Σφάλμα: {error}\n"
        f"Συνδεδεμένα έγγραφα: {doc_count}\n"
        f"Αποτυγχάνει για {consecutive_failures} συνεχόμενους ελέγχους ({days} ημέρες)."
    )

    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
        user_ids = [row[0] for row in cur.fetchall()]
        if not user_ids:
            return False
        cur.executemany(
            "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
            [(user_id, "data_source_failure", title, body, "/admin/data-sources") for user_id in user_ids],
        )
    conn.commit()
    return True


def _notify_recovery(
    conn: psycopg.Connection,
    *,
    source_id: int,
    name: str,
    base_url: str,
    failing_since,
) -> bool:
    """Returns True if a recovery notification was sent. Only fires when the
    failure streak we're recovering from was itself notified (a row exists
    in data_source_failure_alerts for this exact (source_id, failing_since)
    pair) - a streak that never reached FAILURE_THRESHOLD was never reported
    as down, so there's nothing to report as "back" either."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM data_source_failure_alerts WHERE data_source_id = %s AND failing_since = %s",
            (source_id, failing_since),
        )
        if cur.fetchone() is None:
            return False

        cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
        user_ids = [row[0] for row in cur.fetchall()]
        if not user_ids:
            return False

        since_label = failing_since.strftime("%d/%m/%Y")
        title = f"Η πηγή είναι ξανά προσβάσιμη: {name}"
        body = (
            f"URL: {base_url}\n"
            f"Ήταν μπλοκαρισμένη/εκτός λειτουργίας από {since_label} - "
            "ο σημερινός έλεγχος υγείας τη βρήκε προσβάσιμη ξανά."
        )
        cur.executemany(
            "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
            [(user_id, "data_source_recovered", title, body, "/admin/data-sources") for user_id in user_ids],
        )
    conn.commit()
    return True


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    checked = 0
    healthy = 0
    failed = 0
    blocked = 0
    notified = 0
    recovered = 0

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, name, base_url, consecutive_failures, failing_since "
                "FROM data_sources WHERE is_active = true"
            )
            sources = cur.fetchall()

        for source_id, name, base_url, consecutive_failures, failing_since in sources:
            status, error = _check_source(base_url)
            checked += 1
            now_expr = "now()"

            if status == "healthy":
                healthy += 1
                with conn.cursor() as cur:
                    cur.execute(
                        f"UPDATE data_sources SET last_health_check_at = {now_expr}, "
                        "last_health_check_status = %s, last_health_check_error = NULL, "
                        "consecutive_failures = 0, failing_since = NULL WHERE id = %s",
                        (status, source_id),
                    )
                conn.commit()
                if failing_since is not None:
                    if _notify_recovery(conn, source_id=source_id, name=name, base_url=base_url, failing_since=failing_since):
                        recovered += 1
                continue

            if status == "blocked":
                blocked += 1
            else:
                failed += 1

            new_consecutive = consecutive_failures + 1
            is_new_streak = failing_since is None
            with conn.cursor() as cur:
                if is_new_streak:
                    cur.execute(
                        f"UPDATE data_sources SET last_health_check_at = {now_expr}, "
                        "last_health_check_status = %s, last_health_check_error = %s, "
                        f"consecutive_failures = %s, failing_since = {now_expr} WHERE id = %s "
                        "RETURNING failing_since",
                        (status, error, new_consecutive, source_id),
                    )
                else:
                    cur.execute(
                        f"UPDATE data_sources SET last_health_check_at = {now_expr}, "
                        "last_health_check_status = %s, last_health_check_error = %s, "
                        "consecutive_failures = %s WHERE id = %s RETURNING failing_since",
                        (status, error, new_consecutive, source_id),
                    )
                failing_since = cur.fetchone()[0]
            conn.commit()

            if new_consecutive >= FAILURE_THRESHOLD:
                sent = _notify_super_admins(
                    conn,
                    source_id=source_id,
                    name=name,
                    base_url=base_url,
                    status=status,
                    error=error,
                    failing_since=failing_since,
                    consecutive_failures=new_consecutive,
                )
                if sent:
                    notified += 1

    print(
        f"Data source health check complete: checked={checked}, healthy={healthy}, "
        f"failed={failed}, blocked={blocked}, notify_attempts={notified}, recovered={recovered}"
    )


if __name__ == "__main__":
    run()
