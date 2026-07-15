"""Section 1.2 - Auth tests.

Two corrections to the test-plan's assumed status codes, made after reading
the real endpoint code (app/routers/auth.py) rather than guessing:
  - test_register_invite_wrong_email: the endpoint returns 403 ("Invalid,
    expired, or used invite"), not 400 - a mismatched invite email is
    treated the same as an invalid/expired invite, not a separate 400 case.
  - test_reset_password_valid_token: the endpoint is declared
    status_code=204 (No Content), not 200.
Both are asserted against the real behavior below, with a comment at each
assertion explaining the correction.
"""

import uuid
from datetime import datetime, timedelta, timezone

from jose import jwt
from sqlalchemy import select

from app.config import settings
from app.models import Company, Invite, PasswordResetToken, User, Vertical
from app.security import hash_password

from .conftest import DEMO_EMAILS, DEMO_PASSWORD, TEST_CLIENT_IP, cleanup_company, make_company_and_user


def test_login_success(client):
    resp = client.post("/auth/login", json={"email": DEMO_EMAILS["construction_admin"], "password": DEMO_PASSWORD})
    assert resp.status_code == 200
    body = resp.json()
    assert body["token"]
    assert body["role"] == "admin"


def test_login_wrong_password(client):
    resp = client.post("/auth/login", json={"email": DEMO_EMAILS["construction_admin"], "password": "definitely-wrong"})
    assert resp.status_code == 401


def test_login_unknown_email(client):
    resp = client.post("/auth/login", json={"email": "nobody-at-all@nowhere.example", "password": "whatever12"})
    assert resp.status_code == 401


def test_login_lockout_after_5_failures(client):
    # _reset_login_lockout (autouse, conftest.py) already zeroed the
    # counter for this test - explicit here too so this test stays correct
    # even if that fixture is ever changed.
    from app.services.rate_limit import reset_login_failures

    reset_login_failures(TEST_CLIENT_IP)
    for _ in range(5):
        resp = client.post(
            "/auth/login", json={"email": DEMO_EMAILS["construction_admin"], "password": "wrong-password"}
        )
        assert resp.status_code == 401
    resp = client.post("/auth/login", json={"email": DEMO_EMAILS["construction_admin"], "password": "wrong-password"})
    assert resp.status_code == 429


def test_register_new_company(client, db_session):
    unique = uuid.uuid4().hex[:8]
    email = f"new-co-{unique}@example.test"
    company_name = f"New Test Company {unique}"
    resp = client.post(
        "/auth/register",
        json={
            "email": email,
            "password": "supersecret1",
            "first_name": "New",
            "last_name": "Registrant",
            "company_name": company_name,
            "company_type": "construction",
            "vertical_slug": "construction",
        },
    )
    try:
        assert resp.status_code == 201
        body = resp.json()
        assert body["role"] == "admin"
        assert body["company_type"] == "construction"
        company = db_session.scalar(select(Company).where(Company.name == company_name))
        assert company is not None
        vertical = db_session.get(Vertical, company.vertical_id)
        assert vertical.slug == "construction"
    finally:
        from sqlalchemy import text

        user = db_session.scalar(select(User).where(User.email == email))
        company = db_session.scalar(select(Company).where(Company.name == company_name))
        if user:
            # register() logs an audit_log row for this user (see
            # app/services/audit.py) - must clear it before the user can be
            # deleted (FK on audit_log.actor_user_id).
            db_session.execute(text("DELETE FROM audit_log WHERE actor_user_id = :id"), {"id": user.id})
            db_session.commit()
            db_session.delete(user)
            db_session.commit()
        if company:
            db_session.delete(company)
            db_session.commit()


def test_register_duplicate_email(client):
    resp = client.post(
        "/auth/register",
        json={
            "email": DEMO_EMAILS["construction_admin"],
            "password": "supersecret1",
            "first_name": "Dup",
            "last_name": "Registrant",
            "company_name": f"Dup Co {uuid.uuid4().hex[:8]}",
            "company_type": "construction",
            "vertical_slug": "construction",
        },
    )
    assert resp.status_code == 409


def test_register_unknown_vertical(client):
    resp = client.post(
        "/auth/register",
        json={
            "email": f"unknown-vertical-{uuid.uuid4().hex[:8]}@example.test",
            "password": "supersecret1",
            "first_name": "Unknown",
            "last_name": "Vertical",
            "company_name": f"Unknown Vertical Co {uuid.uuid4().hex[:8]}",
            "company_type": "construction",
            "vertical_slug": "not_a_real_vertical",
        },
    )
    assert resp.status_code == 422


