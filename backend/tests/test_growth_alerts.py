"""check_company_count_thresholds - regression coverage for the one-time
"revisit when N companies" super-admin alert (see
app/services/growth_alerts.py). Patches COMPANY_COUNT_THRESHOLDS locally to a
threshold guaranteed to be freshly crossed by this test's own throwaway
company, rather than depending on the real "3" (which may already have an
"already notified" row from actual dev-DB activity)."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import CompanyCountThresholdAlert, Notification, User, Vertical
from app.services import growth_alerts

from .conftest import cleanup_company, make_company_and_user


def test_check_company_count_thresholds_fires_once(client: TestClient, db_session, monkeypatch):
    vertical_id = db_session.scalar(select(Vertical.id).where(Vertical.slug == "construction"))
    company, user, _project, _token = make_company_and_user(db_session, vertical_id=vertical_id, region_id=None)
    threshold = None
    try:
        baseline = growth_alerts.real_active_company_count(db_session)
        threshold = baseline - 1  # already crossed by the company just created above
        monkeypatch.setattr(growth_alerts, "COMPANY_COUNT_THRESHOLDS", [threshold])

        admin_ids = list(
            db_session.scalars(select(User.id).where(User.role == "super_admin", User.is_active.is_(True)))
        )
        assert admin_ids, "expected at least one active super_admin to notify"

        growth_alerts.check_company_count_thresholds(db_session)
        growth_alerts.check_company_count_thresholds(db_session)  # must not double-fire

        alerts = list(
            db_session.scalars(
                select(CompanyCountThresholdAlert).where(CompanyCountThresholdAlert.threshold == threshold)
            )
        )
        assert len(alerts) == 1

        notifications = list(
            db_session.scalars(
                select(Notification).where(
                    Notification.type == "company_count_threshold", Notification.user_id.in_(admin_ids)
                )
            )
        )
        matching = [n for n in notifications if f"> {threshold}" in n.title]
        assert len(matching) == len(admin_ids), "expected exactly one notification per super_admin, not repeated"
    finally:
        # Deliberately in finally, not the try body above: this call fires
        # real Notification rows against whichever real super_admin
        # accounts exist (not the throwaway company/user), and an
        # assertion failing above used to skip this cleanup entirely,
        # leaving those notifications permanently in a real admin's inbox -
        # the exact same failure shape documented in KNOWN_DECISIONS.md's
        # "Second occurrence of test-write pollution" entry. Re-queries
        # rather than reusing the try block's local variables, since a
        # failure could occur before either was ever assigned.
        if threshold is not None:
            for n in db_session.scalars(
                select(Notification).where(
                    Notification.type == "company_count_threshold", Notification.title.like(f"%> {threshold}%")
                )
            ):
                db_session.delete(n)
            for a in db_session.scalars(
                select(CompanyCountThresholdAlert).where(CompanyCountThresholdAlert.threshold == threshold)
            ):
                db_session.delete(a)
            db_session.commit()
        cleanup_company(db_session, company, user)
