"""Section 1.3 - Authorization tests.

These are treated as gating: per the test plan, a failure here means the
suite must stop before any further section runs (real isolation/security
bugs, not feature bugs).
"""

from sqlalchemy import select

from app.models import CompanySubscription, Document, Plan, Vertical
from app.services.embeddings import embed_document

from .conftest import cleanup_company, make_company_and_user

KNOWN_DOCUMENT_ID = 223  # ΓΠΣ Καβάλας - see conftest.py module docstring
KNOWN_DOCUMENT_QUERY = (
    "Τι προβλέπει το Γενικό Πολεοδομικό Σχέδιο Καβάλας για τις Ζώνες Δικαιώματος "
    "Μεταφοράς Συντελεστή Δόμησης;"
)


def test_admin_endpoint_as_member(client, member_headers):
    resp = client.get("/admin/stats", headers=member_headers)
    assert resp.status_code == 403


def test_superadmin_endpoint_as_admin(client, admin_headers):
    resp = client.get("/admin/companies", headers=admin_headers)
    assert resp.status_code == 403


def test_superadmin_endpoint_as_member(client, member_headers):
    resp = client.get("/admin/companies", headers=member_headers)
    assert resp.status_code == 403


def test_chat_with_wrong_company_project(client, db_session, construction_vertical_id, member_headers):
    other_company, other_user, other_project, _ = make_company_and_user(
        db_session, vertical_id=construction_vertical_id, region_id="kavala"
    )
    try:
        resp = client.post(
            "/chat/message",
            json={"query": "test", "project_id": other_project.id},
            headers=member_headers,
        )
        assert resp.status_code == 403
    finally:
        cleanup_company(db_session, other_company, other_user, other_project)


def test_chat_with_nonexistent_project(client, member_headers):
    resp = client.post("/chat/message", json={"query": "test", "project_id": 999999999}, headers=member_headers)
    assert resp.status_code == 404


def test_search_returns_only_own_vertical_docs(client, db_session, member_headers, construction_vertical_id, tax_vertical_id):
    """A tax-specific query, run as a construction member, must never
    surface a document that actually belongs to the tax vertical - checked
    by looking up each returned document's real vertical_id in the DB,
    not just by counting results (a 0-result response alone wouldn't prove
    the vertical filter specifically was what excluded them)."""
    resp = client.post(
        "/search",
        json={"query": "ΦΠΑ φορολογική δήλωση ΑΑΔΕ myAADE παρακράτηση φόρου εισοδήματος"},
        headers=member_headers,
    )
    assert resp.status_code == 200
    doc_ids = [r["document_id"] for r in resp.json()["results"]]
    if doc_ids:
        verticals = set(
            db_session.scalars(select(Document.vertical_id).where(Document.id.in_(doc_ids)))
        )
        assert tax_vertical_id not in verticals
        assert verticals <= {construction_vertical_id}


def test_search_returns_only_own_company_docs(client, db_session, construction_vertical_id):
    """Two throwaway construction companies; company B uploads a document
    with a unique marker via embed_document (real embedding call, same
    no-mocking approach test_critical_path.py already uses), then company
    A searches for that exact marker and must get 0 results."""
    company_a, user_a, project_a, token_a = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    company_b, user_b, project_b, token_b = make_company_and_user(db_session, vertical_id=construction_vertical_id)

    import uuid

    marker = f"unique-cross-company-marker-{uuid.uuid4().hex}"
    doc = Document(
        title="Company B private document",
        content=f"Αυτό το έγγραφο ανήκει αποκλειστικά στην εταιρεία Β. Αναγνωριστικό: {marker}.",
        status="active",
        scope="national",
        extraction_status="full_text",
        company_id=company_b.id,
        vertical_id=construction_vertical_id,
    )
    db_session.add(doc)
    db_session.commit()
    try:
        embed_document(db_session, doc)

        resp_b = client.post(
            "/search", json={"query": f"Αναγνωριστικό {marker}"}, headers={"Authorization": f"Bearer {token_b}"}
        )
        assert resp_b.status_code == 200
        assert doc.id in [r["document_id"] for r in resp_b.json()["results"]]

        resp_a = client.post(
            "/search", json={"query": f"Αναγνωριστικό {marker}"}, headers={"Authorization": f"Bearer {token_a}"}
        )
        assert resp_a.status_code == 200
        assert doc.id not in [r["document_id"] for r in resp_a.json()["results"]]
    finally:
        from sqlalchemy import text

        db_session.execute(text("DELETE FROM embeddings WHERE document_id = :id"), {"id": doc.id})
        db_session.delete(doc)
        db_session.commit()
        cleanup_company(db_session, company_a, user_a, project_a)
        cleanup_company(db_session, company_b, user_b, project_b)


