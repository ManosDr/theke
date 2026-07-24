import os
from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_company_vertical, get_current_user
from app.models import Company, Customer, Document, Embedding, Plan, Project, Region, UserDefaultProject, Vertical
from app.schemas import (
    ProjectCreateRequest,
    ProjectDocumentSummary,
    ProjectDocumentUploadResult,
    ProjectSummary,
    RegionSummary,
    UpdatePlotInPlanRequest,
    UpdateProjectLocationRequest,
    UpdateProjectMetadataRequest,
)
from app.services.documents import (
    SUPPORTED_PROJECT_UPLOAD_EXTENSIONS,
    UPLOAD_DIR,
    content_hash,
    extract_text,
)
from app.services.embeddings import embed_document
from app.services.subscription import check_project_client_limit, get_or_create_subscription

router = APIRouter(prefix="/projects", tags=["projects"])

MAX_PROJECT_DOCUMENT_BYTES = 10 * 1024 * 1024  # 10MB


def _to_project_summary(db: Session, p: Project, is_default: bool) -> ProjectSummary:
    # customer_name/customer_afm prefer the live Customer record over the
    # freeform snapshot fields when customer_id is set - same preference
    # order the project detail page already applies client-side
    # (customerDetail?.name || project.customer_name). Exposed here too so
    # the chat context switcher can search/display real customer name+AFM
    # without a per-project follow-up call.
    customer = db.get(Customer, p.customer_id) if p.customer_id else None
    return ProjectSummary(
        id=p.id,
        name=p.name,
        municipality=p.municipality,
        region_id=p.region_id,
        address=p.address,
        is_default=is_default,
        is_client=p.is_client,
        client_notes=p.client_notes,
        customer_id=p.customer_id,
        customer_name=customer.name if customer else p.customer_name,
        customer_afm=customer.afm if customer else None,
        customer_notes=p.customer_notes,
        plot_address=p.plot_address,
        plot_municipality=p.plot_municipality,
        lat=float(p.lat) if p.lat is not None else None,
        lon=float(p.lon) if p.lon is not None else None,
        kaek=p.kaek,
        plot_area_sqm=float(p.plot_area_sqm) if p.plot_area_sqm is not None else None,
        gis_zone_name=p.gis_zone_name,
        gis_zone_source=p.gis_zone_source,
        archaeological_flag=p.archaeological_flag,
        archaeological_notes=p.archaeological_notes,
        archaeological_notes_en=p.archaeological_notes_en,
        archaeological_site_name=p.archaeological_site_name,
        archaeological_distance_m=p.archaeological_distance_m,
        plot_in_plan=p.plot_in_plan,
        location_resolved_at=p.location_resolved_at,
    )


