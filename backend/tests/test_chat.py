"""Section 1.5 - Chat and RAG tests.

Real OpenAI calls throughout (embeddings + completions), same no-mocking
approach as test_critical_path.py - the point is to catch a real regression
in retrieval/generation, not a fixture round-trip. Needs OPENAI_API_KEY set
in the backend environment, same as the app itself.
"""

from sqlalchemy import select

from app.models import Document, MessageFeedback, User

from .conftest import cleanup_company, make_company_and_user

KAVALA_QUERY = (
    "Τι προβλέπει το Γενικό Πολεοδομικό Σχέδιο Καβάλας για τις Ζώνες Δικαιώματος "
    "Μεταφοράς Συντελεστή Δόμησης;"
)
CONSTRUCTION_NATIONAL_QUERY = "Ποια δικαιολογητικά χρειάζονται για άδεια δόμησης;"
TAX_QUERY = "Τι είναι ο ΦΠΑ και ποιοι είναι οι συντελεστές του στην Ελλάδα;"


def test_chat_returns_answer_with_citation(client, member_headers):
    resp = client.post("/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers=member_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"]
    assert body["citations"]
    assert body["gap"] is False


def test_chat_gap_response_for_unknown_topic(client, member_headers):
    resp = client.post(
        "/chat/message", json={"query": "Ποια είναι η πρωτεύουσα της Γαλλίας;"}, headers=member_headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["gap"] is True
    assert body["citations"] == []


def test_chat_off_topic_returns_gap(client, member_headers):
    resp = client.post(
        "/chat/message", json={"query": "Ποιες είναι οι φορολογικές υποχρεώσεις ΦΠΑ;"}, headers=member_headers
    )
    assert resp.status_code == 200
    assert resp.json()["gap"] is True


def test_chat_disclaimer_matches_vertical(client, member_headers, tax_member_headers):
    construction_resp = client.post("/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers=member_headers)
    assert construction_resp.status_code == 200
    assert "φοροτεχνικό" not in construction_resp.json()["answer"]

    tax_resp = client.post("/chat/message", json={"query": TAX_QUERY}, headers=tax_member_headers)
    assert tax_resp.status_code == 200
    assert "μηχανικό" not in tax_resp.json()["answer"]


def test_chat_rate_limit(client, db_session, member_headers):
    """Per the test plan's own instruction: don't burn 21 real LLM calls.
    Sets the Redis counter directly to the limit (app/services/rate_limit.py
    keys it "chat_msg:<user_id>", CHAT_MESSAGE_LIMIT=20), then makes exactly
    one real call through the actual endpoint to confirm enforcement, and
    resets the key afterward so this doesn't cap the demo account for any
    other test/manual use in this session."""
    from app.services.rate_limit import _get_client

    user_id = db_session.scalar(select(User.id).where(User.email == "demo-member@construction.theke.gr"))
    redis_client = _get_client()
    key = f"chat_msg:{user_id}"
    original = redis_client.get(key)
    original_ttl = redis_client.ttl(key)
    try:
        redis_client.set(key, 20, ex=3600)
        resp = client.post("/chat/message", json={"query": "test rate limit"}, headers=member_headers)
        assert resp.status_code == 429
        assert "όριο" in resp.json()["detail"]
    finally:
        if original is None:
            redis_client.delete(key)
        else:
            redis_client.set(key, original, ex=original_ttl if original_ttl and original_ttl > 0 else 3600)


def test_chat_without_project_returns_national_only(client, db_session, member_headers):
    resp = client.post("/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers=member_headers)
    assert resp.status_code == 200
    cited_ids = [c["document_id"] for c in resp.json()["citations"]]
    if cited_ids:
        scopes = set(db_session.scalars(select(Document.scope).where(Document.id.in_(cited_ids))))
        assert "regional" not in scopes


def test_feedback_recorded(client, db_session, member_headers):
    chat_resp = client.post("/chat/message", json={"query": CONSTRUCTION_NATIONAL_QUERY}, headers=member_headers)
    session_id = chat_resp.json()["session_id"]
    assert session_id is not None

    resp = client.post(
        "/chat/feedback",
        json={"session_id": session_id, "message_index": 0, "rating": "positive"},
        headers=member_headers,
    )
    assert resp.status_code == 201
    feedback_id = resp.json()["id"]
    try:
        row = db_session.get(MessageFeedback, feedback_id)
        assert row is not None
        assert row.session_id == session_id
        assert row.rating == "positive"
    finally:
        row = db_session.get(MessageFeedback, feedback_id)
        if row:
            db_session.delete(row)
            db_session.commit()


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

        resp = client.post(
            "/chat/feedback",
            json={"session_id": session_id, "message_index": 0, "rating": "positive"},
            headers=member_headers,
        )
        assert resp.status_code == 403
    finally:
        cleanup_company(db_session, other_company, other_user, other_project)
