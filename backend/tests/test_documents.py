"""Section 1.6 - Document lifecycle tests.

Three corrections to the test plan, made after reading the real code:
  - test_mark_superseded_requires_confirmed / test_mark_reviewed_requires_
    confirmed: `confirmed` is a required (no-default) bool field on both
    request schemas (MarkSupersededRequest, MarkReviewedRequest in
    app/schemas.py). Pydantic itself rejects a request body that OMITS the
    field with 422 - which is what the plan's expected 422 actually
    requires. Sending `"confirmed": false` explicitly is valid input and
    reaches the endpoint's own check instead, which returns 400, not 422.
    Both are tested below, at the assertion each applies to.
  - test_document_upload_to_project: the real endpoint declares no
    explicit status_code, so it defaults to 200, not 201.
  - test_document_upload_wrong_company_project: _require_project_membership
    (app/routers/projects.py) returns 404 ("Project not found in your
    company") for a project belonging to a different company - there's no
    separate 403 case, unlike the plan's assumption.
"""

import uuid

from app.models import Document, Project

from .conftest import cleanup_company, make_company_and_user


def test_mark_superseded_requires_confirmed(client, db_session, superadmin_headers, construction_vertical_id):
    old_doc = Document(
        title=f"Confirm-gate test {uuid.uuid4().hex[:8]}",
        content="Δοκιμαστικό περιεχόμενο.",
        status="active",
        scope="national",
        vertical_id=construction_vertical_id,
    )
    new_doc = Document(
        title=f"Confirm-gate replacement {uuid.uuid4().hex[:8]}",
        content="Νέο δοκιμαστικό περιεχόμενο.",
        status="active",
        scope="national",
        vertical_id=construction_vertical_id,
    )
    db_session.add_all([old_doc, new_doc])
    db_session.commit()
    try:
        # confirmed omitted entirely -> Pydantic 422 (matches the plan).
        resp = client.post(
            f"/admin/documents/{old_doc.id}/mark-superseded",
            json={"replaced_by_document_id": new_doc.id},
            headers=superadmin_headers,
        )
        assert resp.status_code == 422

        # confirmed explicitly false -> valid input, endpoint's own gate -> 400.
        resp2 = client.post(
            f"/admin/documents/{old_doc.id}/mark-superseded",
            json={"replaced_by_document_id": new_doc.id, "confirmed": False},
            headers=superadmin_headers,
        )
        assert resp2.status_code == 400

        db_session.refresh(old_doc)
        assert old_doc.status == "active"
    finally:
        db_session.delete(old_doc)
        db_session.delete(new_doc)
        db_session.commit()


def test_mark_superseded_sets_status(client, db_session, superadmin_headers, construction_vertical_id):
    old_doc = Document(
        title=f"Real supersede test {uuid.uuid4().hex[:8]}",
        content="Δοκιμαστικό περιεχόμενο προς αντικατάσταση.",
        status="active",
        scope="national",
        vertical_id=construction_vertical_id,
    )
    new_doc = Document(
        title=f"Real supersede replacement {uuid.uuid4().hex[:8]}",
        content="Νέο περιεχόμενο.",
        status="active",
        scope="national",
        vertical_id=construction_vertical_id,
    )
    db_session.add_all([old_doc, new_doc])
    db_session.commit()
    try:
        resp = client.post(
            f"/admin/documents/{old_doc.id}/mark-superseded",
            json={"replaced_by_document_id": new_doc.id, "confirmed": True},
            headers=superadmin_headers,
        )
        assert resp.status_code == 200
        db_session.refresh(old_doc)
        db_session.refresh(new_doc)
        assert old_doc.status == "superseded"
        assert new_doc.replaces_document_id == old_doc.id
    finally:
        # new_doc.replaces_document_id still points at old_doc - delete
        # new_doc first (own commit) or the FK blocks deleting old_doc.
        db_session.delete(new_doc)
        db_session.commit()
        db_session.delete(old_doc)
        db_session.commit()


