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
    preferred_locale VARCHAR,  -- UI language for this account; NULL = no preference set yet (defaults to Greek)
    preferred_theme VARCHAR,  -- 'light' or 'dark'; NULL = no preference set yet (defaults to light)
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

-- Known protected archaeological sites, checked by coordinate proximity
-- (Haversine distance, see backend/app/services/gis.py's
-- check_archaeological_flag()) rather than municipality-name text matching
-- against the KB - the earlier approach flagged every plot anywhere in a
-- site's whole municipality regardless of actual distance from the
-- declared zone. Radii are conservative manually-curated estimates, not
-- official surveyed zone boundaries - see KNOWN_DECISIONS.md.
CREATE TABLE IF NOT EXISTS archaeological_sites (
    id SERIAL PRIMARY KEY,
    name_el VARCHAR NOT NULL UNIQUE,
    name_en VARCHAR,
    region_id VARCHAR REFERENCES regions(region_id),
    lat DECIMAL(10, 7) NOT NULL,
    lon DECIMAL(10, 7) NOT NULL,
    protection_radius_m INTEGER NOT NULL DEFAULT 500,
    protection_zone_description TEXT,
    legal_basis VARCHAR NOT NULL DEFAULT 'Ν.3028/2002',
    source_url VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Seed rows for the 5 supported regions. Centroids verified via Nominatim
-- forward geocoding (Philippi and Thassos use OSM's own archaeological_site/
-- agora POI centroids rather than the initially-proposed points, which were
-- off by several hundred metres - see KNOWN_DECISIONS.md).
INSERT INTO archaeological_sites (name_el, name_en, region_id, lat, lon, protection_radius_m, protection_zone_description, source_url)
VALUES
    ('Παναγία Καβάλας (βυζαντινή ακρόπολη)', 'Panagia, Kavala (Byzantine acropolis)', 'kavala', 40.9334868, 24.4149126, 400,
     'Ιστορικός τόπος και αρχαιολογική ζώνη - χερσόνησος της Παναγίας με το Κάστρο, τα Καμάρες/Υδραγωγείο και το Ιμαρέτ.',
     'https://nominatim.openstreetmap.org/search?q=Παναγία+Καβάλα'),
    ('Αρχαιολογικός χώρος Φιλίππων', 'Archaeological Site of Philippi', 'paggaio', 41.0132841, 24.2839744, 1500,
     'UNESCO World Heritage Site (εγγραφή 2016) - κηρυγμένος αρχαιολογικός χώρος.',
     'https://whc.unesco.org/en/list/1517/'),
    ('Αρχαία Άβδηρα', 'Ancient Abdera', 'xanthi', 40.9446, 24.9746, 800,
     'Αρχαία ελληνική αποικία - κηρυγμένος αρχαιολογικός χώρος.',
     NULL),
    ('Αρχαία πόλη Θάσου', 'Ancient City of Thasos', 'thassos', 40.7795291, 24.7134019, 600,
     'Αρχαία αγορά, θέατρο και τείχη - κηρυγμένος αρχαιολογικός χώρος.',
     NULL),
    ('Αρχαιολογικός χώρος Αμφίπολης', 'Archaeological Site of Amphipolis', 'drama', 40.8162, 23.8523, 1000,
     'Εκτεταμένος αρχαιολογικός χώρος (τείχη αρχαίας πόλης, Λέων της Αμφίπολης, Τύμβος Καστά) - η ακτίνα καλύπτει ενδεικτικά μόνο το κεντρικό τμήμα, καθώς ο χώρος εκτείνεται σε αρκετά χιλιόμετρα.',
     NULL)
ON CONFLICT (name_el) DO NOTHING;

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
    authority VARCHAR,       -- 'tee','ydom','dasarcheio','deddie','deya','ktimatologio','aade','efka','mida','ypen','other'
    permit_stage VARCHAR,    -- 'pre_application','permit_issuance','during_construction','utility_connection','post_construction_registration','tax'
    content_type VARCHAR,    -- 'procedural_howto','legal_reference','regulatory_change_notice','form','faq'
    -- 'full_text','reference_only','manual_entry_pending' (stub, no content
    -- yet), 'manual_entry' (curated content authored directly, not crawled)
    extraction_status VARCHAR,
    last_verified_at DATE,
    -- Set by the weekly staleness job (crawler/crawler/staleness.py), not
    -- computed at request time, so the review queue is a plain flag read.
    needs_review BOOLEAN NOT NULL DEFAULT false,
    -- True for procedural docs whose requirements apply to a private
    -- individual building their own home - see KNOWN_DECISIONS.md.
    applies_to_first_time_homeowner BOOLEAN DEFAULT false
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
    -- NOT NULL: a NULL here poisons any `NOT IN (SELECT document_id FROM
    -- embeddings)` query (embed_pending_documents' catch-up sweep used
    -- exactly this shape) into matching zero rows, silently breaking the
    -- entire embedding backfill - discovered via 2 orphaned test rows that
    -- had slipped in with no document_id at all.
    document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INT,
    chunk_text TEXT,
    embedding VECTOR(1536)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 128);
