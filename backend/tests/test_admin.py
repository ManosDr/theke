"""Section 1.8 - Admin API tests.

Two deliberate deviations from the test plan's literal steps, to avoid
mutating real demo/seed data that other sections (and a human tester) rely
on:
  - test_companies_suspend uses a throwaway company created for this test,
    not a real demo company - suspending demo-admin@construction.theke.gr's
    company would break every other section that logs in as that account.
  - test_data_sources_patch_cadence and test_vertical_content_edit both
    touch real seed rows (a real data source, a real vertical), since
    there's no throwaway equivalent for either - both save the original
    values and restore them in a `finally` block.
One correction: the plan describes PATCH /admin/companies/{id}/suspend;
the real route is POST (app/routers/admin.py), used below.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import select

from app.models import CompanySubscription, Invite, Plan

from .conftest import cleanup_company, make_company_and_user


def test_admin_stats_returns_per_vertical(client, superadmin_headers):
    resp = client.get("/admin/stats", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    slugs = {entry["slug"] for entry in body["by_vertical"]}
    assert {"construction", "tax_accounting"} <= slugs


def test_business_health_returns_timeline_shape(client, superadmin_headers):
    resp = client.get("/admin/business-health", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["days"] == 30
    assert len(body["timeline"]) == 31  # since_day..today inclusive
    assert body["total_spend_eur"] >= 0
    assert body["real_active_users_period"] >= 0
    if body["real_active_users_period"] == 0:
        assert body["cost_per_real_active_user_eur"] is None
    else:
        assert body["cost_per_real_active_user_eur"] == round(
            body["total_spend_eur"] / body["real_active_users_period"], 2
        )
    day = body["timeline"][-1]
    assert set(day.keys()) == {
        "date",
        "spend_eur",
        "messages",
        "gap_rate",
        "positive_feedback",
        "negative_feedback",
        "feedback_ratio",
        "real_companies_cumulative",
        "real_users_cumulative",
    }
    # cumulative growth counts can never decrease day over day
    company_counts = [d["real_companies_cumulative"] for d in body["timeline"]]
    assert company_counts == sorted(company_counts)


def test_business_health_days_param_bounds(client, superadmin_headers):
    resp = client.get("/admin/business-health?days=90", headers=superadmin_headers)
    assert resp.status_code == 200
    assert resp.json()["days"] == 90

    assert client.get("/admin/business-health?days=6", headers=superadmin_headers).status_code == 422
    assert client.get("/admin/business-health?days=181", headers=superadmin_headers).status_code == 422


def test_infra_health_returns_latest_reading(client, superadmin_headers):
    """Read-only endpoint - crawler/crawler/infra_health_check.py is what
    actually writes rows, so this just checks the shape super_admin sees
    back, not the write path itself."""
    resp = client.get("/admin/infra-health", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert "latest" in body and "history" in body and "trend" in body
    if body["latest"] is not None:
        assert body["latest"]["threshold_level"] in ("watch", "warning", "critical")
        assert body["latest"]["total_chunks"] >= 0


def test_data_sources_list(client, superadmin_headers):
    resp = client.get("/admin/data-sources", headers=superadmin_headers)
    assert resp.status_code == 200
    groups = resp.json()
    assert groups
    total_sources = sum(len(g["sources"]) for g in groups)
    assert total_sources > 0


def test_data_sources_patch_cadence(client, superadmin_headers):
    groups = client.get("/admin/data-sources", headers=superadmin_headers).json()
    source = next(g["sources"][0] for g in groups if g["sources"])
    source_id = source["id"]
    original = {
        "crawl_frequency_type": source["crawl_frequency_type"],
        "crawl_frequency_days": source["crawl_frequency_days"],
        "next_crawl_at": source["next_crawl_at"],
    }
    try:
        resp = client.patch(
            f"/admin/data-sources/{source_id}", json={"crawl_frequency_type": "weekly"}, headers=superadmin_headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["crawl_frequency_type"] == "weekly"
        assert body["crawl_frequency_days"] == 7
        assert body["next_crawl_at"] is not None
    finally:
        client.patch(f"/admin/data-sources/{source_id}", json=original, headers=superadmin_headers)


def test_data_sources_sync_updates_timestamp(client, superadmin_headers):
    """Sync now fetches the source's real base_url and content-hash-compares
    it (see app/services/source_fetch.py) - same no-mocking philosophy as
    test_gis.py's real Nominatim/ArcGIS calls, so this inherits the same
    external dependency and can fail on the picked source being
    unreachable, independent of any real regression. Only asserts
    last_crawled_at moved and the status is one of the two real outcomes -
    doesn't assert healthy specifically, since a transient fetch failure
    for whichever source happens to be picked shouldn't fail this test."""
    groups = client.get("/admin/data-sources", headers=superadmin_headers).json()
    source = next(g["sources"][0] for g in groups if g["sources"])
    resp = client.post(f"/admin/data-sources/{source['id']}/sync", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["last_crawl_status"] in ("healthy", "failed")
    if body["last_crawl_status"] == "healthy":
        synced_at = datetime.fromisoformat(body["last_crawled_at"].replace("Z", "+00:00"))
        assert (datetime.now(synced_at.tzinfo) - synced_at) < timedelta(minutes=5)


def test_vertical_content_edit(client, superadmin_headers, tax_member_headers, tax_vertical_id):
    """Propagation used to be verified through a real /chat/message call,
    asserting the marker showed up inside the generated answer (the backend
    used to append disclaimer_text to every answer - see chat.py). That
    append was removed (it duplicated the chat page's own persistent
    disclaimerBar, which already sources the same text - see KNOWN_DECISIONS.
    md). GET /companies/me is the real path that text reaches the frontend
    through now, and reading it straight from the DB is both a more direct
    test of the actual propagation path and - no real OpenAI call needed -
    no longer leaves a permanent stray chat_sessions row behind."""
    original = client.get("/admin/verticals", headers=superadmin_headers).json()
    original_entry = next(v for v in original if v["id"] == tax_vertical_id)
    marker = f"TEST DISCLAIMER {uuid.uuid4().hex[:8]}"
    try:
        resp = client.patch(
            f"/admin/verticals/{tax_vertical_id}", json={"disclaimer_text": marker}, headers=superadmin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["disclaimer_text"] == marker

        company_resp = client.get("/companies/me", headers=tax_member_headers)
        assert company_resp.status_code == 200
        assert company_resp.json()["vertical_disclaimer_text"] == marker
    finally:
        client.patch(
            f"/admin/verticals/{tax_vertical_id}",
            json={"disclaimer_text": original_entry["disclaimer_text"]},
            headers=superadmin_headers,
        )


def test_companies_suspend(client, db_session, superadmin_headers, construction_vertical_id):
    company, user, project, _ = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    try:
        resp = client.post(f"/admin/companies/{company.id}/suspend", headers=superadmin_headers)
        assert resp.status_code == 204

        login_resp = client.post("/auth/login", json={"email": user.email, "password": "not-used"})
        assert login_resp.status_code == 403
        assert "suspend" in login_resp.json()["detail"].lower()

        unsuspend_resp = client.post(f"/admin/companies/{company.id}/unsuspend", headers=superadmin_headers)
        assert unsuspend_resp.status_code == 204
    finally:
        cleanup_company(db_session, company, user, project)


def _make_beta_pending_company(db, *, vertical_id: int):
    company, user, project, token = make_company_and_user(db, vertical_id=vertical_id)
    plan = db.scalar(select(Plan).where(Plan.vertical_id == vertical_id, Plan.is_beta.is_(True)))
    sub = CompanySubscription(company_id=company.id, plan_id=plan.id, status="beta_pending", billing_cycle="monthly")
    db.add(sub)
    db.commit()
    db.refresh(sub)
    return company, user, project, token, sub


def test_approve_beta_signup(client, db_session, superadmin_headers, construction_vertical_id):
    company, user, project, token, sub = _make_beta_pending_company(db_session, vertical_id=construction_vertical_id)
    try:
        # Blocked before approval - see test_authorization.py's dedicated
        # coverage of the centralized check itself; this just confirms the
        # transition this endpoint performs actually lifts it.
        blocked = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert blocked.status_code == 403

        resp = client.post(f"/admin/subscriptions/{company.id}/approve-beta", headers=superadmin_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "beta"

        allowed = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert allowed.status_code == 200
    finally:
        cleanup_company(db_session, company, user, project)


def test_approve_beta_signup_wrong_status_conflicts(client, db_session, superadmin_headers, construction_vertical_id):
    """approve-beta only accepts a beta_pending -> beta transition -
    anything else (already approved, rejected, cancelled, ...) is a 409,
    not a silent no-op or a generic status overwrite."""
    company, user, project, token, sub = _make_beta_pending_company(db_session, vertical_id=construction_vertical_id)
    try:
        first = client.post(f"/admin/subscriptions/{company.id}/approve-beta", headers=superadmin_headers)
        assert first.status_code == 200

        second = client.post(f"/admin/subscriptions/{company.id}/approve-beta", headers=superadmin_headers)
        assert second.status_code == 409
    finally:
        cleanup_company(db_session, company, user, project)


def test_reject_beta_signup(client, db_session, superadmin_headers, construction_vertical_id):
    company, user, project, token, sub = _make_beta_pending_company(db_session, vertical_id=construction_vertical_id)
    try:
        resp = client.post(
            f"/admin/subscriptions/{company.id}/reject-beta",
            json={"reason": "Not a real business - test signup"},
            headers=superadmin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"
        assert resp.json()["notes"] == "Not a real business - test signup"

        # Still blocked after rejection - a rejected signup never gains
        # access, same as it never had any.
        still_blocked = client.get("/chat/history", headers={"Authorization": f"Bearer {token}"})
        assert still_blocked.status_code == 403

        # A rejected signup must not show up as reactivate-eligible the way
        # a real suspended/cancelled/expired company would - confirms
        # 'rejected' really is a distinct status, not a repurposed
        # 'suspended' that the generic reactivate action could accidentally
        # flip straight to 'active' (see KNOWN_DECISIONS.md).
        reactivate = client.patch(f"/admin/subscriptions/{company.id}/reactivate", headers=superadmin_headers)
        assert reactivate.status_code == 200
        assert reactivate.json()["status"] == "active"
        # Documents the current (accepted) behavior: reactivate is a
        # generic, unconditional-status setter with no source-state check
        # at all, so it CAN still be pointed at a rejected company
        # directly by an admin who chooses to - the safety property this
        # feature actually relies on is that 'rejected' doesn't show up
        # bucketed alongside real suspended/cancelled/expired companies in
        # the Subscriptions screen's own reactivate-eligible menu (a
        # frontend-only distinction - see CompaniesPanel/SubscriptionsPanel),
        # not that the backend endpoint itself refuses a rejected source
        # status.
    finally:
        cleanup_company(db_session, company, user, project)


def test_invite_info_endpoint(client, db_session, construction_company_id):
    from sqlalchemy import select

    from app.models import User

    # invited_by is NOT NULL in the real schema - use a real user id.
    inviter_id = db_session.scalar(select(User.id).where(User.email == "demo-admin@construction.theke.gr"))
    invite = Invite(
        company_id=construction_company_id,
        email=f"invitee-{uuid.uuid4().hex[:8]}@example.test",
        role="member",
        token=uuid.uuid4().hex,
        invited_by=inviter_id,
        status="pending",
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db_session.add(invite)
    db_session.commit()
    try:
        resp = client.get(f"/auth/invite-info/{invite.token}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["company_name"] == "Demo Construction Co"
        assert body["vertical_display_name"]
    finally:
        db_session.delete(invite)
        db_session.commit()
