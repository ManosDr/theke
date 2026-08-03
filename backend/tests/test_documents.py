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

from sqlalchemy import func, select, text

from app.models import Document, Embedding, Project

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


# Minimal single-page PDF with a real text run, in the format PyMuPDF (fitz)
# happily parses despite the missing/incomplete xref table - extract_text()
# only needs a well-formed content stream, not a spec-perfect file.
def _minimal_pdf(marker: str) -> bytes:
    return f"""%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 612 792]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length 90>>
stream
BT /F1 18 Tf 50 700 Td ({marker}) Tj ET
endstream
endobj
xref
0 6
trailer<</Size 6/Root 1 0 R>>
%%EOF""".encode()


def _embed_and_count_chunks(db_session, doc: Document) -> int:
    """Embeds a single document directly (rather than running the full
    embed_pending_documents() sweep, which would also embed whatever other
    pending documents happen to exist in the shared test database) and
    returns the resulting chunk count."""
    from app.services.embeddings import embed_document

    embed_document(db_session, doc)
    return db_session.scalar(select(func.count(Embedding.id)).where(Embedding.document_id == doc.id))


def test_general_document_upload_sets_extraction_status_and_embeds(client, db_session, construction_vertical_id):
    """Regression test for the bug this session found: POST /documents/upload
    never set Document.extraction_status at all (stayed NULL), which
    permanently disqualified every document uploaded through this endpoint
    from embed_pending_documents()'s eligibility filter (extraction_status ==
    'full_text'), regardless of restarts - real customer documents (a public
    ΦΕΚ law and a municipality's own upload) sat silently unsearchable for
    weeks before this was caught. Covers the actual buggy path; see
    test_document_upload_to_project above for the project-scoped endpoint,
    which already set this correctly and was the reference pattern used to
    fix this one."""
    # role="admin": can_upload_documents (app/services/authorization.py)
    # restricts POST /documents/upload to admins for construction-type
    # companies (member+admin for municipality).
    company, user, _, token = make_company_and_user(db_session, vertical_id=construction_vertical_id, role="admin")
    try:
        marker = f"RegressionMarker{uuid.uuid4().hex[:8]}"
        resp = client.post(
            "/documents/upload",
            files={"file": ("regression-test.pdf", _minimal_pdf(marker), "application/pdf")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 201
        doc_id = resp.json()["document_id"]

        doc = db_session.get(Document, doc_id)
        assert doc.extraction_status == "full_text"
        assert marker in doc.content

        # This endpoint deliberately doesn't embed synchronously (see
        # projects.py's upload_document docstring on why the two upload
        # endpoints differ here) - a document becomes embeddable only via
        # embed_pending_documents()'s eligibility filter, run at backend
        # startup/restart. That filter (active, extraction_status ==
        # "full_text", not needs_review, has content) is exactly what the
        # original bug silently defeated: a NULL extraction_status (what this
        # endpoint used to leave behind) meant the filter's own query would
        # never match the row, restart after restart. Checking the same
        # filter directly here, rather than calling the real sweep function,
        # avoids also embedding whatever other pending documents happen to
        # exist in the shared test database.
        assert doc.status == "active"
        assert doc.needs_review is False

        chunk_count = _embed_and_count_chunks(db_session, doc)
        assert chunk_count > 0
    finally:
        db_session.execute(text("DELETE FROM embeddings WHERE document_id IN (SELECT id FROM documents WHERE company_id = :c)"), {"c": company.id})
        db_session.execute(text("DELETE FROM documents WHERE company_id = :c"), {"c": company.id})
        db_session.commit()
        cleanup_company(db_session, company, user, None)


def test_admin_extraction_status_repair_endpoint(client, db_session, superadmin_headers, construction_vertical_id):
    """Regression coverage for the repair tool built to fix the bug above on
    documents that were already broken before the fix landed (no existing
    endpoint could correct extraction_status on an existing row, or embed it,
    without either a raw DB write or admin impersonation - neither of which
    should be needed for a one-field repair)."""
    doc = Document(
        title=f"Stuck doc {uuid.uuid4().hex[:8]}",
        content="Πραγματικό περιεχόμενο που έμεινε χωρίς extraction_status.",
        vertical_id=construction_vertical_id,
        doc_type="upload",
        status="active",
        extraction_status=None,
    )
    db_session.add(doc)
    db_session.commit()
    try:
        resp = client.patch(
            f"/admin/documents/{doc.id}/extraction-status",
            json={"extraction_status": "full_text"},
            headers=superadmin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["extraction_status"] == "full_text"

        db_session.refresh(doc)
        assert doc.extraction_status == "full_text"

        chunk_count = db_session.scalar(select(func.count(Embedding.id)).where(Embedding.document_id == doc.id))
        assert chunk_count > 0
    finally:
        db_session.execute(text("DELETE FROM embeddings WHERE document_id = :d"), {"d": doc.id})
        db_session.delete(doc)
        db_session.commit()
