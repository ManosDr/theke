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

from sqlalchemy import func, select, text

from app.models import Document, MessageFeedback, Vertical

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

        # No backend-appended disclaimer inside the answer text at all any
        # more (see chat.py) - the chat page's persistent disclaimerBar is
        # the single place it renders, once per thread, not once per
        # message. Reproduces the walkthrough's duplication bug if this
        # regresses: the vertical's own disclaimer_text sentence used to be
        # concatenated onto every confident/limited-source answer here.
        construction_vertical = db_session.get(Vertical, construction_vertical_id)
        assert construction_vertical.disclaimer_text
        assert construction_vertical.disclaimer_text not in construction_resp.json()["answer"]
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


def test_insufficient_quota_error_fires_immediate_alert(db_session):
    """A real insufficient_quota condition can't be summoned on demand
    without literally exhausting the account (exactly what happened live
    during tonight's build) - a real httpx.Response/openai.RateLimitError
    is constructed here instead, matching the module docstring's exception
    up top: unlike every other test in this file, this one deliberately
    doesn't hit the real API, since the whole point is a condition the real
    API can't be made to produce in a test.

    Calls _maybe_alert_openai_quota_exhausted directly (one of the two
    approaches the feature spec calls out - "mock the specific exception")
    rather than driving it through POST /chat/message, since a genuine
    quota failure would hit OpenAI at the embedding-retrieval call too
    (a separate client instantiation from the completion call this
    exception simulates), and mocking both correctly is far more surface
    area than the thing actually under test here: does this specific
    function correctly detect insufficient_quota, notify, email, and
    debounce - the same function all three real except OpenAIError blocks
    in chat.py call."""
    import httpx
    from openai import RateLimitError

    from app.models import Notification, PlatformSettings, User
    from app.routers.chat import _maybe_alert_openai_quota_exhausted
    from app.services.platform_settings import get_or_create_platform_settings

    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(status_code=429, request=request)
    exc = RateLimitError(
        "You have no credits remaining.",
        response=response,
        body={
            "message": "You have no credits remaining.",
            "type": "insufficient_quota",
            "param": None,
            "code": "credit_balance_exhausted",
        },
    )

    settings_row = get_or_create_platform_settings(db_session)
    settings_row.last_openai_quota_alert_at = None
    db_session.commit()
    superadmin_count = db_session.scalar(
        select(func.count()).select_from(User).where(User.role == "super_admin", User.is_active.is_(True))
    )
    try:
        _maybe_alert_openai_quota_exhausted(db_session, exc)

        notif = db_session.scalar(select(Notification).where(Notification.type == "openai_quota_exhausted"))
        assert notif is not None
        assert "πίστωση" in notif.body

        db_session.refresh(settings_row)
        assert settings_row.last_openai_quota_alert_at is not None

        # One notification per active super admin (notify_super_admins'
        # existing fan-out), not one platform-wide row.
        notif_count = db_session.scalar(
            select(func.count()).select_from(Notification).where(Notification.type == "openai_quota_exhausted")
        )
        assert notif_count == superadmin_count

        # A second failure within the cooldown window is debounced - no
        # duplicate notifications/emails for a burst of concurrent
        # real request failures, exactly what happens once the account
        # actually runs out mid-traffic.
        _maybe_alert_openai_quota_exhausted(db_session, exc)
        notif_count_after = db_session.scalar(
            select(func.count()).select_from(Notification).where(Notification.type == "openai_quota_exhausted")
        )
        assert notif_count_after == notif_count
    finally:
        db_session.execute(text("DELETE FROM notifications WHERE type = 'openai_quota_exhausted'"))
        db_session.commit()
        settings_row = db_session.get(PlatformSettings, 1)
        if settings_row:
            settings_row.last_openai_quota_alert_at = None
            db_session.commit()


def test_ordinary_rate_limit_error_does_not_fire_quota_alert(db_session):
    """An ordinary transient rate limit (no 'type' field distinguishing it
    as insufficient_quota) resolves itself in seconds and doesn't warrant
    a "the product is down" page - only the specific insufficient_quota
    condition should alert, not every OpenAIError subtype."""
    import httpx
    from openai import RateLimitError

    from app.models import Notification
    from app.routers.chat import _maybe_alert_openai_quota_exhausted

    request = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
    response = httpx.Response(status_code=429, request=request)
    exc = RateLimitError(
        "Rate limit reached for requests",
        response=response,
        body={"message": "Rate limit reached for requests", "type": "requests", "param": None, "code": None},
    )

    _maybe_alert_openai_quota_exhausted(db_session, exc)

    notif = db_session.scalar(select(Notification).where(Notification.type == "openai_quota_exhausted"))
    assert notif is None
