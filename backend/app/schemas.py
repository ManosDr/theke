from datetime import datetime

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    # Provide EITHER invite_token (join an existing company - the invite
    # determines which company and role) OR company_name (create a new one,
    # becoming its founding admin). Providing both / neither is rejected.
    invite_token: str | None = None
    company_name: str | None = None
    company_type: str = "construction"  # 'construction', 'municipality' - only used when creating a new company


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    token: str
    company_id: int | None = None
    company_type: str | None = None
    role: str


class InviteCreateRequest(BaseModel):
    email: str
    role: str = "member"  # 'admin' or 'member'


class RoleChangeRequest(BaseModel):
    role: str  # 'admin' or 'member'


class InviteSummary(BaseModel):
    id: int
    email: str
    role: str
    status: str
    token: str | None = None  # only populated in the create response - share this with the invitee
    created_at: datetime
    expires_at: datetime


class ChatRequest(BaseModel):
    message: str
    project_id: int | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[str] = []


class DocumentSummary(BaseModel):
    id: int
    title: str | None = None
    snippet: str | None = None
    source: str | None = None
    doc_type: str | None = None
    municipality: str | None = None


class UploadResponse(BaseModel):
    document_id: int
    title: str
    municipality: str | None = None


class UserSummary(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    created_at: datetime


class AuditLogEntry(BaseModel):
    id: int
    actor_user_id: int | None
    action: str
    resource_type: str | None = None
    resource_id: int | None = None
    metadata: dict | None = None
    created_at: datetime


class CompanySummary(BaseModel):
    id: int
    name: str
    type: str
    is_suspended: bool
    created_at: datetime


class RemovalRequestSummary(BaseModel):
    id: int
    document_id: int
    document_title: str | None = None
    requested_by: int
    status: str
    created_at: datetime


class ProjectCreateRequest(BaseModel):
    name: str
    municipality: str
    address: str | None = None


class ProjectSummary(BaseModel):
    id: int
    name: str | None
    municipality: str | None
    address: str | None
    is_default: bool = False