# Phase 2 of the beta/trial rollout - the centralized beta_pending block in
# app/dependencies.py's get_current_user. These three tests exist
# specifically to prove the block is genuinely centralized (any protected
# endpoint, not one hand-picked route) and that the one deliberate
# exception (GET /subscription/status, via get_current_user_allow_pending)
# stays reachable - see KNOWN_DECISIONS.md and dependencies.py's own
# docstrings for why this shape was chosen.


def _make_company_with_subscription_status(db, *, vertical_id: int, status: str):
    company, user, project, token = make_company_and_user(db, vertical_id=vertical_id)
    plan = db.scalar(select(Plan).where(Plan.vertical_id == vertical_id, Plan.is_beta.is_(True)))
    sub = CompanySubscription(company_id=company.id, plan_id=plan.id, status=status, billing_cycle="monthly")
    db.add(sub)
    db.commit()
    return company, user, project, token


def test_beta_pending_blocked_from_chat(client, db_session, construction_vertical_id):
    """Picks an arbitrary, unrelated protected endpoint (chat history) -
    the point is that the block lives in get_current_user itself, not in
    any specific route, so ANY endpoint using it is covered without having
    to enumerate them all."""
    company, user, project, token = _make_company_with_subscription_status(
        db_session, vertical_id=construction_vertical_id, status="beta_pending"
    )
    try:
        resp = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403
    finally:
        cleanup_company(db_session, company, user, project)


def test_beta_pending_blocked_from_admin_style_action(client, db_session, construction_vertical_id):
    """A second, unrelated endpoint (creating a project) - confirms the
    block isn't specific to read-only routes either."""
    company, user, project, token = _make_company_with_subscription_status(
        db_session, vertical_id=construction_vertical_id, status="beta_pending"
    )
    try:
        resp = client.post("/projects", json={"name": "Should be blocked"}, headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403
    finally:
        cleanup_company(db_session, company, user, project)


def test_beta_pending_can_still_reach_subscription_status(client, db_session, construction_vertical_id):
    """The one deliberate exception - GET /subscription/status must stay
    reachable in the exact state everything else blocks, so the frontend's
    pending-approval screen can show real status and poll for approval."""
    company, user, project, token = _make_company_with_subscription_status(
        db_session, vertical_id=construction_vertical_id, status="beta_pending"
    )
    try:
        resp = client.get("/subscription/status", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "beta_pending"
    finally:
        cleanup_company(db_session, company, user, project)


def test_rejected_status_blocked_from_chat(client, db_session, construction_vertical_id):
    """A declined signup never gains access, same as it never had any -
    'rejected' is in the same no-access bucket as 'beta_pending', not a
    status the ordinary access checks let through."""
    company, user, project, token = _make_company_with_subscription_status(
        db_session, vertical_id=construction_vertical_id, status="rejected"
    )
    try:
        resp = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403
    finally:
        cleanup_company(db_session, company, user, project)


def test_rejected_can_still_reach_subscription_status(client, db_session, construction_vertical_id):
    company, user, project, token = _make_company_with_subscription_status(
        db_session, vertical_id=construction_vertical_id, status="rejected"
    )
    try:
        resp = client.get("/subscription/status", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"
    finally:
        cleanup_company(db_session, company, user, project)


def test_beta_status_not_blocked_from_chat_history(client, db_session, construction_vertical_id):
    """Negative case for the block itself - an approved 'beta' company (the
    status a beta_pending signup transitions to on approval) must NOT be
    blocked, confirming the check is specific to 'beta_pending' and not
    accidentally matching every non-active status."""
    company, user, project, token = _make_company_with_subscription_status(
        db_session, vertical_id=construction_vertical_id, status="beta"
    )
    try:
        resp = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
    finally:
        cleanup_company(db_session, company, user, project)
