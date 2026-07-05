-- theke: initial schema (Phase 1 MVP)
-- Runs once on first postgres container start (docker-entrypoint-initdb.d).

CREATE EXTENSION IF NOT EXISTS vector;

-- Companies (tenants) - both construction firms and municipalities are
-- 'companies' (tenants with users/billing); `type` distinguishes them
-- because their uploaded documents have different visibility rules (see
-- documents.municipality below).
CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    type VARCHAR NOT NULL DEFAULT 'construction',  -- 'construction', 'municipality'
    logo_path TEXT,  -- set via POST /companies/me/logo, served by GET /companies/{id}/logo
    is_suspended BOOLEAN NOT NULL DEFAULT false,  -- super_admin kill switch
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Users. `role` meaning depends on companies.type:
--   super_admin - platform-wide, company_id IS NULL, provisioned out-of-band
--     (env var bootstrap on startup) - never reachable via /auth/register.
--   admin  - construction: manages that company's KB/users.
--            municipality: manages that municipality's KB/users, approves removals.
--   member - construction: employee, read-only on documents (chat/search).
--            municipality: can upload/edit (new versions) but not remove outright.
-- Defined before invites/password_reset_tokens below since both reference
-- it - table creation order matters here (see KNOWN_DECISIONS.md: this file
-- previously had users declared after its own referencers, which only
-- "worked" because the dev DB's volume was created once, long before this
-- file reached that state, and was never re-run against a fresh database
-- until Phase 6 caught it).
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id),
    email TEXT UNIQUE NOT NULL,
    role VARCHAR NOT NULL DEFAULT 'member',   -- 'super_admin', 'admin', 'member'
    is_active BOOLEAN NOT NULL DEFAULT true,
    password_hash TEXT NOT NULL,
    preferred_locale VARCHAR,  -- UI language for this account; NULL = no preference set yet
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Per-person invites (replaces an earlier shared company-wide invite code,
-- which let anyone who obtained it join indefinitely with no record of who
-- was actually invited). An admin creates one per teammate; joining an
-- existing company always requires a valid, unexpired, matching-email token.
CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    company_id INT NOT NULL REFERENCES companies(id),
    email TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    role VARCHAR NOT NULL DEFAULT 'member',  -- role the invitee will get on acceptance
    status VARCHAR NOT NULL DEFAULT 'pending',  -- 'pending', 'accepted', 'revoked'
    invited_by INT NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL DEFAULT (now() + interval '7 days'),
    accepted_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_invites_company ON invites(company_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);

