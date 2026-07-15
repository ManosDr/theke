import os
from datetime import date as date_cls, datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_company_vertical, get_current_user
from app.models import Company, Document, DocumentRemovalRequest, Vertical
from app.schemas import (
    BrowseResponse,
    DocumentDetail,
    DocumentSummary,
    RemovalRequestSummary,
    SourceGroupSummary,
    UploadResponse,
)
from app.services.audit import log_action
from app.services.authorization import can_approve_removal, require_can_upload_documents
from app.services.documents import UPLOAD_DIR, content_hash, extract_text
from app.services.notifications import notify, notify_company_admins, notify_users_by_municipality
from app.services.sources import group_label, source_names_for_group
from app.services.visibility import visible_documents_filter

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_DOCUMENT_BYTES = 25 * 1024 * 1024  # 25MB


# Markers wrapping a matched lexeme in a ts_headline snippet - control
# characters so they never collide with real document text. The frontend
# splits on these to render <mark> without needing dangerouslySetInnerHTML.
HIGHLIGHT_START = ""
HIGHLIGHT_END = ""


def _build_snippet(db: Session, content: str, q: str | None, *, window: int = 280) -> str:
    """A snippet centered on the actual matched lexeme, not just the first
    literal occurrence of `q` - the search itself (`to_tsvector`/
    `plainto_tsquery`) matches on Greek word stems, so a query like "αδειας"
    also matches documents only containing "άδεια"/"αδειών"/etc. A literal
    `content.find(q)` missed those, silently returning an unmarked prefix
    and making highlighting look "random" across result rows. ts_headline
    runs the same tsquery Postgres used to find the row, so the snippet it
    returns is guaranteed to contain (and mark) a real match when one
    exists in the content."""
    if q:
        result = db.execute(
            text("SELECT ts_headline('greek', :content, plainto_tsquery('greek', :q), :options)"),
            {
                "content": content,
                "q": q,
                "options": f"StartSel={HIGHLIGHT_START}, StopSel={HIGHLIGHT_END}, MaxFragments=1, MaxWords=45, MinWords=15",
            },
        ).scalar()
        if result:
            return result
    return content[:window]


def _to_summary(doc: Document, *, with_snippet: bool = True, q: str | None = None, db: Session | None = None) -> DocumentSummary:
    return DocumentSummary(
        id=doc.id,
        title=doc.title,
        snippet=(_build_snippet(db, doc.content, q) if with_snippet and doc.content and db else None),
        source=doc.source,
        doc_type=doc.doc_type,
        municipality=doc.municipality,
        region_id=doc.region_id,
        date=doc.date,
        identifier=doc.identifier,
        series=doc.series,
        issue_number=doc.issue_number,
        source_name=doc.source_name,
        source_group=group_label(doc.source_name) if doc.source_name else None,
        authority=doc.authority,
        content_type=doc.content_type,
        extraction_status=doc.extraction_status,
    )


@router.get("/search", response_model=list[DocumentSummary])
async def search_documents(
    q: str,
    municipality: str | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    vertical: Vertical = Depends(get_company_vertical),
) -> list[DocumentSummary]:
    stmt = (
        select(Document)
        .where(
            text("to_tsvector('greek', coalesce(title, '') || ' ' || coalesce(content, '')) @@ plainto_tsquery('greek', :q)")
        )
        .where(Document.status == "active")
        .where(visible_documents_filter(db, user, vertical.id, municipality=municipality))
        .params(q=q)
        .limit(20)
    )
    results = db.scalars(stmt).all()
    return [_to_summary(doc, q=q, db=db) for doc in results]


@router.get("/sources", response_model=list[SourceGroupSummary])
async def list_sources(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    vertical: Vertical = Depends(get_company_vertical),
) -> list[SourceGroupSummary]:
    """Distinct crawl sources with counts, grouped for the Sources page's
    buttons (e.g. both e-ΕΦΚΑ pages count under one 'e-ΕΦΚΑ' button).
    Public/crawled documents only - source_name is never set on uploads.
    Goes through visible_documents_filter so a region-scoped source (e.g.
    ΔΕΥΑ Καβάλας) only shows up for users whose company has a project there.
    """
    rows = db.execute(
        select(Document.source_name, func.count())
        .where(Document.status == "active", Document.source_name.isnot(None))
        .where(visible_documents_filter(db, user, vertical.id))
        .group_by(Document.source_name)
    ).all()

    counts: dict[str, int] = {}
    for source_name, count in rows:
        group = group_label(source_name)
        counts[group] = counts.get(group, 0) + count

    return [SourceGroupSummary(group=group, count=count) for group, count in sorted(counts.items())]


