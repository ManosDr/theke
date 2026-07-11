"""Five critical-path tests only, per Phase 5 scope - not a general test
suite. Each test creates its own company/user/(project/document) rows
directly via SQLAlchemy and deletes them in a finally block, rather than
depending on demo seed data (which isn't guaranteed present/stable outside
this dev stack - see bootstrap.py's seed_demo_data()). Tests that touch
retrieval make real OpenAI embedding calls (needs OPENAI_API_KEY set),
same as the app itself - no mocking, since the whole point is to catch a
real regression in the actual retrieval/visibility path.
"""

import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from jose import jwt
from sqlalchemy import text

from app.config import settings
from app.database import SessionLocal
from app.main import app
from app.models import Company, Document, Project, User, Vertical
from app.security import create_access_token, hash_password
from app.services.embeddings import embed_document

client = TestClient(app)

# A real, permanently-ingested document (ΓΠΣ Καβάλας, region-scoped to
# 'kavala', already embedded) - see KNOWN_DECISIONS.md on ΑΑΠ-series ΦΕΚ
# documents being kept in the KB, not pruned. Used instead of a
# test-created document so this test also catches a real embedding/
# retrieval regression, not just a fixture round-trip.
KNOWN_DOCUMENT_ID = 223
KNOWN_DOCUMENT_REGION = "kavala"
KNOWN_DOCUMENT_QUERY = (
    "Τι προβλέπει το Γενικό Πολεοδομικό Σχέδιο Καβάλας για τις Ζώνες Δικαιώματος "
    "Μεταφοράς Συντελεστή Δόμησης;"
)


def _construction_vertical_id(db) -> int:
    return db.query(Vertical).filter(Vertical.slug == "construction").one().id


def _make_company_and_user(db, region_id: str | None) -> tuple[Company, User, Project | None, str]:
    unique = uuid.uuid4().hex[:8]
    company = Company(name=f"Test Co {unique}", type="construction", vertical_id=_construction_vertical_id(db))
    db.add(company)
    db.flush()

    user = User(
        company_id=company.id,
        email=f"test-{unique}@example.test",
        role="member",
        password_hash=hash_password("not-used"),
    )
    db.add(user)
    db.flush()

    project = None
    if region_id:
        project = Project(company_id=company.id, name="Test project", region_id=region_id)
        db.add(project)
        db.flush()

    db.commit()
    token = create_access_token(user_id=user.id, company_id=company.id, role=user.role)
    return company, user, project, token


def _cleanup(db, company: Company, user: User, project: Project | None) -> None:
    # Separate commits, in FK order - Company/User/Project have plain
    # ForeignKey columns but no declared relationship() between them, so
    # SQLAlchemy's unit-of-work has no dependency graph to sort a single
    # batched flush by; batching all three deletes into one commit let it
    # emit them in the wrong order and fail with a FK violation.
    db.execute(text("DELETE FROM chat_sessions WHERE user_id = :id"), {"id": user.id})
    # get_or_create_subscription auto-creates a company_subscriptions row
    # (and get_or_create_usage a subscription_usage row) the first time a
    # test hits POST /chat/message - clear both before deleting the company
    # or its FK blocks the delete.
    db.execute(text("DELETE FROM subscription_usage WHERE company_id = :cid"), {"cid": company.id})
    db.execute(text("DELETE FROM company_subscriptions WHERE company_id = :cid"), {"cid": company.id})
    db.commit()
    if project:
        db.delete(project)
        db.commit()
    db.delete(user)
    db.commit()
    db.delete(company)
    db.commit()


def test_search_cites_known_document_for_company_with_region_access():
    db = SessionLocal()
    company, user, project, token = _make_company_and_user(db, region_id=KNOWN_DOCUMENT_REGION)
    try:
        resp = client.post(
            "/search",
            json={"query": KNOWN_DOCUMENT_QUERY},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        result_ids = [r["document_id"] for r in resp.json()["results"]]
        assert KNOWN_DOCUMENT_ID in result_ids
    finally:
        _cleanup(db, company, user, project)
        db.close()


def test_chat_message_returns_gap_shape_for_no_relevant_documents():
    db = SessionLocal()
    company, user, project, token = _make_company_and_user(db, region_id=None)
    try:
        resp = client.post(
            "/chat/message",
            json={"query": "xqzvywplkjh laksjdh unrelated nonsense string 293847"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["gap"] is True
        assert body["citations"] == []
    finally:
        _cleanup(db, company, user, project)
        db.close()


def test_search_excludes_region_document_for_company_without_region_access():
    db = SessionLocal()
    company, user, project, token = _make_company_and_user(db, region_id=None)
    try:
        resp = client.post(
            "/search",
            json={"query": KNOWN_DOCUMENT_QUERY},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        result_ids = [r["document_id"] for r in resp.json()["results"]]
        assert KNOWN_DOCUMENT_ID not in result_ids
    finally:
        _cleanup(db, company, user, project)
        db.close()


def test_expired_jwt_is_rejected_with_401():
    expired_payload = {
        "sub": "1",
        "company_id": None,
        "role": "member",
        "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
    }
    token = jwt.encode(expired_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)

    resp = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_needs_review_document_never_appears_in_search():
    db = SessionLocal()
    company, user, project, token = _make_company_and_user(db, region_id=None)
    marker = f"unique-marker-{uuid.uuid4().hex}"
    doc = Document(
        title="Test needs_review document",
        content=f"Αυτό είναι ένα δοκιμαστικό έγγραφο με μοναδικό αναγνωριστικό {marker}.",
        status="active",
        scope="national",
        extraction_status="full_text",
        needs_review=True,
        vertical_id=_construction_vertical_id(db),
    )
    db.add(doc)
    db.commit()
    try:
        embed_document(db, doc)
        resp = client.post(
            "/search",
            json={"query": f"μοναδικό αναγνωριστικό {marker}"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        result_ids = [r["document_id"] for r in resp.json()["results"]]
        assert doc.id not in result_ids
    finally:
        db.execute(text("DELETE FROM embeddings WHERE document_id = :id"), {"id": doc.id})
        db.delete(doc)
        db.commit()
        _cleanup(db, company, user, project)
        db.close()
