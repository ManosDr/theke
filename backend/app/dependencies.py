from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company, CompanySubscription, User, Vertical
from app.security import decode_access_token

bearer_scheme = HTTPBearer()
# auto_error=False: GET /plans is reachable both logged-out (public pricing
# page) and logged-in (personalized "current tier" state) - a missing or
# invalid token here means "treat as anonymous", not a 401, unlike every
# other bearer_scheme use in this file.
optional_bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    user_id: int
    company_id: int | None
    role: str
    company_type: str | None
    preferred_locale: str | None = None
    email_verified: bool = True


# A company in either of these CompanySubscription statuses has no
# functional access - never approved (beta_pending) or explicitly declined
# (rejected, see admin.py's reject_beta_signup and KNOWN_DECISIONS.md for
# why that's a distinct status from beta_pending, not the same one). Every
# OTHER status (beta, trial, active, even expired/cancelled/suspended,
# which are handled by check_subscription's 402 at the point of use, not
# by blocking login/every endpoint outright) keeps ordinary access.
_NO_ACCESS_STATUSES = {"beta_pending", "rejected"}


def _resolve_current_user(
    credentials: HTTPAuthorizationCredentials,
    db: Session,
    *,
    block_unapproved: bool,
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

        # Every functional endpoint is blocked by default for a company
        # that was never approved (beta_pending) or was declined
        # (rejected) - a self-serve signup gets a real login token
        # immediately (see auth.py's register()), but that token must not
        # unlock chat/documents/projects/anything else until a super_admin
        # approves it, and a rejected signup never gains access at all.
        # block_unapproved=False is the single, deliberate exception (see
        # get_current_user_allow_pending below), not a per-route opt-out -
        # every other Depends(get_current_user) call site in the app is
        # blocked here, uniformly, with no chance to forget the check on a
        # new endpoint.
        if block_unapproved and company:
            sub = db.scalar(
                select(CompanySubscription.status).where(CompanySubscription.company_id == company.id)
            )
            if sub in _NO_ACCESS_STATUSES:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account pending approval")

    return CurrentUser(
        user_id=user.id,
        company_id=user.company_id,
        role=user.role,
        company_type=company_type,
        preferred_locale=user.preferred_locale,
        email_verified=user.email_verified,
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    return _resolve_current_user(credentials, db, block_unapproved=True)


def get_current_user_allow_pending(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """Identical to get_current_user, except a beta_pending or rejected
    company is let through instead of 403ing. The ONE deliberate exception
    to the block (see _resolve_current_user) - reserved for the single
    endpoint (GET /subscription/status) the pending-approval screen needs
    to reach in order to show its own status (pending OR declined) and
    poll for approval, since that screen has to be reachable precisely in
    the states everything else blocks. No other endpoint should depend on
    this."""
    return _resolve_current_user(credentials, db, block_unapproved=False)


def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer_scheme),
    db: Session = Depends(get_db),
) -> CurrentUser | None:
    """Same resolution as get_current_user, but returns None instead of
    raising for a missing/invalid/expired token or inactive account -
    for endpoints reachable both logged-out and logged-in (GET /plans)."""
    if credentials is None:
        return None
    try:
        return get_current_user(credentials, db)
    except HTTPException:
        return None


def get_company_vertical(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Vertical:
    """The vertical (construction, tax_accounting, ...) of the current
    user's company. Used by endpoints that require a real company to
    operate at all (project/document writes) - raises 403 for a
    super_admin (company_id is None) or a company whose vertical_id somehow
    doesn't resolve, since there's nothing for either of those to write
    into. Read-only chat/search endpoints should use get_vertical_scope
    instead, which gives a super_admin an unrestricted-KB exception rather
    than rejecting them outright - see that function's own docstring."""
    if user.company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This endpoint requires a company account")
    company = db.get(Company, user.company_id)
    vertical = db.get(Vertical, company.vertical_id) if company else None
    if not vertical:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company has no assigned vertical")
    return vertical


def get_vertical_scope(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Vertical | None:
    """Like get_company_vertical, but a super_admin (company_id is None)
    gets None back instead of a 403. None signals "no single vertical to
    scope to" to every read-only chat/search endpoint that depends on this:
    those endpoints treat it as an explicit exception - the full public
    knowledge base, across both verticals, with no regional/company
    scoping applied - not an error, mirroring the "super_admin sees
    everything" principle already established for the Sources screen
    (see admin.py's dedicated full-source-visibility endpoints). Still
    raises for a real company with no assigned vertical, same as
    get_company_vertical - that's a genuine data problem, not something a
    super_admin exception should paper over."""
    if user.company_id is None:
        return None
    company = db.get(Company, user.company_id)
    vertical = db.get(Vertical, company.vertical_id) if company else None
    if not vertical:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company has no assigned vertical")
    return vertical
