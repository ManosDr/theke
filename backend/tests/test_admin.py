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

from app.models import Invite

from .conftest import cleanup_company, make_company_and_user


def test_admin_stats_returns_per_vertical(client, superadmin_headers):
    resp = client.get("/admin/stats", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    slugs = {entry["slug"] for entry in body["by_vertical"]}
    assert {"construction", "tax_accounting"} <= slugs


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
    groups = client.get("/admin/data-sources", headers=superadmin_headers).json()
    source = next(g["sources"][0] for g in groups if g["sources"])
    resp = client.post(f"/admin/data-sources/{source['id']}/sync", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    synced_at = datetime.fromisoformat(body["last_crawled_at"].replace("Z", "+00:00"))
    assert (datetime.now(synced_at.tzinfo) - synced_at) < timedelta(minutes=5)


def test_vertical_content_edit(client, superadmin_headers, tax_member_headers, tax_vertical_id):
    original = client.get("/admin/verticals", headers=superadmin_headers).json()
    original_entry = next(v for v in original if v["id"] == tax_vertical_id)
    marker = f"TEST DISCLAIMER {uuid.uuid4().hex[:8]}"
    try:
        resp = client.patch(
            f"/admin/verticals/{tax_vertical_id}", json={"disclaimer_text": marker}, headers=superadmin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["disclaimer_text"] == marker

        chat_resp = client.post(
            "/chat/message",
            json={"query": "Τι είναι ο ΦΠΑ και ποιοι είναι οι συντελεστές του στην Ελλάδα;"},
            headers=tax_member_headers,
        )
        assert chat_resp.status_code == 200
        assert marker in chat_resp.json()["answer"]
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
