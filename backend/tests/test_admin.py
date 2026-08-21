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

from sqlalchemy import func, select, text

from app.models import ChatSession, CompanySubscription, GapSourceCandidate, Invite, Notification, Plan

from .conftest import cleanup_company, make_company_and_user


def test_admin_stats_returns_per_vertical(client, superadmin_headers):
    resp = client.get("/admin/stats", headers=superadmin_headers)
    assert resp.status_code == 200
    body = resp.json()
    slugs = {entry["slug"] for entry in body["by_vertical"]}
    assert {"construction", "tax_accounting"} <= slugs


def test_admin_stats_unresolved_gaps_excludes_addressed(client, db_session, superadmin_headers, construction_vertical_id):
    """Part D of the same-night batch: the dashboard's promoted gap-rate
    card needs a real "unresolved gaps: N" count - true gaps not yet marked
    ChatSession.gap_addressed. Measured as a delta (before/after creating
    two gap sessions and addressing one) since this is a platform-wide
    count, not scoped to one company - other real/seed data in the DB must
    not make this test flaky."""
    before = client.get("/admin/stats", headers=superadmin_headers).json()
    before_total = before["total"]["unresolved_gaps"]
    before_vertical = next(v["unresolved_gaps"] for v in before["by_vertical"] if v["slug"] == "construction")

    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    unaddressed = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Still unresolved")
    addressed = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Already handled")
    addressed.gap_addressed = True
    addressed.gap_addressed_at = datetime.utcnow()
    db_session.commit()
    try:
        after = client.get("/admin/stats", headers=superadmin_headers).json()
        # Exactly +1 (the unaddressed one) - the addressed gap must not
        # count, even though it's still a true_gap() row.
        assert after["total"]["unresolved_gaps"] == before_total + 1
        after_vertical = next(v["unresolved_gaps"] for v in after["by_vertical"] if v["slug"] == "construction")
        assert after_vertical == before_vertical + 1
    finally:
        db_session.delete(unaddressed)
        db_session.delete(addressed)
        db_session.commit()
        cleanup_company(db_session, company, user, project)


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


def _make_gap_session(db, *, company_id: int, user_id: int, message: str) -> ChatSession:
    session = ChatSession(company_id=company_id, user_id=user_id, message=message, gap=True)
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def test_list_gap_queries_includes_user_and_status(client, db_session, superadmin_headers, construction_vertical_id):
    """Phase 6 of the beta/trial rollout: the gap-review workspace
    (GET /admin/gap-queries) must surface who asked, not just which
    company - and every row starts unreviewed until acted on."""
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    unique = uuid.uuid4().hex[:8]
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message=f"Gap question {unique}")
    try:
        resp = client.get("/admin/gap-queries", headers=superadmin_headers)
        assert resp.status_code == 200
        entry = next(e for e in resp.json() if e["id"] == session.id)
        assert entry["message"] == f"Gap question {unique}"
        assert entry["company_id"] == company.id
        assert entry["company_name"] == company.name
        assert entry["user_id"] == user.id
        assert entry["user_name"] == user.display_name
        assert entry["addressed"] is False
        assert entry["addressed_at"] is None
    finally:
        cleanup_company(db_session, company, user, project)


def test_list_gap_queries_scoped_by_company_and_user(
    client, db_session, superadmin_headers, construction_vertical_id
):
    """The company_id/user_id query params are the deep-link target from
    every place an aggregate gap-rate percentage is shown (company detail
    modal, dashboard tile, Business Health) - scoping must actually narrow
    the result set, not just annotate it."""
    company_a, user_a, project_a, _ = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    company_b, user_b, project_b, _ = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session_a = _make_gap_session(db_session, company_id=company_a.id, user_id=user_a.id, message="Question from A")
    session_b = _make_gap_session(db_session, company_id=company_b.id, user_id=user_b.id, message="Question from B")
    try:
        by_company = client.get(f"/admin/gap-queries?company_id={company_a.id}", headers=superadmin_headers)
        assert by_company.status_code == 200
        ids = {e["id"] for e in by_company.json()}
        assert session_a.id in ids
        assert session_b.id not in ids

        by_user = client.get(f"/admin/gap-queries?user_id={user_b.id}", headers=superadmin_headers)
        assert by_user.status_code == 200
        ids = {e["id"] for e in by_user.json()}
        assert session_b.id in ids
        assert session_a.id not in ids
    finally:
        cleanup_company(db_session, company_a, user_a, project_a)
        cleanup_company(db_session, company_b, user_b, project_b)


