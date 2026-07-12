"""Weekly canary benchmark (see crawler/crontab) - sends a fixed set of
10 questions (5 construction, 5 tax/accounting) through the real chat
pipeline, as the demo accounts, and checks the persisted chat_sessions row
for each: gap must be false and citations must be non-empty. This is a
mechanical check against the DB row already written by POST /chat/message,
not a second LLM-graded judgment call - the only cost is the 10 chat
completions themselves (~EUR 0.09/week), same as any other chat use.

Only failing questions get a row in benchmark_alerts (see db/init.sql) and a
notification to every super admin - a clean week leaves both untouched. This
catches regressions between the manual benchmark passes recorded in
KNOWN_DECISIONS.md (a system-prompt edit, a bad re-embed, a document getting
archived/superseded) without needing a human to notice first.
"""

import os

import psycopg
import requests

from crawler.config import DATABASE_URL

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
DEMO_PASSWORD = "demo1234"

# Keyed by the vertical's colloquial "who to log in as" - construction has a
# real project (needed so /chat/message picks up municipality-scoped
# content), tax/accounting doesn't use project scoping at all.
DEMO_ACCOUNTS = {
    "construction": "demo-member@construction.theke.gr",
    "tax_accounting": "demo-member@accounting.theke.gr",
}

CANARY_QUESTIONS = {
    "construction": [
        "Ποια δικαιολογητικά χρειάζονται για άδεια δόμησης;",
        "Τι είναι ο συντελεστής δόμησης;",
        "Πώς γίνεται η τακτοποίηση αυθαιρέτου;",
        "Τι είναι η Ηλεκτρονική Ταυτότητα Κτιρίου;",
        "Πότε χρειάζεται ενεργειακό πιστοποιητικό;",
    ],
    "tax_accounting": [
        "Πότε λήγει η φορολογική δήλωση;",
        "Πώς εκδίδω ηλεκτρονικά τιμολόγια και τι ισχύει με το myDATA;",
        "Ποιες είναι οι ασφαλιστικές μου εισφορές ΕΦΚΑ;",
        "Πόσες άδειες δικαιούμαι;",
        "Τι γίνεται αν καθυστερήσω να πληρώσω φόρο;",
    ],
}


def _login(email: str) -> str:
    resp = requests.post(f"{BACKEND_URL}/auth/login", json={"email": email, "password": DEMO_PASSWORD}, timeout=30)
    resp.raise_for_status()
    return resp.json()["token"]


def _construction_project_id(conn: psycopg.Connection) -> int | None:
    """The demo construction account's project id isn't a stable constant
    (SERIAL, depends on seed order/history) - look it up by the account's
    company rather than hardcoding it."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT p.id FROM projects p "
            "JOIN users u ON u.company_id = p.company_id "
            "WHERE u.email = %s ORDER BY p.id LIMIT 1",
            (DEMO_ACCOUNTS["construction"],),
        )
        row = cur.fetchone()
        return row[0] if row else None


def _ask(headers: dict, question: str, project_id: int | None) -> dict:
    body: dict = {"query": question, "conversation_history": []}
    if project_id is not None:
        body["project_id"] = project_id
    resp = requests.post(f"{BACKEND_URL}/chat/message", json=body, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json()


def _read_session(conn: psycopg.Connection, session_id: int | None) -> tuple[bool, int]:
    """Reads gap/citation_count back off the actual chat_sessions row (not
    just the HTTP response) so the canary is verifying what got persisted,
    not just what the API happened to answer with in that one call."""
    if session_id is None:
        # The hard-gap/off-topic-guard path never calls _log_session -
        # nothing was persisted, which is itself a failure for a canary
        # question (all 10 are expected to be squarely in-scope).
        return True, 0
    with conn.cursor() as cur:
        cur.execute("SELECT gap, citations FROM chat_sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    if row is None:
        return True, 0
    gap, citations = row
    return bool(gap), len(citations) if citations else 0


def _notify_super_admins(conn: psycopg.Connection, failures: list[tuple[str, str, bool, int]]) -> None:
    title = f"Canary benchmark: {len(failures)} question(s) failed"
    body = "\n".join(f"- [{vertical}] {question!r} (gap={gap}, citations={citation_count})" for vertical, question, gap, citation_count in failures)
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
        user_ids = [row[0] for row in cur.fetchall()]
        if not user_ids:
            return
        cur.executemany(
            "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
            [(user_id, "canary_benchmark", title, body, "/admin/feedback") for user_id in user_ids],
        )
    conn.commit()


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    failures: list[tuple[str, str, bool, int]] = []

    with psycopg.connect(conninfo) as conn:
        project_id = _construction_project_id(conn)

        for vertical, questions in CANARY_QUESTIONS.items():
            token = _login(DEMO_ACCOUNTS[vertical])
            headers = {"Authorization": f"Bearer {token}"}
            scoped_project_id = project_id if vertical == "construction" else None

            for question in questions:
                data = _ask(headers, question, scoped_project_id)
                gap, citation_count = _read_session(conn, data.get("session_id"))
                passed = gap is False and citation_count > 0
                if not passed:
                    failures.append((vertical, question, gap, citation_count))
                    with conn.cursor() as cur:
                        cur.execute(
                            "INSERT INTO benchmark_alerts (vertical, question, session_id, gap, citation_count) "
                            "VALUES (%s, %s, %s, %s, %s)",
                            (vertical, question, data.get("session_id"), gap, citation_count),
                        )
                    conn.commit()

        if failures:
            _notify_super_admins(conn, failures)

    print(f"Canary benchmark complete: {len(failures)} failure(s) out of {sum(len(q) for q in CANARY_QUESTIONS.values())} questions")


if __name__ == "__main__":
    run()
