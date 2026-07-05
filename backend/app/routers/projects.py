from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import CurrentUser, get_current_user
from app.models import Project, Region, UserDefaultProject
from app.schemas import ProjectCreateRequest, ProjectSummary, RegionSummary

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectSummary, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> ProjectSummary:
    if not user.company_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account has no company")

    if payload.region_id and not db.get(Region, payload.region_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown region")

    project = Project(
        company_id=user.company_id,
        name=payload.name,
        municipality=payload.municipality,
        region_id=payload.region_id,
        address=payload.address,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return ProjectSummary(
        id=project.id,
        name=project.name,
        municipality=project.municipality,
        region_id=project.region_id,
        address=project.address,
    )


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
    return [
        ProjectSummary(
            id=p.id,
            name=p.name,
            municipality=p.municipality,
            region_id=p.region_id,
            address=p.address,
            is_default=p.id in default_ids,
        )
        for p in projects
    ]


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


@router.post("/{project_id}/default", status_code=status.HTTP_204_NO_CONTENT)
async def mark_default_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> None:
    project = db.get(Project, project_id)
    if not project or project.company_id != user.company_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found in your company")

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