-- Utility providers (ΔΕΥΑ water utilities, ΔΕΔΔΗΕ electric-grid regional
-- offices). Modeled separately from regions since coverage isn't 1:1 with
-- a municipality: one ΔΕΥΑ can serve several municipalities, and ΔΕΔΔΗΕ's
-- own regional boundaries don't follow municipal ones at all.
CREATE TABLE IF NOT EXISTS utility_providers (
    provider_id VARCHAR PRIMARY KEY,          -- slug, e.g. 'deya-kavalas'
    provider_type VARCHAR NOT NULL,           -- 'water', 'electric_grid'
    provider_name VARCHAR NOT NULL,
    base_url VARCHAR,
    coverage_region_ids VARCHAR[] NOT NULL DEFAULT '{}',  -- soft reference to regions.region_id, no FK (array)
    status VARCHAR NOT NULL DEFAULT 'pending', -- 'active', 'pending', 'stub'
    contact_phone VARCHAR,                     -- NULL until curated - see KNOWN_DECISIONS.md
    contact_email VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Regions: municipality -> regional_unit -> region hierarchy for the
-- regional content tier (Kavala is the first one populated). Adding a new
-- region/provider is meant to be a data entry, not a schema or code change -
-- see the crawler's scoped-crawl workflow for how a `pending` region becomes
-- `active`.
CREATE TABLE IF NOT EXISTS regions (
    region_id VARCHAR PRIMARY KEY,             -- slug, e.g. 'kavala'
    region_name_el VARCHAR NOT NULL,
    region_name_en VARCHAR NOT NULL,
    level VARCHAR NOT NULL,                    -- 'municipality', 'regional_unit', 'region'
    parent_region_id VARCHAR REFERENCES regions(region_id),
    ydom_authority_name VARCHAR,               -- name of the ΥΔΟΜ office covering this municipality (may be shared)
    contact_phone VARCHAR,                     -- ΥΔΟΜ contact - NULL until curated, see KNOWN_DECISIONS.md
    contact_email VARCHAR,
    deya_provider_id VARCHAR REFERENCES utility_providers(provider_id),
    deddie_region_id VARCHAR REFERENCES utility_providers(provider_id),
    -- 'active' once at least one utility provider is populated with real
    -- content - not blocked on has_coefficient_data (see below).
    status VARCHAR NOT NULL DEFAULT 'pending', -- 'active', 'pending', 'stub'
    -- NULL = not yet determined, TRUE = sourced and in the KB, FALSE =
    -- actively looked and confirmed not available via the crawled ΥΔΟΜ page.
    has_coefficient_data BOOLEAN,
    -- Distinct from has_coefficient_data: TRUE means a ΓΠΣ/ΑΑΠ ΦΕΚ has been
    -- ingested with real zone-named coefficient/setback text - NOT a
    -- per-plot answer, since resolving a plot to its zone needs GIS/CAD map
    -- data this pipeline doesn't parse. See KNOWN_DECISIONS.md.
    has_zone_level_coefficient_text BOOLEAN,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_region_id);

-- Documents: crawled legal texts (public) AND uploaded documents (scoped).
-- Visibility rule, applied at query time (see backend/app/services/visibility.py):
--   company_id IS NULL                        -> public, everyone
--   company_id = requester's company_id        -> private (construction company upload)
--   municipality = requester's project/query municipality -> visible to anyone
--     asking about that municipality, regardless of their own company_id
--     (a municipality's uploads still carry their own company_id for
--     management/ownership, but the municipality match grants read access
--     to outside users - that's the whole point of them uploading it)
CREATE TABLE IF NOT EXISTS documents (
    id SERIAL PRIMARY KEY,
    title TEXT,
    doc_type VARCHAR,       -- 'law', 'PD', 'ministerial', 'circular', 'form'
    identifier VARCHAR,     -- e.g. '4495/2017'
    issue_number VARCHAR,
    series VARCHAR,         -- 'A', 'B', 'D', etc.
    date DATE,
    source VARCHAR,
    language VARCHAR DEFAULT 'el',
    content TEXT,
    content_hash TEXT,       -- sha256 of raw file bytes, for crawl dedup across re-discovered URLs
    -- Which crawler source ingested this (matches crawler/crawler/sources.py
    -- entry names, e.g. 'fek_search_api', 'tee_e_adeies'). NULL for uploads
    -- (they aren't crawled - see doc_type='upload' instead). Powers the
    -- "browse by source" UI.
    source_name VARCHAR,
    raw_json JSONB,
    company_id INT REFERENCES companies(id),  -- NULL = public/crawled
    municipality VARCHAR,                     -- set on municipality uploads for broad visibility
    uploaded_by INT REFERENCES users(id),
    status VARCHAR NOT NULL DEFAULT 'active',  -- 'active', 'superseded', 'removed'
    -- Set when this row is an edit (new version) of an earlier upload; the
    -- old row's status flips to 'superseded' immediately (editing needs no
    -- approval). Outright removal (no replacement) goes through
    -- document_removal_requests instead and needs admin sign-off.
    replaces_document_id INT REFERENCES documents(id),
    created_at TIMESTAMP NOT NULL DEFAULT now(),

    -- National/regional tier + classification metadata for the Greek
    -- construction-permitting KB architecture (national baseline vs.
    -- per-municipality/per-utility content, plus honest extraction-status
    -- tracking so a reference-only or manual-entry-pending document is never
    -- silently presented as if it were fully searchable).
    scope VARCHAR NOT NULL DEFAULT 'national',  -- 'national', 'regional'
    region_id VARCHAR REFERENCES regions(region_id),
    authority VARCHAR,       -- 'tee','ydom','dasarcheio','deddie','deya','ktimatologio','aade','efka','mida','other'
    permit_stage VARCHAR,    -- 'pre_application','permit_issuance','during_construction','utility_connection','post_construction_registration','tax'
    content_type VARCHAR,    -- 'procedural_howto','legal_reference','regulatory_change_notice','form','faq'
    extraction_status VARCHAR, -- 'full_text','reference_only','manual_entry_pending'
    last_verified_at DATE,
    -- Set by the weekly staleness job (crawler/crawler/staleness.py), not
    -- computed at request time, so the review queue is a plain flag read.
    needs_review BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_documents_region ON documents(region_id);
CREATE INDEX IF NOT EXISTS idx_documents_scope ON documents(scope);
CREATE INDEX IF NOT EXISTS idx_documents_authority ON documents(authority);
CREATE INDEX IF NOT EXISTS idx_documents_needs_review ON documents(needs_review) WHERE needs_review = true;

-- Public (crawled) docs must be globally unique by content; a company's own
-- uploads only need to be unique within that company (two different
-- companies uploading the same official form/PDF is legitimate).
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_content_hash_public ON documents(content_hash) WHERE company_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_content_hash_company ON documents(content_hash, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_identifier ON documents(identifier);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_documents_municipality ON documents(municipality);
CREATE INDEX IF NOT EXISTS idx_documents_source_name ON documents(source_name);
CREATE INDEX IF NOT EXISTS idx_documents_title_fts ON documents USING gin(to_tsvector('greek', coalesce(title, '')));
CREATE INDEX IF NOT EXISTS idx_documents_content_fts ON documents USING gin(to_tsvector('greek', coalesce(content, '')));

-- Embeddings (for vector search)
CREATE TABLE IF NOT EXISTS embeddings (
    id SERIAL PRIMARY KEY,
    document_id INT REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INT,
    chunk_text TEXT,
    embedding VECTOR(1536)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 128);

-- Companies' projects
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id),
    name TEXT,
    municipality VARCHAR,
    region_id VARCHAR REFERENCES regions(region_id),
    address TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_region ON projects(region_id);

-- A user's chosen project(s) for municipality context. If a user has
-- projects in more than one distinct municipality, /chat should confirm
-- which one on the first question of a session; a single project (or
-- multiple projects all in the same municipality) needs no prompt.
CREATE TABLE IF NOT EXISTS user_default_projects (
    user_id INT NOT NULL REFERENCES users(id),
    project_id INT NOT NULL REFERENCES projects(id),
    PRIMARY KEY (user_id, project_id)
);

-- Removing a document outright requires admin sign-off (editing/uploading a
-- new version does not - see documents.replaces_document_id).
CREATE TABLE IF NOT EXISTS document_removal_requests (
    id SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(id),
    requested_by INT NOT NULL REFERENCES users(id),
    status VARCHAR NOT NULL DEFAULT 'pending',  -- 'pending', 'approved', 'rejected'
    decided_by INT REFERENCES users(id),
    decided_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_removal_requests_status ON document_removal_requests(status);

-- Who did what, for company admins ("who accessed the app", "track what
-- they did") and platform-wide oversight for the super admin.
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    actor_user_id INT REFERENCES users(id),
    company_id INT REFERENCES companies(id),
    action VARCHAR NOT NULL,   -- 'login', 'register', 'invite_created', 'document_upload',
                                -- 'document_edit', 'document_removal_requested',
                                -- 'document_removal_approved', 'document_removal_rejected',
                                -- 'access_revoked', 'access_restored', 'company_suspended'
    resource_type VARCHAR,     -- 'document', 'user', 'company'
    resource_id INT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_company ON audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);

-- Chat sessions (GDPR: purge older than retention window)
CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    company_id INT REFERENCES companies(id),
    user_id INT REFERENCES users(id),
    project_id INT REFERENCES projects(id),
    message TEXT,
    response TEXT,
    tool_used VARCHAR,
    citations JSONB,
    gap BOOLEAN,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Locales available for the UI. 'en' and 'el' ship built-in (bundled in the
-- frontend as a fallback, so the app works even if this table is empty);
-- a super admin can add more (de, tr, he, ...) via the Languages admin panel.
CREATE TABLE IF NOT EXISTS locales (
    code VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    is_builtin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO locales (code, name, is_builtin) VALUES
    ('en', 'English', true),
    ('el', 'Ελληνικά', true)
ON CONFLICT (code) DO NOTHING;

-- Per-key text overrides for a locale. A super admin can tweak any bundled
-- en/el string, or supply every string for a brand-new locale added above -
-- keys with no override fall back to the bundled English default at read time.
CREATE TABLE IF NOT EXISTS translation_overrides (
    id SERIAL PRIMARY KEY,
    locale VARCHAR NOT NULL REFERENCES locales(code) ON DELETE CASCADE,
    key VARCHAR NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (locale, key)
);

CREATE INDEX IF NOT EXISTS idx_translation_overrides_locale ON translation_overrides(locale);

-- Per-user notifications: new documents after a scheduled crawl, new content
-- in a municipality tied to one of a construction company's projects, an
-- invite being accepted, and document-removal request/decision events.
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    type VARCHAR NOT NULL,   -- 'new_documents', 'municipality_content', 'invite_accepted',
                              -- 'removal_requested', 'removal_decided'
    title VARCHAR NOT NULL,
    body TEXT,
    link VARCHAR,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);
