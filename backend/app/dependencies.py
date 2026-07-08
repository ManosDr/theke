from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company, User, Vertical
from app.security import decode_access_token

bearer_scheme = HTTPBearer()


@dataclass
class CurrentUser:
    user_id: int
    company_id: int | None
    role: str
    company_type: str | None


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    try:
        payload = decode_access_token(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    # Re-read user/company from the DB on every request (not just at login)
    # so revocation and role changes take effect immediately, and a
    # suspended company locks out its users right away, instead of waiting
    # up to access_token_expire_minutes for the old JWT to expire.
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account is inactive")

    company_type = None
    if user.company_id is not None:
        company = db.get(Company, user.company_id)
        if company and company.is_suspended:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company access suspended")
        company_type = company.type if company else None

    return CurrentUser(
        user_id=user.id,
        company_id=user.company_id,
        role=user.role,
        company_type=company_type,
    )


def get_company_vertical(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Vertical:
    """The vertical (construction, tax_accounting, ...) of the current
    user's company. Used by chat, search, and admin endpoints to scope
    which documents are visible and which system prompt/disclaimer applies.
    Raises 403 for a super_admin (company_id is None) or a company whose
    vertical_id somehow doesn't resolve - both endpoints requiring a
    vertical assume the caller belongs to exactly one company/vertical,
    never a platform-wide account."""
    if user.company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This endpoint requires a company account")
    company = db.get(Company, user.company_id)
    vertical = db.get(Vertical, company.vertical_id) if company else None
    if not vertical:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company has no assigned vertical")
    return vertical
