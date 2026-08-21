from datetime import date as date_type, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Only used when creating a new company (invite-based registration ignores
# this field - role/company come from the invite instead). Keep in sync with
# any frontend company-type dropdown; "municipality" (not "municipal") matches
# the existing Company.type value used throughout visibility/authorization.
COMPANY_TYPES = ("construction", "architecture", "engineering", "contractor", "municipality", "accounting")

# beta_pending: self-serve signup awaiting super_admin approval, no
#   functional access (see dependencies.py's centralized block).
# beta: approved (or invited, already vetted) - no expiration, feedback
#   widget visible.
# rejected: a beta_pending signup a super_admin declined - distinct from
#   suspended on purpose, see KNOWN_DECISIONS.md.
# suspended: declared, never assigned - see KNOWN_DECISIONS.md.
SubscriptionStatus = Literal[
    "beta_pending", "beta", "trial", "active", "expired", "cancelled", "rejected", "suspended"
]


class RegisterRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    first_name: str = Field(min_length=1)
    last_name: str = Field(min_length=1)
    # Provide EITHER invite_token (join an existing company - the invite
    # determines which company and role) OR nothing (create a new company,
    # becoming its founding admin - invite_token's own absence is what
    # selects this path, not company_name's presence). Providing both is
    # rejected as ambiguous - see auth.py's register(). company_name itself
    # is optional on the new-company path: left blank, the new company's
    # display name defaults to the founding admin's own first+last name
    # rather than forcing a placeholder into a real field (see
    # KNOWN_DECISIONS.md).
    invite_token: str | None = None
    company_name: str | None = None
    company_type: str = "construction"
    # Only used when accepting a company-less invite (see admin.py's
    # create_super_admin_invite / auth.py's register()) - the invitee names
    # their own company right here, in the same registration call, rather
    # than a separate follow-up request. Ignored on every other path.
    # Optional, same as company_name above - blank defaults to the founding
    # admin's own name.
    new_company_name: str | None = None
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
    # Optional free-text "how did you hear about us", only meaningful on a
    # new-company path (company_name or new_company_name) - ignored when
    # joining an existing company via a normal invite, since that company's
    # acquisition_source was already captured when IT was created. Never a
    # signup blocker - see Company.acquisition_source.
    acquisition_source: str | None = None
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
    # None only for a company-less invite (requires_company_name=True) -
    # there's no company yet for the invitee to see the name of.
    company_name: str | None = None
    vertical_display_name: str
    role: str
    # True => the registration form must collect a company name (the
    # invitee is creating their own company, not joining an existing one).
    requires_company_name: bool = False
    # Always present - Invite.email is non-nullable. Lets the registration
    # form pre-fill and lock the email field (see auth.py's register(),
    # which already 403s if the submitted email doesn't match this exact
    # value) so an invitee can't accidentally register under a different
    # address than the one actually invited.
    email: str


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


class VerifyEmailRequest(BaseModel):
    token: str


class ResendVerificationResponse(BaseModel):
    message: str


class TokenResponse(BaseModel):
    token: str
    company_id: int | None = None
    company_type: str | None = None
    role: str
    first_name: str | None = None
    last_name: str | None = None
    preferred_locale: str | None = None
    preferred_theme: str | None = None
    email_verified: bool = True


class RefreshTokenResponse(BaseModel):
    """Just a new access token - unlike TokenResponse (login/register),
    there's no reason to re-send the whole profile on every silent refresh;
    the frontend already holds it from the original login and refresh never
    changes it."""

    token: str


class UpdateLocaleRequest(BaseModel):
    locale: str = Field(min_length=2, max_length=10)


class UpdateThemeRequest(BaseModel):
    theme: Literal["light", "dark"]


class InviteCreateRequest(BaseModel):
    email: str
    role: str = "member"  # 'admin' or 'member'


class SuperAdminInviteCreateRequest(BaseModel):
    """Company-less invite (see admin.py's create_super_admin_invite) -
    only an email and a vertical (via the same construction/municipality/
    accounting selector used everywhere else a company is created). No
    company name, no region, no role choice: the invitee always becomes
    the founding 'admin' of a company they create themselves at
    acceptance time (see auth.py's register())."""

    email: str
    company_type: str = "construction"

    @field_validator("company_type")
    @classmethod
    def _validate_company_type(cls, v: str) -> str:
        if v not in COMPANY_TYPES:
            raise ValueError(f"company_type must be one of {COMPANY_TYPES}")
        return v


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
    # Optional: the frontend's current in-memory locale, sent explicitly so
    # a language toggle takes effect on the very next message even if the
    # PATCH /auth/me/locale request it fired (fire-and-forget, not awaited -
    # see i18n.tsx's setLocale()) hasn't landed in the DB yet. Falls back to
    # CurrentUser.preferred_locale (the DB value) when omitted, so older
    # clients or direct API callers are unaffected.
    preferred_locale: str | None = None


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
    # Genuine per-answer follow-up questions (Section 5b) - always [] except
    # on a confident (gap=False), cited answer where the model's completion
    # included FOLLOWUP_MARKER's block. The frontend shows no chips at all
    # when this is empty, rather than falling back to generic defaults.
    followups: list[str] = []
    # Document-upload nudge signal (UX proposal Part 1) - True only when the
    # active project genuinely has zero documents (checked server-side
    # before the model is even asked, see _project_has_documents) AND the
    # model judged, under a deliberately conservative instruction, that its
    # answer was general/zone-level specifically because no project
    # document existed. Default False/None, same discipline as citations -
    # a false positive here (telling a correct, precise answer "could be
    # better") is worse than a missed nudge.
    would_benefit_from_document: bool = False
    suggested_document_type: str | None = None


class ChatHistoryItem(BaseModel):
    id: int
    message: str
    response: str
    citations: list[ChatMessageCitation] = []
    gap: bool | None = None  # NULL for rows written by the older POST /chat
    followups: list[str] = []
    created_at: datetime
    # 'gap_resolution_notice' marks a system-generated follow-up inserted by
    # the "Ενημέρωση χρήστη" gap-discovery action (see
    # POST /admin/gap-source-candidates/{id}/notify-user) rather than a
    # real user question - the frontend renders it without the usual
    # question bubble. NULL/other values are ordinary Q&A turns.
    tool_used: str | None = None


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
    # Calendar-day count (resets at midnight) - feeds the company admin
    # usage table's pool-relative framing and the 20+/day anomaly
    # indicator (Finance's number, admin-only, never shown to the user
    # it describes). Message counts only, no token/cost fields on this
    # schema - see KNOWN_DECISIONS.md.
    messages_today: int = 0


# Platform-wide (super admin) equivalent of UserSummary/InviteSummary - adds
# company_id/company_name since, unlike the company-admin's own /companies/me
# view, a cross-company list is meaningless without knowing whose user or
# invite each row belongs to. company_id is nullable - super_admin accounts
# aren't tied to any single company.
class AdminUserSummary(UserSummary):
    company_id: int | None = None
    company_name: str
    vertical_slug: str | None = None
    # Surfaced from the owning Company.is_test_account (Users has no such
    # field of its own - see KNOWN_DECISIONS.md) so the frontend can split
    # the Users screen into real-users vs demo-accounts tabs without a
    # second flag.
    is_test_account: bool = False
    # Surfaced from the owning company's CompanySubscription.status, same
    # propagation pattern as is_test_account above - None for a company-less
    # user (every super_admin), who has no subscription to read from.
    subscription_status: SubscriptionStatus | None = None
    # Same propagation, only meaningful for subscription_status='trial' -
    # see CompanySummary.trial_ends_at.
    trial_ends_at: datetime | None = None
    # Surfaced from the owning Company.is_suspended - False for a
    # company-less user. Phase 4 of the beta/trial rollout: without this,
    # a user belonging to a suspended company would show that company's
    # raw subscription_status (e.g. still "beta") in the Users list
    # instead of Suspended, which is misleading - is_suspended always
    # takes priority over subscription_status, same as in CompaniesPanel.
    company_is_suspended: bool = False


# Plain-text, shown once in the confirmation modal, never stored - see
# POST /admin/users/{id}/reset-password.
class AdminResetPasswordResponse(BaseModel):
    new_password: str


class EmailStatusResponse(BaseModel):
    email_enabled: bool


class AdminInviteSummary(InviteSummary):
    # None for a still-pending company-less invite (see
    # SuperAdminInviteCreateRequest) - filled in once accepted, when the
    # invitee's own company gets created.
    company_id: int | None = None
    company_name: str | None = None


class CompanyOverviewResponse(BaseModel):
    users_total: int
    users_active_30d: int
    messages_30d: int
    gap_rate: float
    customers_total: int
    projects_total: int
    private_documents_count: int
    public_documents_count: int
    activity: list["ActivityEventEntry"]
    positive_feedback: int = 0
    negative_feedback: int = 0
    messages_last_14d: list[datetime] = []


class ActivityEventEntry(BaseModel):
    type: str  # 'chat_message', 'document_uploaded', 'project_created', 'case_added', 'customer_added', 'user_joined'
    created_at: datetime
    description: str
    actor_name: str | None = None


class CompanyDocumentSummary(BaseModel):
    id: int
    title: str | None
    project_id: int | None
    project_name: str | None
    customer_id: int | None = None
    customer_name: str | None = None
    scope_tier: str = "company"  # 'company', 'customer', 'project'
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


class AuditLogListResponse(BaseModel):
    items: list[AuditLogEntry]
    total: int


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
    is_test_account: bool = False
    created_at: datetime
    vertical_id: int | None = None
    vertical_slug: str | None = None
    active_users_count: int = 0
    active_projects_count: int = 0
    # None only for a company somehow missing its CompanySubscription row -
    # every company created after Phase 2 gets one eagerly at registration
    # time (see auth.py/admin.py), and every pre-existing one was backfilled
    # (db/init.sql) - this should be unreachable in practice.
    subscription_status: SubscriptionStatus | None = None
    # Only meaningful (non-null) for status='trial' - Phase 4 of the
    # beta/trial rollout, so the Companies/Users list can show "Trial (N
    # days)" instead of a bare "Trial" the way it can for every other
    # status. beta_pending/beta genuinely have no expiration.
    trial_ends_at: datetime | None = None


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
    # standard TRIAL_DAYS_DEFAULT (30). trial_days is accepted regardless
    # of is_test_account so a super admin can also hand a real prospect a
    # non-default trial length without marking them a test account.
    is_test_account: bool = False
    trial_days: int = 30  # matches app/services/subscription.py's TRIAL_DAYS_DEFAULT
    # Optional free-text "how did you hear about us", filled by the
    # super_admin creating this company - see Company.acquisition_source.
    acquisition_source: str | None = None

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
    vertical_tagline_en: str | None
    vertical_welcome_message: str | None
    vertical_welcome_message_en: str | None
    vertical_disclaimer_text: str | None
    vertical_disclaimer_text_en: str | None
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
    # Populated from the live Customer record when customer_id is set (see
    # _to_project_summary()) - not stored on Project itself. Lets the chat
    # context switcher search/display real customer name+AFM without a
    # per-project follow-up call.
    customer_afm: str | None = None
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
    # English translation, same Greek-fallback pattern as the vertical
    # content fields - not auto-populated (check_archaeological_flag() only
    # writes the Greek notes), set by hand per project when a real
    # translation exists.
    archaeological_notes_en: str | None = None
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


# Super admin's full-source-visibility screen (GET /admin/companies-documents,
# /admin/companies/{id}/customers-documents) - see routers/admin.py. Distinct
# from CompanySummary/CustomerSummary above, which back the existing
# company/customer management screens and don't carry document counts.
class CompanyDocumentsSummary(BaseModel):
    company_id: int
    company_name: str
    company_type: str
    vertical_slug: str | None = None
    document_count: int = 0
    storage_bytes: int = 0
    customer_count: int = 0


class CustomerDocumentsSummary(BaseModel):
    id: int
    name: str
    afm: str | None = None
    phone: str | None = None
    email: str | None = None
    document_count: int = 0


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
    # Stable identifier for the two rejection reasons the frontend renders
    # localized copy for, instead of matching on `error`'s raw English text
    # (which would leak untranslated into the Greek UI and break silently
    # if the English wording ever changed). None for the extraction-
    # exception path, which still surfaces a generic fallback message.
    error_code: Literal["unsupported_file_type", "file_too_large"] | None = None


class RegionSummary(BaseModel):
    region_id: str
    region_name_el: str
    region_name_en: str
    level: str
    status: str
    has_coefficient_data: bool | None = None
    has_zone_level_coefficient_text: bool | None = None


class RegionRequestSummary(BaseModel):
    region_id: str
    region_name_el: str
    region_name_en: str
    request_count: int
    last_requested_at: datetime


class RegionContactCandidateSummary(BaseModel):
    id: int
    region_id: str
    region_name_el: str
    candidate_authority_name: str | None
    candidate_phone: str | None
    candidate_email: str | None
    source_url: str
    discovered_at: datetime
    status: str


class RegionContactCandidateConfirmRequest(BaseModel):
    # Overrides applied before writing to the live Region row - present
    # only when the reviewer edited the discovered candidate first
    # ("Edit then Confirm"); omitted fields fall back to the candidate's
    # own discovered value.
    authority_name: str | None = None
    phone: str | None = None
    email: str | None = None


class RegionContactCandidateRejectRequest(BaseModel):
    review_note: str | None = None


class RegionDiscoveryBatchRunRequest(BaseModel):
    # Omitted -> falls back to RegionDiscoverySettings.default_batch_size.
    batch_size: int | None = Field(default=None, ge=1, le=50)


class RegionDiscoveryBatchResult(BaseModel):
    """Same-shape summary as the pilot batch's own report - N candidates
    found, N regions with nothing found - surfaced in the admin UI right
    after a batch completes, before any review happens."""

    region_ids_attempted: list[str]
    candidates_found: int
    not_found_region_ids: list[str]
    skipped: list[dict]


class RegionDiscoverySettingsSummary(BaseModel):
    cadence_type: str
    default_batch_size: int
    updated_at: datetime


class RegionDiscoverySettingsUpdateRequest(BaseModel):
    cadence_type: Literal["manual", "weekly", "monthly"] | None = None
    default_batch_size: int | None = Field(default=None, ge=1, le=50)


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
    # Every stale doc here is public/national KB (company_id IS NULL, see
    # list_stale_documents), but still belongs to exactly one vertical -
    # lets the super admin dashboard's vertical filter scope this list too.
    vertical_slug: str


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
    # Active companies excluding is_test_account - some KNOWN_DECISIONS.md
    # entries have a "revisit when more than N active companies" trigger
    # keyed off this exact number (see app/services/growth_alerts.py).
    real_active_companies: int = 0
    # true_gap() rows not yet marked ChatSession.gap_addressed - the
    # persistent "unresolved gaps: N" count backing the dashboard's
    # promoted gap-rate card (Part D of the same-night batch - see
    # KNOWN_DECISIONS.md). Same all-time, not_test_company/
    # not_solo_super_admin scope as gap_rate itself, not a 30-day window.
    unresolved_gaps: int = 0


class VerticalStatsEntry(BaseModel):
    slug: str
    messages: int
    gap_rate: float
    active_documents: int
    active_companies: int
    positive_feedback: int = 0
    negative_feedback: int = 0
    platform_tokens_30d: int = 0
    platform_cost_eur_30d: float = 0.0
    suspended_companies: int = 0
    unresolved_gaps: int = 0


class AdminStatsByVerticalResponse(BaseModel):
    total: AdminStatsResponse
    by_vertical: list[VerticalStatsEntry]


class BusinessHealthDayEntry(BaseModel):
    date: str  # YYYY-MM-DD
    spend_eur: float
    messages: int
    # 0.0 (not an error) on a day with zero messages - mirrors
    # AdminStatsResponse.gap_rate's convention.
    gap_rate: float
    positive_feedback: int
    negative_feedback: int
    # positive / (positive + negative) * 100, rounded to 1 decimal - None on
    # a day with zero feedback rows, so a sparse day doesn't render as a
    # misleading flat 0% or 100% on the chart.
    feedback_ratio: float | None
    # Cumulative real (non-test, non-solo-super-admin) companies/users
    # registered by end of this day - a growth trend, not a live "active
    # right now" count (historical suspension state isn't tracked, so that
    # reconstruction isn't possible; this is honestly a registration curve).
    real_companies_cumulative: int
    real_users_cumulative: int


class BusinessHealthResponse(BaseModel):
    days: int
    timeline: list[BusinessHealthDayEntry]
    total_spend_eur: float
    # Distinct real users who sent at least one message in the period -
    # "active" meaning actually used the product, not just registered.
    real_active_users_period: int
    # total_spend_eur / real_active_users_period - None when that's zero
    # (nothing to divide by), not 0.0, so it can't be misread as "free."
    cost_per_real_active_user_eur: float | None


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


class SpendAlertThresholdEntry(BaseModel):
    daily_eur: float
    weekly_eur: float
    updated_at: datetime


class SpendAlertThresholdUpdateRequest(BaseModel):
    daily_eur: float
    weekly_eur: float


class SpendAlertCheckEntry(BaseModel):
    spend_24h_eur: float
    spend_7d_eur: float
    daily_breached: bool
    weekly_breached: bool
    created_at: datetime


class SpendAlertsResponse(BaseModel):
    thresholds: SpendAlertThresholdEntry
    latest: SpendAlertCheckEntry | None
    # Most recent readings, oldest first - chart-ready, mirrors InfraHealthResponse.
    history: list[SpendAlertCheckEntry]


class WeeklyDigestEntry(BaseModel):
    total_messages: int
    gap_rate: float
    spend_7d_eur: float
    active_companies: int
    open_feedback: int
    needs_review: int
    new_gaps: int
    recipients_sent: int
    recipients_total: int
    triggered_manually: bool
    created_at: datetime


class WeeklyDigestsResponse(BaseModel):
    latest: WeeklyDigestEntry | None
    # Most-recent-first, unlike SpendAlertsResponse/InfraHealthResponse's
    # history (no chart here, just a readable list).
    history: list[WeeklyDigestEntry]


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
    last_health_check_at: datetime | None = None
    last_health_check_status: str | None = None
    last_health_check_error: str | None = None
    consecutive_failures: int = 0
    failing_since: datetime | None = None


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


class SyncAllResponse(BaseModel):
    queued: int
    estimated_minutes: int


class SyncAllStatusResponse(BaseModel):
    # total lets a fresh page load (no local memory of what was POSTed)
    # compute "N of M" progress and correctly resume showing a run already
    # in flight - see DataSourcesPanel's on-mount status check.
    total: int
    pending: int
    healthy: int
    failed: int
    blocked: int
    current_source_name: str | None = None
    last_updated: datetime | None = None


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
    tagline_en: str | None
    welcome_message: str | None
    welcome_message_en: str | None
    disclaimer_text: str | None
    disclaimer_text_en: str | None
    system_prompt_override: str | None
    off_topic_hint: str | None
    uses_regional_scoping: bool
    status: str


class VerticalUpdateRequest(BaseModel):
    tagline: str | None = None
    # English translation - same Greek-fallback pattern as
    # welcome_message_en/disclaimer_text_en below.
    tagline_en: str | None = None
    welcome_message: str | None = None
    # English translation - the chat page's empty-state copy falls back to
    # welcome_message (Greek) when this is null, same pattern as
    # disclaimer_text_en below.
    welcome_message_en: str | None = None
    # Matches the frontend textarea's cap (VerticalEditorPanel.tsx) - this is
    # the chat page's persistent disclaimerBar text (rendered once per
    # thread, not per answer - see chat/page.tsx), so it needs to stay short
    # regardless of which path (UI or a direct API call) sets it.
    disclaimer_text: str | None = Field(default=None, max_length=200)
    # English translation, same cap - the frontend falls back to
    # disclaimer_text when this is null (see models.py's Vertical comment).
    disclaimer_text_en: str | None = Field(default=None, max_length=200)
    system_prompt_override: str | None = None
    off_topic_hint: str | None = None


class GapQueryEntry(BaseModel):
    id: int
    message: str
    company_id: int | None
    company_name: str | None
    user_id: int | None
    user_name: str | None
    created_at: datetime
    addressed: bool
    addressed_at: datetime | None


class GapStatusUpdateRequest(BaseModel):
    addressed: bool


class GapSourceCandidateEntry(BaseModel):
    id: int
    chat_session_id: int
    question: str
    candidate_title: str | None
    candidate_content: str | None
    source_url: str
    authority: str | None
    confidence: str | None
    discovered_at: datetime
    status: str
    review_note: str | None
    document_id: int | None
    notified_at: datetime | None
    notify_skipped_at: datetime | None
    # 'external_search' (the ordinary "Αναζήτηση πηγής" web-search flow) or
    # 'recheck_recovery' ("Επανέλεγχος όλων" found the answer was already in
    # the KB, just not retrieving with enough confidence before - no new
    # Document was created, document_id points at the pre-existing one).
    # Frontend groups on this so a recovered-from-KB batch isn't mixed in
    # with genuinely-new external sources, which need heavier scrutiny.
    origin: str = "external_search"
    # Who actually asked the original question - same fields GapQueryEntry
    # already carries, resolved here too so every review card can show it
    # alongside the question itself, not just the "recent gaps" table.
    company_name: str | None = None
    user_name: str | None = None


class GapDiscoveryResult(BaseModel):
    # None when the search genuinely found nothing citable in the allowed
    # authoritative domains - a real, expected outcome, not an error.
    candidate: GapSourceCandidateEntry | None


class GapRecheckAllResponse(BaseModel):
    queued: int
    estimated_minutes: int


class GapRecheckStatusResponse(BaseModel):
    # Same reasoning as SyncAllStatusResponse.total - lets a fresh page load
    # resume showing an in-flight run's real progress.
    total: int
    pending: int
    recovered: int
    still_gap: int
    failed: int
    last_updated: datetime | None = None


class GapSourceCandidateConfirmRequest(BaseModel):
    # The frontend always sends the full current (possibly-edited) field
    # state, same discipline as RegionContactCandidateConfirmRequest - no
    # partial-override fallback to the original discovered values.
    title: str = Field(min_length=1)
    content: str = Field(min_length=1)
    source_url: str = Field(min_length=1)
    authority: str | None = None


class GapSourceCandidateRejectRequest(BaseModel):
    review_note: str | None = None


class GapSourceNotifyRequest(BaseModel):
    # True (default) matches the endpoint's original behavior - in-app
    # notification + email. False is the "in-app only" choice added
    # alongside skip-notify: the same follow-up ChatSession/notification
    # still lands, just without an email, for an asker who's already
    # gotten several of these and doesn't need another inbox ping for
    # every individually-resolved gap.
    send_email: bool = True


class GapSourceNotifyResult(BaseModel):
    notified_at: datetime
    chat_session_id: int
    email_sent: bool


class InternalChatActivityEntry(BaseModel):
    """One ChatSession row belonging to a company-less super_admin account -
    see GET /admin/internal-activity's own docstring for why this exists
    separately from the platform stat cards."""

    id: int
    actor_email: str
    message: str | None
    gap: bool | None
    created_at: datetime


class InternalAuditActivityEntry(BaseModel):
    id: int
    actor_email: str
    action: str
    resource_type: str | None
    resource_id: int | None
    created_at: datetime


class InternalActivityResponse(BaseModel):
    chat_activity: list[InternalChatActivityEntry]
    audit_activity: list[InternalAuditActivityEntry]


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


class DocumentExtractionStatusUpdateRequest(BaseModel):
    # One of 'full_text','reference_only','manual_entry_pending','manual_entry'
    # - see Document.extraction_status's comment in models.py for what each
    # means. Not validated against that list here since the set is a
    # documented convention, not a DB enum/constraint.
    extraction_status: str = Field(min_length=1)


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
    # Calendar-day count (resets at midnight UTC, not a rolling 24h window
    # like `used` above) - purely informational, no threshold or color
    # coding attached to it. See KNOWN_DECISIONS.md: message counts only,
    # never tokens/€, for any role other than super_admin.
    messages_today: int


class UserUsageSummary(BaseModel):
    messages_30d: int


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
    status: SubscriptionStatus
    trial_ends_at: datetime | None
    # started_at on the subscription row - the trial-day-count anchor for
    # TrialNudgeBanner's conversion nudge (Phase 4c; component renamed away
    # from Day45Banner when the trial length changed from 60 to 30 days -
    # see KNOWN_DECISIONS.md), computed client-side the same way TrialBanner
    # already derives days-remaining from trial_ends_at.
    trial_started_at: datetime
    current_period_end: datetime | None
    messages_used: int
    messages_limit: int
    users_count: int
    user_limit: int
    # Lets the frontend suppress TrialNudgeBanner's conversion nudge for
    # is_test_account companies (see Phase 5) without a second request.
    is_test_account: bool
    # Pace-based projection (see compute_pool_risk_projection) - True only
    # when the company's recent messaging pace would exhaust the pool with
    # more than a few days still left in the billing period. Always False
    # for is_beta plans (no meaningful pool to run out of). Replaces the
    # old fixed remaining-count threshold per UX/Finance guidance.
    pool_at_risk: bool
    # The same projection's day count, whenever there's enough recent
    # activity to compute a pace at all - populated even when pool_at_risk
    # is False, so the company admin dashboard (Section 6b) can show a
    # concrete "on track" figure, not just a boolean. None when there's
    # too little recent signal to project anything, or for is_beta plans.
    pool_days_until_exhaustion: int | None
    # Storage usage vs. plan ceiling (Section 6c), matching the message-pool
    # display pattern above. storage_limit_bytes is None on Starter/beta
    # plans (see check_storage_limit) - no ceiling enforced there, so the
    # frontend shows the raw usage with no bar, same as an unlimited pool.
    storage_used_bytes: int
    storage_limit_bytes: int | None


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
    subscription_status: SubscriptionStatus | None = None
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
    status: SubscriptionStatus
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


class CancelSubscriptionRequest(BaseModel):
    # Optional (Item 3, churn capture) - free text, never a hard blocker on
    # actually cancelling. NULL/omitted is a valid, expected value: a
    # super_admin should always be able to cancel a subscription even with
    # no reason on hand, same "don't force a taxonomy or a required field
    # onto something that just needs to happen" reasoning as the
    # acquisition-source field (Item 2).
    reason: str | None = None


class AddSubscriptionNoteRequest(BaseModel):
    notes: str


class RejectBetaSignupRequest(BaseModel):
    # Optional, same "never a hard blocker" reasoning as
    # CancelSubscriptionRequest.reason above - stored on
    # CompanySubscription.notes rather than a new column.
    reason: str | None = None


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


class LegalDocumentAdminSummary(BaseModel):
    """One card's worth of data for the admin legal-documents screen -
    no content, so the list endpoint stays light."""

    slug: Literal["terms", "privacy", "dpa"]
    title: str
    is_published: bool
    version: int
    placeholder_count: int
    published_at: datetime | None
    updated_at: datetime
    updated_by_name: str | None


class LegalDocumentAdminDetail(LegalDocumentAdminSummary):
    content: str
    placeholders: list[str]


class LegalDocumentSaveRequest(BaseModel):
    title: str
    content: str


class LegalDocumentPublishError(BaseModel):
    detail: str
    placeholders: list[str]


class LegalDocumentUnpublishRequest(BaseModel):
    confirmed: bool = False


class EmailTemplateSummary(BaseModel):
    """One card's worth of data for the admin email-templates screen - no
    body content, so the list endpoint stays light, same split as
    LegalDocumentAdminSummary/Detail."""

    template_key: Literal["invite", "invite_no_company", "welcome", "password_reset", "email_verification"]
    subject_el: str
    updated_at: datetime
    updated_by_name: str | None


class EmailTemplateDetail(EmailTemplateSummary):
    subject_en: str
    body_el: str
    body_en: str
    available_variables: list[str]


class EmailTemplateSaveRequest(BaseModel):
    subject_el: str = Field(min_length=1)
    subject_en: str = Field(min_length=1)
    body_el: str = Field(min_length=1)
    body_en: str = Field(min_length=1)


class EmailTemplateTestSendRequest(BaseModel):
    subject_el: str
    subject_en: str
    body_el: str
    body_en: str


class EmailTestSendResponse(BaseModel):
    sent: bool
    # None when sent=True; "disabled" (email sending off in this
    # environment) or "send_failed" (Resend rejected/errored) otherwise -
    # lets the frontend show a specific message instead of a generic one.
    reason: Literal["disabled", "send_failed"] | None = None


class EmailSettingsEntry(BaseModel):
    test_email_address: str
    updated_at: datetime


class EmailSettingsUpdateRequest(BaseModel):
    test_email_address: str = Field(min_length=3)


class PlatformSettingsEntry(BaseModel):
    beta_ended: bool
    updated_at: datetime


class PlatformSettingsUpdateRequest(BaseModel):
    beta_ended: bool


HELP_ROLES = ("member", "admin", "super_admin")
HELP_VERTICALS = ("construction", "tax_accounting")


class HelpSectionAdminSummary(BaseModel):
    id: int
    slug: str
    title_el: str
    visible_to_roles: list[str]
    vertical_scope: str | None
    display_order: int
    is_active: bool
    updated_at: datetime
    updated_by_name: str | None


class HelpSectionAdminDetail(HelpSectionAdminSummary):
    title_en: str
    body_el: str
    body_en: str


class HelpSectionSaveRequest(BaseModel):
    slug: str = Field(min_length=1, max_length=50)
    title_el: str = Field(min_length=1)
    title_en: str = Field(min_length=1)
    body_el: str = Field(min_length=1)
    body_en: str = Field(min_length=1)
    visible_to_roles: list[str] = Field(min_length=1)
    vertical_scope: str | None = None
    is_active: bool = True

    @field_validator("visible_to_roles")
    @classmethod
    def _valid_roles(cls, v: list[str]) -> list[str]:
        bad = [r for r in v if r not in HELP_ROLES]
        if bad:
            raise ValueError(f"Unknown role(s): {', '.join(bad)}")
        return v

    @field_validator("vertical_scope")
    @classmethod
    def _valid_vertical(cls, v: str | None) -> str | None:
        if v is not None and v not in HELP_VERTICALS:
            raise ValueError(f"Unknown vertical_scope: {v}")
        return v


class HelpSectionReorderRequest(BaseModel):
    ordered_ids: list[int] = Field(min_length=1)


class HelpSectionPublic(BaseModel):
    """Locale-resolved for the requester's current UI language - the public
    endpoint picks title_el/body_el vs title_en/body_en server-side rather
    than shipping both and making the frontend choose."""

    id: int
    slug: str
    title: str
    body: str
