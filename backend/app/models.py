from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import ARRAY, Date, DateTime, ForeignKey, Integer, JSON, Numeric, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Vertical(Base):
    __tablename__ = "verticals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, unique=True)
    display_name: Mapped[str] = mapped_column(Text)
    tagline: Mapped[str | None] = mapped_column(Text)
    welcome_message: Mapped[str | None] = mapped_column(Text)
    disclaimer_text: Mapped[str | None] = mapped_column(Text)
    system_prompt_override: Mapped[str | None] = mapped_column(Text)
    off_topic_hint: Mapped[str | None] = mapped_column(Text)
    uses_regional_scoping: Mapped[bool] = mapped_column(default=True)
    status: Mapped[str] = mapped_column(Text, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DataSource(Base):
    __tablename__ = "data_sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vertical_id: Mapped[int] = mapped_column(ForeignKey("verticals.id"))
    name: Mapped[str] = mapped_column(Text)
    base_url: Mapped[str] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(Text, default="html_page")
    crawl_frequency_type: Mapped[str] = mapped_column(Text, default="monthly")  # 'daily', 'weekly', 'monthly', 'custom'
    crawl_frequency_days: Mapped[int] = mapped_column(Integer, default=30)
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Authoritative "when will this next run" regardless of frequency_type -
    # always read this field for scheduling, never re-derive from frequency
    # alone (an admin can override it manually via PATCH).
    next_crawl_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_crawl_status: Mapped[str | None] = mapped_column(Text)
    last_crawl_document_count: Mapped[int | None] = mapped_column(Integer)
    last_crawl_error: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text, default="construction")  # 'construction', 'municipality'
    logo_path: Mapped[str | None] = mapped_column(Text)
    is_suspended: Mapped[bool] = mapped_column(default=False)
    vertical_id: Mapped[int] = mapped_column(ForeignKey("verticals.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Invite(Base):
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    email: Mapped[str] = mapped_column(Text)
    token: Mapped[str] = mapped_column(Text, unique=True)
    role: Mapped[str] = mapped_column(Text, default="member")
    status: Mapped[str] = mapped_column(Text, default="pending")  # 'pending', 'accepted', 'revoked'
    invited_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    # Derived from company.vertical_id at invite-creation time, never chosen
    # manually - see app/routers/admin.py's invite-creation endpoint.
    vertical_id: Mapped[int | None] = mapped_column(ForeignKey("verticals.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    token: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    email: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text, default="member")  # 'super_admin', 'admin', 'member'
    is_active: Mapped[bool] = mapped_column(default=True)
    password_hash: Mapped[str] = mapped_column(Text)
    preferred_locale: Mapped[str | None] = mapped_column(Text)
    preferred_theme: Mapped[str | None] = mapped_column(Text)  # 'light' or 'dark'; NULL defaults to 'light'
    phone: Mapped[str | None] = mapped_column(Text)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str | None] = mapped_column(Text)
    doc_type: Mapped[str | None] = mapped_column(Text)
    identifier: Mapped[str | None] = mapped_column(Text)
    issue_number: Mapped[str | None] = mapped_column(Text)
    series: Mapped[str | None] = mapped_column(Text)
    date: Mapped[date | None] = mapped_column(Date)
    source: Mapped[str | None] = mapped_column(Text)
    language: Mapped[str] = mapped_column(Text, default="el")
    content: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str | None] = mapped_column(Text)
    source_name: Mapped[str | None] = mapped_column(Text)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    municipality: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(Text, default="active")  # 'active', 'superseded', 'removed'
    # Lives on the NEW document, points at the OLD document it supersedes -
    # not the reverse. When set, the referenced document's status must be
    # 'superseded'; enforced at the application layer (see
    # app/routers/documents.py and app/routers/admin.py's
    # mark-superseded/undo-supersede endpoints), not a DB trigger.
    replaces_document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"))
    vertical_id: Mapped[int] = mapped_column(ForeignKey("verticals.id"))
    # Set only for client/project-scoped uploads (e.g. a client's tax
    # records, a specific building's plans) - private to that project, never
    # returned by a query that doesn't explicitly scope to it. NULL means a
    # normal public/company KB document.
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # National/regional tier + classification metadata (see docs/kb-architecture -
    # added to support Kavala-style regional content without a future schema change).
    scope: Mapped[str] = mapped_column(Text, default="national")  # 'national', 'regional'
    region_id: Mapped[str | None] = mapped_column(ForeignKey("regions.region_id"))
    authority: Mapped[str | None] = mapped_column(Text)  # 'tee','ydom','dasarcheio','deddie','deya','ktimatologio','aade','efka','mida','ypen','other'
    permit_stage: Mapped[str | None] = mapped_column(Text)  # 'pre_application','permit_issuance','during_construction','utility_connection','post_construction_registration','tax'
    content_type: Mapped[str | None] = mapped_column(Text)  # 'procedural_howto','legal_reference','regulatory_change_notice','form','faq'
    # 'full_text','reference_only','manual_entry_pending' (a stub with no
    # content yet, awaiting future curation), 'manual_entry' (curated
    # content authored directly, not crawled - see KNOWN_DECISIONS.md).
    extraction_status: Mapped[str | None] = mapped_column(Text)
    last_verified_at: Mapped[date | None] = mapped_column(Date)
    # Set by the weekly staleness job (crawler/crawler/staleness.py), not by
    # request-time queries - so the review queue stays cheap and stable
    # instead of recomputing "is this stale" on every page load.
    needs_review: Mapped[bool] = mapped_column(default=False)

    # passive_deletes=True: trust the DB's ON DELETE CASCADE on
    # embeddings.document_id (see Embedding below) instead of SQLAlchemy's
    # default behavior of UPDATE-ing each embedding's document_id to NULL
    # before the delete - which fails outright since that column is
    # NOT NULL, surfacing as a raw connection error to the client rather
    # than a clean response.
    embeddings: Mapped[list["Embedding"]] = relationship(back_populates="document", passive_deletes=True)


class UtilityProvider(Base):
    __tablename__ = "utility_providers"

    provider_id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, e.g. 'deya-kavalas'
    provider_type: Mapped[str] = mapped_column(Text)  # 'water', 'electric_grid'
    provider_name: Mapped[str] = mapped_column(Text)
    base_url: Mapped[str | None] = mapped_column(Text)
    coverage_region_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    status: Mapped[str] = mapped_column(Text, default="pending")  # 'active', 'pending', 'stub'
    # NULL until a curation pass fills it in - see KNOWN_DECISIONS.md. Left
    # blank rather than scraped, since contact pages vary too much per site
    # to auto-extract reliably (same reasoning as base_url/ydom_authority_name).
    contact_phone: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Region(Base):
    __tablename__ = "regions"

    region_id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, e.g. 'kavala'
    region_name_el: Mapped[str] = mapped_column(Text)
    region_name_en: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(Text)  # 'municipality', 'regional_unit', 'region'
    parent_region_id: Mapped[str | None] = mapped_column(ForeignKey("regions.region_id"))
    ydom_authority_name: Mapped[str | None] = mapped_column(Text)
    # ΥΔΟΜ contact for this region - NULL until curated (see
    # KNOWN_DECISIONS.md); ΔΕΥΑ/ΔΕΔΔΗΕ contacts live on utility_providers
    # instead, since those are shared across regions, not per-region.
    contact_phone: Mapped[str | None] = mapped_column(Text)
    contact_email: Mapped[str | None] = mapped_column(Text)
    deya_provider_id: Mapped[str | None] = mapped_column(ForeignKey("utility_providers.provider_id"))
    deddie_region_id: Mapped[str | None] = mapped_column(ForeignKey("utility_providers.provider_id"))
    # 'active' once at least one utility provider is populated with real
    # content - no longer blocked on has_coefficient_data (see below). A
    # region can be genuinely useful (utility connection paperwork) well
    # before anyone's sourced its ΓΠΣ/ΖΟΕ coefficient figures.
    status: Mapped[str] = mapped_column(Text, default="pending")  # 'active', 'pending', 'stub'
    # Tracked separately from `status` on purpose: whether building
    # coefficients/setback figures have been sourced for this region.
    # True = sourced and in the KB. False = actively looked and confirmed
    # not available via the crawled ΥΔΟΜ page (e.g. it's a contact directory
    # with no numbers in it). None = not yet determined either way (e.g. the
    # source page couldn't be read at all, so absence hasn't been confirmed).
    has_coefficient_data: Mapped[bool | None] = mapped_column()
    # Distinct from has_coefficient_data on purpose: this is narrower and
    # more honest. True means a region's ΓΠΣ/ΑΑΠ ΦΕΚ has been ingested and it
    # does contain real building-coefficient/setback figures - but organized
    # by named zone ("Μπάτης-Τόσκα", etc.), not by address or parcel. It does
    # NOT mean a specific plot's coefficient can be looked up - that needs a
    # zone map (GIS/CAD data this pipeline doesn't parse) to resolve which
    # zone a given plot falls into. See KNOWN_DECISIONS.md.
    has_zone_level_coefficient_text: Mapped[bool | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ArchaeologicalSite(Base):
    """Known protected archaeological sites, checked by coordinate proximity
    (Haversine distance) in services/gis.py's check_archaeological_flag() -
    replaces an earlier RAG/municipality-text-matching approach that flagged
    every plot in a site's entire municipality regardless of actual distance
    from the declared zone (see KNOWN_DECISIONS.md)."""

    __tablename__ = "archaeological_sites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_el: Mapped[str] = mapped_column(Text)
    name_en: Mapped[str | None] = mapped_column(Text)
    region_id: Mapped[str | None] = mapped_column(ForeignKey("regions.region_id"))
    lat: Mapped[float] = mapped_column(Numeric(10, 7))
    lon: Mapped[float] = mapped_column(Numeric(10, 7))
    protection_radius_m: Mapped[int] = mapped_column(Integer, default=500)
    protection_zone_description: Mapped[str | None] = mapped_column(Text)
    legal_basis: Mapped[str] = mapped_column(Text, default="Ν.3028/2002")
    source_url: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Embedding(Base):
    __tablename__ = "embeddings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"))
    chunk_index: Mapped[int | None] = mapped_column(Integer)
    chunk_text: Mapped[str | None] = mapped_column(Text)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536))

    document: Mapped["Document"] = relationship(back_populates="embeddings")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    name: Mapped[str | None] = mapped_column(Text)
    municipality: Mapped[str | None] = mapped_column(Text)
    region_id: Mapped[str | None] = mapped_column(ForeignKey("regions.region_id"))
    address: Mapped[str | None] = mapped_column(Text)
    # True for a client engagement (chiefly the tax vertical, but available
    # to both) - in that case `name` is treated as the client's name.
    is_client: Mapped[bool] = mapped_column(default=False)
    client_notes: Mapped[str | None] = mapped_column(Text)
    # The plot's actual owner - distinct from is_client/client_notes above,
    # which describe the engagement, not the person.
    customer_name: Mapped[str | None] = mapped_column(Text)
    customer_notes: Mapped[str | None] = mapped_column(Text)
    # Plot location, set via POST /gis/resolve-location once a user drops a
    # pin - NULL means "no location set yet", not "location at 0,0".
    plot_address: Mapped[str | None] = mapped_column(Text)
    plot_municipality: Mapped[str | None] = mapped_column(Text)
    lat: Mapped[float | None] = mapped_column(Numeric(10, 7))
    lon: Mapped[float | None] = mapped_column(Numeric(10, 7))
    # Cadastral fields - best-effort/nullable, since the public Ktimatologio
    # WFS that would populate these is confirmed dead (see KNOWN_DECISIONS.md).
    kaek: Mapped[str | None] = mapped_column(Text)
    plot_area_sqm: Mapped[float | None] = mapped_column(Numeric)
    parcel_geometry: Mapped[dict | None] = mapped_column(JSON)
    # gis_zone_source records provenance (e.g. 'manual_entry') so a displayed
    # zone name is never presented as if it came from a live lookup when it didn't.
    gis_zone_name: Mapped[str | None] = mapped_column(Text)
    gis_zone_source: Mapped[str | None] = mapped_column(Text)
    # Set by services/gis.py's check_archaeological_flag() - coordinate
    # proximity (Haversine) against the archaeological_sites table, not a
    # live API (see KNOWN_DECISIONS.md).
    archaeological_flag: Mapped[bool] = mapped_column(default=False)
    archaeological_notes: Mapped[str | None] = mapped_column(Text)
    archaeological_site_name: Mapped[str | None] = mapped_column(Text)
    archaeological_distance_m: Mapped[int | None] = mapped_column(Integer)
    location_resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    # Real, reusable contact record - additive to customer_name/customer_notes
    # above, not a replacement (a project can still be created with just a
    # freeform name for a one-off, no-repeat-client case). See Customer below.
    customer_id: Mapped[int | None] = mapped_column(ForeignKey("customers.id"))
    # Ζώνη οικισμού - nullable, only meaningful once a location is set. See
    # build_location_context() and _retrieve() in app/services/rag.py.
    plot_in_plan: Mapped[bool | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    name: Mapped[str] = mapped_column(Text)
    afm: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(Text)
    email: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    message: Mapped[str | None] = mapped_column(Text)
    response: Mapped[str | None] = mapped_column(Text)
    tool_used: Mapped[str | None] = mapped_column(Text)
    # [{document_id, title, authority, source_url}, ...] as actually returned
    # to the caller - populated by POST /chat/message; left NULL by the older
    # POST /chat, which doesn't persist citations.
    citations: Mapped[list | None] = mapped_column(JSON)
    # Mirrors ChatMessageResponse.gap so a reloaded conversation (GET
    # /chat/history) can still show the low-confidence indicator - NULL for
    # rows written by the older POST /chat, which has no such concept.
    gap: Mapped[bool | None] = mapped_column(default=None)
    # NULL on every row where no GPT completion call was made at all (the
    # off-topic-guard classifier call doesn't count - see _log_session's
    # call sites in app/routers/chat.py) - distinguishes "no LLM call" from
    # a genuine zero-token response.
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)
    estimated_cost_eur: Mapped[float | None] = mapped_column(Numeric(10, 6))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class MessageFeedback(Base):
    __tablename__ = "message_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id"))
    # Position of the rated message in the frontend's displayed conversation
    # array (0-indexed) - not a position within this one session row, since
    # each chat_sessions row is already exactly one Q&A turn (one assistant
    # message). Carried through so future analytics can tell "was it an
    # early or late message in the conversation that got a bad rating",
    # even though session_id alone already identifies which turn this is.
    message_index: Mapped[int] = mapped_column(Integer)
    rating: Mapped[str] = mapped_column(Text)  # 'positive', 'negative'
    # Optional elaboration on a negative rating - NULL for every positive
    # rating (never prompted) and for a negative one where the user chose
    # "Παράλειψη" over typing anything.
    feedback_text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="pending")  # 'pending', 'solved', 'rejected'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BenchmarkAlert(Base):
    """One row per failing question from the weekly canary benchmark
    (crawler/crawler/canary_benchmark.py) - only failures are logged, so this
    table being empty for a given week means every canary question passed."""

    __tablename__ = "benchmark_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vertical: Mapped[str] = mapped_column(Text)
    question: Mapped[str] = mapped_column(Text)
    session_id: Mapped[int | None] = mapped_column(ForeignKey("chat_sessions.id"))
    gap: Mapped[bool] = mapped_column()
    citation_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    vertical_id: Mapped[int | None] = mapped_column(ForeignKey("verticals.id"))
    name: Mapped[str] = mapped_column(Text)
    slug: Mapped[str] = mapped_column(Text, unique=True)
    billing_cycle: Mapped[str] = mapped_column(Text, default="monthly")
    price_eur: Mapped[float] = mapped_column(Numeric(10, 2))
    user_limit: Mapped[int] = mapped_column(Integer)
    message_pool: Mapped[int] = mapped_column(Integer)
    # Bypasses the message pool check entirely in POST /chat/message
    # (see subscription_usage below) - unlimited usage during soft launch
    # regardless of the message_pool number on the row.
    is_beta: Mapped[bool] = mapped_column(default=False)
    # False keeps a plan out of any future public pricing listing without
    # deleting it - every beta plan is is_active=False for exactly this
    # reason (it's an internal assignment, not something a visitor picks).
    is_active: Mapped[bool] = mapped_column(default=True)
    features: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CompanySubscription(Base):
    __tablename__ = "company_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), unique=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"))
    status: Mapped[str] = mapped_column(Text, default="trial")  # 'trial','active','expired','cancelled','suspended'
    # Can diverge from the plan's own default billing_cycle - a company on
    # the Professional plan can be billed annually even though the plan
    # itself defaults to monthly.
    billing_cycle: Mapped[str] = mapped_column(Text, default="monthly")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime)
    stripe_customer_id: Mapped[str | None] = mapped_column(Text)
    stripe_subscription_id: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SubscriptionUsage(Base):
    __tablename__ = "subscription_usage"
    __table_args__ = (UniqueConstraint("company_id", "period_start"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    messages_used: Mapped[int] = mapped_column(Integer, default=0)
    messages_limit: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class UserDefaultProject(Base):
    __tablename__ = "user_default_projects"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), primary_key=True)


class DocumentRemovalRequest(Base):
    __tablename__ = "document_removal_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"))
    requested_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(Text, default="pending")  # 'pending', 'approved', 'rejected'
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Locale(Base):
    __tablename__ = "locales"

    code: Mapped[str] = mapped_column(Text, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    is_builtin: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class TranslationOverride(Base):
    __tablename__ = "translation_overrides"
    __table_args__ = (UniqueConstraint("locale", "key", name="uq_translation_overrides_locale_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    locale: Mapped[str] = mapped_column(ForeignKey("locales.code", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(Text)
    value: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text)
    link: Mapped[str | None] = mapped_column(Text)
    is_read: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    action: Mapped[str] = mapped_column(Text)
    resource_type: Mapped[str | None] = mapped_column(Text)
    resource_id: Mapped[int | None] = mapped_column(Integer)
    log_metadata: Mapped[dict | None] = mapped_column("metadata", JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
