from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company, User
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
