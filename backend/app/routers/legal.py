from fastapi import APIRouter, HTTPException, status

from app.schemas import LegalDocResponse, LegalStatusResponse
from app.services.legal_docs import LEGAL_DOCS, get_legal_doc, get_legal_status

# Unauthenticated - these pages (and the footer/registration checkbox that
# link to them) must work for logged-out visitors, same reasoning as
# companies.py's public_router for the logo.
router = APIRouter(prefix="/legal", tags=["legal"])


@router.get("/status", response_model=LegalStatusResponse)
async def legal_status() -> LegalStatusResponse:
    return LegalStatusResponse(**get_legal_status())


@router.get("/{slug}", response_model=LegalDocResponse)
async def legal_doc(slug: str) -> LegalDocResponse:
    if slug not in LEGAL_DOCS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown legal document")
    return LegalDocResponse(**get_legal_doc(slug))