@router.post("", response_model=ProjectSummary, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    vertical: Vertical = Depends(get_company_vertical),
) -> ProjectSummary:
    if not user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account has no company")

    company = db.get(Company, user.company_id)
    sub = get_or_create_subscription(db, company)
    plan = db.get(Plan, sub.plan_id)
    limit_block = check_project_client_limit(db, company, plan)
    if limit_block:
        return JSONResponse(status_code=status.HTTP_402_PAYMENT_REQUIRED, content=limit_block)

    if vertical.uses_regional_scoping and not payload.region_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A region is required for projects in the construction vertical",
        )
    if payload.region_id and not db.get(Region, payload.region_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown region")
    if payload.customer_id is not None:
        _require_customer_membership(db, user, payload.customer_id)

    project = Project(
        company_id=user.company_id,
        name=payload.name,
        municipality=payload.municipality,
        region_id=payload.region_id,
        address=payload.address,
        # A tax-vertical project is always a client engagement (no other
        # kind of project exists in that vertical yet); construction stays
        # opt-in via the region requirement above being the real gate on
        # what "project" means there.
        is_client=not vertical.uses_regional_scoping,
        client_notes=payload.client_notes,
        # customer_id (a real, reusable contact record) takes precedence
        # over the freeform customer_name/customer_notes pair when both are
        # given - it's the authoritative link; the freeform fields remain
        # available for a one-off customer that isn't worth creating a
        # record for.
        customer_id=payload.customer_id,
        customer_name=payload.customer_name,
        customer_notes=payload.customer_notes,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return _to_project_summary(db, project, is_default=False)


@router.get("", response_model=list[ProjectSummary])
async def list_projects(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[ProjectSummary]:
    if not user.company_id:
        return []

    projects = db.scalars(select(Project).where(Project.company_id == user.company_id)).all()
    default_ids = set(
        db.scalars(select(UserDefaultProject.project_id).where(UserDefaultProject.user_id == user.user_id)).all()
    )
    return [_to_project_summary(db, p, is_default=p.id in default_ids) for p in projects]


@router.get("/regions", response_model=list[RegionSummary])
async def list_regions(db: Session = Depends(get_db)) -> list[RegionSummary]:
    """Powers the project-creation form's municipality dropdown - any region
    on record (even 'pending' ones, since a project can exist before that
    region's KB coverage is complete)."""
    regions = db.scalars(select(Region).order_by(Region.region_name_el)).all()
    return [
        RegionSummary(
            region_id=r.region_id,
            region_name_el=r.region_name_el,
            region_name_en=r.region_name_en,
            level=r.level,
            status=r.status,
            has_coefficient_data=r.has_coefficient_data,
            has_zone_level_coefficient_text=r.has_zone_level_coefficient_text,
        )
        for r in regions
    ]


@router.get("/{project_id}", response_model=ProjectSummary)
async def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProjectSummary:
    project = _require_project_membership(db, user, project_id)
    default_ids = set(
        db.scalars(select(UserDefaultProject.project_id).where(UserDefaultProject.user_id == user.user_id))
    )
    return _to_project_summary(db, project, is_default=project.id in default_ids)


@router.patch("/{project_id}", response_model=ProjectSummary)
async def update_project(
    project_id: int,
    payload: UpdateProjectMetadataRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProjectSummary:
    """Edits the project's own metadata (name, customer details) - separate
    from PATCH /{project_id}/location, which only ever touches GIS fields."""
    project = _require_project_membership(db, user, project_id)
    if payload.customer_id is not None:
        _require_customer_membership(db, user, payload.customer_id)

    project.name = payload.name
    project.customer_id = payload.customer_id
    project.customer_name = payload.customer_name
    project.customer_notes = payload.customer_notes
    project.client_notes = payload.client_notes
    db.commit()
    db.refresh(project)

    default_ids = set(
        db.scalars(select(UserDefaultProject.project_id).where(UserDefaultProject.user_id == user.user_id))
    )
    return _to_project_summary(db, project, is_default=project.id in default_ids)


@router.post("/{project_id}/default", status_code=status.HTTP_204_NO_CONTENT)
async def mark_default_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Sets THE default project for this user - clears any other pin(s)
    first, so a user never ends up with more than one at a time. The chat
    page's initial-load logic (and now the chat context card's own
    "Αλλαγή/Ορισμός προεπιλογής" actions) both assume exactly one default,
    so this enforces that invariant here rather than relying on every
    caller to unmark the old one first."""
    project = db.get(Project, project_id)
    if not project or project.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found in your company")

    db.query(UserDefaultProject).filter(
        UserDefaultProject.user_id == user.user_id, UserDefaultProject.project_id != project_id
    ).delete()
    if not db.get(UserDefaultProject, (user.user_id, project_id)):
        db.add(UserDefaultProject(user_id=user.user_id, project_id=project_id))
    db.commit()


@router.delete("/{project_id}/default", status_code=status.HTTP_204_NO_CONTENT)
async def unmark_default_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    link = db.get(UserDefaultProject, (user.user_id, project_id))
    if link:
        db.delete(link)
        db.commit()


def _require_project_membership(db: Session, user: CurrentUser, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if not project or project.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found in your company")
    return project


def _require_customer_membership(db: Session, user: CurrentUser, customer_id: int) -> Customer:
    customer = db.get(Customer, customer_id)
    if not customer or customer.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found in your company")
    return customer


@router.post("/{project_id}/documents/upload", response_model=list[ProjectDocumentUploadResult])
async def upload_project_documents(
    project_id: int,
    files: list[UploadFile],
    upload_scope: str = Form(default="project"),
    source_url: str | None = Form(default=None),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    vertical: Vertical = Depends(get_company_vertical),
) -> list[ProjectDocumentUploadResult]:
    """Client/project-scoped uploads (e.g. a tax client's records, or a
    specific building's plans) - private to this project, never returned by
    a general (no-project) chat/search query, only when a request is
    explicitly scoped to project_id (see visible_documents_filter). Unlike
    the public-KB /documents/upload, embeddings are generated immediately
    here rather than left for the backfill sweep, since a client expects to
    ask about a document right after uploading it, not on the next sweep.

    `upload_scope` picks where in the document.project_id/customer_id
    hierarchy the upload lands - 'project' (default, this project only),
    'customer' (every project belonging to the same customer - only valid
    when this project actually has one), or 'company' (the whole company's
    general KB, equivalent to POST /documents/upload). See
    visible_documents_filter() for how each tier is surfaced back at
    chat/search time. Named distinctly from Document.scope (the unrelated
    'national'/'regional'/'project' KB-tier column set below) - the two used
    to share the name "scope", which was confusing enough in practice to be
    worth the rename.

    `source_url` is optional and only meaningful when upload_scope='company'
    - the external page (law, ΦΕΚ, guidance) this note interprets, if the
    uploader identifies one. Silently ignored for 'project'/'customer'
    scope, which stay out of the staleness-check feature this field enables
    (see Document.reference_url and crawler/crawler/company_doc_staleness.py).
    """
    project = _require_project_membership(db, user, project_id)
    if upload_scope not in ("project", "customer", "company"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="upload_scope must be 'project', 'customer', or 'company'"
        )
    if upload_scope == "customer" and project.customer_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This project has no linked customer to scope the document to",
        )

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    results: list[ProjectDocumentUploadResult] = []

    for file in files:
        filename = file.filename or "upload"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in SUPPORTED_PROJECT_UPLOAD_EXTENSIONS:
            results.append(
                ProjectDocumentUploadResult(
                    filename=filename,
                    document_id=None,
                    extraction_status="manual_entry_pending",
                    chunk_count=0,
                    error=f"Unsupported file type '.{ext}' - use PDF, DOCX, or TXT",
                )
            )
            continue

        file_bytes = await file.read()
        if len(file_bytes) > MAX_PROJECT_DOCUMENT_BYTES:
            results.append(
                ProjectDocumentUploadResult(
                    filename=filename,
                    document_id=None,
                    extraction_status="manual_entry_pending",
                    chunk_count=0,
                    error="File exceeds the 10MB limit",
                )
            )
            continue

        try:
            text_content = extract_text(file_bytes, filename)
            extraction_status = "full_text" if text_content.strip() else "manual_entry_pending"
        except Exception as exc:  # noqa: BLE001 - any parser failure degrades to a stub, not a 500
            text_content = None
            extraction_status = "manual_entry_pending"
            error_message = str(exc)
        else:
            error_message = None

        hash_value = content_hash(file_bytes)
        company_dir = os.path.join(UPLOAD_DIR, str(user.company_id), "projects", str(project_id))
        os.makedirs(company_dir, exist_ok=True)
        file_path = os.path.join(company_dir, f"{hash_value}_{filename}")
        with open(file_path, "wb") as f:
            f.write(file_bytes)

        doc = Document(
            title=filename,
            doc_type="upload",
            source=file_path,
            content=text_content,
            content_hash=hash_value,
            company_id=user.company_id,
            uploaded_by=user.user_id,
            vertical_id=vertical.id,
            project_id=project.id if upload_scope == "project" else None,
            customer_id=project.customer_id if upload_scope == "customer" else None,
            scope="project",  # Document.scope: third valid value alongside 'national'/'regional' - see db/init.sql
            extraction_status=extraction_status,
            reference_url=source_url.strip() if upload_scope == "company" and source_url and source_url.strip() else None,
        )
        db.add(doc)
        db.flush()

        chunk_count = 0
        if extraction_status == "full_text":
            chunk_count = embed_document(db, doc)

        results.append(
            ProjectDocumentUploadResult(
                filename=filename,
                document_id=doc.id,
                extraction_status=extraction_status,
                chunk_count=chunk_count,
                error=error_message,
            )
        )

    db.commit()
    return results


@router.get("/{project_id}/documents", response_model=list[ProjectDocumentSummary])
async def list_project_documents(
    project_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[ProjectDocumentSummary]:
    """This project's own uploads, plus (when the project has a linked
    customer) that customer's cross-project uploads too - the same two
    tiers visible_documents_filter() surfaces at chat time, so what a user
    sees listed here matches what the assistant can actually cite. Does NOT
    include company-wide uploads (scope='company') - those belong to the
    general KB document list, not a specific project's document tab."""
    project = _require_project_membership(db, user, project_id)

    scope_condition = Document.project_id == project_id
    if project.customer_id is not None:
        scope_condition = scope_condition | (
            (Document.customer_id == project.customer_id) & Document.project_id.is_(None)
        )

    rows = db.execute(
        select(Document, func.count(Embedding.id))
        .outerjoin(Embedding, Embedding.document_id == Document.id)
        .where(scope_condition, Document.status == "active")
        .group_by(Document.id)
        .order_by(Document.created_at.desc())
    ).all()
    return [
        ProjectDocumentSummary(
            id=doc.id,
            title=doc.title,
            extraction_status=doc.extraction_status,
            created_at=doc.created_at,
            chunk_count=chunk_count,
            doc_scope="project" if doc.project_id == project_id else "customer",
        )
        for doc, chunk_count in rows
    ]


@router.delete("/{project_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_document(
    project_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    """Removes a project- or customer-scoped document and its embeddings (ON
    DELETE CASCADE on embeddings.document_id) - never touches public KB or
    company-wide documents, since this only ever looks up rows matching this
    project's own project_id or (when linked) its customer_id."""
    project = _require_project_membership(db, user, project_id)

    doc = db.get(Document, document_id)
    is_own_project_doc = doc and doc.project_id == project_id
    is_own_customer_doc = (
        doc and project.customer_id is not None and doc.customer_id == project.customer_id and doc.project_id is None
    )
    if not doc or not (is_own_project_doc or is_own_customer_doc):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found in this project")

    db.delete(doc)
    db.commit()


@router.patch("/{project_id}/location", response_model=ProjectSummary)
async def update_project_location(
    project_id: int,
    payload: UpdateProjectLocationRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProjectSummary:
    """Persists a resolved location onto a project - the frontend calls
    POST /gis/resolve-location first to get address/cadastral/zone/
    archaeological info for a dropped pin, then this to save it. Kept as a
    separate step (not folded into resolve-location) so a user can preview a
    pin before committing it to the project."""
    project = _require_project_membership(db, user, project_id)

    project.lat = payload.lat
    project.lon = payload.lon
    project.plot_address = payload.plot_address
    project.plot_municipality = payload.plot_municipality
    project.kaek = payload.kaek
    project.plot_area_sqm = payload.plot_area_sqm
    project.parcel_geometry = payload.parcel_geometry
    project.gis_zone_name = payload.gis_zone_name
    project.gis_zone_source = payload.gis_zone_source
    project.archaeological_flag = payload.archaeological_flag
    project.archaeological_notes = payload.archaeological_notes
    project.archaeological_site_name = payload.archaeological_site_name
    project.archaeological_distance_m = payload.archaeological_distance_m
    project.plot_in_plan = payload.plot_in_plan
    project.location_resolved_at = datetime.utcnow()
    db.commit()
    db.refresh(project)

    default_project_ids = set(
        db.scalars(select(UserDefaultProject.project_id).where(UserDefaultProject.user_id == user.user_id))
    )
    return _to_project_summary(db, project, is_default=project.id in default_project_ids)


@router.patch("/{project_id}/plot-in-plan", response_model=ProjectSummary)
async def update_plot_in_plan(
    project_id: int,
    payload: UpdatePlotInPlanRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProjectSummary:
    """Standalone endpoint for correcting εντός/εκτός σχεδίου after the
    fact (the project detail page's inline-editable badge) - separate from
    PATCH /{project_id}/location so fixing this one field doesn't require
    re-sending the entire resolved-location payload."""
    project = _require_project_membership(db, user, project_id)

    project.plot_in_plan = payload.plot_in_plan
    db.commit()
    db.refresh(project)

    default_project_ids = set(
        db.scalars(select(UserDefaultProject.project_id).where(UserDefaultProject.user_id == user.user_id))
    )
    return _to_project_summary(db, project, is_default=project.id in default_project_ids)
