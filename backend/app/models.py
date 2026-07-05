from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import ARRAY, Date, DateTime, ForeignKey, Integer, JSON, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(Text)
    type: Mapped[str] = mapped_column(Text, default="construction")  # 'construction', 'municipality'
    logo_path: Mapped[str | None] = mapped_column(Text)
    is_suspended: Mapped[bool] = mapped_column(default=False)
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
    role: Mapped[str] = mapped_column(Text, default="member")  # 'super_admin', 'admin', 'member'
    is_active: Mapped[bool] = mapped_column(default=True)
    password_hash: Mapped[str] = mapped_column(Text)
    preferred_locale: Mapped[str | None] = mapped_column(Text)
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
    raw_json: Mapped[dict | None] = mapped_column(JSON)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"))
    municipality: Mapped[str | None] = mapped_column(Text)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(Text, default="active")  # 'active', 'superseded', 'removed'
    replaces_document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # National/regional tier + classification metadata (see docs/kb-architecture -
    # added to support Kavala-style regional content without a future schema change).
    scope: Mapped[str] = mapped_column(Text, default="national")  # 'national', 'regional'
    region_id: Mapped[str | None] = mapped_column(ForeignKey("regions.region_id"))
    authority: Mapped[str | None] = mapped_column(Text)  # 'tee','ydom','dasarcheio','deddie','deya','ktimatologio','aade','efka','mida','other'
    permit_stage: Mapped[str | None] = mapped_column(Text)  # 'pre_application','permit_issuance','during_construction','utility_connection','post_construction_registration','tax'
    content_type: Mapped[str | None] = mapped_column(Text)  # 'procedural_howto','legal_reference','regulatory_change_notice','form','faq'
    extraction_status: Mapped[str | None] = mapped_column(Text)  # 'full_text','reference_only','manual_entry_pending'
    last_verified_at: Mapped[date | None] = mapped_column(Date)
    # Set by the weekly staleness job (crawler/crawler/staleness.py), not by
    # request-time queries - so the review queue stays cheap and stable
    # instead of recomputing "is this stale" on every page load.
    needs_review: Mapped[bool] = mapped_column(default=False)

    embeddings: Mapped[list["Embedding"]] = relationship(back_populates="document")


class UtilityProvider(Base):
    __tablename__ = "utility_providers"

    provider_id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, e.g. 'deya-kavalas'
    provider_type: Mapped[str] = mapped_column(Text)  # 'water', 'electric_grid'
    provider_name: Mapped[str] = mapped_column(Text)
    base_url: Mapped[str | None] = mapped_column(Text)
    coverage_region_ids: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list)
    status: Mapped[str] = mapped_column(Text, default="pending")  # 'active', 'pending', 'stub'
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Region(Base):
    __tablename__ = "regions"

    region_id: Mapped[str] = mapped_column(Text, primary_key=True)  # slug, e.g. 'kavala'
    region_name_el: Mapped[str] = mapped_column(Text)
    region_name_en: Mapped[str] = mapped_column(Text)
    level: Mapped[str] = mapped_column(Text)  # 'municipality', 'regional_unit', 'region'
    parent_region_id: Mapped[str | None] = mapped_column(ForeignKey("regions.region_id"))
    ydom_authority_name: Mapped[str | None] = mapped_column(Text)
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
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


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
