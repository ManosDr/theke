"""Monday-morning usage digest email (see crawler/crontab) - a 7-day
platform snapshot sent to every active super admin via Resend, closing out
the same Monday window as staleness.py/canary_benchmark.py/
infra_health_check.py/retention_cleanup.py. Raw psycopg throughout (the
crawler cannot import backend.app.* SQLAlchemy models - see those other
jobs), and its own copy of the Resend send call (backend/app/services/
email.py's pattern) since the crawler has no access to that module either.

Every figure mirrors an existing, already-established definition rather
than inventing a new one:
- total messages / spend (7d): same is_test_account exclusion idiom as
  GET /admin/stats (platform_tokens_30d/platform_cost_eur_30d), just over
  7 days instead of 30.
- active companies: same filter as real_active_company_count()
  (app/services/growth_alerts.py) - is_suspended=false, is_test_account=false.
- gap rate: gap=true chat_sessions / total chat_sessions, same
  is_test_account exclusion, over the trailing 7 days.
- open feedback: message_feedback rows with rating='negative' AND
  status='pending' - the same definition FeedbackPanel.tsx's "pending" stat
  card uses.
- needs_review queue: public KB documents (company_id IS NULL, status=
  'active', needs_review=true) - the same query GET /admin/stale-documents
  uses for the review queue.
- new_gaps: chat_sessions.gap=true rows since the previous digest (any run,
  scheduled or manual - see _record_history) - the passive-awareness
  companion to Phase 6's gap-review workspace (GET/PATCH
  /admin/gap-queries). Falls back to the same 7-day window as everything
  else above for the very first digest ever sent.
"""

from datetime import datetime, timedelta

import resend

from crawler.config import DATABASE_URL, EMAIL_ENABLED, EMAIL_FROM, RESEND_API_KEY

import psycopg


