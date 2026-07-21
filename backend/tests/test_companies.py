"""GET /companies/me - regression coverage for the CurrentUser.id/user_id
attribute-name bug found during onboarding verification (KNOWN_DECISIONS.md):
the endpoint used `user.id` instead of `user.user_id` when computing
current_user_has_messages/company_has_messages, 500ing for every caller."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Vertical

from .conftest import cleanup_company, make_company_and_user


def test_get_my_company_returns_200(client: TestClient, db_session):
    vertical_id = db_session.scalar(select(Vertical.id).where(Vertical.slug == "construction"))
    company, user, _project, token = make_company_and_user(db_session, vertical_id=vertical_id, region_id=None)
    try:
        resp = client.get("/companies/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == company.id
        assert body["current_user_has_messages"] is False
        assert body["company_has_messages"] is False
    finally:
        cleanup_company(db_session, company, user)
