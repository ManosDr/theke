"""Daily platform-wide spend check (see crawler/crontab) - runs every day,
not just the Monday window, because this specifically exists to catch
launch-window spend spikes fast. Sums chat_sessions.estimated_cost_eur over
the trailing 24h and 7d, excluding is_test_account/suspended companies (the
same exclusion idiom used platform-wide in GET /admin/stats -
Company.is_test_account.is_(False) via an OUTER JOIN so NULL company_id rows
aren't silently dropped), compares each figure against the current
super-admin-editable thresholds in spend_alert_thresholds, writes one row to
spend_alert_checks every run for a trend line, and notifies every active
super admin when either threshold is exceeded.
"""

import psycopg

from crawler.config import DATABASE_URL


def _fetch_spend(conn: psycopg.Connection, hours: int) -> float:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(cs.estimated_cost_eur), 0) FROM chat_sessions cs "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "WHERE cs.created_at >= now() - (%s || ' hours')::interval "
            "AND (c.id IS NULL OR c.is_test_account IS FALSE)",
            (hours,),
        )
        return float(cur.fetchone()[0])


def _fetch_thresholds(conn: psycopg.Connection) -> tuple[float, float]:
    with conn.cursor() as cur:
        cur.execute("SELECT daily_eur, weekly_eur FROM spend_alert_thresholds WHERE id = 1")
        row = cur.fetchone()
    if row is None:
        return 5.00, 25.00
    return float(row[0]), float(row[1])


def _notify_super_admins(
    conn: psycopg.Connection,
    *,
    daily_breached: bool,
    weekly_breached: bool,
    spend_24h: float,
    spend_7d: float,
    daily_threshold: float,
    weekly_threshold: float,
) -> None:
    notices = []
    if daily_breached:
        notices.append(
            (
                "Πλατφόρμα: υπέρβαση ημερήσιου ορίου δαπανών AI",
                f"Η δαπάνη AI των τελευταίων 24 ωρών ({spend_24h:.2f}€) ξεπέρασε το ημερήσιο "
                f"όριο ({daily_threshold:.2f}€), εξαιρουμένων δοκιμαστικών λογαριασμών.",
            )
        )
    if weekly_breached:
        notices.append(
            (
                "Πλατφόρμα: υπέρβαση εβδομαδιαίου ορίου δαπανών AI",
                f"Η δαπάνη AI των τελευταίων 7 ημερών ({spend_7d:.2f}€) ξεπέρασε το εβδομαδιαίο "
                f"όριο ({weekly_threshold:.2f}€), εξαιρουμένων δοκιμαστικών λογαριασμών.",
            )
        )
    if not notices:
        return
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
        user_ids = [row[0] for row in cur.fetchall()]
        if not user_ids:
            return
        rows = [
            (user_id, "spend_alert", title, body, "/admin/spend-alerts")
            for user_id in user_ids
            for title, body in notices
        ]
        cur.executemany(
            "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
            rows,
        )
    conn.commit()


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    with psycopg.connect(conninfo) as conn:
        spend_24h = _fetch_spend(conn, 24)
        spend_7d = _fetch_spend(conn, 24 * 7)
        daily_threshold, weekly_threshold = _fetch_thresholds(conn)

        daily_breached = spend_24h > daily_threshold
        weekly_breached = spend_7d > weekly_threshold

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO spend_alert_checks (spend_24h_eur, spend_7d_eur, daily_breached, weekly_breached) "
                "VALUES (%s, %s, %s, %s)",
                (spend_24h, spend_7d, daily_breached, weekly_breached),
            )
        conn.commit()

        if daily_breached or weekly_breached:
            _notify_super_admins(
                conn,
                daily_breached=daily_breached,
                weekly_breached=weekly_breached,
                spend_24h=spend_24h,
                spend_7d=spend_7d,
                daily_threshold=daily_threshold,
                weekly_threshold=weekly_threshold,
            )

    print(
        f"Spend alert check complete: 24h={spend_24h:.2f}EUR (threshold {daily_threshold:.2f}), "
        f"7d={spend_7d:.2f}EUR (threshold {weekly_threshold:.2f}), "
        f"daily_breached={daily_breached}, weekly_breached={weekly_breached}"
    )


if __name__ == "__main__":
    run()
