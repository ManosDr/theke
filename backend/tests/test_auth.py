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
from sqlalchemy import select, text

from app.config import settings
from app.models import Company, CompanySubscription, Invite, PasswordResetToken, User, Vertical
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
            "dpa_accepted": True,
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
        # Phase 2 of the beta/trial rollout: self-serve (no invite_token)
        # registration lands on beta_pending, not the old lazy trial
        # default - see auth.py's register()/create_registration_subscription.
        sub = db_session.scalar(select(CompanySubscription).where(CompanySubscription.company_id == company.id))
        assert sub is not None
        assert sub.status == "beta_pending"
    finally:
        from sqlalchemy import text

        user = db_session.scalar(select(User).where(User.email == email))
        company = db_session.scalar(select(Company).where(Company.name == company_name))
        if user:
            # register() logs an audit_log row for this user (see
            # app/services/audit.py) - must clear it before the user can be
            # deleted (FK on audit_log.actor_user_id). Self-serve
            # registration also issues an email_verification_tokens row
            # (see auth.py's _issue_and_send_verification) and, now, a
            # refresh_tokens row (see auth.py's _issue_refresh_cookie) -
            # same FK cleanup requirement for both.
            db_session.execute(text("DELETE FROM audit_log WHERE actor_user_id = :id"), {"id": user.id})
            db_session.execute(text("DELETE FROM email_verification_tokens WHERE user_id = :id"), {"id": user.id})
            db_session.execute(text("DELETE FROM refresh_tokens WHERE user_id = :id"), {"id": user.id})
            db_session.commit()
            db_session.delete(user)
            db_session.commit()
        if company:
            # register()'s self-serve branch now eagerly creates a
            # CompanySubscription row (Phase 2 of the beta/trial rollout -
            # see auth.py's create_registration_subscription call and
            # dependencies.py's centralized beta_pending block) instead of
            # leaving it to the old lazy get_or_create_subscription
            # fallback - same FK cleanup requirement as the user-side rows
            # above, or the company delete below 500s on the FK.
            db_session.execute(text("DELETE FROM subscription_events WHERE company_id = :id"), {"id": company.id})
            db_session.execute(text("DELETE FROM company_subscriptions WHERE company_id = :id"), {"id": company.id})
            db_session.commit()
            db_session.delete(company)
            db_session.commit()


def test_register_new_company_after_beta_ended(client, db_session):
    """Phase 3 of the beta/trial rollout - once platform_settings.beta_ended
    is true, the exact same self-serve registration request that produces
    beta_pending in test_register_new_company above must instead produce a
    real 30-day trial, with no approval gate. Flips the flag back to False
    in `finally` regardless of outcome - this is a real, global, singleton
    setting, not a per-test fixture, so a failure here must not leave it
    stuck true for every test/manual session that runs after."""
    db_session.execute(text("UPDATE platform_settings SET beta_ended = true WHERE id = 1"))
    db_session.commit()

    unique = uuid.uuid4().hex[:8]
    email = f"post-beta-{unique}@example.test"
    company_name = f"Post Beta Test Co {unique}"
    try:
        resp = client.post(
            "/auth/register",
            json={
                "email": email,
                "password": "supersecret1",
                "first_name": "PostBeta",
                "last_name": "Registrant",
                "company_name": company_name,
                "company_type": "construction",
                "vertical_slug": "construction",
                "dpa_accepted": True,
            },
        )
        assert resp.status_code == 201
        token = resp.json()["token"]
        company = db_session.scalar(select(Company).where(Company.name == company_name))
        assert company is not None
        sub = db_session.scalar(select(CompanySubscription).where(CompanySubscription.company_id == company.id))
        assert sub is not None
        assert sub.status == "trial"
        assert sub.trial_ends_at is not None

        # No approval gate for trial - the centralized block in
        # dependencies.py only blocks beta_pending/rejected, so this must
        # succeed immediately, unlike the beta_pending case.
        chat_resp = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert chat_resp.status_code == 200
    finally:
        db_session.execute(text("UPDATE platform_settings SET beta_ended = false WHERE id = 1"))
        db_session.commit()

        user = db_session.scalar(select(User).where(User.email == email))
        company = db_session.scalar(select(Company).where(Company.name == company_name))
        if user:
            db_session.execute(text("DELETE FROM audit_log WHERE actor_user_id = :id"), {"id": user.id})
            db_session.execute(text("DELETE FROM email_verification_tokens WHERE user_id = :id"), {"id": user.id})
            db_session.execute(text("DELETE FROM refresh_tokens WHERE user_id = :id"), {"id": user.id})
            db_session.commit()
            db_session.delete(user)
            db_session.commit()
        if company:
            db_session.execute(text("DELETE FROM subscription_events WHERE company_id = :id"), {"id": company.id})
            db_session.execute(text("DELETE FROM company_subscriptions WHERE company_id = :id"), {"id": company.id})
            db_session.commit()
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
            "dpa_accepted": True,
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
            "dpa_accepted": True,
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
                "dpa_accepted": True,
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


def _cleanup_reset_tokens_for(db_session, email: str) -> None:
    # POST /auth/forgot-password always creates a real PasswordResetToken
    # row for a known, active email (see app/routers/auth.py) - calling it
    # against the real demo admin, as both tests below need to (there's no
    # throwaway equivalent for "an email forgot_password recognizes as
    # real"), leaves that row behind with no other caller ever cleaning it
    # up. Low-visibility compared to a chat/notification row (nothing in
    # the UI lists a user's own past reset tokens, and it self-expires),
    # but it's still an uncleaned real write against a real demo account -
    # same class of issue as KNOWN_DECISIONS.md's "Second occurrence of
    # test-write pollution" entry, so it gets cleaned up here rather than
    # left to expire on its own.
    user_id = db_session.scalar(select(User.id).where(User.email == email))
    if user_id is None:
        return
    for row in db_session.scalars(select(PasswordResetToken).where(PasswordResetToken.user_id == user_id)):
        db_session.delete(row)
    db_session.commit()


def test_forgot_password_known_email(client, db_session):
    try:
        resp = client.post("/auth/forgot-password", json={"email": DEMO_EMAILS["construction_admin"]})
        assert resp.status_code == 200
    finally:
        _cleanup_reset_tokens_for(db_session, DEMO_EMAILS["construction_admin"])


def test_forgot_password_unknown_email_identical_response(client, db_session):
    try:
        known = client.post("/auth/forgot-password", json={"email": DEMO_EMAILS["construction_admin"]})
        unknown = client.post("/auth/forgot-password", json={"email": "definitely-not-real@nowhere.example"})
        assert known.status_code == unknown.status_code == 200
        assert known.json() == unknown.json()
    finally:
        _cleanup_reset_tokens_for(db_session, DEMO_EMAILS["construction_admin"])


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
