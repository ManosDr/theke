"""Shared fixtures for the backend test suite.

The dev DB is the only DB - there is no separate test database and no
TEST_DATABASE_URL (confirmed: DATABASE_URL inside the backend container
points at the same `theke` database the running app uses; no pytest.ini/
pyproject.toml overrides it). test_critical_path.py already established the
pattern this whole suite follows: each test creates its own throwaway rows
directly via SQLAlchemy and deletes them in a `finally` block, with
FK-ordered individual db.delete() + db.commit() calls rather than one
batched commit (batching let SQLAlchemy's unit-of-work emit deletes in the
wrong order and fail on a FK violation - see test_critical_path.py's
_cleanup() comment). No transaction-rollback fixture is used, deliberately -
a rollback-scoped session would hide real commit-order/FK bugs that a
manual-cleanup session catches.

Three real document IDs are hardcoded in some tests, because they are
permanently ingested with real embeddings/content and are not created or
deleted by any test:
  223 - ΓΠΣ Καβάλας document (kavala region, real retrieval regression check)
  318 - archaeological-flag document (Panagia/Kavala GIS content)
  219 - Drama ΥΔΟΜ decoy-bug document, needs_review=True (visibility checks)
All other test data is created and cleaned up by the tests themselves.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app.database import SessionLocal
from app.main import app
from app.models import Company, Project, User, Vertical
from app.security import create_access_token, hash_password
from app.services.rate_limit import reset_login_failures

DEMO_PASSWORD = "demo1234"

DEMO_EMAILS = {
    "superadmin": "demo-superadmin@theke.gr",
    "construction_admin": "demo-admin@construction.theke.gr",
    "construction_member": "demo-member@construction.theke.gr",
    "municipality_admin": "demo-admin@municipality.theke.gr",
    "municipality_member": "demo-member@municipality.theke.gr",
    "tax_admin": "demo-admin@accounting.theke.gr",
    "tax_member": "demo-member@accounting.theke.gr",
}

# TestClient's default request.client.host is always "testclient" - every
# login attempt in this whole run shares one IP-keyed lockout counter
# (see app/services/rate_limit.py). A successful login resets it, so
# fixture-driven logins mostly self-heal, but any test that deliberately
# fails logins should reset first for a deterministic starting count.
TEST_CLIENT_IP = "testclient"


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_login_lockout():
    """Runs before AND after every test - keeps the shared IP-keyed login
    lockout counter from leaking failed attempts between unrelated tests
    (e.g. an authz test hitting a wrong-password path polluting a later
    dedicated lockout test)."""
    reset_login_failures(TEST_CLIENT_IP)
    yield
    reset_login_failures(TEST_CLIENT_IP)


def login(client: TestClient, email: str, password: str = DEMO_PASSWORD) -> str:
    resp = client.post("/auth/login", json={"email": email, "password": password})
    resp.raise_for_status()
    return resp.json()["token"]


def auth_headers(client: TestClient, email: str, password: str = DEMO_PASSWORD) -> dict:
    return {"Authorization": f"Bearer {login(client, email, password)}"}


@pytest.fixture
def superadmin_headers(client):
    return auth_headers(client, DEMO_EMAILS["superadmin"])


@pytest.fixture
def admin_headers(client):
    return auth_headers(client, DEMO_EMAILS["construction_admin"])


@pytest.fixture
def member_headers(client):
    return auth_headers(client, DEMO_EMAILS["construction_member"])


@pytest.fixture
def tax_admin_headers(client):
    return auth_headers(client, DEMO_EMAILS["tax_admin"])


@pytest.fixture
def tax_member_headers(client):
    return auth_headers(client, DEMO_EMAILS["tax_member"])


@pytest.fixture
def municipality_member_headers(client):
    return auth_headers(client, DEMO_EMAILS["municipality_member"])


@pytest.fixture
def construction_company_id(db_session):
    return db_session.scalar(select(Company.id).where(Company.name == "Demo Construction Co"))


@pytest.fixture
def tax_company_id(db_session):
    return db_session.scalar(select(Company.id).where(Company.name == "Demo Λογιστικό Γραφείο"))


@pytest.fixture
def construction_vertical_id(db_session):
    return db_session.scalar(select(Vertical.id).where(Vertical.slug == "construction"))


@pytest.fixture
def tax_vertical_id(db_session):
    return db_session.scalar(select(Vertical.id).where(Vertical.slug == "tax_accounting"))


def make_company_and_user(
    db,
    *,
    vertical_id: int,
    company_type: str = "construction",
    region_id: str | None = None,
    role: str = "member",
) -> tuple[Company, User, Project | None, str]:
    """Same throwaway-fixture shape as test_critical_path.py's
    _make_company_and_user - duplicated here rather than imported, since
    test_critical_path.py isn't meant to be a library other test files
    depend on (it's the pre-existing Phase 5 suite, kept as-is)."""
    unique = uuid.uuid4().hex[:8]
    company = Company(name=f"Test Co {unique}", type=company_type, vertical_id=vertical_id)
    db.add(company)
    db.flush()

    user = User(
        company_id=company.id,
        email=f"test-{unique}@example.test",
        role=role,
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
    token = create_access_token(user_id=user.id, company_id=company.id, role=role)
    return company, user, project, token


def cleanup_company(db, company: Company, user: User, project: Project | None = None) -> None:
    # audit_log rows reference both actor_user_id and company_id (see
    # app/services/audit.py's log_action, called by login/register/
    # password-reset/company-suspend and others) - any of those actions
    # happening during a test leaves a row that blocks the FK-ordered
    # deletes below unless cleared first. Found the hard way: several
    # Section 1 tests failed in this cleanup step, not in their actual
    # assertions, until this was added.
    db.execute(text("DELETE FROM audit_log WHERE actor_user_id = :id OR company_id = :cid"), {"id": user.id, "cid": company.id})
    db.execute(text("DELETE FROM chat_sessions WHERE user_id = :id"), {"id": user.id})
    # get_or_create_subscription (app/services/subscription.py) auto-creates
    # a company_subscriptions row - and get_or_create_usage a
    # subscription_usage row - the first time any test hits POST
    # /chat/message, since that endpoint now runs check_subscription() on
    # every request. Neither is tracked by this session's identity map (it
    # was created inside a request handler's own session), so clear both by
    # company_id before deleting the company or its FK blocks the delete.
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
