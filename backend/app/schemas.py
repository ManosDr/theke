from datetime import date as date_type, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Only used when creating a new company (invite-based registration ignores
# this field - role/company come from the invite instead). Keep in sync with
# any frontend company-type dropdown; "municipality" (not "municipal") matches
# the existing Company.type value used throughout visibility/authorization.
COMPANY_TYPES = ("construction", "architecture", "engineering", "contractor", "municipality", "accounting")


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
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
    # Set only when arriving via the public pricing page's CTA
    # (?intended_tier=<plan slug>) - there's no company record yet at
    # registration time to store this on (and no dedicated field for it),
    # so the endpoint logs it onto the new company's own audit_log entry
    # for manual sales reference rather than inventing new schema for a
    # single free-text hint. Ignored on the invite_token path.
    intended_tier: str | None = None
    # No default - omitting this field entirely (not just sending false)
    # must also fail validation, so a client can't bypass the checkbox by
    # simply not sending the key. Enforced again in the endpoint itself
    # (rejecting False, not just relying on this being required) - see
    # auth.py's register(), and KNOWN_DECISIONS.md on why "required in the
    # UI" alone was never enough.
    dpa_accepted: bool

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
    first_name: str | None = None
    last_name: str | None = None
    preferred_locale: str | None = None
    preferred_theme: str | None = None


class ImpersonateResponse(TokenResponse):
    email: str


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
    # Only ever prompted for on a negative rating - null is valid there too
    # ("Παράλειψη"), and is the only value accepted for a positive rating.
    feedback_text: str | None = None


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
    vertical_id: int | None = None
    vertical_slug: str | None = None
    last_verified_at: date_type | None = None
    needs_review: bool = False
    # See StaleDocumentSummary's field of the same name - populated here too
    # so the admin Documents screen's row can show why a needs_review
    # document was flagged, not just that it was.
    auto_needs_review_reason: str | None = None
    # still_accurate from this document's most recent document_validations
    # row, if any - None means never AI-revalidated. Powers the post-bulk-
    # revalidation sort (needs attention first, then never-checked, then
    # confirmed-clean last) on the admin Documents/needs-review screens.
    still_accurate: bool | None = None
    # Full (untruncated) content - unlike snippet above (always capped to
    # 280 chars for list rendering), this is populated ONLY by the
    # single-document GET (see admin.py's get_admin_document), None
    # everywhere else so list responses don't balloon. Used by the AI
    # revalidation panel's "Τρέχον περιεχόμενο" readonly comparison view.
    full_content: str | None = None


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
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None = None
    messages_30d: int = 0


# Platform-wide (super admin) equivalent of UserSummary/InviteSummary - adds
# company_id/company_name since, unlike the company-admin's own /companies/me
# view, a cross-company list is meaningless without knowing whose user or
# invite each row belongs to. company_id is nullable - super_admin accounts
# aren't tied to any single company.
class AdminUserSummary(UserSummary):
    company_id: int | None = None
    company_name: str


# Plain-text, shown once in the confirmation modal, never stored - see
# POST /admin/users/{id}/reset-password.
class AdminResetPasswordResponse(BaseModel):
    new_password: str


class EmailStatusResponse(BaseModel):
    email_enabled: bool


class AdminInviteSummary(InviteSummary):
    company_id: int
    company_name: str


class CompanyOverviewResponse(BaseModel):
    users_total: int
    users_active_30d: int
    messages_30d: int
    gap_rate: float
    customers_total: int
    projects_total: int
    private_documents_count: int
    public_documents_count: int
    total_tokens_30d: int
    estimated_cost_eur_30d: float
    activity: list["ActivityEventEntry"]


class ActivityEventEntry(BaseModel):
    type: str  # 'chat_message', 'document_uploaded', 'project_created', 'customer_added', 'user_joined'
    created_at: datetime
    description: str
    actor_name: str | None = None


class CompanyDocumentSummary(BaseModel):
    id: int
    title: str | None
    project_id: int | None
    project_name: str | None
    doc_type: str | None
    extraction_status: str | None
    created_at: datetime


class CompanyDocumentReviewEntry(BaseModel):
    """One row in the company admin's needs-review queue - company-wide
    documents only (see companies.py's GET .../documents/needs-review).
    Exactly one of auto_reason/manual_note is set, telling the UI whether
    this was flagged by the reference_url hash-check or by a company member."""

    id: int
    title: str | None
    created_at: datetime
    reference_url: str | None
    auto_reason: str | None
    manual_note: str | None


class FlagForReviewRequest(BaseModel):
    note: str | None = None


class KbSourceStatusEntry(BaseModel):
    source_name: str
    document_count: int
    last_crawled_at: datetime | None
    next_crawl_at: datetime | None
    health: str  # 'healthy', 'overdue', 'failed', 'never_synced'


class CustomerProjectListEntry(BaseModel):
    id: int
    name: str | None
    region_id: str | None
    region_name_el: str | None
    created_at: datetime
    document_count: int


class MeSummary(BaseModel):
    id: int
    email: str
    first_name: str | None
    last_name: str | None
    phone: str | None
    role: str
    preferred_locale: str | None
    preferred_theme: str | None


class UpdateMeRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    preferred_locale: str | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


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
    vertical_id: int | None = None
    vertical_slug: str | None = None
    active_users_count: int = 0
    active_projects_count: int = 0


class CompanyUserSummary(BaseModel):
    id: int
    email: str
    first_name: str | None = None
    last_name: str | None = None
    role: str
    is_active: bool


class CompanyProjectSummary(BaseModel):
    id: int
    name: str | None = None
    municipality: str | None = None
    is_client: bool


class CompanyCreateWithAdminRequest(BaseModel):
    company_name: str
    company_type: str
    admin_first_name: str
    admin_last_name: str
    admin_email: str
    admin_phone: str | None = None
    # "Δοκιμαστικός χρήστης" toggle - when true, the created company is
    # tagged Company.is_test_account (excluded from platform-wide
    # reporting) and its trial length uses trial_days instead of the
    # standard TRIAL_DAYS_DEFAULT (60). trial_days is accepted regardless
    # of is_test_account so a super admin can also hand a real prospect a
    # non-default trial length without marking them a test account.
    is_test_account: bool = False
    trial_days: int = 60  # matches app/services/subscription.py's TRIAL_DAYS_DEFAULT

    @field_validator("company_type")
    @classmethod
    def _validate_company_type(cls, v: str) -> str:
        if v not in COMPANY_TYPES:
            raise ValueError(f"company_type must be one of {COMPANY_TYPES}")
        return v


class CompanyCreateWithAdminResponse(BaseModel):
    company_id: int
    company_name: str
    admin_user_id: int
    admin_first_name: str
    admin_last_name: str
    admin_email: str
    generated_password: str


class TokenUsageByUser(BaseModel):
    user_id: int
    name: str
    total_tokens_30d: int
    estimated_cost_eur_30d: float
    message_count: int


class TokenUsageSummary(BaseModel):
    prompt_tokens_30d: int
    completion_tokens_30d: int
    total_tokens_30d: int
    estimated_cost_eur_30d: float
    avg_tokens_per_message: int
    by_user: list[TokenUsageByUser]


class CompanyDetail(CompanySummary):
    users: list[CompanyUserSummary] = []
    projects: list[CompanyProjectSummary] = []
    messages_30d: int = 0
    gap_rate: float = 0.0
    token_usage: TokenUsageSummary


class ReassignVerticalRequest(BaseModel):
    vertical_id: int
    # Same confirmed=True gate used elsewhere for judgment-call actions -
    # reassignment removes the company's access to every document in its
    # current vertical, which the frontend must show a count for before
    # this is set to true.
    confirmed: bool


class MyCompanySummary(BaseModel):
    id: int
    name: str
    type: str
    has_logo: bool
    logo_url: str | None = None
    vertical_slug: str
    vertical_display_name: str
    vertical_tagline: str | None
    vertical_welcome_message: str | None
    vertical_disclaimer_text: str | None
    vertical_uses_regional_scoping: bool
    # Legal/billing details (Phase 0.5) - needed for a valid Greek invoice,
    # editable by a company admin via PATCH /companies/me/billing-details.
    legal_name: str | None = None
    afm: str | None = None
    billing_address: str | None = None
    # Set at registration (new-company path only - see auth.py's register())
    # - backs the Account page's "Νομικά" section's
    # "Αποδεχτήκατε την έκδοση X στις Y" display.
    dpa_accepted_at: datetime | None = None
    dpa_version: str | None = None
    # Whether the requesting user has ever sent a chat message (lifetime, not
    # scoped to 30 days) - drives the dashboard welcome card's dismiss-vs-show
    # logic (see MemberDashboard/CompanyAdminDashboard's WelcomeCard usage).
    current_user_has_messages: bool = False
    # Whether ANYONE at the company has ever sent a chat message - distinct
    # from current_user_has_messages (per-user), this gates the chat page's
    # extra "how sourcing works" onboarding line shown only for a company's
    # very first ever session (see chat/page.tsx).
    company_has_messages: bool = False


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
    # customer_id (a real, reusable contact record) takes precedence over
    # customer_name/customer_notes (freeform text) when both are given - see
    # POST /projects. Either, both, or neither may be omitted.
    customer_id: int | None = None
    customer_name: str | None = None
    customer_notes: str | None = None


class ProjectSummary(BaseModel):
    id: int
    name: str | None
    municipality: str | None
    region_id: str | None = None
    address: str | None
    is_default: bool = False
    is_client: bool = False
    client_notes: str | None = None
    customer_id: int | None = None
    customer_name: str | None = None
    customer_notes: str | None = None
    plot_address: str | None = None
    plot_municipality: str | None = None
    lat: float | None = None
    lon: float | None = None
    kaek: str | None = None
    plot_area_sqm: float | None = None
    gis_zone_name: str | None = None
    gis_zone_source: str | None = None
    archaeological_flag: bool = False
    archaeological_notes: str | None = None
    archaeological_site_name: str | None = None
    archaeological_distance_m: int | None = None
    plot_in_plan: bool | None = None
    location_resolved_at: datetime | None = None


class UpdateProjectMetadataRequest(BaseModel):
    name: str
    customer_id: int | None = None
    customer_name: str | None = None
    customer_notes: str | None = None
    client_notes: str | None = None


class CustomerCreateRequest(BaseModel):
    name: str
    afm: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None


class CustomerUpdateRequest(BaseModel):
    name: str | None = None
    afm: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None


class CustomerSummary(BaseModel):
    id: int
    name: str
    afm: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    created_at: datetime
    project_count: int = 0
    last_project_at: datetime | None = None


class CustomerProjectSummary(BaseModel):
    id: int
    name: str | None
    region_id: str | None = None
    region_name_el: str | None = None
    created_at: datetime
    is_client: bool = False
    document_count: int = 0


class CustomerDetailResponse(BaseModel):
    id: int
    name: str
    afm: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    created_at: datetime
    projects: list[CustomerProjectSummary] = []


class ResolveLocationRequest(BaseModel):
    lat: float
    lon: float
    # When provided, the cadastral lookup runs against this KAEK instead of
    # being skipped - its centroid then also drives the reverse-geocode/
    # archaeological check, superseding lat/lon (see POST /gis/resolve-location).
    kaek: str | None = None


class ServicesAvailable(BaseModel):
    geocoding: bool
    cadastral: bool
    gis_zone: bool


class ResolveLocationResponse(BaseModel):
    lat: float
    lon: float
    address: str | None = None
    municipality: str | None = None
    kaek: str | None = None
    plot_area_sqm: float | None = None
    parcel_geometry: dict | None = None
    gis_zone_name: str | None = None
    archaeological_flag: bool = False
    archaeological_notes: str | None = None
    archaeological_site_name: str | None = None
    archaeological_distance_m: int | None = None
    ktimatologio_link: str | None = None
    services_available: ServicesAvailable


class ParcelLookupResponse(BaseModel):
    kaek: str
    available: bool
    found: bool = False
    area_sqm: float | None = None
    perimeter_m: float | None = None
    centroid_lat: float | None = None
    centroid_lon: float | None = None
    geometry: dict | None = None
    ktimatologio_link: str | None = None
    error: str | None = None


class GeocodeResult(BaseModel):
    display_name: str | None = None
    type: str | None = None
    lat: float
    lon: float


class UpdateProjectLocationRequest(BaseModel):
    lat: float
    lon: float
    plot_address: str | None = None
    plot_municipality: str | None = None
    kaek: str | None = None
    plot_area_sqm: float | None = None
    parcel_geometry: dict | None = None
    gis_zone_name: str | None = None
    gis_zone_source: str | None = None
    archaeological_flag: bool = False
    archaeological_notes: str | None = None
    archaeological_site_name: str | None = None
    archaeological_distance_m: int | None = None
    plot_in_plan: bool | None = None


class UpdatePlotInPlanRequest(BaseModel):
    plot_in_plan: bool | None = None


class ProjectDocumentSummary(BaseModel):
    id: int
    title: str | None
    extraction_status: str | None
    created_at: datetime
    chunk_count: int
    # 'project' (this project only), 'customer' (all of this customer's
    # projects), or 'company' (whole company) - which upload-scope choice
    # produced this row. Lets the UI badge customer/company-scoped documents
    # differently since they weren't uploaded specifically for this project.
    doc_scope: str


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
    # Set only when needs_review was raised by the data-source content-hash
    # sync (see admin.py's sync_data_source), not by a human or the 6-month
    # staleness sweep - the admin Documents screen shows this text inline
    # and uses its presence to power the "Αυτόματη σήμανση" filter.
    auto_needs_review_reason: str | None = None


class DocumentValidationResult(BaseModel):
    """Response of both POST /admin/documents/{id}/revalidate and the
    per-document work the bulk queue does - one shape for both call sites.
    status="source_unavailable" means the source fetch itself failed and no
    GPT-4o call was made (still_accurate/changes_detected/etc. are all
    None in that case); status="validated" means GPT-4o compared the
    stored content against the live source."""

    status: str
    reason: str | None = None
    still_accurate: bool | None = None
    changes_detected: str | None = None
    suggested_content: str | None = None
    confidence: str | None = None
    reasoning: str | None = None
    source_fetched_at: datetime | None = None
    source_url: str | None = None
    validation_id: int | None = None


class ApplySuggestionRequest(BaseModel):
    content: str = Field(min_length=1)
    validation_id: int
    action: str  # 'accepted' | 'edited'


class RevalidateAllResponse(BaseModel):
    queued: int
    estimated_minutes: int


class RevalidationStatusResponse(BaseModel):
    pending: int
    validated: int
    failed: int
    # Breakdown of `validated` by outcome - accurate + changed always sums
    # to validated. Powers the bulk-completion summary message ("N need
    # updating, M are accurate").
    accurate: int = 0
    changed: int = 0
    last_updated: datetime | None = None


class AdminStatsResponse(BaseModel):
    total_messages: int
    # Percentage of chat_sessions rows with gap=true, rounded to one
    # decimal place - 0.0 (not an error) when total_messages is 0.
    gap_rate: float
    active_documents: int
    positive_feedback: int
    negative_feedback: int
    # Last 30 days only (unlike total_messages above, which is all-time) -
    # the platform-wide token/cost attention-row stat.
    platform_tokens_30d: int = 0
    platform_cost_eur_30d: float = 0.0


class VerticalStatsEntry(BaseModel):
    slug: str
    messages: int
    gap_rate: float
    active_documents: int
    active_companies: int


class AdminStatsByVerticalResponse(BaseModel):
    total: AdminStatsResponse
    by_vertical: list[VerticalStatsEntry]


class InfraHealthCheckEntry(BaseModel):
    total_chunks: int
    index_size_mb: float
    threshold_level: Literal["watch", "warning", "critical"]
    created_at: datetime


class InfraHealthResponse(BaseModel):
    latest: InfraHealthCheckEntry | None
    # Most recent readings, oldest first - enough for a simple sparkline.
    history: list[InfraHealthCheckEntry]
    # "up"/"down"/"flat" vs. the reading closest to 7 days before latest, or
    # None if there isn't at least one reading old enough to compare against.
    trend: Literal["up", "down", "flat"] | None


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


class RegionAdminSummary(BaseModel):
    region_id: str
    region_name_el: str
    ydom_authority_name: str | None
    contact_phone: str | None
    contact_email: str | None
    status: str


class RegionAdminUpdateRequest(BaseModel):
    contact_phone: str | None = None
    contact_email: str | None = None
    ydom_authority_name: str | None = None


class UtilityProviderAdminSummary(BaseModel):
    provider_id: str
    provider_name: str
    provider_type: str
    coverage_region_ids: list[str]
    contact_phone: str | None
    contact_email: str | None


class UtilityProviderAdminUpdateRequest(BaseModel):
    contact_phone: str | None = None
    contact_email: str | None = None
    provider_name: str | None = None


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
    # Matches the frontend textarea's cap (VerticalEditorPanel.tsx) - this is
    # the disclaimer appended to every chat answer, so it needs to stay short
    # regardless of which path (UI or a direct API call) sets it.
    disclaimer_text: str | None = Field(default=None, max_length=200)
    system_prompt_override: str | None = None
    off_topic_hint: str | None = None


class GapQueryEntry(BaseModel):
    id: int
    message: str
    company_name: str | None
    created_at: datetime


class AdminDocumentCreateRequest(BaseModel):
    """Backs the admin "Νέο Έγγραφο" form - authoring a manual_entry public
    KB document directly, as opposed to the crawler's automated ingestion.
    source is Optional[str] at the schema level (Pydantic can't express
    "required only when extraction_status == X"), but the endpoint enforces
    it as required for extraction_status="manual_entry" - see
    KNOWN_DECISIONS.md's KB staleness policy entry for why."""

    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    vertical_id: int
    source: str | None = None
    authority: str | None = None
    content_type: str | None = None
    region_id: str | None = None
    extraction_status: str = "manual_entry"


class MarkReviewedRequest(BaseModel):
    # Required and must be true - clearing needs_review has no way to check
    # the underlying content was actually fixed, so the reviewer's explicit
    # confirmation is the only correctness gate that exists (see
    # KNOWN_DECISIONS.md). Enforced server-side, not just as a disabled
    # frontend button, so a direct API call can't skip it either.
    confirmed: bool
    # Set only when this mark-reviewed call comes from the AI revalidation
    # panel (State A's "Σήμανση ως ελεγμένο" or State B's "Απόρριψη" - see
    # DocumentsPanel.tsx) - stamps that validation row's admin_action as
    # 'dismissed' so the audit trail records a human looked at the AI's
    # assessment and chose not to act on it, distinct from the plain
    # "no AI involved" mark-reviewed path where this stays None.
    validation_id: int | None = None


class MarkSupersededRequest(BaseModel):
    replaced_by_document_id: int
    # Same server-side gate as MarkReviewedRequest - superseding a document
    # is a judgment call about content equivalence a human made, not
    # something the API can verify on its own.
    confirmed: bool


class UndoSupersedeRequest(BaseModel):
    confirmed: bool


class ChatRateLimitStatus(BaseModel):
    used: int
    limit: int
    remaining: int
    resets_in_seconds: int


class UserUsageSummary(BaseModel):
    messages_30d: int
    total_tokens_30d: int
    estimated_cost_eur_30d: float


class FeedbackEntry(BaseModel):
    id: int
    rating: Literal["positive", "negative"]
    feedback_text: str | None
    status: Literal["pending", "solved", "rejected"]
    created_at: datetime
    question: str
    answer_excerpt: str
    user_name: str
    company_name: str | None
    vertical: str | None


class FeedbackListResponse(BaseModel):
    items: list[FeedbackEntry]


class FeedbackStatusUpdateRequest(BaseModel):
    status: Literal["solved", "rejected"]


class UserFeedbackCreate(BaseModel):
    category: Literal["bug", "suggestion", "content_gap"]
    message: str | None = Field(default=None, max_length=500)
    page_url: str | None = Field(default=None, max_length=500)


class UserFeedbackEntry(BaseModel):
    id: int
    category: Literal["bug", "suggestion", "content_gap"]
    message: str | None
    page_url: str | None
    created_at: datetime
    user_name: str
    company_name: str | None


class UserFeedbackListResponse(BaseModel):
    items: list[UserFeedbackEntry]


class SubscriptionStatusResponse(BaseModel):
    plan_name: str
    plan_slug: str
    is_beta: bool
    status: Literal["trial", "active", "expired", "cancelled", "suspended"]
    trial_ends_at: datetime | None
    # started_at on the subscription row - the trial-day-count anchor for
    # the day-45 conversion nudge (Phase 4c), computed client-side the same
    # way TrialBanner already derives days-remaining from trial_ends_at.
    trial_started_at: datetime
    current_period_end: datetime | None
    messages_used: int
    messages_limit: int
    users_count: int
    user_limit: int
    # Lets the frontend suppress the day-45 conversion nudge for
    # is_test_account companies (see Phase 5) without a second request.
    is_test_account: bool


class PlanSummary(BaseModel):
    id: int
    vertical_id: int | None
    vertical_slug: str | None
    name: str
    slug: str
    billing_cycle: str
    price_eur: float
    annual_total_eur: float | None
    user_limit: int
    message_pool: int
    storage_limit_bytes: int | None
    project_limit: int | None
    client_limit: int | None
    max_file_size_bytes: int
    promo_price_eur: float | None
    promo_starts_at: datetime | None
    promo_ends_at: datetime | None
    is_beta: bool
    is_active: bool
    subscriber_count: int


class PlanCreateRequest(BaseModel):
    vertical_id: int | None = None
    name: str
    slug: str
    billing_cycle: str = "monthly"
    price_eur: float
    annual_total_eur: float | None = None
    user_limit: int
    message_pool: int
    storage_limit_bytes: int | None = None
    project_limit: int | None = None
    client_limit: int | None = None
    max_file_size_bytes: int = 20_000_000  # decimal MB, matches Plan.max_file_size_bytes's default reasoning
    promo_price_eur: float | None = None
    promo_starts_at: datetime | None = None
    promo_ends_at: datetime | None = None
    is_beta: bool = False
    is_active: bool = True


class PlanUpdateRequest(BaseModel):
    name: str | None = None
    billing_cycle: str | None = None
    price_eur: float | None = None
    annual_total_eur: float | None = None
    user_limit: int | None = None
    message_pool: int | None = None
    storage_limit_bytes: int | None = None
    project_limit: int | None = None
    client_limit: int | None = None
    max_file_size_bytes: int | None = None
    promo_price_eur: float | None = None
    promo_starts_at: datetime | None = None
    promo_ends_at: datetime | None = None
    is_beta: bool | None = None
    is_active: bool | None = None


class PlanPublicEntry(BaseModel):
    """One tier card's worth of data for the public/in-app pricing page
    (GET /plans) - annual_monthly_equiv_eur is derived server-side
    (round(annual_total_eur / 12, 2)) so the frontend never re-derives
    pricing math itself. price_eur/annual_total_eur already reflect an
    active promo override, if any (see app/routers/plans.py)."""

    id: int
    slug: str
    name: str
    price_eur: float
    annual_total_eur: float | None
    annual_monthly_equiv_eur: float | None
    is_promo: bool
    user_limit: int
    message_pool: int
    project_limit: int | None
    client_limit: int | None
    storage_limit_bytes: int | None
    max_file_size_bytes: int
    is_current: bool


class PlansPublicResponse(BaseModel):
    vertical_slug: str
    tiers: list[PlanPublicEntry]
    # Populated only when authenticated AND the caller's own company vertical
    # matches the requested `vertical` query param - viewing the OTHER
    # vertical's tab while logged in shows plain, unpersonalized pricing
    # (see Phase 2b: "don't hide the other tab, just don't default to it").
    subscription_status: Literal["trial", "active", "expired", "cancelled", "suspended"] | None = None
    trial_ends_at: datetime | None = None


class PlanRequestCreate(BaseModel):
    requested_tier_id: int


class PlanRequestResponse(BaseModel):
    direction: Literal["upgrade", "downgrade"]
    requested_tier_name: str


class SubscriptionEntry(BaseModel):
    company_id: int
    company_name: str
    vertical_slug: str | None
    plan_id: int
    plan_name: str
    plan_price_eur: float
    is_beta: bool
    status: Literal["trial", "active", "expired", "cancelled", "suspended"]
    billing_cycle: str
    trial_ends_at: datetime | None
    current_period_end: datetime | None
    messages_used: int
    messages_limit: int
    # Legal/billing details needed to generate a valid Greek invoice (Phase
    # 0.5) - surfaced here so the super-admin subscriptions screen can show
    # a "missing fields" warning inline per company, without a second
    # fetch. None/empty means not yet filled in by the company admin.
    legal_name: str | None = None
    afm: str | None = None
    billing_address: str | None = None
    users_count: int
    user_limit: int
    notes: str | None


class SubscriptionListResponse(BaseModel):
    items: list[SubscriptionEntry]


class AssignPlanRequest(BaseModel):
    plan_id: int
    billing_cycle: str = "monthly"
    trial_days: int | None = None
    notes: str | None = None


class ExtendTrialRequest(BaseModel):
    days: int


class AddSubscriptionNoteRequest(BaseModel):
    notes: str


class InvoiceCreateRequest(BaseModel):
    company_id: int
    plan_id: int
    billing_cycle: str
    period_start: date_type
    period_end: date_type


class InvoiceEntry(BaseModel):
    id: int
    invoice_number: str
    company_id: int
    company_name: str
    plan_id: int
    plan_name: str
    billing_cycle: str
    amount_net_eur: float
    vat_rate: float
    amount_vat_eur: float
    amount_total_eur: float
    issued_at: datetime
    period_start: date_type
    period_end: date_type


class CompanyBillingDetails(BaseModel):
    legal_name: str | None = None
    afm: str | None = None
    billing_address: str | None = None


class LegalStatusResponse(BaseModel):
    """is_draft per document - lets a caller (footer, registration
    checkbox, Account page) disable/label a specific link without
    fetching that document's full content."""

    terms: bool
    privacy: bool
    dpa: bool


class LegalDocResponse(BaseModel):
    slug: Literal["terms", "privacy", "dpa"]
    title: str
    is_draft: bool
    # None while is_draft - the placeholder-laden source text is never sent
    # to the client at all (see app/services/legal_docs.py), not just
    # hidden by the frontend.
    content: str | None
