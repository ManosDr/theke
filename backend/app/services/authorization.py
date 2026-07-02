"""Role checks. `CurrentUser.role` is 'super_admin' | 'admin' | 'member';
meaning depends on `CurrentUser.company_type` ('construction' | 'municipality').

Permission matrix this encodes:
  - super_admin: manages companies/users platform-wide; no private document
    read access (see backend/app/services/visibility.py - deliberately not
    granted here either).
  - construction admin: manages that company's users/KB (upload, request
    removal).
  - construction member: read-only (chat/search) - cannot upload.
  - municipality admin: manages that municipality's users/KB, and is the
    only role that can approve/reject removal requests.
  - municipality member: can upload/edit (new versions) but cannot remove
    outright - must go through a removal request an admin decides on.
"""

from fastapi import HTTPException, status

from app.dependencies import CurrentUser


def require_super_admin(user: CurrentUser) -> None:
    if user.role != "super_admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")


def require_company_admin(user: CurrentUser) -> None:
    if user.role != "admin" or user.company_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company admin access required")


def can_upload_documents(user: CurrentUser) -> bool:
    if user.company_id is None:
        return False
    if user.company_type == "municipality":
        return user.role in ("admin", "member")
    return user.role == "admin"  # construction: admin only


def require_can_upload_documents(user: CurrentUser) -> None:
    if not can_upload_documents(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not permitted to upload documents")


def can_approve_removal(user: CurrentUser) -> bool:
    return user.role == "admin" and user.company_id is not None