def test_undo_supersede(client, db_session, superadmin_headers, construction_vertical_id):
    old_doc = Document(
        title=f"Undo test {uuid.uuid4().hex[:8]}",
        content="Δοκιμαστικό περιεχόμενο undo.",
        status="active",
        scope="national",
        vertical_id=construction_vertical_id,
    )
    new_doc = Document(
        title=f"Undo replacement {uuid.uuid4().hex[:8]}",
        content="Νέο περιεχόμενο undo.",
        status="active",
        scope="national",
        vertical_id=construction_vertical_id,
    )
    db_session.add_all([old_doc, new_doc])
    db_session.commit()
    try:
        client.post(
            f"/admin/documents/{old_doc.id}/mark-superseded",
            json={"replaced_by_document_id": new_doc.id, "confirmed": True},
            headers=superadmin_headers,
        )
        resp = client.post(
            f"/admin/documents/{old_doc.id}/undo-supersede",
            json={"confirmed": True},
            headers=superadmin_headers,
        )
        assert resp.status_code == 200
        db_session.refresh(old_doc)
        db_session.refresh(new_doc)
        assert old_doc.status == "active"
        assert new_doc.replaces_document_id is None
    finally:
        db_session.delete(old_doc)
        db_session.delete(new_doc)
        db_session.commit()


def test_mark_reviewed_requires_confirmed(client, db_session, superadmin_headers, construction_vertical_id):
    doc = Document(
        title=f"Mark-reviewed confirm-gate test {uuid.uuid4().hex[:8]}",
        content="Δοκιμαστικό περιεχόμενο needs_review.",
        status="active",
        scope="national",
        needs_review=True,
        vertical_id=construction_vertical_id,
    )
    db_session.add(doc)
    db_session.commit()
    try:
        resp = client.post(f"/admin/stale-documents/{doc.id}/mark-reviewed", json={}, headers=superadmin_headers)
        assert resp.status_code == 422

        resp2 = client.post(
            f"/admin/stale-documents/{doc.id}/mark-reviewed", json={"confirmed": False}, headers=superadmin_headers
        )
        assert resp2.status_code == 400

        db_session.refresh(doc)
        assert doc.needs_review is True
    finally:
        db_session.delete(doc)
        db_session.commit()


def test_mark_reviewed_clears_flag(client, db_session, superadmin_headers, construction_vertical_id):
    doc = Document(
        title=f"Mark-reviewed clear test {uuid.uuid4().hex[:8]}",
        content="Δοκιμαστικό περιεχόμενο needs_review.",
        status="active",
        scope="national",
        needs_review=True,
        vertical_id=construction_vertical_id,
    )
    db_session.add(doc)
    db_session.commit()
    try:
        resp = client.post(
            f"/admin/stale-documents/{doc.id}/mark-reviewed", json={"confirmed": True}, headers=superadmin_headers
        )
        assert resp.status_code == 204
        db_session.refresh(doc)
        assert doc.needs_review is False
    finally:
        db_session.delete(doc)
        db_session.commit()


def test_document_upload_to_project(client, db_session, construction_vertical_id):
    # region_id is otherwise irrelevant here - passed only so
    # make_company_and_user actually creates a Project row.
    company, user, project, token = make_company_and_user(db_session, vertical_id=construction_vertical_id, region_id="kavala")
    try:
        resp = client.post(
            f"/projects/{project.id}/documents/upload",
            files={"files": ("test-upload.txt", b"Test project document content.", "text/plain")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        result = resp.json()[0]
        assert result["extraction_status"] in ("full_text", "manual_entry_pending")
        assert result["document_id"] is not None
        if result["extraction_status"] == "full_text":
            assert result["chunk_count"] > 0

        doc = db_session.get(Document, result["document_id"])
        assert doc.project_id == project.id
    finally:
        from sqlalchemy import text

        db_session.execute(text("DELETE FROM embeddings WHERE document_id IN (SELECT id FROM documents WHERE project_id = :p)"), {"p": project.id})
        db_session.execute(text("DELETE FROM documents WHERE project_id = :p"), {"p": project.id})
        db_session.commit()
        cleanup_company(db_session, company, user, project)


def test_document_upload_wrong_company_project(client, db_session, construction_vertical_id):
    company_a, user_a, project_a, token_a = make_company_and_user(db_session, vertical_id=construction_vertical_id, region_id="kavala")
    company_b, user_b, project_b, token_b = make_company_and_user(db_session, vertical_id=construction_vertical_id, region_id="xanthi")
    try:
        resp = client.post(
            f"/projects/{project_a.id}/documents/upload",
            files={"files": ("test-upload.txt", b"Should not be allowed.", "text/plain")},
            headers={"Authorization": f"Bearer {token_b}"},
        )
        assert resp.status_code == 404
    finally:
        cleanup_company(db_session, company_a, user_a, project_a)
        cleanup_company(db_session, company_b, user_b, project_b)
