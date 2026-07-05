from datetime import date as date_type, datetime

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
    preferred_locale: str | None = None  # UI language active at signup time, if any


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    token: str
    company_id: int | None = None
    company_type: str | None = None
    role: str
    preferred_locale: str | None = None


class UpdateLocaleRequest(BaseModel):
    locale: str = Field(min_length=2, max_length=10)


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


class ChatCitation(BaseModel):
    document_id: int
    title: str | None = None
    authority: str | None = None
    content_type: str | None = None
    source: str | None = None
    date: str | None = None


class ChatResponse(BaseModel):
    answer: str
    citations: list[ChatCitation] = []


class DocumentSummary(BaseModel):
    id: int
    title: str | None = None
    snippet: str | None = None
    source: str | None = None
    doc_type: str | None = None
    municipality: str | None = None
    region_id: str | None = None
    date: date_type | None = None
    identifier: str | None = None
    series: str | None = None
    issue_number: str | None = None
    source_name: str | None = None
    source_group: str | None = None


class SourceGroupSummary(BaseModel):
    group: str
    count: int


class BrowseResponse(BaseModel):
    total: int
    items: list[DocumentSummary]


class DocumentDetail(DocumentSummary):
    content: str | None = None


class LocaleSummary(BaseModel):
    code: str
    name: str
    is_builtin: bool


class LocaleCreate(BaseModel):
    code: str = Field(min_length=2, max_length=10)
    name: str = Field(min_length=1, max_length=50)


class TranslationsUpdate(BaseModel):
    values: dict[str, str]


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
    company_id: int | None = None
    action: str
    resource_type: str | None = None
    resource_id: int | None = None
    metadata: dict | None = None
    created_at: datetime


class NotificationSummary(BaseModel):
    id: int
    type: str
    title: str
    body: str | None = None
    link: str | None = None
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationSummary]
    unread_count: int


class CompanySummary(BaseModel):
    id: int
    name: str
    type: str
    is_suspended: bool
    created_at: datetime


class MyCompanySummary(BaseModel):
    id: int
    name: str
    type: str
    has_logo: bool


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
    region_id: str | None = None  # links to regions.region_id, gates access to that region's KB documents
    address: str | None = None


class ProjectSummary(BaseModel):
    id: int
    name: str | None
    municipality: str | None
    region_id: str | None = None
    address: str | None
    is_default: bool = False


class RegionSummary(BaseModel):
    region_id: str
    region_name_el: str
    region_name_en: str
    level: str
    status: str
    has_coefficient_data: bool | None = None
    has_zone_level_coefficient_text: bool | None = None


class SearchRequest(BaseModel):
    query: str
    region_id: str | None = None  # narrows to one region on top of visibility; national docs stay included
    top_k: int | None = None


class SearchResultItem(BaseModel):
    document_id: int
    title: str | None = None
    authority: str | None = None
    source_url: str | None = None
    date: str | None = None
    content_type: str | None = None
    extraction_status: str | None = None
    chunk_text: str
    distance: float


class SearchResponse(BaseModel):
    results: list[SearchResultItem] = []
    # Populated only when results is empty, explaining why - "nothing in
    # scope at all" vs. "candidates existed but none confident enough" -
    # so an empty response never reads as a confident "no matches exist."
    reason: str | None = None


class StaleDocumentSummary(BaseModel):
    id: int
    title: str | None = None
    source: str | None = None
    source_group: str | None = None
    region_id: str | None = None
    last_verified_at: date_type | None = None
