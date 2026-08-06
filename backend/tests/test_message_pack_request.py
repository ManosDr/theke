"""POST /subscription/message-pack-request - the lightweight equivalent of
POST /plan-requests for the 200-message top-up pack (see
app/routers/subscription.py). Just fires an admin notification; no
PlanRequest row since a top-up isn't a tier change."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Notification, User, Vertical

from .conftest import cleanup_company, make_company_and_user


def test_message_pack_request_notifies_super_admins(client: TestClient, db_session):
    vertical_id = db_session.scalar(select(Vertical.id).where(Vertical.slug == "construction"))
    company, user, _project, token = make_company_and_user(db_session, vertical_id=vertical_id, region_id=None)
    try:
        resp = client.post(
            "/subscription/message-pack-request",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 204, resp.text

        admin_ids = list(db_session.scalars(select(User.id).where(User.role == "super_admin")))
        assert admin_ids, "expected at least one super_admin to notify"

        notifications = list(
            db_session.scalars(
                select(Notification).where(
                    Notification.type == "message_pack_request", Notification.user_id.in_(admin_ids)
                )
            )
        )
        assert notifications, "expected a message_pack_request notification for a super_admin"
        matching = [n for n in notifications if company.name in n.body]
        assert matching, f"expected a notification body mentioning {company.name}"
    finally:
        # Deliberately in finally, not the try body above: this endpoint
        # fires real Notification rows against whichever real super_admin
        # accounts exist, and an assertion failing above used to skip this
        # cleanup entirely, leaving those notifications permanently in a
        # real admin's inbox - see KNOWN_DECISIONS.md's "Second occurrence
        # of test-write pollution" entry. Re-queries by company.name rather
        # than reusing the try block's `matching` list, since a failure
        # could occur before that list was ever computed.
        for n in db_session.scalars(
            select(Notification).where(
                Notification.type == "message_pack_request", Notification.body.like(f"%{company.name}%")
            )
        ):
            db_session.delete(n)
        db_session.commit()
        cleanup_company(db_session, company, user)