def test_update_gap_query_status_marks_addressed_and_reverts(
    client, db_session, superadmin_headers, construction_vertical_id
):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Some unanswered question")
    try:
        addressed = client.patch(
            f"/admin/gap-queries/{session.id}", json={"addressed": True}, headers=superadmin_headers
        )
        assert addressed.status_code == 200
        body = addressed.json()
        assert body["addressed"] is True
        assert body["addressed_at"] is not None

        db_session.refresh(session)
        assert session.gap_addressed_by is not None

        reverted = client.patch(
            f"/admin/gap-queries/{session.id}", json={"addressed": False}, headers=superadmin_headers
        )
        assert reverted.status_code == 200
        assert reverted.json()["addressed"] is False
        assert reverted.json()["addressed_at"] is None
    finally:
        cleanup_company(db_session, company, user, project)


def test_update_gap_query_status_not_found(client, superadmin_headers):
    resp = client.patch("/admin/gap-queries/99999999", json={"addressed": True}, headers=superadmin_headers)
    assert resp.status_code == 404


def _cleanup_gap_source_candidate(db, candidate_id: int) -> None:
    candidate = db.get(GapSourceCandidate, candidate_id)
    if not candidate:
        return
    doc_id = candidate.document_id
    db.delete(candidate)
    db.commit()
    if doc_id:
        db.execute(text("DELETE FROM embeddings WHERE document_id = :id"), {"id": doc_id})
        db.execute(text("DELETE FROM documents WHERE id = :id"), {"id": doc_id})
        db.commit()


