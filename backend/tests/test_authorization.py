"""Section 1.3 - Authorization tests.

These are treated as gating: per the test plan, a failure here means the
suite must stop before any further section runs (real isolation/security
bugs, not feature bugs).
"""

from sqlalchemy import select

from app.models import Document, Vertical
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
