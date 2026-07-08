from datetime import date as date_type, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Only used when creating a new company (invite-based registration ignores
# this field - role/company come from the invite instead). Keep in sync with
# any frontend company-type dropdown; "municipality" (not "municipal") matches
# the existing Company.type value used throughout visibility/authorization.
COMPANY_TYPES = ("construction", "architecture", "engineering", "contractor", "municipality")


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    # Provide EITHER invite_token (join an existing company - the invite
    # determines which company and role) OR company_name (create a new one,
    # becoming its founding admin). Providing both / neither is rejected.
    invite_token: str | None = None
    company_name: str | None = None
    company_type: str = "construction"
    # Required only on the company_name (new-company) path - validated
    # against the verticals table in the endpoint itself (not here), since
    # a Pydantic-level check has no DB access. Ignored on the invite_token
    # path, where the vertical is inherited from the inviting company.
    vertical_slug: str | None = None
    preferred_locale: str | None = None  # UI language active at signup time, if any

    @field_validator("company_type")
    @classmethod
    def _validate_company_type(cls, v: str) -> str:
        if v not in COMPANY_TYPES:
            raise ValueError(f"company_type must be one of {COMPANY_TYPES}")
        return v


class InviteInfoResponse(BaseModel):
    company_name: str
    vertical_display_name: str
    role: str


class LoginRequest(BaseModel):
    email: str
    password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ForgotPasswordResponse(BaseModel):
    message: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    token: str
    company_id: int | None = None
    company_type: str | None = None
    role: str
    preferred_locale: str | None = None
    preferred_theme: str | None = None


class UpdateLocaleRequest(BaseModel):
    locale: str = Field(min_length=2, max_length=10)


class UpdateThemeRequest(BaseModel):
    theme: Literal["light", "dark"]


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


class ChatHistoryTurn(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatMessageRequest(BaseModel):
    query: str
    conversation_history: list[ChatHistoryTurn] = []
    project_id: int | None = None


class ChatMessageCitation(BaseModel):
    document_id: int
    title: str | None = None
    authority: str | None = None
    source_url: str | None = None
    # Always "full_text" today in practice - only full_text documents are
    # ever embedded (see app/services/embeddings.py), so a RAG citation can't
    # actually be reference_only/manual_entry_pending yet. Carried anyway so
    # the frontend's "source pending verification" badge is genuinely wired
    # up rather than silently assumed impossible, in case that ever changes.
    extraction_status: str | None = None
    # Contact details for the citation's issuing authority, if curated (see
    # KNOWN_DECISIONS.md) - NULL until a manual research pass fills them in.
    contact_phone: str | None = None
    contact_email: str | None = None


class ChatMessageResponse(BaseModel):
    answer: str
    citations: list[ChatMessageCitation] = []
    # True when either nothing was retrieved (canned response, no GPT call)
    # or a real answer was generated from fewer supporting excerpts than
    # rag_top_k requested, or from excerpts weaker than rag_warn_distance -
    # a signal to present the answer as lower-confidence, not a promise
    # that no answer was given.
    gap: bool
    # The underlying chat_sessions row id - None for the hard-gap/off-topic/
    # error paths that return before _log_session ever runs, since there's
    # nothing to attach a POST /chat/feedback rating to in that case.
    session_id: int | None = None


class ChatHistoryItem(BaseModel):
    id: int
    message: str
    response: str
    citations: list[ChatMessageCitation] = []
    gap: bool | None = None  # NULL for rows written by the older POST /chat
    created_at: datetime


class ChatFeedbackRequest(BaseModel):
    session_id: int
    message_index: int
    rating: Literal["positive", "negative"]


class ChatHistoryResponse(BaseModel):
    items: list[ChatHistoryItem]


class DocumentReplacementRef(BaseModel):
    id: int
    title: str | None = None


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
    authority: str | None = None
    content_type: str | None = None
    extraction_status: str | None = None
    # Populated only by admin KB management (GET /admin/documents) - the
    # replacement chain a superseded/replacement document sits in. None for
    # every other caller (tenant search/browse never sees superseded docs
    # at all - see visible_documents_filter).
    status: str | None = None
    replaced_by: DocumentReplacementRef | None = None
    replaces: DocumentReplacementRef | None = None


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
    # Required for construction-vertical projects (validated server-side,
    # not by this schema, since the requirement depends on the requester's
    # company vertical - see POST /projects). Optional/meaningless for a
    # tax-vertical client engagement, which has no municipality concept.
    municipality: str | None = None
    region_id: str | None = None  # links to regions.region_id, gates access to that region's KB documents
    address: str | None = None
    client_notes: str | None = None


class ProjectSummary(BaseModel):
    id: int
    name: str | None
    municipality: str | None
    region_id: str | None = None
    address: str | None
    is_default: bool = False
    is_client: bool = False
    client_notes: str | None = None


class ProjectDocumentSummary(BaseModel):
    id: int
    title: str | None
    extraction_status: str | None
    created_at: datetime
    chunk_count: int


class ProjectDocumentUploadResult(BaseModel):
    filename: str
    document_id: int | None
    extraction_status: str
    chunk_count: int
    error: str | None = None


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


class AdminStatsResponse(BaseModel):
    total_messages: int
    # Percentage of chat_sessions rows with gap=true, rounded to one
    # decimal place - 0.0 (not an error) when total_messages is 0.
    gap_rate: float
    active_documents: int
    positive_feedback: int
    negative_feedback: int


class VerticalStatsEntry(BaseModel):
    slug: str
    messages: int
    gap_rate: float
    active_documents: int
    active_companies: int


class AdminStatsByVerticalResponse(BaseModel):
    total: AdminStatsResponse
    by_vertical: list[VerticalStatsEntry]


class DataSourceSummary(BaseModel):
    id: int
    name: str
    base_url: str
    source_type: str
    crawl_frequency_type: str
    crawl_frequency_days: int
    last_crawled_at: datetime | None
    next_crawl_at: datetime | None
    last_crawl_status: str | None
    last_crawl_document_count: int | None
    last_crawl_error: str | None
    is_active: bool
    notes: str | None = None


class DataSourcesByVertical(BaseModel):
    vertical_slug: str
    vertical_display_name: str
    sources: list[DataSourceSummary]


class DataSourceUpdateRequest(BaseModel):
    name: str | None = None
    crawl_frequency_type: str | None = None  # 'daily', 'weekly', 'monthly', 'custom'
    crawl_frequency_days: int | None = None
    next_crawl_at: datetime | None = None  # manual override of the next scheduled run
    is_active: bool | None = None
    notes: str | None = None


class DataSourceSyncStatus(BaseModel):
    id: int
    last_crawled_at: datetime | None
    next_crawl_at: datetime | None
    last_crawl_status: str | None
    last_crawl_document_count: int | None
    last_crawl_error: str | None


class VerticalSummary(BaseModel):
    id: int
    slug: str
    display_name: str
    tagline: str | None
    welcome_message: str | None
    disclaimer_text: str | None
    system_prompt_override: str | None
    off_topic_hint: str | None
    uses_regional_scoping: bool
    status: str


class VerticalUpdateRequest(BaseModel):
    tagline: str | None = None
    welcome_message: str | None = None
    disclaimer_text: str | None = None
    system_prompt_override: str | None = None
    off_topic_hint: str | None = None


class GapQueryEntry(BaseModel):
    id: int
    message: str
    company_name: str | None
    created_at: datetime


class MarkReviewedRequest(BaseModel):
    # Required and must be true - clearing needs_review has no way to check
    # the underlying content was actually fixed, so the reviewer's explicit
    # confirmation is the only correctness gate that exists (see
    # KNOWN_DECISIONS.md). Enforced server-side, not just as a disabled
    # frontend button, so a direct API call can't skip it either.
    confirmed: bool


class MarkSupersededRequest(BaseModel):
    replaced_by_document_id: int
    # Same server-side gate as MarkReviewedRequest - superseding a document
    # is a judgment call about content equivalence a human made, not
    # something the API can verify on its own.
    confirmed: bool


class UndoSupersedeRequest(BaseModel):
    confirmed: bool
