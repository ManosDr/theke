"""Section 1.5 - Chat and RAG tests.

Real OpenAI calls throughout (embeddings + completions), same no-mocking
approach as test_critical_path.py - the point is to catch a real regression
in retrieval/generation, not a fixture round-trip. Needs OPENAI_API_KEY set
in the backend environment, same as the app itself.

Every test below uses a throwaway company/user (make_company_and_user /
cleanup_company from conftest.py), not the real demo accounts - every one
of these calls POST /chat/message, which permanently logs a chat_sessions
row regardless of test context. Originally written against member_headers/
tax_member_headers (the real demo-member@construction.theke.gr and
demo-member@accounting.theke.gr), this file alone created 6+ permanent,
uncleaned rows in those two real, human-logged-into demo accounts on every
single suite run - discovered only because a *different* test's stray rows
happened to carry an identifying marker (see KNOWN_DECISIONS.md's
"Second occurrence of test-write pollution" entry). Retrieval for
national-scope documents doesn't depend on which company is asking (see
test_critical_path.py, which already proves a throwaway company gets
identical national-scope citations), so migrating loses no coverage.
"""

from sqlalchemy import select

from app.models import Document, MessageFeedback

from .conftest import cleanup_company, make_company_and_user

KAVALA_QUERY = (
    "Τι προβλέπει το Γενικό Πολεοδομικό Σχέδιο Καβάλας για τις Ζώνες Δικαιώματος "
    "Μεταφοράς Συντελεστή Δόμησης;"
)
CONSTRUCTION_NATIONAL_QUERY = "Ποια δικαιολογητικά χρειάζονται για άδεια δόμησης;"
TAX_QUERY = "Τι είναι ο ΦΠΑ και ποιοι είναι οι συντελεστές του στην Ελλάδα;"


def test_chat_returns_answer_with_citation(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    try:
        resp = client.post(
            "/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["answer"]
        assert body["citations"]
        assert body["gap"] is False
    finally:
        cleanup_company(db_session, company, user, project)


def test_chat_gap_response_for_unknown_topic(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    try:
        resp = client.post(
            "/chat/message",
            json={"query": "Ποια είναι η πρωτεύουσα της Γαλλίας;"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["gap"] is True
        assert body["citations"] == []
    finally:
        cleanup_company(db_session, company, user, project)


def test_chat_off_topic_returns_gap(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    try:
        resp = client.post(
            "/chat/message",
            json={"query": "Ποιες είναι οι φορολογικές υποχρεώσεις ΦΠΑ;"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["gap"] is True
    finally:
        cleanup_company(db_session, company, user, project)


def test_chat_disclaimer_matches_vertical(client, db_session, construction_vertical_id, tax_vertical_id):
    construction_company, construction_user, construction_project, construction_token = make_company_and_user(
        db_session, vertical_id=construction_vertical_id
    )
    tax_company, tax_user, tax_project, tax_token = make_company_and_user(
        db_session, vertical_id=tax_vertical_id, company_type="tax_accounting"
    )
    try:
        construction_resp = client.post(
            "/chat/message",
            json={"query": CONSTRUCTION_NATIONAL_QUERY},
            headers={"Authorization": f"Bearer {construction_token}"},
        )
        assert construction_resp.status_code == 200
        assert "φοροτεχνικό" not in construction_resp.json()["answer"]

        tax_resp = client.post(
            "/chat/message", json={"query": TAX_QUERY}, headers={"Authorization": f"Bearer {tax_token}"}
        )
        assert tax_resp.status_code == 200
        assert "μηχανικό" not in tax_resp.json()["answer"]
    finally:
        cleanup_company(db_session, construction_company, construction_user, construction_project)
        cleanup_company(db_session, tax_company, tax_user, tax_project)


def test_chat_rate_limit(client, db_session, construction_vertical_id):
    """Per the test plan's own instruction: don't burn 21 real LLM calls.
    Sets the Redis counter directly to the limit (app/services/rate_limit.py
    keys it "chat_msg:<user_id>", CHAT_MESSAGE_LIMIT=20), then makes exactly
    one real call through the actual endpoint to confirm enforcement. Uses a
    throwaway user's id as the Redis key - previously this keyed off the
    real demo-member@construction.theke.gr's own id and had to carefully
    save/restore that account's actual rate-limit state (including TTL) to
    avoid leaving the shared demo account rate-limited for the rest of the
    day; a throwaway user never had real state to preserve, so the key can
    just be deleted outright afterward."""
    from app.services.rate_limit import _get_client

    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    redis_client = _get_client()
    key = f"chat_msg:{user.id}"
    try:
        redis_client.set(key, 20, ex=3600)
        resp = client.post(
            "/chat/message", json={"query": "test rate limit"}, headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 429
        assert "όριο" in resp.json()["detail"]
    finally:
        redis_client.delete(key)
        cleanup_company(db_session, company, user, project)


def test_chat_without_project_returns_national_only(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    try:
        resp = client.post(
            "/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        cited_ids = [c["document_id"] for c in resp.json()["citations"]]
        if cited_ids:
            scopes = set(db_session.scalars(select(Document.scope).where(Document.id.in_(cited_ids))))
            assert "regional" not in scopes
    finally:
        cleanup_company(db_session, company, user, project)


def test_feedback_recorded(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    feedback_id = None
    try:
        chat_resp = client.post(
            "/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers={"Authorization": f"Bearer {token}"}
        )
        session_id = chat_resp.json()["session_id"]
        assert session_id is not None

        resp = client.post(
            "/chat/feedback",
            json={"session_id": session_id, "message_index": 0, "rating": "positive"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        feedback_id = resp.json()["id"]

        row = db_session.get(MessageFeedback, feedback_id)
        assert row is not None
        assert row.session_id == session_id
        assert row.rating == "positive"
    finally:
        # message_feedback.session_id has no ON DELETE CASCADE onto
        # chat_sessions (confirmed via \d message_feedback) - this row must
        # be gone before cleanup_company's own chat_sessions delete runs,
        # or that delete fails on the FK.
        if feedback_id is not None:
            row = db_session.get(MessageFeedback, feedback_id)
            if row:
                db_session.delete(row)
                db_session.commit()
        cleanup_company(db_session, company, user, project)


def test_feedback_wrong_company_session(client, db_session, member_headers, construction_vertical_id):
    other_company, other_user, other_project, other_token = make_company_and_user(
        db_session, vertical_id=construction_vertical_id
    )
    try:
        chat_resp = client.post(
            "/chat/message",
            json={"query": CONSTRUCTION_NATIONAL_QUERY},
            headers={"Authorization": f"Bearer {other_token}"},
        )
        session_id = chat_resp.json()["session_id"]
        assert session_id is not None

        # member_headers here is only the *attacker* attempting unauthorized
        # access to someone else's session - the attempt is rejected with
        # 403 before anything is written under that account, so this is the
        # one legitimate use of a real demo account left in this file.
        resp = client.post(
            "/chat/feedback",
            json={"session_id": session_id, "message_index": 0, "rating": "positive"},
            headers=member_headers,
        )
        assert resp.status_code == 403
    finally:
        cleanup_company(db_session, other_company, other_user, other_project)