@router.get("/browse", response_model=BrowseResponse)
async def browse_documents(
    group: str | None = None,
    q: str | None = None,
    doc_type: str | None = None,
    authority: str | None = None,
    content_type: str | None = None,
    region_id: str | None = None,
    date_from: date_cls | None = None,
    date_to: date_cls | None = None,
    municipality: str | None = None,
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    vertical: Vertical = Depends(get_company_vertical),
) -> BrowseResponse:
    """Listing/filtering endpoint behind both the Sources drill-down (filter
    by `group`) and the Search page (any combination of filters, `q` optional
    unlike /search where it's required). needs_review documents never appear
    here regardless of any filter - visible_documents_filter excludes them
    unconditionally (see app/services/visibility.py).
    """
    stmt = (
        select(Document)
        .where(Document.status == "active")
        .where(visible_documents_filter(db, user, vertical.id, municipality=municipality))
    )

    if group:
        names = source_names_for_group(group)
        if not names:
            return BrowseResponse(total=0, items=[])
        stmt = stmt.where(Document.source_name.in_(names))
    if q:
        stmt = stmt.where(
            text("to_tsvector('greek', coalesce(title, '') || ' ' || coalesce(content, '')) @@ plainto_tsquery('greek', :q)")
        ).params(q=q)
    if doc_type:
        stmt = stmt.where(Document.doc_type == doc_type)
    if authority:
        stmt = stmt.where(Document.authority == authority)
    if content_type:
        stmt = stmt.where(Document.content_type == content_type)
    if region_id:
        stmt = stmt.where(Document.region_id == region_id)
    if date_from:
        stmt = stmt.where(Document.date >= date_from)
    if date_to:
        stmt = stmt.where(Document.date <= date_to)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    results = db.scalars(stmt.order_by(Document.date.desc().nullslast()).limit(limit).offset(offset)).all()

    return BrowseResponse(total=total, items=[_to_summary(doc, with_snippet=bool(q), q=q, db=db) for doc in results])