def _fetch_stats(conn: psycopg.Connection) -> dict:
    # NOT (u.role = 'super_admin' AND u.company_id IS NULL), joined in below,
    # excludes a company-less super_admin's own chat activity - it has
    # cs.company_id IS NULL too, which used to satisfy the is_test_account
    # exclusion's "c.id IS NULL" branch and count as real usage. Query-level
    # filter only, see backend's _solo_super_admin_user_ids() docstring and
    # GET /admin/internal-activity for where this activity is still visible.
    with conn.cursor() as cur:
        # tool_used NOT IN (...) excludes system-generated rows (currently
        # just the gap-resolution follow-up notice) from the real "total
        # messages" count - see backend/app/models.py's
        # ChatSession.is_real_user_message()/SYSTEM_GENERATED_TOOL_USED,
        # the source of truth this literal must be kept in sync with by
        # hand (this script can't import that module - separate Python
        # environment, no SQLAlchemy).
        cur.execute(
            "SELECT COUNT(*) FROM chat_sessions cs "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "LEFT JOIN users u ON u.id = cs.user_id "
            "WHERE cs.created_at >= now() - interval '7 days' AND (c.id IS NULL OR c.is_test_account IS FALSE) "
            "AND NOT (u.role = 'super_admin' AND u.company_id IS NULL) "
            "AND (cs.tool_used IS NULL OR cs.tool_used NOT IN ('gap_resolution_notice'))"
        )
        total_messages = cur.fetchone()[0]

        cur.execute(
            "SELECT COUNT(*) FROM chat_sessions cs "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "LEFT JOIN users u ON u.id = cs.user_id "
            "WHERE cs.gap IS TRUE AND cs.created_at >= now() - interval '7 days' "
            "AND (c.id IS NULL OR c.is_test_account IS FALSE) "
            "AND NOT (u.role = 'super_admin' AND u.company_id IS NULL)"
        )
        gap_count = cur.fetchone()[0]
        gap_rate = round(gap_count / total_messages * 100, 1) if total_messages else 0.0

        cur.execute(
            "SELECT COALESCE(SUM(cs.estimated_cost_eur), 0) FROM chat_sessions cs "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "LEFT JOIN users u ON u.id = cs.user_id "
            "WHERE cs.created_at >= now() - interval '7 days' AND (c.id IS NULL OR c.is_test_account IS FALSE) "
            "AND NOT (u.role = 'super_admin' AND u.company_id IS NULL)"
        )
        spend_7d = float(cur.fetchone()[0])

        cur.execute("SELECT COUNT(*) FROM companies WHERE is_suspended IS FALSE AND is_test_account IS FALSE")
        active_companies = cur.fetchone()[0]

        # MessageFeedback has no user_id/company_id of its own - reach the
        # actor and company through chat_sessions the same way the queries
        # above do, including the is_test_account exclusion (previously
        # absent here too).
        cur.execute(
            "SELECT COUNT(*) FROM message_feedback mf "
            "JOIN chat_sessions cs ON cs.id = mf.session_id "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "LEFT JOIN users u ON u.id = cs.user_id "
            "WHERE mf.rating = 'negative' AND mf.status = 'pending' "
            "AND (c.id IS NULL OR c.is_test_account IS FALSE) "
            "AND NOT (u.role = 'super_admin' AND u.company_id IS NULL)"
        )
        open_feedback = cur.fetchone()[0]

        cur.execute(
            "SELECT COUNT(*) FROM documents WHERE company_id IS NULL AND status = 'active' AND needs_review IS TRUE"
        )
        needs_review = cur.fetchone()[0]

        cur.execute("SELECT MAX(created_at) FROM weekly_digests")
        last_digest_at = cur.fetchone()[0]
        gap_since = last_digest_at or (datetime.utcnow() - timedelta(days=7))

        cur.execute(
            "SELECT COUNT(*) FROM chat_sessions cs "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "LEFT JOIN users u ON u.id = cs.user_id "
            "WHERE cs.gap IS TRUE AND cs.created_at >= %s "
            "AND (c.id IS NULL OR c.is_test_account IS FALSE) "
            "AND NOT (u.role = 'super_admin' AND u.company_id IS NULL)",
            (gap_since,),
        )
        new_gaps = cur.fetchone()[0]

        # Top 5 askers by new-gap count, for the digest's "grouped by user"
        # breakdown - not persisted structurally, same as every other stat
        # here being a bare count in weekly_digests.
        cur.execute(
            "SELECT COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email) AS display_name, "
            "COUNT(*) AS cnt "
            "FROM chat_sessions cs "
            "LEFT JOIN companies c ON c.id = cs.company_id "
            "LEFT JOIN users u ON u.id = cs.user_id "
            "WHERE cs.gap IS TRUE AND cs.created_at >= %s "
            "AND (c.id IS NULL OR c.is_test_account IS FALSE) "
            "AND NOT (u.role = 'super_admin' AND u.company_id IS NULL) "
            "AND cs.user_id IS NOT NULL "
            "GROUP BY display_name "
            "ORDER BY cnt DESC "
            "LIMIT 5",
            (gap_since,),
        )
        new_gaps_by_user = cur.fetchall()

    return {
        "total_messages": total_messages,
        "gap_rate": gap_rate,
        "spend_7d": spend_7d,
        "active_companies": active_companies,
        "open_feedback": open_feedback,
        "needs_review": needs_review,
        "new_gaps": new_gaps,
        "new_gaps_by_user": new_gaps_by_user,
    }


def _super_admin_emails(conn: psycopg.Connection) -> list[str]:
    with conn.cursor() as cur:
        cur.execute("SELECT email FROM users WHERE role = 'super_admin' AND is_active = true")
        return [row[0] for row in cur.fetchall()]


def _new_gaps_breakdown_html(stats: dict) -> str:
    rows = stats.get("new_gaps_by_user") or []
    if not rows:
        return ""
    items = "".join(
        f'<tr><td style="padding: 4px 0;">{name}</td><td style="text-align: right;">{count}</td></tr>'
        for name, count in rows
    )
    return f"""
      <p style="color: #444; line-height: 1.6; margin-top: 20px;">Νέα κενά ανά χρήστη (κορυφαίοι 5):</p>
      <table style="width: 100%; border-collapse: collapse; color: #444; font-size: 14px;">
        {items}
      </table>
    """


