"""Daily invite-expiry sweep (see crawler/crontab) - finds every invite still
'pending' whose expires_at has already passed, flips it to 'expired', and
notifies every active super admin. Before this job existed, a lapsed invite
just sat at status='pending' forever - the only place expiry was ever
checked was reactively, at accept-time, in auth.py's register()/invite_info(),
with no record kept and nobody told. Runs daily (not weekly) since an invite
is only valid INVITE_VALID_DAYS (7) - a week-long lag before the flip would
mean an invite could be stale for most of its own validity window before
anyone found out.
"""

import psycopg

from crawler.config import DATABASE_URL


def _find_expired(conn: psycopg.Connection) -> list[tuple[int, str]]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, email FROM invites WHERE status = 'pending' AND expires_at < now()"
        )
        return [(row[0], row[1]) for row in cur.fetchall()]


def _flip_and_notify(conn: psycopg.Connection, expired: list[tuple[int, str]]) -> None:
    with conn.cursor() as cur:
        cur.executemany(
            "UPDATE invites SET status = 'expired' WHERE id = %s",
            [(invite_id,) for invite_id, _email in expired],
        )

        cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
        user_ids = [row[0] for row in cur.fetchall()]
        if user_ids:
            rows = [
                (
                    user_id,
                    "invite_expired",
                    "Invite expired",
                    f"{email}'s invite expired without being accepted.",
                    "/admin/invites",
                )
                for user_id in user_ids
                for _invite_id, email in expired
            ]
            cur.executemany(
                "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
                rows,
            )
    conn.commit()


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    with psycopg.connect(conninfo) as conn:
        expired = _find_expired(conn)
        if expired:
            _flip_and_notify(conn, expired)

    print(f"Invite expiry check complete: {len(expired)} invite(s) flipped to expired.")


if __name__ == "__main__":
    run()