@router.post("/upload", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile,
    replaces_document_id: int | None = Form(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> UploadResponse:
    require_can_upload_documents(user)

    replaced_doc = None
    if replaces_document_id is not None:
        replaced_doc = db.get(Document, replaces_document_id)
        if not replaced_doc or replaced_doc.company_id != user.company_id or replaced_doc.status != "active":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Document to replace was not found in your company's active documents",
            )

    pdf_bytes = await file.read()
    if len(pdf_bytes) > MAX_DOCUMENT_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document must be under 25MB")

    hash_value = content_hash(pdf_bytes)

    if db.scalar(
        select(Document).where(Document.content_hash == hash_value, Document.company_id == user.company_id)
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This exact document is already uploaded")

    text_content = extract_text(pdf_bytes)

    company = db.get(Company, user.company_id)
    municipality = company.name if company and user.company_type == "municipality" else None

    company_dir = os.path.join(UPLOAD_DIR, str(user.company_id))
    os.makedirs(company_dir, exist_ok=True)
    file_path = os.path.join(company_dir, f"{hash_value}.pdf")
    with open(file_path, "wb") as f:
        f.write(pdf_bytes)

    doc = Document(
        title=file.filename,
        doc_type="upload",
        source=file_path,
        content=text_content,
        content_hash=hash_value,
        company_id=user.company_id,
        municipality=municipality,
        uploaded_by=user.user_id,
        replaces_document_id=replaces_document_id,
        vertical_id=company.vertical_id,
    )
    db.add(doc)
    db.flush()

    if replaced_doc is not None:
        replaced_doc.status = "superseded"
        log_action(
            db,
            actor_user_id=user.user_id,
            company_id=user.company_id,
            action="document_edit",
            resource_type="document",
            resource_id=doc.id,
            metadata={"replaces_document_id": replaced_doc.id},
        )
    else:
        log_action(
            db,
            actor_user_id=user.user_id,
            company_id=user.company_id,
            action="document_upload",
            resource_type="document",
            resource_id=doc.id,
        )

    if municipality:
        notify_users_by_municipality(
            db,
            municipality=municipality,
            exclude_company_id=user.company_id,
            type="municipality_content",
            title=f"New content in {municipality}",
            body=doc.title,
            link=f"/documents/{doc.id}",
        )

    db.commit()
    db.refresh(doc)

    return UploadResponse(document_id=doc.id, title=doc.title, municipality=doc.municipality)


def _get_own_active_document(db: Session, user: CurrentUser, document_id: int) -> Document:
    doc = db.get(Document, document_id)
    if not doc or doc.company_id != user.company_id or doc.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found in your company")
    return doc


@router.post("/{document_id}/request-removal", response_model=RemovalRequestSummary, status_code=status.HTTP_201_CREATED)
async def request_removal(
    document_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> RemovalRequestSummary:
    require_can_upload_documents(user)
    doc = _get_own_active_document(db, user, document_id)

    # Admins are the approvers, so their own removal request is auto-decided -
    # there's no one else to approve it. Non-admins (municipality members)
    # need an admin to sign off before anything actually disappears.
    auto_approved = can_approve_removal(user)

    request = DocumentRemovalRequest(
        document_id=doc.id,
        requested_by=user.user_id,
        status="approved" if auto_approved else "pending",
        decided_by=user.user_id if auto_approved else None,
    )
    db.add(request)

    if auto_approved:
        doc.status = "removed"

        request.decided_at = datetime.utcnow()
    else:
        notify_company_admins(
            db,
            company_id=user.company_id,
            type="removal_requested",
            title="Document removal needs your approval",
            body=doc.title,
            link="/dashboard",
        )

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="document_removal_approved" if auto_approved else "document_removal_requested",
        resource_type="document",
        resource_id=doc.id,
    )
    db.commit()
    db.refresh(request)

    return RemovalRequestSummary(
        id=request.id,
        document_id=request.document_id,
        document_title=doc.title,
        requested_by=request.requested_by,
        status=request.status,
        created_at=request.created_at,
    )


@router.get("/removal-requests", response_model=list[RemovalRequestSummary])
async def list_removal_requests(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[RemovalRequestSummary]:
    if not can_approve_removal(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    rows = db.execute(
        select(DocumentRemovalRequest, Document.title)
        .join(Document, Document.id == DocumentRemovalRequest.document_id)
        .where(Document.company_id == user.company_id, DocumentRemovalRequest.status == "pending")
        .order_by(DocumentRemovalRequest.created_at.desc())
    ).all()
    return [
        RemovalRequestSummary(
            id=req.id,
            document_id=req.document_id,
            document_title=title,
            requested_by=req.requested_by,
            status=req.status,
            created_at=req.created_at,
        )
        for req, title in rows
    ]


@router.post("/removal-requests/{request_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_removal(
    request_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    if not can_approve_removal(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    request = db.get(DocumentRemovalRequest, request_id)
    doc = db.get(Document, request.document_id) if request else None
    if not request or not doc or doc.company_id != user.company_id or request.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending removal request not found")


    request.status = "approved"
    request.decided_by = user.user_id
    request.decided_at = datetime.utcnow()
    doc.status = "removed"

    notify(
        db,
        user_id=request.requested_by,
        type="removal_decided",
        title="Your removal request was approved",
        body=doc.title,
        link="/dashboard",
    )

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="document_removal_approved",
        resource_type="document",
        resource_id=doc.id,
    )
    db.commit()


@router.post("/removal-requests/{request_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_removal(
    request_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    if not can_approve_removal(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    request = db.get(DocumentRemovalRequest, request_id)
    doc = db.get(Document, request.document_id) if request else None
    if not request or not doc or doc.company_id != user.company_id or request.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending removal request not found")


    request.status = "rejected"
    request.decided_by = user.user_id
    request.decided_at = datetime.utcnow()

    notify(
        db,
        user_id=request.requested_by,
        type="removal_decided",
        title="Your removal request was rejected",
        body=doc.title,
        link="/dashboard",
    )

    log_action(
        db,
        actor_user_id=user.user_id,
        company_id=user.company_id,
        action="document_removal_rejected",
        resource_type="document",
        resource_id=doc.id,
    )
    db.commit()


# Registered last: a bare "/{document_id}" would otherwise shadow the static
# routes above (/search, /sources, /browse, /upload, /removal-requests) since
# FastAPI matches routes in registration order.
@router.get("/{document_id}", response_model=DocumentDetail)
async def get_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    vertical: Vertical = Depends(get_company_vertical),
) -> DocumentDetail:
    doc = db.get(Document, document_id)
    if not doc or doc.status != "active":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    visible_ids = db.scalars(
        select(Document.id).where(Document.id == document_id).where(visible_documents_filter(db, user, vertical.id))
    ).all()
    if not visible_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    summary = _to_summary(doc, with_snippet=False)
    return DocumentDetail(**summary.model_dump(), content=doc.content)
