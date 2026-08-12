from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import LegalDocResponse, LegalStatusResponse
from app.services.legal_docs import SLUGS, get_legal_doc, get_legal_status

# Unauthenticated - these pages (and the footer/registration checkbox that
# link to them) must work for logged-out visitors, same reasoning as
# companies.py's public_router for the logo.
router = APIRouter(prefix="/legal", tags=["legal"])


@router.get("/status", response_model=LegalStatusResponse)
async def legal_status(db: Session = Depends(get_db)) -> LegalStatusResponse:
    return LegalStatusResponse(**get_legal_status(db))


@router.get("/{slug}", response_model=LegalDocResponse)
async def legal_doc(slug: str, db: Session = Depends(get_db)) -> LegalDocResponse:
    if slug not in SLUGS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    return LegalDocResponse(**get_legal_doc(db, slug))