def _send_digest(to_email: str, stats: dict) -> bool:
    """Same no-op-when-disabled / never-raises contract as
    backend/app/services/email.py's send_password_reset_email."""
    if not EMAIL_ENABLED or not RESEND_API_KEY:
        return False

    resend.api_key = RESEND_API_KEY

    try:
        resend.Emails.send(
            {
                "from": EMAIL_FROM,
                "to": to_email,
                "subject": "Theke: Εβδομαδιαία σύνοψη πλατφόρμας",
                "html": f"""
            <div style="font-family: Georgia, serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h2 style="color: #1B2A4A; margin-bottom: 8px;">Εβδομαδιαία σύνοψη πλατφόρμας</h2>
              <p style="color: #444; line-height: 1.6;">Τελευταίες 7 ημέρες:</p>
              <table style="width: 100%; border-collapse: collapse; color: #444;">
                <tr><td style="padding: 6px 0;">Συνολικά μηνύματα</td><td style="text-align: right; font-weight: 600;">{stats["total_messages"]:,}</td></tr>
                <tr><td style="padding: 6px 0;">Ποσοστό κενών απαντήσεων</td><td style="text-align: right; font-weight: 600;">{stats["gap_rate"]}%</td></tr>
                <tr><td style="padding: 6px 0;">Δαπάνη AI</td><td style="text-align: right; font-weight: 600;">{stats["spend_7d"]:.2f}€</td></tr>
                <tr><td style="padding: 6px 0;">Ενεργές εταιρείες</td><td style="text-align: right; font-weight: 600;">{stats["active_companies"]}</td></tr>
                <tr><td style="padding: 6px 0;">Ανοιχτά σχόλια (αρνητικά, εκκρεμή)</td><td style="text-align: right; font-weight: 600;">{stats["open_feedback"]}</td></tr>
                <tr><td style="padding: 6px 0;">Ουρά επανελέγχου εγγράφων</td><td style="text-align: right; font-weight: 600;">{stats["needs_review"]}</td></tr>
                <tr><td style="padding: 6px 0;">Νέα κενά από την προηγούμενη σύνοψη</td><td style="text-align: right; font-weight: 600;">{stats["new_gaps"]}</td></tr>
              </table>
              {_new_gaps_breakdown_html(stats)}
              <p style="color: #888; font-size: 13px; line-height: 1.5; margin-top: 24px;">
                Η ομάδα Theke
              </p>
            </div>
            """,
            }
        )
        return True
    except Exception:
        return False


def _record_history(conn: psycopg.Connection, stats: dict, sent: int, total: int) -> None:
    """Mirrors every scheduled run into weekly_digests (Section 6a) - the
    same table POST /admin/digests/resend writes to for a manual trigger -
    so GET /admin/digests' history shows both, not just manual ones."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO weekly_digests "
            "(total_messages, gap_rate, spend_7d_eur, active_companies, open_feedback, "
            "needs_review, new_gaps, recipients_sent, recipients_total, triggered_manually) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, false)",
            (
                stats["total_messages"],
                stats["gap_rate"],
                stats["spend_7d"],
                stats["active_companies"],
                stats["open_feedback"],
                stats["needs_review"],
                stats["new_gaps"],
                sent,
                total,
            ),
        )
    conn.commit()


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    with psycopg.connect(conninfo) as conn:
        stats = _fetch_stats(conn)
        emails = _super_admin_emails(conn)

        sent = 0
        for email in emails:
            if _send_digest(email, stats):
                sent += 1

        _record_history(conn, stats, sent, len(emails))

    print(f"Weekly digest complete: {stats}, sent to {sent}/{len(emails)} super admin(s)")


if __name__ == "__main__":
    run()