-- Full-text component of hybrid (vector + keyword) retrieval - see
-- app/services/rag.py's _retrieve(). Not CONCURRENTLY here since init.sql
-- only ever runs against a table that's either empty (fresh init) or
-- already has this index (IF NOT EXISTS no-ops) - CONCURRENTLY was only
-- needed for the one-time live-DB backfill, which used a separate command.
CREATE INDEX IF NOT EXISTS idx_embeddings_fts ON embeddings USING gin(to_tsvector('greek', chunk_text));

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

-- Thumbs up/down on a specific assistant answer. message_index is the
-- position of the rated message in the frontend's displayed conversation
-- array (0-indexed) - not a position within chat_sessions itself, since
-- each chat_sessions row is already one Q&A turn (one assistant message).
CREATE TABLE IF NOT EXISTS message_feedback (
    id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES chat_sessions(id),
    message_index INT NOT NULL,
    rating VARCHAR NOT NULL,  -- 'positive', 'negative'
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_feedback_session ON message_feedback(session_id);

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

-- ============================================================
-- Multi-vertical architecture: theke serves more than one professional
-- domain (construction permits today, tax/accounting next) from the same
-- codebase. A vertical scopes which documents a company can see, which
-- system prompt/disclaimer a chat answer uses, and whether regional
-- scoping (ΥΔΟΜ/ΔΕΥΑ/ΔΕΔΔΗΕ, construction-only) applies at all.
-- ============================================================

CREATE TABLE IF NOT EXISTS verticals (
    id SERIAL PRIMARY KEY,
    slug VARCHAR NOT NULL UNIQUE,
    display_name VARCHAR NOT NULL,
    tagline TEXT,
    welcome_message TEXT,
    disclaimer_text TEXT,
    system_prompt_override TEXT,
    off_topic_hint TEXT,
    uses_regional_scoping BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO verticals (
    slug, display_name, tagline, welcome_message, disclaimer_text, uses_regional_scoping
) VALUES (
    'construction',
    'Θήκη Κατασκευών',
    'Η γνωσιακή βάση για αδειοδότηση και κανονισμούς δόμησης',
    'Ρωτήστε για απαιτήσεις αδείας δόμησης, έλεγχο εγγράφων, ή διαδικασίες ΥΔΟΜ για την περιοχή σας.',
    'Οι παραπάνω πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε αδειούχο μηχανικό για το συγκεκριμένο έργο σας.',
    true
) ON CONFLICT (slug) DO NOTHING;

INSERT INTO verticals (
    slug, display_name, tagline, welcome_message, disclaimer_text, uses_regional_scoping
) VALUES (
    'tax_accounting',
    'Θήκη Λογιστικής & Φορολογίας',
    'Η γνωσιακή βάση για φορολογική νομοθεσία και λογιστικές διαδικασίες',
    'Ρωτήστε για φορολογικές υποχρεώσεις, εγκυκλίους ΑΑΔΕ, ΦΠΑ, ΕΝΦΙΑ, ή οποιοδήποτε φορολογικό θέμα.',
    'Οι παραπάνω πληροφορίες είναι για ενημέρωση μόνο. Συμβουλευτείτε αδειούχο λογιστή ή φοροτεχνικό για το συγκεκριμένο ζήτημά σας.',
    false
) ON CONFLICT (slug) DO NOTHING;

-- Every company belongs to exactly one vertical (a firm doing both
-- construction and tax work would need two companies/tenants, not a
-- multi-vertical company row - keeps document/chat scoping unambiguous).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vertical_id INTEGER REFERENCES verticals(id);
UPDATE companies SET vertical_id = (SELECT id FROM verticals WHERE slug = 'construction') WHERE vertical_id IS NULL;
ALTER TABLE companies ALTER COLUMN vertical_id SET NOT NULL;

-- Every document belongs to exactly one vertical, same rationale as above.
-- NULL company_id (public/crawled) documents still carry a vertical_id -
-- "public" only ever meant "public within this vertical."
ALTER TABLE documents ADD COLUMN IF NOT EXISTS vertical_id INTEGER REFERENCES verticals(id);
UPDATE documents SET vertical_id = (SELECT id FROM verticals WHERE slug = 'construction') WHERE vertical_id IS NULL;
ALTER TABLE documents ALTER COLUMN vertical_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_vertical ON documents(vertical_id);

-- documents.status valid values: 'active', 'superseded', 'removed'. No enum
-- change needed (status is VARCHAR) - 'superseded' was already a valid value
-- written by the upload-replace flow below; this comment just makes all
-- three values explicit in one place.
--
-- documents.replaces_document_id direction: this column lives on the NEW
-- document and points at the OLD document it supersedes (not the reverse).
-- When set, the referenced (old) document's status must be 'superseded'.
-- This consistency rule is enforced at the application layer (see
-- app/routers/documents.py's upload-replace path and app/routers/admin.py's
-- mark-superseded/undo-supersede endpoints), not a DB trigger - a trigger
-- would need to reach across two rows atomically in a way that's simpler
-- to guarantee inside a single backend transaction that already owns both
-- writes.

CREATE TABLE IF NOT EXISTS data_sources (
    id SERIAL PRIMARY KEY,
    vertical_id INTEGER NOT NULL REFERENCES verticals(id),
    name VARCHAR NOT NULL,
    base_url VARCHAR NOT NULL,
    source_type VARCHAR NOT NULL DEFAULT 'html_page',
    crawl_frequency_type VARCHAR NOT NULL DEFAULT 'monthly',  -- 'daily', 'weekly', 'monthly', 'custom'
    crawl_frequency_days INTEGER NOT NULL DEFAULT 30,
    last_crawled_at TIMESTAMP,
    -- Authoritative "when will this next run" regardless of frequency_type -
    -- always read this field for scheduling, never re-derive from frequency
    -- alone (an admin can override it manually via PATCH).
    next_crawl_at TIMESTAMP,
    last_crawl_status VARCHAR,
    last_crawl_document_count INTEGER,
    last_crawl_error TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_data_sources_vertical ON data_sources(vertical_id);

-- Every invite is scoped to the same vertical as the company it invites
-- into - derived from company_id, never chosen separately at invite-creation
-- time (see app/routers/admin.py's invite-creation endpoint).
ALTER TABLE invites ADD COLUMN IF NOT EXISTS vertical_id INTEGER REFERENCES verticals(id);
UPDATE invites SET vertical_id = (SELECT c.vertical_id FROM companies c WHERE c.id = invites.company_id) WHERE vertical_id IS NULL;

-- projects.region_id is already nullable (construction-only concept; a tax
-- engagement has no region). is_client flags a project as a client
-- engagement (chiefly for the tax vertical, but available to both) - in
-- that case `projects.name` is treated as the client's name.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_client BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_notes TEXT;

-- Client/project-scoped documents (e.g. a client's uploaded tax records or
-- a specific building's uploaded plans) live alongside public KB documents
-- in the same table, distinguished by project_id being set. Visibility:
-- only surfaced when a chat/search request is scoped to that project AND
-- the requester belongs to the document's company - see
-- app/services/visibility.py's visible_documents_filter().
ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

-- GIS/location fields on projects. customer_name/customer_notes are
-- deliberately separate from the existing is_client/client_notes pair
-- (Phase 3 above): is_client flags the engagement type, client_notes is
-- freeform notes about it, while these two describe the actual person/entity
-- who owns the plot - useful even outside a "client engagement" (e.g. a
-- construction firm's own project still has a property owner).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_notes TEXT;

-- Plot location. lat/lon are nullable - a project only gets them once a user
-- drops a pin (see POST /gis/resolve-location); NULL means "no location set
-- yet", not "location at 0,0". decimal(10,7) gives ~1cm precision, matching
-- GPS/OSM convention.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plot_address TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plot_municipality VARCHAR;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lat DECIMAL(10,7);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lon DECIMAL(10,7);

-- Cadastral fields. All nullable/best-effort: the public Ktimatologio WFS
-- that would populate these automatically is confirmed dead (see GIS Phase 0
-- / KNOWN_DECISIONS.md) - these are populated when available, left NULL
-- otherwise, never faked.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kaek VARCHAR;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plot_area_sqm DECIMAL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS parcel_geometry JSONB;

-- Building-coefficient zone. gis_zone_source records where the value came
-- from (e.g. 'manual_entry', 'sdig' if that ever becomes queryable) so a
-- displayed zone name is never presented as if it came from a live
-- authoritative lookup when it didn't.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gis_zone_name VARCHAR;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS gis_zone_source VARCHAR;

-- Archaeological zone flag - set by app/services/gis.py's
-- check_archaeological_flag() (coordinate-proximity/Haversine against
-- archaeological_sites, not a live API - see KNOWN_DECISIONS.md), never
-- left silently false when unknown. site_name/distance_m are populated
-- alongside the flag so build_location_context() (app/services/rag.py) can
-- give the LLM a specific site and distance rather than just a boolean.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archaeological_flag BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archaeological_notes TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archaeological_site_name VARCHAR;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archaeological_distance_m INTEGER;

-- Set whenever POST /gis/resolve-location successfully runs for this
-- project, regardless of which individual sub-lookups succeeded - lets the
-- UI show "location last checked X" separately from "location set".
ALTER TABLE projects ADD COLUMN IF NOT EXISTS location_resolved_at TIMESTAMP;

-- Customers: a real, reusable contact record per company, replacing the
-- freeform customer_name/customer_notes text pair above for companies that
-- want to track repeat clients across multiple projects. The old text
-- fields stay on `projects` (customer_id is additive, not a replacement -
-- see POST/PATCH /projects) since a project can still be created with just
-- a name for a one-off, no-repeat-client case.
CREATE TABLE IF NOT EXISTS customers (
  id          serial PRIMARY KEY,
  company_id  integer NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  afm         varchar(9),
  phone       varchar(20),
  email       varchar(255),
  notes       text,
  created_at  timestamp NOT NULL DEFAULT now()
);

-- Partial (not table-level UNIQUE) because afm is optional - two customers
-- at the same company with no AFM on file must not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_afm_unique
  ON customers(company_id, afm) WHERE afm IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_company ON customers(company_id);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS customer_id integer REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);

-- Ζώνη οικισμού (in-plan vs. out-of-plan) - nullable, only meaningful once
-- a location is set, and changes which regulatory framework applies. See
-- build_location_context() and _retrieve()'s query-enrichment use of this
-- in app/services/rag.py.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS plot_in_plan boolean;

-- One-time backfill: every existing project with a freeform customer_name
-- but no customer_id gets a real customers row, one per project (not
-- deduped by name - two projects sharing a customer_name string aren't
-- assumed to be the same real customer without stronger evidence like a
-- matching AFM). Naturally idempotent: once a project's customer_id is
-- set, it no longer matches the WHERE clause on the next init.sql run.
DO $$
DECLARE
  proj RECORD;
  new_customer_id INTEGER;
BEGIN
  FOR proj IN
    SELECT id, company_id, customer_name
    FROM projects
    WHERE customer_name IS NOT NULL AND customer_id IS NULL
  LOOP
    INSERT INTO customers (company_id, name)
    VALUES (proj.company_id, proj.customer_name)
    RETURNING id INTO new_customer_id;

    UPDATE projects SET customer_id = new_customer_id WHERE id = proj.id;
  END LOOP;
END $$;

-- Direct user creation (super admin creates a company + first admin user
-- atomically, see POST /admin/companies/create-with-admin) needs a phone
-- field to capture, and last_login_at to show real activity in the
-- company admin dashboard's Χρήστες tab rather than only created_at.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name VARCHAR(255);

-- Token consumption tracking, per completion call - NULL on any row where
-- no GPT call was made at all (e.g. the off-topic-guard gap path), not
-- just zero, so "no LLM call" and "a genuinely free response" stay
-- distinguishable. See app/routers/chat.py's _log_session.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS total_tokens integer;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS estimated_cost_eur decimal(10, 6);