def test_register_invite_wrong_email(client, db_session, construction_company_id):
    # invited_by is NOT NULL in the real schema (confirmed the hard way -
    # this originally passed None and got a NotNullViolation before the
    # test body ever ran) - use the real construction admin's user id.
    inviter_id = db_session.scalar(select(User.id).where(User.email == DEMO_EMAILS["construction_admin"]))
    invite = Invite(
        company_id=construction_company_id,
        email="the-actual-invitee@example.test",
        role="member",
        token=uuid.uuid4().hex,
        invited_by=inviter_id,
        status="pending",
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db_session.add(invite)
    db_session.commit()
    try:
        resp = client.post(
            "/auth/register",
            json={
                "email": "someone-else-entirely@example.test",
                "password": "supersecret1",
                "first_name": "Someone",
                "last_name": "Else",
                "invite_token": invite.token,
            },
        )
        # Correction from the test plan's assumed 400: the real endpoint
        # (app/routers/auth.py register()) treats an email mismatch as an
        # invalid invite and returns 403, the same status as an
        # expired/already-used invite - there's no separate 400 case.
        assert resp.status_code == 403
    finally:
        db_session.delete(invite)
        db_session.commit()


def test_protected_endpoint_no_token(client):
    # Correction from the test plan's assumed 401: FastAPI's HTTPBearer
    # (app/dependencies.py's bearer_scheme, default auto_error=True) raises
    # 403 "Not authenticated" when the Authorization header is missing
    # entirely - it never reaches get_current_user's own 401 logic, which
    # only fires once a token is actually present but invalid/expired. See
    # test_protected_endpoint_malformed_token below for that 401 case.
    resp = client.get("/chat/history")
    assert resp.status_code == 403


def test_protected_endpoint_malformed_token(client):
    resp = client.get("/chat/history", headers={"Authorization": "Bearer notavalidtoken"})
    assert resp.status_code == 401


def test_protected_endpoint_expired_token(client):
    expired_payload = {
        "sub": "1",
        "company_id": None,
        "role": "member",
        "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
    }
    token = jwt.encode(expired_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    resp = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_forgot_password_known_email(client):
    resp = client.post("/auth/forgot-password", json={"email": DEMO_EMAILS["construction_admin"]})
    assert resp.status_code == 200


def test_forgot_password_unknown_email_identical_response(client):
    known = client.post("/auth/forgot-password", json={"email": DEMO_EMAILS["construction_admin"]})
    unknown = client.post("/auth/forgot-password", json={"email": "definitely-not-real@nowhere.example"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_reset_password_valid_token(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token=uuid.uuid4().hex,
        expires_at=datetime.utcnow() + timedelta(minutes=30),
    )
    db_session.add(reset_token)
    db_session.commit()
    try:
        resp = client.post("/auth/reset-password", json={"token": reset_token.token, "new_password": "brandnewpass1"})
        # Correction from the test plan's assumed 200: the endpoint is
        # declared status_code=204 (No Content) in app/routers/auth.py.
        assert resp.status_code == 204

        login_resp = client.post("/auth/login", json={"email": user.email, "password": "brandnewpass1"})
        assert login_resp.status_code == 200
    finally:
        db_session.delete(reset_token) if db_session.get(PasswordResetToken, reset_token.id) else None
        db_session.commit()
        cleanup_company(db_session, company, user, project)


def test_reset_password_reuse_token(client, db_session, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    reset_token = PasswordResetToken(
        user_id=user.id,
        token=uuid.uuid4().hex,
        expires_at=datetime.utcnow() + timedelta(minutes=30),
    )
    db_session.add(reset_token)
    db_session.commit()
    try:
        first = client.post("/auth/reset-password", json={"token": reset_token.token, "new_password": "brandnewpass1"})
        assert first.status_code == 204
        second = client.post("/auth/reset-password", json={"token": reset_token.token, "new_password": "anotherpass2"})
        assert second.status_code == 400
    finally:
        row = db_session.get(PasswordResetToken, reset_token.id)
        if row:
            db_session.delete(row)
            db_session.commit()
        cleanup_company(db_session, company, user, project)