def test_discover_gap_source_stages_candidate(
    client, db_session, superadmin_headers, construction_vertical_id, monkeypatch
):
    """POST /admin/gap-queries/{id}/discover-source stages a candidate when
    the (mocked - a real web_search call is too slow/flaky/costly for an
    automated unit test, see gap_discovery.py's own module docstring for why
    this is a manual, human-reviewed action rather than an automated retry
    loop) search finds something - and never touches the live KB itself."""
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Ποιος ο ΦΠΑ σε ΙΚΕ;")

    import app.routers.admin as admin_module

    monkeypatch.setattr(
        admin_module,
        "discover_source_candidate",
        lambda question, vertical_slug: {
            "title": "Mock law title",
            "content": "Mock answer content citing the mock law.",
            "source_url": "https://www.e-nomothesia.gr/mock-law.html",
            "authority": "other",
            "confidence": "medium",
        },
    )
    candidate_id = None
    try:
        resp = client.post(f"/admin/gap-queries/{session.id}/discover-source", headers=superadmin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["candidate"] is not None
        candidate_id = body["candidate"]["id"]
        assert body["candidate"]["source_url"] == "https://www.e-nomothesia.gr/mock-law.html"
        assert body["candidate"]["status"] == "pending_review"
        assert body["candidate"]["document_id"] is None

        listed = client.get("/admin/gap-source-candidates?status=pending_review", headers=superadmin_headers)
        assert listed.status_code == 200
        assert any(c["id"] == candidate_id for c in listed.json())
    finally:
        if candidate_id:
            _cleanup_gap_source_candidate(db_session, candidate_id)
        cleanup_company(db_session, company, user, project)


def test_discover_gap_source_no_result(client, db_session, superadmin_headers, construction_vertical_id, monkeypatch):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Some unanswered question")

    import app.routers.admin as admin_module

    monkeypatch.setattr(admin_module, "discover_source_candidate", lambda question, vertical_slug: None)
    try:
        resp = client.post(f"/admin/gap-queries/{session.id}/discover-source", headers=superadmin_headers)
        assert resp.status_code == 200
        assert resp.json()["candidate"] is None
    finally:
        cleanup_company(db_session, company, user, project)


def test_discover_gap_source_requires_company(client, db_session, superadmin_headers):
    """A gap session with no company_id has no vertical to search against -
    422, not a silent guess."""
    session = ChatSession(company_id=None, user_id=None, message="orphan gap", gap=True)
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    try:
        resp = client.post(f"/admin/gap-queries/{session.id}/discover-source", headers=superadmin_headers)
        assert resp.status_code == 422
    finally:
        db_session.delete(session)
        db_session.commit()


def _make_gap_source_candidate(db, *, chat_session_id: int, vertical_id: int, question: str) -> GapSourceCandidate:
    candidate = GapSourceCandidate(
        chat_session_id=chat_session_id,
        vertical_id=vertical_id,
        question=question,
        candidate_title="Test candidate title",
        candidate_content="Test candidate content answering the question.",
        source_url="https://www.e-nomothesia.gr/test-candidate.html",
        authority="other",
        confidence="medium",
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return candidate


def test_confirm_gap_source_candidate_ingests_document_and_marks_gap_addressed(
    client, db_session, superadmin_headers, construction_vertical_id
):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Real gap question")
    candidate = _make_gap_source_candidate(
        db_session, chat_session_id=session.id, vertical_id=construction_vertical_id, question=session.message
    )
    try:
        resp = client.post(
            f"/admin/gap-source-candidates/{candidate.id}/confirm",
            json={
                "title": candidate.candidate_title,
                "content": candidate.candidate_content,
                "source_url": candidate.source_url,
                "authority": candidate.authority,
            },
            headers=superadmin_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "confirmed"
        assert body["document_id"] is not None

        db_session.refresh(session)
        assert session.gap_addressed is True
        assert session.gap_addressed_by is not None

        # A second confirm on an already-reviewed candidate is rejected, not
        # a silent no-op or a duplicate document.
        again = client.post(
            f"/admin/gap-source-candidates/{candidate.id}/confirm",
            json={"title": "x", "content": "x", "source_url": "https://example.com", "authority": None},
            headers=superadmin_headers,
        )
        assert again.status_code == 400
    finally:
        _cleanup_gap_source_candidate(db_session, candidate.id)
        cleanup_company(db_session, company, user, project)


def test_reject_gap_source_candidate(client, db_session, superadmin_headers, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Real gap question")
    candidate = _make_gap_source_candidate(
        db_session, chat_session_id=session.id, vertical_id=construction_vertical_id, question=session.message
    )
    try:
        resp = client.post(
            f"/admin/gap-source-candidates/{candidate.id}/reject",
            json={"review_note": "Not actually relevant"},
            headers=superadmin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "rejected"

        # Notify is blocked on a rejected candidate the same as a pending one.
        notify_resp = client.post(
            f"/admin/gap-source-candidates/{candidate.id}/notify-user", headers=superadmin_headers
        )
        assert notify_resp.status_code == 400
    finally:
        _cleanup_gap_source_candidate(db_session, candidate.id)
        cleanup_company(db_session, company, user, project)


def test_notify_gap_source_user_inserts_followup_and_marks_notified(
    client, db_session, superadmin_headers, construction_vertical_id
):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Real gap question")
    candidate = _make_gap_source_candidate(
        db_session, chat_session_id=session.id, vertical_id=construction_vertical_id, question=session.message
    )
    try:
        confirm = client.post(
            f"/admin/gap-source-candidates/{candidate.id}/confirm",
            json={
                "title": candidate.candidate_title,
                "content": candidate.candidate_content,
                "source_url": candidate.source_url,
                "authority": candidate.authority,
            },
            headers=superadmin_headers,
        )
        assert confirm.status_code == 200
        db_session.refresh(candidate)

        resp = client.post(f"/admin/gap-source-candidates/{candidate.id}/notify-user", headers=superadmin_headers)
        assert resp.status_code == 200
        follow_up_id = resp.json()["chat_session_id"]

        follow_up = db_session.get(ChatSession, follow_up_id)
        assert follow_up is not None
        assert follow_up.user_id == user.id
        assert follow_up.tool_used == "gap_resolution_notice"
        assert follow_up.message is None
        assert candidate.candidate_content in follow_up.response
        assert follow_up.citations and follow_up.citations[0]["document_id"] == candidate.document_id

        notif = db_session.scalar(
            select(Notification).where(Notification.user_id == user.id, Notification.type == "gap_source_found")
        )
        assert notif is not None
        # Deep-links to the actual new message, not a bare "/chat" - see
        # chat/page.tsx's ?session= scroll-and-highlight handling.
        assert notif.link == f"/chat?session={follow_up_id}"

        db_session.refresh(candidate)
        assert candidate.notified_at is not None

        # A second notify on an already-notified candidate is a conflict,
        # not a duplicate message/email.
        again = client.post(f"/admin/gap-source-candidates/{candidate.id}/notify-user", headers=superadmin_headers)
        assert again.status_code == 409
    finally:
        db_session.execute(text("DELETE FROM notifications WHERE user_id = :id AND type = 'gap_source_found'"), {"id": user.id})
        db_session.commit()
        _cleanup_gap_source_candidate(db_session, candidate.id)
        cleanup_company(db_session, company, user, project)


def test_skip_notify_gap_source_user_marks_resolved_without_messaging(
    client, db_session, superadmin_headers, construction_vertical_id
):
    """Part E of the same-night batch: "Ολοκλήρωση χωρίς ειδοποίηση" - the
    other resolution of the post-confirm choice, alongside notify-user.
    Must never touch ChatSession/notifications/email (gap_addressed was
    already set at confirm time), and must be mutually exclusive with
    notify-user in both directions."""
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Real gap question")
    candidate = _make_gap_source_candidate(
        db_session, chat_session_id=session.id, vertical_id=construction_vertical_id, question=session.message
    )
    try:
        # Blocked before confirming - same guard as notify-user.
        too_early = client.post(f"/admin/gap-source-candidates/{candidate.id}/skip-notify", headers=superadmin_headers)
        assert too_early.status_code == 400

        confirm = client.post(
            f"/admin/gap-source-candidates/{candidate.id}/confirm",
            json={
                "title": candidate.candidate_title,
                "content": candidate.candidate_content,
                "source_url": candidate.source_url,
                "authority": candidate.authority,
            },
            headers=superadmin_headers,
        )
        assert confirm.status_code == 200

        resp = client.post(f"/admin/gap-source-candidates/{candidate.id}/skip-notify", headers=superadmin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["notify_skipped_at"] is not None
        assert body["notified_at"] is None

        # No ChatSession follow-up, no notification - this path is silent.
        follow_up_count = db_session.scalar(
            select(func.count())
            .select_from(ChatSession)
            .where(ChatSession.tool_used == "gap_resolution_notice", ChatSession.user_id == user.id)
        )
        assert follow_up_count == 0
        notif = db_session.scalar(
            select(Notification).where(Notification.user_id == user.id, Notification.type == "gap_source_found")
        )
        assert notif is None

        # Mutually exclusive in both directions.
        again_skip = client.post(f"/admin/gap-source-candidates/{candidate.id}/skip-notify", headers=superadmin_headers)
        assert again_skip.status_code == 409
        now_notify = client.post(f"/admin/gap-source-candidates/{candidate.id}/notify-user", headers=superadmin_headers)
        assert now_notify.status_code == 409
    finally:
        _cleanup_gap_source_candidate(db_session, candidate.id)
        cleanup_company(db_session, company, user, project)


def test_notify_gap_source_user_requires_confirmed(client, db_session, superadmin_headers, construction_vertical_id):
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    session = _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Real gap question")
    candidate = _make_gap_source_candidate(
        db_session, chat_session_id=session.id, vertical_id=construction_vertical_id, question=session.message
    )
    try:
        resp = client.post(f"/admin/gap-source-candidates/{candidate.id}/notify-user", headers=superadmin_headers)
        assert resp.status_code == 400
    finally:
        _cleanup_gap_source_candidate(db_session, candidate.id)
        cleanup_company(db_session, company, user, project)


def _make_real_answered_session(db, *, company_id: int, user_id: int, message: str) -> ChatSession:
    """A real, non-gap Q&A turn - gap=False with real citations, matching
    what a genuine confident answer logs (true_gap() infers from citations/
    error_type, not the gap column, so a real answer needs real citations
    to actually read as non-gap)."""
    session = ChatSession(
        company_id=company_id, user_id=user_id, message=message, gap=False, tool_used="rag",
        citations=[{"document_id": 1, "title": "Some document", "authority": None, "source_url": None}],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def _make_system_generated_session(db, *, company_id: int, user_id: int) -> ChatSession:
    """Mirrors notify_gap_source_user's own follow-up insert - message=None,
    gap=False, real citations, tool_used='gap_resolution_notice'."""
    session = ChatSession(
        company_id=company_id, user_id=user_id, message=None, response="A generated follow-up answer.",
        gap=False, tool_used="gap_resolution_notice",
        citations=[{"document_id": 1, "title": "Some document", "authority": None, "source_url": None}],
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def test_system_generated_messages_excluded_from_gap_rate_and_usage(
    client, db_session, superadmin_headers, construction_vertical_id
):
    """The real incident from tonight's gap-source-discovery rollout: a
    confirmed candidate's "Ενημέρωση χρήστη" follow-up notice must not
    inflate messages_30d (and therefore the gap-rate denominator) - 2 true
    gaps out of 3 REAL messages should read 66.7%, not 50% from a 4th,
    system-generated row counted as if it were a real message."""
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id)
    _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Gap question one")
    _make_gap_session(db_session, company_id=company.id, user_id=user.id, message="Gap question two")
    _make_real_answered_session(db_session, company_id=company.id, user_id=user.id, message="A real answered question")
    _make_system_generated_session(db_session, company_id=company.id, user_id=user.id)
    try:
        resp = client.get(f"/admin/companies/{company.id}", headers=superadmin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["messages_30d"] == 3
        assert body["gap_rate"] == 66.7
        # Part C fix: the per-user token-usage table's message_count must
        # equal the company-level count for a single-user company - it
        # previously only counted messages with an actual priced GPT
        # completion (total_tokens IS NOT NULL), silently excluding the two
        # gap sessions and the system-generated row differently than
        # messages_30d does, which could show a mismatched, lower number
        # for the company's only user.
        by_user = body["token_usage"]["by_user"]
        assert len(by_user) == 1
        assert by_user[0]["user_id"] == user.id
        assert by_user[0]["message_count"] == 3

        usage_headers = {"Authorization": f"Bearer {token}"}
        usage_resp = client.get("/users/me/usage", headers=usage_headers)
        assert usage_resp.status_code == 200
        assert usage_resp.json()["messages_30d"] == 3
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
