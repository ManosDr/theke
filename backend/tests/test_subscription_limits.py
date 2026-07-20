"""Project/client count enforcement (Plan.project_limit / Plan.client_limit),
checked in POST /projects via check_project_client_limit
(app/services/subscription.py). Starter plans carry a real limit;
Professional/Business/beta have it NULL (unlimited) - see db/init.sql's
per-slug seed values."""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import CompanySubscription, Plan, Project, Vertical
from app.security import create_access_token

from .conftest import cleanup_company, make_company_and_user


def _assign_plan(db, company_id: int, plan_slug: str) -> None:
    plan_id = db.scalar(select(Plan.id).where(Plan.slug == plan_slug))
    assert plan_id, f"plan {plan_slug} not seeded"
    sub = CompanySubscription(company_id=company_id, plan_id=plan_id, status="active")
    db.add(sub)
    db.commit()


def test_starter_project_limit_blocks_at_11th(client: TestClient, db_session):
    vertical_id = db_session.scalar(select(Vertical.id).where(Vertical.slug == "construction"))
    company, user, _project, token = make_company_and_user(db_session, vertical_id=vertical_id, region_id=None)
    try:
        _assign_plan(db_session, company.id, "construction-starter")

        # Seed 10 projects directly (construction-starter's project_limit) -
        # the 11th is the one under test, so it doesn't need 10 real HTTP
        # round-trips first.
        for i in range(10):
            db_session.add(Project(company_id=company.id, name=f"Project {i}", region_id="kavala"))
        db_session.commit()

        resp = client.post(
            "/projects",
            json={"name": "Project 11", "municipality": "Καβάλα", "region_id": "kavala"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 402, resp.text
        body = resp.json()
        assert body["upgrade_required"] is True
        assert "όριο έργων" in body["detail"]

        # Confirm no 11th project was actually created.
        remaining = list(db_session.scalars(select(Project).where(Project.company_id == company.id)))
        assert len(remaining) == 10
    finally:
        for p in db_session.scalars(select(Project).where(Project.company_id == company.id)):
            db_session.delete(p)
        db_session.commit()
        cleanup_company(db_session, company, user)


def test_professional_no_project_limit_at_15_plus(client: TestClient, db_session):
    vertical_id = db_session.scalar(select(Vertical.id).where(Vertical.slug == "construction"))
    company, user, _project, token = make_company_and_user(db_session, vertical_id=vertical_id, region_id=None)
    try:
        _assign_plan(db_session, company.id, "construction-professional")

        for i in range(15):
            db_session.add(Project(company_id=company.id, name=f"Project {i}", region_id="kavala"))
        db_session.commit()

        resp = client.post(
            "/projects",
            json={"name": "Project 16", "municipality": "Καβάλα", "region_id": "kavala"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201, resp.text
    finally:
        for p in db_session.scalars(select(Project).where(Project.company_id == company.id)):
            db_session.delete(p)
        db_session.commit()
        cleanup_company(db_session, company, user)


def test_starter_client_limit_blocks_at_21st(client: TestClient, db_session):
    """Same enforcement, tax vertical's client_limit field this time -
    every tax-vertical project is a client engagement (is_client=True), so
    counting is_client=True projects is what client_limit measures."""
    vertical_id = db_session.scalar(select(Vertical.id).where(Vertical.slug == "tax_accounting"))
    company, user, _project, token = make_company_and_user(
        db_session, vertical_id=vertical_id, company_type="tax_accounting", region_id=None
    )
    try:
        _assign_plan(db_session, company.id, "tax-starter")

        for i in range(20):
            db_session.add(Project(company_id=company.id, name=f"Client {i}", is_client=True))
        db_session.commit()

        resp = client.post(
            "/projects",
            json={"name": "Client 21"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 402, resp.text
        body = resp.json()
        assert body["upgrade_required"] is True
        assert "όριο πελατών" in body["detail"]
    finally:
        for p in db_session.scalars(select(Project).where(Project.company_id == company.id)):
            db_session.delete(p)
        db_session.commit()
        cleanup_company(db_session, company, user)
