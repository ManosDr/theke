"""Public/authenticated read for the admin-editable Help page - the actual
content lives in the help_sections table (see admin.py for the CRUD side),
this endpoint just reproduces the same role/vertical filtering the old
hardcoded frontend/app/help/page.tsx component used to do in code."""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Company, HelpSection, Vertical
from app.schemas import HelpSectionPublic

router = APIRouter(tags=["help"])


@router.get("/help-sections", response_model=list[HelpSectionPublic])
async def list_visible_help_sections(
    locale: str = "el",
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> list[HelpSectionPublic]:
    vertical_slug = None
    if user.company_id is not None:
        company = db.get(Company, user.company_id)
        if company and company.vertical_id:
            vertical = db.get(Vertical, company.vertical_id)
            vertical_slug = vertical.slug if vertical else None

    rows = db.scalars(
        select(HelpSection).where(HelpSection.is_active.is_(True)).order_by(HelpSection.display_order, HelpSection.id)
    )
    visible = [
        r
        for r in rows
        if user.role in r.visible_to_roles and (r.vertical_scope is None or r.vertical_scope == vertical_slug)
    ]
    return [
        HelpSectionPublic(
            id=r.id,
            slug=r.slug,
            title=r.title_en if locale == "en" else r.title_el,
            body=r.body_en if locale == "en" else r.body_el,
        )
        for r in visible
    ]
