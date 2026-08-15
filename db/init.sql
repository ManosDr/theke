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

-- Seed for the 5 municipalities/providers actually covered by real KB
-- content (Kavala, Drama, Xanthi, Thassos, Paggaio) - previously only ever
-- existed as manually-inserted live-DB state, never captured here, so a
-- genuinely fresh `docker compose up` on a wiped volume produced zero
-- regions at all. Inserted before the 332-row municipality bulk seed below
-- so that block's ON CONFLICT DO NOTHING correctly skips these 5 rather
-- than needing them excluded from that generated list.
INSERT INTO utility_providers (provider_id, provider_type, provider_name, base_url, coverage_region_ids, status) VALUES
    ('deddie-kavala', 'electric_grid', 'ΔΕΔΔΗΕ - Περιοχή Καβάλας (Διεύθυνση Περιφέρειας Μακεδονίας-Θράκης)', 'https://www.deddie.gr/', ARRAY['kavala','paggaio','thassos'], 'active'),
    ('deyaap-paggaiou', 'water', 'Δ.Ε.Υ.Α.Α. Παγγαίου', 'https://deyapaggaiou.gr/', ARRAY['paggaio'], 'active'),
    ('deyad-dramas', 'water', 'Δ.Ε.Υ.Α. Δράμας', 'https://deyad.gr/', ARRAY['drama'], 'active'),
    ('deya-kavalas', 'water', 'Δ.Ε.Υ.Α. Καβάλας', 'https://deyakav.gr/', ARRAY['kavala'], 'active'),
    ('deya-thassou', 'water', 'Δ.Ε.Υ.Α. Θάσου', 'https://deyathassou.gr/', ARRAY['thassos'], 'active'),
    ('deyax-xanthis', 'water', 'Δ.Ε.Υ.Α. Ξάνθης', 'https://www.deyaxanthis.gr/', ARRAY['xanthi'], 'active')
ON CONFLICT (provider_id) DO NOTHING;

INSERT INTO regions (region_id, region_name_el, region_name_en, level, ydom_authority_name, contact_phone, contact_email, deya_provider_id, deddie_region_id, status, has_coefficient_data, has_zone_level_coefficient_text) VALUES
    ('drama', 'Δήμος Δράμας', 'Municipality of Drama', 'municipality', 'Διεύθυνση Δόμησης Δήμου Δράμας', '2521351399', 'emilk@dimosdramas.gr', 'deyad-dramas', NULL, 'active', NULL, false),
    ('kavala', 'Δήμος Καβάλας', 'Municipality of Kavala', 'municipality', 'Διεύθυνση Δόμησης και Πολεοδομικού Σχεδιασμού Δήμου Καβάλας', '2513503323', 'poldirect@kavala.gov.gr', 'deya-kavalas', 'deddie-kavala', 'active', false, true),
    ('paggaio', 'Δήμος Παγγαίου', 'Municipality of Paggaio', 'municipality', 'Διεύθυνση Δόμησης, Πολεοδομικού Σχεδιασμού & Εφαρμογών Δήμου Παγγαίου', '2592350051', 'ydom@dimospaggaiou.gr', 'deyaap-paggaiou', 'deddie-kavala', 'active', false, NULL),
    ('thassos', 'Δήμος Θάσου', 'Municipality of Thassos', 'municipality', 'Υπηρεσία Δόμησης (ΥΔΟΜ) Δήμου Θάσου', '2593350154', 'dimos@thassos.gr', 'deya-thassou', 'deddie-kavala', 'active', false, NULL),
    ('xanthi', 'Δήμος Ξάνθης', 'Municipality of Xanthi', 'municipality', 'Διεύθυνση Δόμησης Δήμου Ξάνθης', '2541354110', 'ebarbalexi@cityofxanthi.gr', 'deyax-xanthis', NULL, 'active', NULL, true)
ON CONFLICT (region_id) DO NOTHING;

-- Auto-generated from Wikipedia 'List of municipalities of Greece (2011)'
-- (Kallikratis reform, 332 municipalities), 2026-08-11.
-- Source: https://en.wikipedia.org/wiki/List_of_municipalities_of_Greece_(2011)
-- ON CONFLICT DO NOTHING: the 5 already-covered municipalities (kavala, drama,
-- xanthi, thassos, paggaio) keep their existing hand-curated rows untouched -
-- this only adds the remaining ~327 as status='pending' (no KB content yet).
INSERT INTO regions (region_id, region_name_el, region_name_en, level, status) VALUES
    ('abdera', 'Δήμος Αβδήρων', 'Municipality of Abdera', 'municipality', 'pending'),
    ('acharnes', 'Δήμος Αχαρνών', 'Municipality of Acharnes', 'municipality', 'pending'),
    ('aegina', 'Δήμος Αίγινας', 'Municipality of Aegina', 'municipality', 'pending'),
    ('agathonisi', 'Δήμος Αγαθονησίου', 'Municipality of Agathonisi', 'municipality', 'pending'),
    ('agia', 'Δήμος Αγιάς', 'Municipality of Agia', 'municipality', 'pending'),
    ('agia-paraskevi', 'Δήμος Αγίας Παρασκευής', 'Municipality of Agia Paraskevi', 'municipality', 'pending'),
    ('agia-varvara', 'Δήμος Αγίας Βαρβάρας', 'Municipality of Agia Varvara', 'municipality', 'pending'),
    ('agioi-anargyroi-kamatero', 'Δήμος Αγίων Αναργύρων-Καματερού', 'Municipality of Agioi Anargyroi-Kamatero', 'municipality', 'pending'),
    ('agios-dimitrios', 'Δήμος Αγίου Δημητρίου', 'Municipality of Agios Dimitrios', 'municipality', 'pending'),
    ('agios-efstratios', 'Δήμος Αγίου Ευστρατίου', 'Municipality of Agios Efstratios', 'municipality', 'pending'),
    ('agios-nikolaos', 'Δήμος Αγίου Νικολάου', 'Municipality of Agios Nikolaos', 'municipality', 'pending'),
    ('agios-vasileios', 'Δήμος Αγίου Βασιλείου', 'Municipality of Agios Vasileios', 'municipality', 'pending'),
    ('agistri', 'Δήμος Αγκιστρίου', 'Municipality of Agistri', 'municipality', 'pending'),
    ('agrafa', 'Δήμος Αγράφων', 'Municipality of Agrafa', 'municipality', 'pending'),
    ('agrinio', 'Δήμος Αγρινίου', 'Municipality of Agrinio', 'municipality', 'pending'),
    ('aigaleo', 'Δήμος Αιγάλεω', 'Municipality of Aigaleo', 'municipality', 'pending'),
    ('aigialeia', 'Δήμος Αιγιαλείας', 'Municipality of Aigialeia', 'municipality', 'pending'),
    ('aktio-vonitsa', 'Δήμος Άκτιου-Βόνιτσας', 'Municipality of Aktio-Vonitsa', 'municipality', 'pending'),
    ('alexandreia', 'Δήμος Αλεξάνδρειας', 'Municipality of Alexandreia', 'municipality', 'pending'),
    ('alexandroupoli', 'Δήμος Αλεξανδρούπολης', 'Municipality of Alexandroupoli', 'municipality', 'pending'),
    ('aliartos', 'Δήμος Αλιάρτου', 'Municipality of Aliartos', 'municipality', 'pending'),
    ('alimos', 'Δήμος Αλίμου', 'Municipality of Alimos', 'municipality', 'pending'),
    ('almopia', 'Δήμος Αλμωπίας', 'Municipality of Almopia', 'municipality', 'pending'),
    ('almyros', 'Δήμος Αλμυρού', 'Municipality of Almyros', 'municipality', 'pending'),
    ('alonnisos', 'Δήμος Αλοννήσου', 'Municipality of Alonnisos', 'municipality', 'pending'),
    ('amari', 'Δήμος Αμάριου', 'Municipality of Amari', 'municipality', 'pending'),
    ('amfikleia-elateia', 'Δήμος Αμφίκλειας-Ελάτειας', 'Municipality of Amfikleia-Elateia', 'municipality', 'pending'),
    ('amfilochia', 'Δήμος Αμφιλοχίας', 'Municipality of Amfilochia', 'municipality', 'pending'),
    ('amorgos', 'Δήμος Αμοργού', 'Municipality of Amorgos', 'municipality', 'pending'),
    ('ampelokipoi-menemeni', 'Δήμος Αμπελοκήπων-Μενεμένης', 'Municipality of Ampelokipoi-Menemeni', 'municipality', 'pending'),
    ('amphipolis', 'Δήμος Αμφίπολης', 'Municipality of Amphipolis', 'municipality', 'pending'),
    ('amyntaio', 'Δήμος Αμυνταίου', 'Municipality of Amyntaio', 'municipality', 'pending'),
    ('anafi', 'Δήμος Ανάφης', 'Municipality of Anafi', 'municipality', 'pending'),
    ('andravida-kyllini', 'Δήμος Ανδραβίδας – Κυλλήνης', 'Municipality of Andravida-Kyllini', 'municipality', 'pending'),
    ('andritsaina-krestena', 'Δήμος Ανδριτσαίνας-Κρεστένων', 'Municipality of Andritsaina-Krestena', 'municipality', 'pending'),
    ('andros', 'Δήμος Άνδρου', 'Municipality of Andros', 'municipality', 'pending'),
    ('anogeia', 'Δήμος Ανωγείων', 'Municipality of Anogeia', 'municipality', 'pending'),
    ('antiparos', 'Δήμος Αντιπάρου', 'Municipality of Antiparos', 'municipality', 'pending'),
    ('apokoronas', 'Δήμος Αποκορώνου', 'Municipality of Apokoronas', 'municipality', 'pending'),
    ('archanes-asterousia', 'Δήμος Αρχανών-Αστερουσίων', 'Municipality of Archanes-Asterousia', 'municipality', 'pending'),
    ('argithea', 'Δήμος Αργιθέας', 'Municipality of Argithea', 'municipality', 'pending'),
    ('argos-mykines', 'Δήμος Άργους-Μυκηνών', 'Municipality of Argos-Mykines', 'municipality', 'pending'),
    ('argos-orestiko', 'Δήμος Άργους Ορεστικού', 'Municipality of Argos Orestiko', 'municipality', 'pending'),
    ('aristotelis', 'Δήμος Αριστοτέλη', 'Municipality of Aristotelis', 'municipality', 'pending'),
    ('arriana', 'Δήμος Αρριανών', 'Municipality of Arriana', 'municipality', 'pending'),
    ('arta', 'Δήμος Αρταίων', 'Municipality of Arta', 'municipality', 'pending'),
    ('aspropyrgos', 'Δήμος Ασπροπύργου', 'Municipality of Aspropyrgos', 'municipality', 'pending'),
    ('astypalaia', 'Δήμος Αστυπαλαίας', 'Municipality of Astypalaia', 'municipality', 'pending'),
    ('athens', 'Δήμος Αθηναίων', 'Municipality of Athens', 'municipality', 'pending'),
    ('central-corfu-and-diapontia-islands', 'Δήμος Κεντρικής Κέρκυρας και Διαπόντιων Νήσων', 'Municipality of Central Corfu and Diapontia Islands', 'municipality', 'pending'),
    ('north-corfu', 'Δήμος Βόρειας Κέρκυρας', 'Municipality of North Corfu', 'municipality', 'pending'),
    ('south-corfu', 'Δήμος Νότιας Κέρκυρας', 'Municipality of South Corfu', 'municipality', 'pending'),
    ('central-tzoumerka', 'Δήμος Κεντρικών Τζουμέρκων', 'Municipality of Central Tzoumerka', 'municipality', 'pending'),
    ('argostoli', 'Δήμος Αργοστολίου', 'Municipality of Argostoli', 'municipality', 'pending'),
    ('lixouri', 'Δήμος Ληξουρίου', 'Municipality of Lixouri', 'municipality', 'pending'),
    ('sami', 'Δήμος Σάμης', 'Municipality of Sami', 'municipality', 'pending'),
    ('chaidari', 'Δήμος Χαϊδαρίου', 'Municipality of Chaidari', 'municipality', 'pending'),
    ('chalandri', 'Δήμος Χαλανδρίου', 'Municipality of Chalandri', 'municipality', 'pending'),
    ('chalcis', 'Δήμος Χαλκιδέων', 'Municipality of Chalcis', 'municipality', 'pending'),
    ('chalki', 'Δήμος Χάλκης', 'Municipality of Chalki', 'municipality', 'pending'),
    ('chalkidona', 'Δήμος Χαλκηδόνος', 'Municipality of Chalkidona', 'municipality', 'pending'),
    ('chania', 'Δήμος Χανίων', 'Municipality of Chania', 'municipality', 'pending'),
    ('chersonisos', 'Δήμος Χερσονήσου', 'Municipality of Chersonisos', 'municipality', 'pending'),
    ('chios', 'Δήμος Χίου', 'Municipality of Chios', 'municipality', 'pending'),
    ('corinth-municipality', 'Δήμος Κορινθίων', 'Municipality of Corinth (municipality)', 'municipality', 'pending'),
    ('cythera', 'Δήμος Κυθήρων', 'Municipality of Cythera', 'municipality', 'pending'),
    ('dafni-ymittos', 'Δήμος Δάφνης-Υμηττού', 'Municipality of Dafni-Ymittos', 'municipality', 'pending'),
    ('delphi', 'Δήμος Δελφών', 'Municipality of Delphi', 'municipality', 'pending'),
    ('delta', 'Δήμος Δέλτα', 'Municipality of Delta', 'municipality', 'pending'),
    ('deskati', 'Δήμος Δεσκάτης', 'Municipality of Deskati', 'municipality', 'pending'),
    ('didymoteicho', 'Δήμος Διδυμοτείχου', 'Municipality of Didymoteicho', 'municipality', 'pending'),
    ('dion-olympos', 'Δήμος Δίου-Ολύμπου', 'Municipality of Dion-Olympos', 'municipality', 'pending'),
    ('dionysos', 'Δήμος Διονύσου', 'Municipality of Dionysos', 'municipality', 'pending'),
    ('dirfys-messapia', 'Δήμος Διρφύων-Μεσσαπίων', 'Municipality of Dirfys-Messapia', 'municipality', 'pending'),
    ('distomo-arachova-antikyra', 'Δήμος Διστόμου-Αράχοβας-Αντικύρας', 'Municipality of Distomo-Arachova-Antikyra', 'municipality', 'pending'),
    ('dodoni', 'Δήμος Δωδώνης', 'Municipality of Dodoni', 'municipality', 'pending'),
    ('domokos', 'Δήμος Δομοκού', 'Municipality of Domokos', 'municipality', 'pending'),
    ('dorida', 'Δήμος Δωρίδος', 'Municipality of Dorida', 'municipality', 'pending'),
    ('doxato', 'Δήμος Δοξάτου', 'Municipality of Doxato', 'municipality', 'pending'),
    ('drama', 'Δήμος Δράμας', 'Municipality of Drama', 'municipality', 'pending'),
    ('east-mani', 'Δήμος Ανατολικής Μάνης', 'Municipality of East Mani', 'municipality', 'pending'),
    ('edessa', 'Δήμος Έδεσσας', 'Municipality of Edessa', 'municipality', 'pending'),
    ('elafonisos', 'Δήμος Ελαφονήσου', 'Municipality of Elafonisos', 'municipality', 'pending'),
    ('elassona', 'Δήμος Ελασσόνας', 'Municipality of Elassona', 'municipality', 'pending'),
    ('elefsina', 'Δήμος Ελευσίνας', 'Municipality of Elefsina', 'municipality', 'pending'),
    ('elliniko-argyroupoli', 'Δήμος Ελληνικού-Αργυρούπολης', 'Municipality of Elliniko-Argyroupoli', 'municipality', 'pending'),
    ('emmanouil-pappas', 'Δήμος Εμμανουήλ Παππά', 'Municipality of Emmanouil Pappas', 'municipality', 'pending'),
    ('eordaia', 'Δήμος Εορδαίας', 'Municipality of Eordaia', 'municipality', 'pending'),
    ('epidaurus', 'Δήμος Επιδαύρου', 'Municipality of Epidaurus', 'municipality', 'pending'),
    ('eretria', 'Δήμος Ερέτριας', 'Municipality of Eretria', 'municipality', 'pending'),
    ('ermionida', 'Δήμος Ερμιονίδας', 'Municipality of Ermionida', 'municipality', 'pending'),
    ('erymanthos', 'Δήμος Ερυμάνθου', 'Municipality of Erymanthos', 'municipality', 'pending'),
    ('evrotas', 'Δήμος Ευρώτα', 'Municipality of Evrotas', 'municipality', 'pending'),
    ('faistos', 'Δήμος Φαιστού', 'Municipality of Faistos', 'municipality', 'pending'),
    ('farkadona', 'Δήμος Φαρκαδόνας', 'Municipality of Farkadona', 'municipality', 'pending'),
    ('farsala', 'Δήμος Φαρσάλων', 'Municipality of Farsala', 'municipality', 'pending'),
    ('filiates', 'Δήμος Φιλιατών', 'Municipality of Filiates', 'municipality', 'pending'),
    ('filothei-psychiko', 'Δήμος Φιλοθέης-Ψυχικού', 'Municipality of Filothei-Psychiko', 'municipality', 'pending'),
    ('florina', 'Δήμος Φλώρινας', 'Municipality of Florina', 'municipality', 'pending'),
    ('folegandros', 'Δήμος Φολεγάνδρου', 'Municipality of Folegandros', 'municipality', 'pending'),
    ('fournoi-korseon', 'Δήμος Φούρνων Κορσεών', 'Municipality of Fournoi Korseon', 'municipality', 'pending'),
    ('fyli', 'Δήμος Φυλής', 'Municipality of Fyli', 'municipality', 'pending'),
    ('galatsi', 'Δήμος Γαλατσίου', 'Municipality of Galatsi', 'municipality', 'pending'),
    ('gavdos', 'Δήμος Γαύδου', 'Municipality of Gavdos', 'municipality', 'pending'),
    ('georgios-karaiskakis', 'Δήμος Γεωργίου Καραϊσκάκη', 'Municipality of Georgios Karaiskakis', 'municipality', 'pending'),
    ('glyfada', 'Δήμος Γλυφάδας', 'Municipality of Glyfada', 'municipality', 'pending'),
    ('gortyn-a', 'Δήμος Γόρτυνας', 'Municipality of Gortyna', 'municipality', 'pending'),
    ('gortynia', 'Δήμος Γορτυνίας', 'Municipality of Gortynia', 'municipality', 'pending'),
    ('grevena', 'Δήμος Γρεβενών', 'Municipality of Grevena', 'municipality', 'pending'),
    ('heraklion', 'Δήμος Ηρακλείου', 'Municipality of Heraklion', 'municipality', 'pending'),
    ('hydra', 'Δήμος Ύδρας', 'Municipality of Hydra', 'municipality', 'pending'),
    ('iasmos', 'Δήμος Ιάσμου', 'Municipality of Iasmos', 'municipality', 'pending'),
    ('icaria', 'Δήμος Ικαριάς', 'Municipality of Icaria', 'municipality', 'pending'),
    ('ierapetra', 'Δήμος Ιεράπετρας', 'Municipality of Ierapetra', 'municipality', 'pending'),
    ('igoumenitsa', 'Δήμος Ηγουμενίτσας', 'Municipality of Igoumenitsa', 'municipality', 'pending'),
    ('ilida', 'Δήμος Ηλίδας', 'Municipality of Ilida', 'municipality', 'pending'),
    ('ilio', 'Δήμος Ιλίου', 'Municipality of Ilio', 'municipality', 'pending'),
    ('ilioupoli', 'Δήμος Ηλιουπόλεως', 'Municipality of Ilioupoli', 'municipality', 'pending'),
    ('ioannina', 'Δήμος Ιωαννιτών', 'Municipality of Ioannina', 'municipality', 'pending'),
    ('ios', 'Δήμος Ιητών', 'Municipality of Ios', 'municipality', 'pending'),
    ('irakleia', 'Δήμος Ηρακλείας', 'Municipality of Irakleia', 'municipality', 'pending'),
    ('irakleio', 'Δήμος Ηρακλείου', 'Municipality of Irakleio', 'municipality', 'pending'),
    ('istiaia-aidipsos', 'Δήμος Ιστιαίας-Αιδηψού', 'Municipality of Istiaia-Aidipsos', 'municipality', 'pending'),
    ('ithaca', 'Δήμος Ιθάκης', 'Municipality of Ithaca', 'municipality', 'pending'),
    ('kaisariani', 'Δήμος Καισαριανής', 'Municipality of Kaisariani', 'municipality', 'pending'),
    ('kalamaria', 'Δήμος Καλαμαριάς', 'Municipality of Kalamaria', 'municipality', 'pending'),
    ('kalamata', 'Δήμος Καλαμάτας', 'Municipality of Kalamata', 'municipality', 'pending'),
    ('kalavryta', 'Δήμος Καλαβρύτων', 'Municipality of Kalavryta', 'municipality', 'pending'),
    ('kallithea', 'Δήμος Καλλιθέας', 'Municipality of Kallithea', 'municipality', 'pending'),
    ('kalymnos', 'Δήμος Καλυμνίων', 'Municipality of Kalymnos', 'municipality', 'pending'),
    ('kamena-vourla', 'Δήμος Καμένων Βούρλων', 'Municipality of Kamena Vourla', 'municipality', 'pending'),
    ('kantanos-selino', 'Δήμος Καντάνου-Σελίνου', 'Municipality of Kantanos-Selino', 'municipality', 'pending'),
    ('karditsa', 'Δήμος Καρδίτσας', 'Municipality of Karditsa', 'municipality', 'pending'),
    ('karpathos', 'Δήμος Καρπάθου', 'Municipality of Karpathos', 'municipality', 'pending'),
    ('karpenisi', 'Δήμος Καρπενησίου', 'Municipality of Karpenisi', 'municipality', 'pending'),
    ('karystos', 'Δήμος Καρύστου', 'Municipality of Karystos', 'municipality', 'pending'),
    ('kasos', 'Δήμος Κάσου', 'Municipality of Kasos', 'municipality', 'pending'),
    ('kassandra', 'Δήμος Κασσάνδρας', 'Municipality of Kassandra', 'municipality', 'pending'),
    ('kastellorizo', 'Δήμος Μεγίστης', 'Municipality of Kastellorizo', 'municipality', 'pending'),
    ('kastoria', 'Δήμος Καστοριάς', 'Municipality of Kastoria', 'municipality', 'pending'),
    ('katerini', 'Δήμος Κατερίνης', 'Municipality of Katerini', 'municipality', 'pending'),
    ('kato-nevrokopi', 'Δήμος Κάτω Νευροκοπίου', 'Municipality of Kato Nevrokopi', 'municipality', 'pending'),
    ('kavala', 'Δήμος Καβάλας', 'Municipality of Kavala', 'municipality', 'pending'),
    ('kea', 'Δήμος Κέας', 'Municipality of Kea', 'municipality', 'pending'),
    ('keratsini-drapetsona', 'Δήμος Κερατσινίου-Δραπετσώνας', 'Municipality of Keratsini-Drapetsona', 'municipality', 'pending'),
    ('kifisia', 'Δήμος Κηφισιάς', 'Municipality of Kifisia', 'municipality', 'pending'),
    ('kileler', 'Δήμος Κιλελέρ', 'Municipality of Kileler', 'municipality', 'pending'),
    ('kilkis', 'Δήμος Κιλκίς', 'Municipality of Kilkis', 'municipality', 'pending'),
    ('kimolos', 'Δήμος Κιμώλου', 'Municipality of Kimolos', 'municipality', 'pending'),
    ('kissamos', 'Δήμος Κισσάμου', 'Municipality of Kissamos', 'municipality', 'pending'),
    ('komotini', 'Δήμος Κομοτηνής', 'Municipality of Komotini', 'municipality', 'pending'),
    ('konitsa', 'Δήμος Κόνιτσας', 'Municipality of Konitsa', 'municipality', 'pending'),
    ('kordelio-evosmos', 'Δήμος Κορδελιού-Ευόσμου', 'Municipality of Kordelio-Evosmos', 'municipality', 'pending'),
    ('korydallos', 'Δήμος Κορυδαλλού', 'Municipality of Korydallos', 'municipality', 'pending'),
    ('kos', 'Δήμος Κω', 'Municipality of Kos', 'municipality', 'pending'),
    ('kozani', 'Δήμος Κοζάνης', 'Municipality of Kozani', 'municipality', 'pending'),
    ('kropia', 'Δήμος Κρωπίας', 'Municipality of Kropia', 'municipality', 'pending'),
    ('kymi-aliveri', 'Δήμος Κύμης-Αλιβερίου', 'Municipality of Kymi-Aliveri', 'municipality', 'pending'),
    ('kythnos', 'Δήμος Κύθνου', 'Municipality of Kythnos', 'municipality', 'pending'),
    ('lake-plastiras', 'Δήμος Λίμνης Πλαστήρα', 'Municipality of Lake Plastiras', 'municipality', 'pending'),
    ('lamia', 'Δήμος Λαμιέων', 'Municipality of Lamia', 'municipality', 'pending'),
    ('langadas', 'Δήμος Λαγκαδά', 'Municipality of Langadas', 'municipality', 'pending'),
    ('larissa', 'Δήμος Λαρισαίων', 'Municipality of Larissa', 'municipality', 'pending'),
    ('lavreotiki', 'Δήμος Λαυρεωτικής', 'Municipality of Lavreotiki', 'municipality', 'pending'),
    ('lefkada', 'Δήμος Λευκάδας', 'Municipality of Lefkada', 'municipality', 'pending'),
    ('leipsoi', 'Δήμος Λειψών', 'Municipality of Leipsoi', 'municipality', 'pending'),
    ('lemnos', 'Δήμος Λήμνου', 'Municipality of Lemnos', 'municipality', 'pending'),
    ('leros', 'Δήμος Λέρου', 'Municipality of Leros', 'municipality', 'pending'),
    ('mytilini', 'Δήμος Μυτιλήνης', 'Municipality of Mytilini', 'municipality', 'pending'),
    ('west-lesbos', 'Δήμος Δυτικής Λέσβου', 'Municipality of West Lesbos', 'municipality', 'pending'),
    ('livadeia', 'Δήμος Λεβαδέων', 'Municipality of Livadeia', 'municipality', 'pending'),
    ('lokroi', 'Δήμος Λοκρών', 'Municipality of Lokroi', 'municipality', 'pending'),
    ('loutraki-perachora-agioi-theodoroi', 'Δήμος Λουτρακίου−Περαχώρας−Αγίων Θεοδώρων', 'Municipality of Loutraki-Perachora-Agioi Theodoroi', 'municipality', 'pending'),
    ('lykovrysi-pefki', 'Δήμος Λυκόβρυσης-Πεύκης', 'Municipality of Lykovrysi-Pefki', 'municipality', 'pending'),
    ('makrakomi', 'Δήμος Μακρακώμης', 'Municipality of Makrakomi', 'municipality', 'pending'),
    ('malevizi', 'Δήμος Μαλεβιζίου', 'Municipality of Malevizi', 'municipality', 'pending'),
    ('mandra-eidyllia', 'Δήμος Μάνδρας-Ειδυλλίας', 'Municipality of Mandra-Eidyllia', 'municipality', 'pending'),
    ('mantoudi-limni-agia-anna', 'Δήμος Μαντουδίου-Λίμνης-Αγίας Άννας', 'Municipality of Mantoudi-Limni-Agia Anna', 'municipality', 'pending'),
    ('marathon', 'Δήμος Μαραθώνος', 'Municipality of Marathon', 'municipality', 'pending'),
    ('markopoulo-mesogaias', 'Δήμος Μαρκοπούλου Μεσογαίας', 'Municipality of Markopoulo Mesogaias', 'municipality', 'pending'),
    ('maroneia-sapes', 'Δήμος Μαρώνειας-Σαπών', 'Municipality of Maroneia-Sapes', 'municipality', 'pending'),
    ('marousi', 'Δήμος Αμαρουσίου', 'Municipality of Marousi', 'municipality', 'pending'),
    ('megalopoli', 'Δήμος Μεγαλόπολης', 'Municipality of Megalopoli', 'municipality', 'pending'),
    ('meganisi', 'Δήμος Μεγανησίου', 'Municipality of Meganisi', 'municipality', 'pending'),
    ('megara', 'Δήμος Μεγαρέων', 'Municipality of Megara', 'municipality', 'pending'),
    ('messini', 'Δήμος Μεσσήνης', 'Municipality of Messini', 'municipality', 'pending'),
    ('metamorfosi', 'Δήμος Μεταμορφώσεως', 'Municipality of Metamorfosi', 'municipality', 'pending'),
    ('meteora', 'Δήμος Μετεώρων', 'Municipality of Meteora', 'municipality', 'pending'),
    ('metsovo', 'Δήμος Μετσόβου', 'Municipality of Metsovo', 'municipality', 'pending'),
    ('milos', 'Δήμος Μήλου', 'Municipality of Milos', 'municipality', 'pending'),
    ('minoa-pediada', 'Δήμος Μινώα Πεδιάδας', 'Municipality of Minoa Pediada', 'municipality', 'pending'),
    ('missolonghi', 'Δήμος Ιεράς Πόλης Μεσολογγίου', 'Municipality of Missolonghi', 'municipality', 'pending'),
    ('monemvasia', 'Δήμος Μονεμβασιάς', 'Municipality of Monemvasia', 'municipality', 'pending'),
    ('moschato-tavros', 'Δήμος Μοσχάτου-Ταύρου', 'Municipality of Moschato-Tavros', 'municipality', 'pending'),
    ('mouzaki', 'Δήμος Μουζακίου', 'Municipality of Mouzaki', 'municipality', 'pending'),
    ('myki', 'Δήμος Μύκης', 'Municipality of Myki', 'municipality', 'pending'),
    ('mykonos', 'Δήμος Μυκόνου', 'Municipality of Mykonos', 'municipality', 'pending'),
    ('mylopotamos', 'Δήμος Μυλοποτάμου', 'Municipality of Mylopotamos', 'municipality', 'pending'),
    ('nafpaktia', 'Δήμος Ναυπακτίας', 'Municipality of Nafpaktia', 'municipality', 'pending'),
    ('nafplio', 'Δήμος Ναυπλιέων', 'Municipality of Nafplio', 'municipality', 'pending'),
    ('naousa', 'Δήμος Νάουσας', 'Municipality of Naousa', 'municipality', 'pending'),
    ('naxos-and-lesser-cyclades', 'Δήμος Νάξου και Μικρών Κυκλάδων', 'Municipality of Naxos and Lesser Cyclades', 'municipality', 'pending'),
    ('nea-filadelfeia-nea-chalkidona', 'Δήμος Νέας Φιλαδελφείας-Νέας Χαλκηδόνος', 'Municipality of Nea Filadelfeia-Nea Chalkidona', 'municipality', 'pending'),
    ('nea-ionia', 'Δήμος Νέας Ιωνίας', 'Municipality of Nea Ionia', 'municipality', 'pending'),
    ('neapoli-sykies', 'Δήμος Νεάπολης-Συκεών', 'Municipality of Neapoli-Sykies', 'municipality', 'pending'),
    ('nea-propontida', 'Δήμος Νέας Προποντίδας', 'Municipality of Nea Propontida', 'municipality', 'pending'),
    ('nea-smyrni', 'Δήμος Νέας Σμύρνης', 'Municipality of Nea Smyrni', 'municipality', 'pending'),
    ('nea-zichni', 'Δήμος Νέας Ζίχνης', 'Municipality of Nea Zichni', 'municipality', 'pending'),
    ('nemea', 'Δήμος Νεμέας', 'Municipality of Nemea', 'municipality', 'pending'),
    ('nestorio', 'Δήμος Νεστορίου', 'Municipality of Nestorio', 'municipality', 'pending'),
    ('nestos', 'Δήμος Νέστου', 'Municipality of Nestos', 'municipality', 'pending'),
    ('nikaia-agios-ioannis-rentis', 'Δήμος Νίκαιας-Αγίου Ιωάννη Ρέντη', 'Municipality of Nikaia-Agios Ioannis Rentis', 'municipality', 'pending'),
    ('nikolaos-skoufas', 'Δήμος Νικολάου Σκουφά', 'Municipality of Nikolaos Skoufas', 'municipality', 'pending'),
    ('nisyros', 'Δήμος Νισύρου', 'Municipality of Nisyros', 'municipality', 'pending'),
    ('north-kynouria', 'Δήμος Βόρειας Κυνουρίας', 'Municipality of North Kynouria', 'municipality', 'pending'),
    ('north-tzoumerka', 'Δήμος Βορείων Τζουμέρκων', 'Municipality of North Tzoumerka', 'municipality', 'pending'),
    ('oichalia', 'Δήμος Οιχαλίας', 'Municipality of Oichalia', 'municipality', 'pending'),
    ('oinousses', 'Δήμος Οινουσσών', 'Municipality of Oinousses', 'municipality', 'pending'),
    ('archaia-olympia', 'Δήμος Αρχαίας Ολυμπίας', 'Municipality of Archaia Olympia', 'municipality', 'pending'),
    ('oraiokastro', 'Δήμος Ωραιοκάστρου', 'Municipality of Oraiokastro', 'municipality', 'pending'),
    ('orchomenos', 'Δήμος Ορχομενού', 'Municipality of Orchomenos', 'municipality', 'pending'),
    ('orestiada', 'Δήμος Ορεστιάδας', 'Municipality of Orestiada', 'municipality', 'pending'),
    ('oropedio-lasithiou', 'Δήμος Οροπεδίου Λασιθίου', 'Municipality of Oropedio Lasithiou', 'municipality', 'pending'),
    ('oropos', 'Δήμος Ωρωπού', 'Municipality of Oropos', 'municipality', 'pending'),
    ('paiania', 'Δήμος Παιανίας', 'Municipality of Paiania', 'municipality', 'pending'),
    ('paionia', 'Δήμος Παιονίας', 'Municipality of Paionia', 'municipality', 'pending'),
    ('palaio-faliro', 'Δήμος Παλαιού Φαλήρου', 'Municipality of Palaio Faliro', 'municipality', 'pending'),
    ('palamas', 'Δήμος Παλαμά', 'Municipality of Palamas', 'municipality', 'pending'),
    ('pallini', 'Δήμος Παλλήνης', 'Municipality of Pallini', 'municipality', 'pending'),
    ('paggaio', 'Δήμος Παγγαίου', 'Municipality of Pangaio', 'municipality', 'pending'),
    ('papagou-cholargos', 'Δήμος Παπάγου-Χολαργού', 'Municipality of Papagou-Cholargos', 'municipality', 'pending'),
    ('paranesti', 'Δήμος Παρανεστίου', 'Municipality of Paranesti', 'municipality', 'pending'),
    ('parga', 'Δήμος Πάργας', 'Municipality of Parga', 'municipality', 'pending'),
    ('paros', 'Δήμος Πάρου', 'Municipality of Paros', 'municipality', 'pending'),
    ('patmos', 'Δήμος Πάτμου', 'Municipality of Patmos', 'municipality', 'pending'),
    ('patras', 'Δήμος Πατρέων', 'Municipality of Patras', 'municipality', 'pending'),
    ('pavlos-melas', 'Δήμος Παύλου Μελά', 'Municipality of Pavlos Melas', 'municipality', 'pending'),
    ('paxi', 'Δήμος Παξών', 'Municipality of Paxi', 'municipality', 'pending'),
    ('pella', 'Δήμος Πέλλας', 'Municipality of Pella', 'municipality', 'pending'),
    ('penteli', 'Δήμος Πεντέλης', 'Municipality of Penteli', 'municipality', 'pending'),
    ('perama', 'Δήμος Περάματος', 'Municipality of Perama', 'municipality', 'pending'),
    ('peristeri', 'Δήμος Περιστερίου', 'Municipality of Peristeri', 'municipality', 'pending'),
    ('petroupoli', 'Δήμος Πετρουπόλεως', 'Municipality of Petroupoli', 'municipality', 'pending'),
    ('pineios', 'Δήμος Πηνειού', 'Municipality of Pineios', 'municipality', 'pending'),
    ('piraeus', 'Δήμος Πειραιώς', 'Municipality of Piraeus', 'municipality', 'pending'),
    ('platanias', 'Δήμος Πλατανιά', 'Municipality of Platanias', 'municipality', 'pending'),
    ('pogoni', 'Δήμος Πωγωνίου', 'Municipality of Pogoni', 'municipality', 'pending'),
    ('polygyros', 'Δήμος Πολυγύρου', 'Municipality of Polygyros', 'municipality', 'pending'),
    ('poros', 'Δήμος Πόρου', 'Municipality of Poros', 'municipality', 'pending'),
    ('prespes', 'Δήμος Πρεσπών', 'Municipality of Prespes', 'municipality', 'pending'),
    ('preveza', 'Δήμος Πρέβεζας', 'Municipality of Preveza', 'municipality', 'pending'),
    ('prosotsani', 'Δήμος Προσοτσάνης', 'Municipality of Prosotsani', 'municipality', 'pending'),
    ('psara', 'Δήμος Ψαρών', 'Municipality of Psara', 'municipality', 'pending'),
    ('pydna-kolindros', 'Δήμος Πύδνας-Κολινδρού', 'Municipality of Pydna-Kolindros', 'municipality', 'pending'),
    ('pylaia-chortiatis', 'Δήμος Πυλαίας-Χορτιάτη', 'Municipality of Pylaia-Chortiatis', 'municipality', 'pending'),
    ('pyli', 'Δήμος Πύλης', 'Municipality of Pyli', 'municipality', 'pending'),
    ('pylos-nestor', 'Δήμος Πύλου-Νέστορος', 'Municipality of Pylos-Nestor', 'municipality', 'pending'),
    ('pyrgos', 'Δήμος Πύργου', 'Municipality of Pyrgos', 'municipality', 'pending'),
    ('rafina-pikermi', 'Δήμος Ραφήνας-Πικερμίου', 'Municipality of Rafina-Pikermi', 'municipality', 'pending'),
    ('rethymno', 'Δήμος Ρεθύμνου', 'Municipality of Rethymno', 'municipality', 'pending'),
    ('rhodes', 'Δήμος Ρόδου', 'Municipality of Rhodes', 'municipality', 'pending'),
    ('rigas-feraios', 'Δήμος Ρήγα Φεραίου', 'Municipality of Rigas Feraios', 'municipality', 'pending'),
    ('salamis-island', 'Δήμος Σαλαμίνος', 'Municipality of Salamis Island', 'municipality', 'pending'),
    ('east-samos', 'Δήμος Ανατολικής Σάμου', 'Municipality of East Samos', 'municipality', 'pending'),
    ('west-samos', 'Δήμος Δυτικής Σάμου', 'Municipality of West Samos', 'municipality', 'pending'),
    ('samothrace', 'Δήμος Σαμοθράκης', 'Municipality of Samothrace', 'municipality', 'pending'),
    ('santorini', 'Δήμος Θήρας', 'Municipality of Santorini', 'municipality', 'pending'),
    ('saronikos', 'Δήμος Σαρωνικού', 'Municipality of Saronikos', 'municipality', 'pending'),
    ('serifos', 'Δήμος Σερίφου', 'Municipality of Serifos', 'municipality', 'pending'),
    ('serres', 'Δήμος Σερρών', 'Municipality of Serres', 'municipality', 'pending'),
    ('servia', 'Δήμος Σερβίων', 'Municipality of Servia', 'municipality', 'pending'),
    ('velventos', 'Δήμος Βελβεντού', 'Municipality of Velventos', 'municipality', 'pending'),
    ('sfakia', 'Δήμος Σφακίων', 'Municipality of Sfakia', 'municipality', 'pending'),
    ('sifnos', 'Δήμος Σίφνου', 'Municipality of Sifnos', 'municipality', 'pending'),
    ('sikinos', 'Δήμος Σικίνου', 'Municipality of Sikinos', 'municipality', 'pending'),
    ('sikyona', 'Δήμος Σικυωνίων', 'Municipality of Sikyona', 'municipality', 'pending'),
    ('sintiki', 'Δήμος Σιντικής', 'Municipality of Sintiki', 'municipality', 'pending'),
    ('sithonia', 'Δήμος Σιθωνίας', 'Municipality of Sithonia', 'municipality', 'pending'),
    ('sitia', 'Δήμος Σητείας', 'Municipality of Sitia', 'municipality', 'pending'),
    ('skiathos', 'Δήμος Σκιάθου', 'Municipality of Skiathos', 'municipality', 'pending'),
    ('skopelos', 'Δήμος Σκοπέλου', 'Municipality of Skopelos', 'municipality', 'pending'),
    ('skydra', 'Δήμος Σκύδρας', 'Municipality of Skydra', 'municipality', 'pending'),
    ('skyros', 'Δήμος Σκύρου', 'Municipality of Skyros', 'municipality', 'pending'),
    ('sofades', 'Δήμος Σοφάδων', 'Municipality of Sofades', 'municipality', 'pending'),
    ('soufli', 'Δήμος Σουφλίου', 'Municipality of Soufli', 'municipality', 'pending'),
    ('souli', 'Δήμος Σουλίου', 'Municipality of Souli', 'municipality', 'pending'),
    ('south-kynouria', 'Δήμος Νότιας Κυνουρίας', 'Municipality of South Kynouria', 'municipality', 'pending'),
    ('south-pelion', 'Δήμος Νοτίου Πηλίου', 'Municipality of South Pelion', 'municipality', 'pending'),
    ('sparta', 'Δήμος Σπάρτης', 'Municipality of Sparta', 'municipality', 'pending'),
    ('spata-artemida', 'Δήμος Σπάτων-Αρτέμιδος', 'Municipality of Spata-Artemida', 'municipality', 'pending'),
    ('spetses', 'Δήμος Σπετσών', 'Municipality of Spetses', 'municipality', 'pending'),
    ('stylida', 'Δήμος Στυλίδος', 'Municipality of Stylida', 'municipality', 'pending'),
    ('symi', 'Δήμος Σύμης', 'Municipality of Symi', 'municipality', 'pending'),
    ('syros-ermoupoli', 'Δήμος Σύρου-Ερμούπολης', 'Municipality of Syros-Ermoupoli', 'municipality', 'pending'),
    ('tanagra', 'Δήμος Τανάγρας', 'Municipality of Tanagra', 'municipality', 'pending'),
    ('tempi', 'Δήμος Τεμπών', 'Municipality of Tempi', 'municipality', 'pending'),
    ('thassos', 'Δήμος Θάσου', 'Municipality of Thasos', 'municipality', 'pending'),
    ('thebes', 'Δήμος Θηβαίων', 'Municipality of Thebes', 'municipality', 'pending'),
    ('thermaikos', 'Δήμος Θερμαϊκού', 'Municipality of Thermaikos', 'municipality', 'pending'),
    ('thermi', 'Δήμος Θέρμης', 'Municipality of Thermi', 'municipality', 'pending'),
    ('thermo', 'Δήμος Θέρμου', 'Municipality of Thermo', 'municipality', 'pending'),
    ('thessaloniki', 'Δήμος Θεσσαλονίκης', 'Municipality of Thessaloniki', 'municipality', 'pending'),
    ('tilos', 'Δήμος Τήλου', 'Municipality of Tilos', 'municipality', 'pending'),
    ('tinos', 'Δήμος Τήνου', 'Municipality of Tinos', 'municipality', 'pending'),
    ('topeiros', 'Δήμος Τοπείρου', 'Municipality of Topeiros', 'municipality', 'pending'),
    ('trifylia', 'Δήμος Τριφυλλίας', 'Municipality of Trifylia', 'municipality', 'pending'),
    ('trikala', 'Δήμος Τρικκαίων', 'Municipality of Trikala', 'municipality', 'pending'),
    ('tripoli', 'Δήμος Τρίπολης', 'Municipality of Tripoli', 'municipality', 'pending'),
    ('troizinia-methana', 'Δήμος Τροιζηνίας-Μεθάνων', 'Municipality of Troizinia-Methana', 'municipality', 'pending'),
    ('tyrnavos', 'Δήμος Τυρνάβου', 'Municipality of Tyrnavos', 'municipality', 'pending'),
    ('vari-voula-vouliagmeni', 'Δήμος Βάρης-Βούλας-Βουλιαγμένης', 'Municipality of Vari-Voula-Vouliagmeni', 'municipality', 'pending'),
    ('velo-vocha', 'Δήμος Βέλου-Βοχας', 'Municipality of Velo-Vocha', 'municipality', 'pending'),
    ('veria', 'Δήμος Βέροιας', 'Municipality of Veria', 'municipality', 'pending'),
    ('viannos', 'Δήμος Βιάννου', 'Municipality of Viannos', 'municipality', 'pending'),
    ('visaltia', 'Δήμος Βισαλτίας', 'Municipality of Visaltia', 'municipality', 'pending'),
    ('voio', 'Δήμος Βοΐου', 'Municipality of Voio', 'municipality', 'pending'),
    ('volos', 'Δήμος Βόλου', 'Municipality of Volos', 'municipality', 'pending'),
    ('volvi', 'Δήμος Βόλβης', 'Municipality of Volvi', 'municipality', 'pending'),
    ('vrilissia', 'Δήμος Βριλησσίων', 'Municipality of Vrilissia', 'municipality', 'pending'),
    ('vyronas', 'Δήμος Βύρωνος', 'Municipality of Vyronas', 'municipality', 'pending'),
    ('west-achaea', 'Δήμος Δυτικής Αχαΐας', 'Municipality of West Achaea', 'municipality', 'pending'),
    ('west-mani', 'Δήμος Δυτικής Μάνης', 'Municipality of West Mani', 'municipality', 'pending'),
    ('xanthi', 'Δήμος Ξάνθης', 'Municipality of Xanthi', 'municipality', 'pending'),
    ('xiromero', 'Δήμος Ξηρομέρου', 'Municipality of Xiromero', 'municipality', 'pending'),
    ('xylokastro-evrostina', 'Δήμος Ξυλοκάστρου-Ευρωστίνης', 'Municipality of Xylokastro-Evrostina', 'municipality', 'pending'),
    ('zacharo', 'Δήμος Ζαχάρως', 'Municipality of Zacharo', 'municipality', 'pending'),
    ('zagora-mouresi', 'Δήμος Ζαγοράς-Μουρεσίου', 'Municipality of Zagora-Mouresi', 'municipality', 'pending'),
    ('zagori', 'Δήμος Ζαγορίου', 'Municipality of Zagori', 'municipality', 'pending'),
    ('zakynthos', 'Δήμος Ζακύνθου', 'Municipality of Zakynthos', 'municipality', 'pending'),
    ('ziros', 'Δήμος Ζηρού', 'Municipality of Ziros', 'municipality', 'pending'),
    ('zitsa', 'Δήμος Ζίτσας', 'Municipality of Zitsa', 'municipality', 'pending'),
    ('zografou', 'Δήμος Ζωγράφου', 'Municipality of Zografou', 'municipality', 'pending')
ON CONFLICT (region_id) DO NOTHING;

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

-- Weekly canary benchmark (crawler/crawler/canary_benchmark.py, Monday
-- morning via crawler/crontab). Only failing questions get a row here - this
-- is an alert log, not a full run history; a passing week leaves it
-- untouched. session_id points at the actual chat_sessions row the canary's
-- POST /chat/message call produced, so a super admin can open the exact
-- answer that failed instead of just seeing the question text again.
CREATE TABLE IF NOT EXISTS benchmark_alerts (
    id SERIAL PRIMARY KEY,
    vertical VARCHAR NOT NULL,
    question TEXT NOT NULL,
    session_id INT REFERENCES chat_sessions(id),
    gap BOOLEAN NOT NULL,
    citation_count INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_alerts_created ON benchmark_alerts(created_at);

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

-- One row per "revisit when N companies" KNOWN_DECISIONS.md trigger that has
-- already fired a super-admin notification (see app/services/growth_alerts.py) -
-- a one-time "you crossed the line, go look" signal, not a recurring nag.
CREATE TABLE IF NOT EXISTS company_count_threshold_alerts (
    threshold INT PRIMARY KEY,
    notified_at TIMESTAMP NOT NULL DEFAULT now()
);

-- The three public legal documents (terms/privacy/dpa), admin-editable with
-- an explicit publish gate - replaces the old file-based system
-- (app/legal_docs/*.md) where draft-state was only ever inferred from
-- `[...]` placeholders in the file. version increments on every successful
-- publish; companies.dpa_version stamps this value for slug='dpa' at
-- registration time, giving a real "which edition did they agree to" audit
-- trail. Seeded below from the prior markdown files' content.
CREATE TABLE IF NOT EXISTS legal_documents (
    id SERIAL PRIMARY KEY,
    slug VARCHAR(20) NOT NULL UNIQUE CHECK (slug IN ('terms', 'privacy', 'dpa')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    is_published BOOLEAN NOT NULL DEFAULT false,
    version INT NOT NULL DEFAULT 1,
    published_at TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT now(),
    updated_by INT REFERENCES users(id)
);

-- Seeded from the prior app/legal_docs/*.md files (internal ⚠️/💬 note
-- blockquotes stripped, matching the old render-time strip) - draft state
-- (is_published=false) until an admin explicitly publishes via the new
-- admin panel. ON CONFLICT DO NOTHING so a live DB that already has these
-- rows (admin-edited or already published) is never overwritten by a
-- fresh init.sql apply.
INSERT INTO legal_documents (slug, title, content, is_published, version) VALUES ('dpa', 'Σύμβαση Επεξεργασίας Δεδομένων', '# ΣΥΜΒΑΣΗ ΕΠΕΞΕΡΓΑΣΙΑΣ ΔΕΔΟΜΕΝΩΝ (DPA): THEKE

**Παράρτημα στους Όρους Χρήσης, σύμφωνα με το Άρθρο 28 ΓΚΠΔ**
**Έκδοση σχεδίου:** Προς νομικό έλεγχο πριν τη δημοσίευση
**Τελευταία ενημέρωση:** [ΗΜΕΡΟΜΗΝΙΑ]


---

## 1. Μέρη & Αντικείμενο

Η παρούσα Σύμβαση Επεξεργασίας Δεδομένων («Σύμβαση») συνάπτεται μεταξύ:

- **«Υπεύθυνος Επεξεργασίας»**: ο Πελάτης της Theke (η εταιρεία/επαγγελματίας που έχει ενεργή συνδρομή), για τα προσωπικά δεδομένα τρίτων (π.χ. δικών του πελατών) που καταχωρεί στην πλατφόρμα· και
- **«Εκτελών την Επεξεργασία»**: η **[ΕΠΩΝΥΜΙΑ ΙΚΕ, ΑΦΜ, ΓΕΜΗ, ΕΔΡΑ]** («Theke»),

και αποτελεί αναπόσπαστο παράρτημα των Όρων Χρήσης («Κύρια Σύμβαση») που διέπουν τη χρήση της Υπηρεσίας. Σε περίπτωση αντίφασης μεταξύ της παρούσας Σύμβασης και της Κύριας Σύμβασης, ως προς θέματα επεξεργασίας προσωπικών δεδομένων υπερισχύει η παρούσα.

Η παρούσα Σύμβαση εφαρμόζεται στο βαθμό που ο Πελάτης καταχωρεί, μέσω της χρήσης της Υπηρεσίας, προσωπικά δεδομένα φυσικών προσώπων τρίτων προς τη Theke (π.χ. στοιχεία πελατών του Πελάτη, στοιχεία τρίτων που αναφέρονται σε ανεβασμένα έγγραφα), εφεξής «Δεδομένα Πελατών του Πελάτη».

---

## 2. Φύση, Σκοπός & Διάρκεια Επεξεργασίας

| Στοιχείο | Περιγραφή |
|---|---|
| **Αντικείμενο** | Αποθήκευση, ευρετηρίαση, και επεξεργασία μέσω τεχνητής νοημοσύνης δεδομένων που καταχωρεί ο Πελάτης στο πλαίσιο χρήσης της Θήκης Λογιστικής & Φορολογίας / Θήκης Κατασκευαστικών |
| **Σκοπός** | Παροχή λειτουργιών διαχείρισης υποθέσεων/πελατών, αναζήτησης εγγράφων, και απαντήσεων μέσω AI εντός της πλατφόρμας |
| **Διάρκεια** | Καθ'' όλη τη διάρκεια ισχύος της Κύριας Σύμβασης, και για το διάστημα διατήρησης δεδομένων μετά τη λήξη της, όπως ορίζεται στην Πολιτική Απορρήτου (Ενότητα 8) |
| **Κατηγορίες Υποκειμένων** | Πελάτες/υποθέσεις του Πελάτη (π.χ. πελάτες λογιστικού γραφείου, τρίτα πρόσωπα που αναφέρονται σε ανεβασμένα έγγραφα κατασκευών) |
| **Κατηγορίες Δεδομένων** | Ονοματεπώνυμο, ΑΦΜ, στοιχεία επικοινωνίας, και κάθε άλλο δεδομένο που ο Πελάτης επιλέγει να καταχωρίσει εντός εγγράφων ή πεδίων της πλατφόρμας. **Δεν περιλαμβάνει ειδικές κατηγορίες δεδομένων** (άρθρο 9 ΓΚΠΔ): ο Πελάτης δεσμεύεται να μην καταχωρεί δεδομένα υγείας, θρησκευτικών/πολιτικών πεποιθήσεων, ή άλλες ειδικές κατηγορίες μέσω της Υπηρεσίας. |

---

## 3. Υποχρεώσεις της Theke ως Εκτελούντος την Επεξεργασία

Η Theke:

**α)** Επεξεργάζεται τα Δεδομένα Πελατών του Πελάτη **αποκλειστικά βάσει τεκμηριωμένων εντολών** του Πελάτη, όπως αυτές εκφράζονται μέσω της κανονικής χρήσης της Υπηρεσίας και της παρούσας Σύμβασης. Αν η Theke κρίνει ότι μια εντολή παραβιάζει τον ΓΚΠΔ ή άλλη διάταξη προστασίας δεδομένων, ενημερώνει άμεσα τον Πελάτη.

**β)** Διασφαλίζει ότι το προσωπικό της που έχει πρόσβαση στα δεδομένα δεσμεύεται από υποχρέωση εμπιστευτικότητας.

**γ)** Λαμβάνει τα κατάλληλα τεχνικά και οργανωτικά μέτρα ασφαλείας (άρθρο 32 ΓΚΠΔ): κρυπτογράφηση σε μεταφορά, λογική απομόνωση δεδομένων ανά εταιρεία-πελάτη, περιορισμένη πρόσβαση βάσει ρόλου, όπως αναλυτικά περιγράφεται στην Πολιτική Απορρήτου.

**δ)** **Δεν χρησιμοποιεί υπο-εκτελούντες (sub-processors) χωρίς προηγούμενη γενική ή ειδική έγκριση**: η παρούσα Σύμβαση αποτελεί γενική έγκριση για τους υπο-εκτελούντες που αναφέρονται στο Παράρτημα Α. Η Theke ενημερώνει τον Πελάτη τουλάχιστον 30 ημέρες πριν από την προσθήκη ή αντικατάσταση υπο-εκτελούντος, παρέχοντας στον Πελάτη δικαίωμα εναντίωσης.

**ε)** Επιβάλλει στους υπο-εκτελούντες συμβατικές υποχρεώσεις αντίστοιχες με αυτές της παρούσας Σύμβασης, και παραμένει πλήρως υπεύθυνη έναντι του Πελάτη για τις πράξεις/παραλείψεις τους.

**στ)** Παρέχει εύλογη συνδρομή στον Πελάτη για την ικανοποίηση αιτημάτων άσκησης δικαιωμάτων υποκειμένων (πρόσβαση, διόρθωση, διαγραφή, φορητότητα) που αφορούν Δεδομένα Πελατών του Πελάτη, εντός εύλογου χρονικού διαστήματος από σχετικό αίτημα του Πελάτη.

**ζ)** Ενημερώνει τον Πελάτη **χωρίς αδικαιολόγητη καθυστέρηση, και σε κάθε περίπτωση εντός 48 ωρών** από τη στιγμή που λαμβάνει γνώση περιστατικού παραβίασης δεδομένων (data breach) που αφορά Δεδομένα Πελατών του Πελάτη, παρέχοντας τις διαθέσιμες πληροφορίες ώστε ο Πελάτης να εκπληρώσει τη δική του υποχρέωση γνωστοποίησης προς την ΑΠΔΠΧ εντός 72 ωρών (άρθρο 33 ΓΚΠΔ).

**η)** Κατά τη λήξη της Κύριας Σύμβασης, κατ'' επιλογή του Πελάτη, **διαγράφει ή επιστρέφει** στον Πελάτη όλα τα Δεδομένα Πελατών του Πελάτη, σύμφωνα με τις περιόδους διατήρησης της Πολιτικής Απορρήτου, εκτός αν το δίκαιο της Ένωσης ή εθνικό δίκαιο επιβάλλει διατήρηση.

**θ)** Θέτει στη διάθεση του Πελάτη κάθε αναγκαία πληροφορία για την απόδειξη συμμόρφωσης με τις υποχρεώσεις της παρούσας Σύμβασης, και επιτρέπει (και συμβάλλει σε) ελέγχους, συμπεριλαμβανομένων επιθεωρήσεων, που διενεργούνται από τον Πελάτη ή εξουσιοδοτημένο ελεγκτή του, κατόπιν εύλογης προειδοποίησης.

---

## 4. Υποχρεώσεις του Πελάτη ως Υπεύθυνου Επεξεργασίας

Ο Πελάτης:

**α)** Διαθέτει τη δική του νόμιμη βάση επεξεργασίας (π.χ. σύμβαση παροχής υπηρεσιών με τους δικούς του πελάτες, έννομο συμφέρον) για την καταχώρηση Δεδομένων Πελατών του Πελάτη στη Theke, και είναι αποκλειστικά υπεύθυνος για τη νομιμότητα της συλλογής και της αρχικής επεξεργασίας τους.

**β)** Είναι αποκλειστικά υπεύθυνος για την ενημέρωση των δικών του πελατών (υποκειμένων) σχετικά με την επεξεργασία των δεδομένων τους, συμπεριλαμβανομένης της χρήσης της Theke ως εργαλείου/υπο-εκτελούντος.

**γ)** Δεν καταχωρεί ειδικές κατηγορίες δεδομένων (άρθρο 9 ΓΚΠΔ) ή δεδομένα ανηλίκων στην πλατφόρμα, εκτός αν αυτό έχει συμφωνηθεί ρητά και γραπτώς με τη Theke.

**δ)** Ενημερώνει άμεσα τη Theke αν λάβει αίτημα άσκησης δικαιώματος από υποκείμενο που αφορά δεδομένα αποθηκευμένα στην πλατφόρμα, ώστε να ενεργοποιηθεί η συνδρομή του άρθρου 3(στ).

---

## 5. Διεθνείς Διαβιβάσεις

Η επεξεργασία Δεδομένων Πελατών του Πελάτη μέσω του OpenAI (βλ. Παράρτημα Α) συνεπάγεται διαβίβαση δεδομένων εκτός ΕΕ/ΕΟΧ, προς τις ΗΠΑ. Η διαβίβαση αυτή καλύπτεται από Πρότυπες Συμβατικές Ρήτρες (SCCs) ενσωματωμένες στη Συμφωνία Επεξεργασίας Δεδομένων του OpenAI, και από την πιστοποίηση του OpenAI στο πλαίσιο EU-U.S. Data Privacy Framework. Ο Πελάτης αποδέχεται τη διαβίβαση αυτή ως αναγκαία προϋπόθεση χρήσης της βασικής λειτουργίας της Υπηρεσίας.

---

## 6. Ευθύνη

Η ευθύνη κάθε μέρους για παραβιάσεις της παρούσας Σύμβασης διέπεται από τους όρους περιορισμού ευθύνης της Κύριας Σύμβασης (Ενότητα 6 των Όρων Χρήσης), με εξαίρεση περιπτώσεις όπου αναγκαστικού δικαίου διατάξεις του ΓΚΠΔ επιβάλλουν διαφορετικό καθεστώς ευθύνης μεταξύ Υπεύθυνου και Εκτελούντος την Επεξεργασία (άρθρο 82 ΓΚΠΔ).

---

## ΠΑΡΑΡΤΗΜΑ Α: Εγκεκριμένοι Υπο-Εκτελούντες

| Υπο-Εκτελών | Ρόλος | Τοποθεσία Επεξεργασίας | Μηχανισμός Διαβίβασης |
|---|---|---|---|
| OpenAI, L.L.C. | Επεξεργασία ερωτημάτων AI, δημιουργία embeddings | ΗΠΑ | SCCs + EU-U.S. Data Privacy Framework |
| Hetzner Online GmbH | Φιλοξενία υποδομής/βάσης δεδομένων | ΕΕ (Γερμανία/Φινλανδία) | Εντός ΕΕ: δεν απαιτείται μηχανισμός διαβίβασης |
| Resend | Αποστολή email (μόνο για στοιχεία λογαριασμού, όχι Δεδομένα Πελατών του Πελάτη) | ΗΠΑ | SCCs + EU-U.S. Data Privacy Framework |


---

## Αποδοχή

Με την αποδοχή των Όρων Χρήσης κατά την εγγραφή, ο Πελάτης αποδέχεται και τους όρους της παρούσας Σύμβασης Επεξεργασίας Δεδομένων ως αναπόσπαστο παράρτημά τους.
', false, 1) ON CONFLICT (slug) DO NOTHING;
INSERT INTO legal_documents (slug, title, content, is_published, version) VALUES ('privacy', 'Πολιτική Απορρήτου', '# ΠΟΛΙΤΙΚΗ ΑΠΟΡΡΗΤΟΥ: THEKE

**Έκδοση σχεδίου:** Προς νομικό έλεγχο πριν τη δημοσίευση
**Τελευταία ενημέρωση:** [ΗΜΕΡΟΜΗΝΙΑ]


---

## 1. Υπεύθυνος Επεξεργασίας

Υπεύθυνος επεξεργασίας των προσωπικών δεδομένων που συλλέγονται μέσω της πλατφόρμας Theke είναι η **[ΕΠΩΝΥΜΙΑ ΙΚΕ, ΑΦΜ, ΓΕΜΗ, ΕΔΡΑ]** («εμείς», «η Theke»).

Για οποιοδήποτε θέμα σχετικό με την επεξεργασία των δεδομένων σας: **info@theke.ai**

---

## 2. Ποια Δεδομένα Συλλέγουμε

### 2.1 Στοιχεία Λογαριασμού
Ονοματεπώνυμο, email, τηλέφωνο (προαιρετικό), εταιρική σύνδεση, ρόλος στην εταιρεία σας.

### 2.2 Ερωτήματα / Chat
Κάθε ερώτηση που υποβάλλετε στη Theke αποθηκεύεται στη βάση δεδομένων μας και αποστέλλεται στον πάροχο τεχνητής νοημοσύνης OpenAI για την παραγωγή απάντησης (βλ. Ενότητα 4).

### 2.3 Έγγραφα που Ανεβάζετε
Αρχεία που ανεβάζετε (π.χ. συμβάσεις, σχέδια, αλληλογραφία) αποθηκεύονται στην υποδομή μας, εξάγεται το κειμενικό τους περιεχόμενο, και δημιουργούνται διανυσματικές αναπαραστάσεις (embeddings) για λειτουργίες αναζήτησης. Τα δεδομένα κάθε εταιρείας-πελάτη είναι λογικά απομονωμένα (isolated) σε τρία επίπεδα: από άλλες εταιρείες-πελάτες, από τους υπόλοιπους πελάτες σας εντός της ίδιας εταιρείας όταν ένα έγγραφο συνδέεται με συγκεκριμένο πελάτη, και από τα υπόλοιπα έργα του ίδιου πελάτη όταν ένα έγγραφο συνδέεται με συγκεκριμένο έργο.

### 2.4 Στοιχεία Πελατών σας (Κάθετη Λογιστικής)
Αν χρησιμοποιείτε τη Θήκη Λογιστικής, ενδέχεται να καταχωρίσετε στοιχεία των **δικών σας πελατών** (ονοματεπώνυμο, ΑΦΜ) για τη διαχείριση υποθέσεων εντός της πλατφόρμας. **Σημαντικό:** για αυτά τα δεδομένα, εσείς (ή η εταιρεία σας) είστε ο Υπεύθυνος Επεξεργασίας έναντι των δικών σας πελατών, και η Theke ενεργεί ως Εκτελών την Επεξεργασία για λογαριασμό σας. Βλ. Ενότητα 7.

### 2.5 Στοιχεία Χρέωσης
Η τιμολόγηση γίνεται προς το παρόν χειροκίνητα από την Εταιρεία· δεν συλλέγουμε ή αποθηκεύουμε στοιχεία τραπεζικής κάρτας στους διακομιστές μας. Όταν ενεργοποιηθεί η ενσωμάτωση με τον πάροχο πληρωμών Stripe, η παρούσα Πολιτική θα επικαιροποιηθεί αναλόγως.

---

## 3. Σκοπός & Νομική Βάση Επεξεργασίας

| Δεδομένα | Σκοπός | Νομική Βάση (Άρθρο 6 ΓΚΠΔ) |
|---|---|---|
| Στοιχεία λογαριασμού | Δημιουργία/διαχείριση λογαριασμού, επικοινωνία | Εκτέλεση σύμβασης (6§1β) |
| Ερωτήματα chat | Παροχή της βασικής λειτουργίας της Υπηρεσίας | Εκτέλεση σύμβασης (6§1β) |
| Ανεβασμένα έγγραφα | Παροχή λειτουργιών αναζήτησης/ανάλυσης εγγράφων | Εκτέλεση σύμβασης (6§1β) |
| Στοιχεία πελατών σας (ΑΦΜ κ.λπ.) | Λειτουργία διαχείρισης υποθέσεων εντός πλατφόρμας | Εκτέλεση σύμβασης μεταξύ εσάς και της Theke· εσείς φέρετε τη δική σας νομική βάση έναντι των πελατών σας |
| Τεχνικά logs / χρήση | Ασφάλεια, αντιμετώπιση κατάχρησης, βελτίωση υπηρεσίας | Έννομο συμφέρον (6§1στ) |

---

## 4. Ο Ρόλος του OpenAI: Σε Απλή Γλώσσα

Η Theke χρησιμοποιεί το μοντέλο τεχνητής νοημοσύνης **GPT-4o της εταιρείας OpenAI** (έδρα: ΗΠΑ) για να επεξεργαστεί κάθε ερώτημα που υποβάλλετε και να παράγει την απάντηση με παραπομπές. Αυτό σημαίνει πρακτικά:

- **Κάθε ερώτηση που κάνετε στη Theke, και το κείμενο κάθε εγγράφου που ανεβάζετε (για τη δημιουργία embeddings), αποστέλλεται στους διακομιστές του OpenAI στις ΗΠΑ για επεξεργασία.** Αυτό δεν είναι προαιρετικό· είναι ο τρόπος που λειτουργεί ο πυρήνας της Υπηρεσίας.
- Ο OpenAI ενεργεί ως **Εκτελών την Επεξεργασία (data processor)** για λογαριασμό της Theke, όχι ως ανεξάρτητος Υπεύθυνος Επεξεργασίας. Αυτό σημαίνει ότι δεν έχει το δικαίωμα να χρησιμοποιήσει τα δεδομένα σας για δικούς του σκοπούς.
- Ο OpenAI δηλώνει ότι **δεν χρησιμοποιεί δεδομένα που αποστέλλονται μέσω του API του για την εκπαίδευση των μοντέλων του**, και τα διατηρεί για έως 30 ημέρες για σκοπούς παρακολούθησης κατάχρησης (abuse monitoring), εκτός αν έχει εγκριθεί καθεστώς μηδενικής διατήρησης (zero data retention).
- Η μεταφορά δεδομένων στις ΗΠΑ καλύπτεται από **Πρότυπες Συμβατικές Ρήτρες (Standard Contractual Clauses)** που περιλαμβάνονται στη Συμφωνία Επεξεργασίας Δεδομένων (DPA) του OpenAI, καθώς και από την πιστοποίηση του OpenAI στο πλαίσιο **EU-U.S. Data Privacy Framework**.


---

## 5. Λοιποί Εκτελούντες την Επεξεργασία

| Πάροχος | Ρόλος | Δεδομένα που βλέπει |
|---|---|---|
| **OpenAI** (ΗΠΑ) | Επεξεργασία ερωτημάτων AI, δημιουργία embeddings | Κείμενο ερωτημάτων, κείμενο ανεβασμένων εγγράφων |
| **Hetzner** (ΕΕ, Γερμανία/Φινλανδία) | Φιλοξενία υποδομής (διακομιστές, βάση δεδομένων) | Όλα τα αποθηκευμένα δεδομένα (ως πάροχος υποδομής) |
| **Resend** | Αποστολή email (π.χ. επαναφορά κωδικού) | Διεύθυνση email, σύνδεσμος επαναφοράς |

Δεν πωλούμε ή ενοικιάζουμε τα δεδομένα σας σε τρίτους για διαφημιστικούς ή άλλους εμπορικούς σκοπούς.

---

## 6. Διεθνείς Διαβιβάσεις Δεδομένων

Η Hetzner φιλοξενεί τα δεδομένα εντός Ευρωπαϊκής Ένωσης. Ο OpenAI και ο Resend επεξεργάζονται δεδομένα στις ΗΠΑ (ο OpenAI όπως περιγράφεται αναλυτικά στην Ενότητα 4, και ο Resend όπως αναφέρεται στην Ενότητα 5), με τις ίδιες διασφαλίσεις και στις δύο περιπτώσεις (SCCs, EU-U.S. Data Privacy Framework).

---

## 7. Όταν Καταχωρείτε Στοιχεία Δικών σας Πελατών (Κάθετη Λογιστικής)

Αν είστε λογιστής/φοροτεχνικός και καταχωρείτε στοιχεία (ονοματεπώνυμο, ΑΦΜ) των δικών σας πελατών στη Theke:

- **Εσείς παραμένετε Υπεύθυνος Επεξεργασίας** για τα δεδομένα των δικών σας πελατών. Οφείλετε να έχετε τη δική σας νόμιμη βάση επεξεργασίας (π.χ. σύμβαση παροχής λογιστικών υπηρεσιών) και τη δική σας ενημέρωση προς τους πελάτες σας.
- **Η Theke ενεργεί ως Εκτελών την Επεξεργασία** για αυτά τα δεδομένα, στο πλαίσιο μιας Σύμβασης Επεξεργασίας Δεδομένων (Data Processing Agreement) μεταξύ της Theke και εσάς, σύμφωνα με το άρθρο 28 ΓΚΠΔ.


---

## 8. Πόσο Καιρό Διατηρούμε τα Δεδομένα σας

- **Ερωτήματα chat και ανεβασμένα έγγραφα:** διατηρούνται καθ'' όλη τη διάρκεια ενεργής συνδρομής, και για **60 ημέρες** μετά την ακύρωση της συνδρομής (παράθυρο επανενεργοποίησης), μετά τις οποίες διαγράφονται οριστικά.
- **Ρητό αίτημα διαγραφής:** αν υποβάλετε ρητό αίτημα διαγραφής των δεδομένων σας (άρθρο 17 ΓΚΠΔ) ανά πάσα στιγμή, είτε κατά τη διάρκεια ενεργής συνδρομής είτε μετά την ακύρωση, η διαγραφή ολοκληρώνεται εντός **30 ημερών** από το αίτημα. Το ρητό αίτημα υπερισχύει του 60ήμερου παραθύρου επανενεργοποίησης και επισπεύδει τη διαγραφή· δεν την καθυστερεί ποτέ.
- **Στοιχεία λογαριασμού:** διατηρούνται όσο υπάρχει ενεργός λογαριασμός, και διαγράφονται εντός 30 ημερών από αίτημα διαγραφής ή από το πέρας του 60ήμερου παραθύρου μετά την οριστική ακύρωση.
- **Παραστατικά τιμολόγησης:** διατηρούνται για όσο χρονικό διάστημα επιβάλλει η φορολογική νομοθεσία (τυπικά 5 έτη), ανεξάρτητα από τη διαγραφή του λογαριασμού.

---

## 9. Τα Δικαιώματά σας

Σύμφωνα με τον ΓΚΠΔ, έχετε δικαίωμα:
- **Πρόσβασης** στα δεδομένα σας
- **Διόρθωσης** ανακριβών δεδομένων
- **Διαγραφής** («δικαίωμα στη λήθη»), με τις εξαιρέσεις της Ενότητας 8
- **Φορητότητας**: λήψη των δεδομένων σας σε αναγνώσιμη μορφή (CSV/JSON)
- **Εναντίωσης** στην επεξεργασία για λόγους έννομου συμφέροντος
- **Υποβολής καταγγελίας** στην Αρχή Προστασίας Δεδομένων Προσωπικού Χαρακτήρα (ΑΠΔΠΧ), www.dpa.gr

Για την άσκηση των δικαιωμάτων σας: **info@theke.ai**

---

## 10. Ασφάλεια

Χρησιμοποιούμε τεχνικά και οργανωτικά μέτρα (κρυπτογράφηση σε μεταφορά, λογική απομόνωση δεδομένων ανά εταιρεία-πελάτη, περιορισμένη πρόσβαση προσωπικού) για την προστασία των δεδομένων σας. Καμία μέθοδος μετάδοσης ή αποθήκευσης δεν είναι 100% ασφαλής.

---

## 11. Τροποποιήσεις

Η παρούσα Πολιτική ενδέχεται να επικαιροποιείται. Ουσιώδεις αλλαγές θα ανακοινώνονται με εύλογη προειδοποίηση.

---

## 12. Επικοινωνία

**[Πλήρη στοιχεία Εταιρείας μετά τη σύσταση ΙΚΕ]**
Email: **info@theke.ai**
', false, 1) ON CONFLICT (slug) DO NOTHING;
INSERT INTO legal_documents (slug, title, content, is_published, version) VALUES ('terms', 'Όροι Χρήσης', '# ΟΡΟΙ ΧΡΗΣΗΣ: THEKE

**Έκδοση σχεδίου:** Προς νομικό έλεγχο πριν τη δημοσίευση
**Τελευταία ενημέρωση:** [ΗΜΕΡΟΜΗΝΙΑ]


---

## 1. Αποδοχή Όρων

Οι παρόντες Όροι Χρήσης («Όροι») διέπουν τη χρήση της πλατφόρμας Theke, συμπεριλαμβανομένων των δύο κάθετων υπηρεσιών της, Θήκη Κατασκευαστικών και Θήκη Λογιστικής (από κοινού η «Υπηρεσία» ή «Theke»), η οποία παρέχεται από την εταιρεία **[ΕΠΩΝΥΜΙΑ ΙΚΕ, ΑΦΜ, ΓΕΜΗ, ΕΔΡΑ]** («εμείς», «η Εταιρεία»).

Με την εγγραφή σας, την αποδοχή αυτού του κειμένου κατά την εγγραφή, ή τη χρήση της Υπηρεσίας, αποδέχεστε πλήρως και ανεπιφύλακτα τους παρόντες Όρους. Αν ενεργείτε εκ μέρους εταιρείας ή επαγγελματικής οντότητας («Πελάτης»), δηλώνετε ότι έχετε την εξουσία να δεσμεύσετε τον Πελάτη σε αυτούς τους Όρους.

Αν δεν συμφωνείτε με τους Όρους, δεν πρέπει να χρησιμοποιήσετε την Υπηρεσία.

---

## 2. Περιγραφή Υπηρεσίας: Ουσιώδης Περιορισμός Σκοπού

Η Theke είναι ένα εργαλείο **κανονιστικής πληροφόρησης** που χρησιμοποιεί τεχνητή νοημοσύνη (retrieval-augmented generation) για να απαντά σε ερωτήσεις σχετικά με ελληνική νομοθεσία και κανονιστικές διαδικασίες, βασιζόμενο σε επίσημες ελληνικές πηγές (ΦΕΚ, νόμους, αποφάσεις δημόσιων υπηρεσιών) με παραπομπές (citations) στις πηγές αυτές.

**Η Theke ΔΕΝ παρέχει νομική, φοροτεχνική, λογιστική, μηχανική ή οποιαδήποτε άλλη μορφή επαγγελματικής συμβουλής.** Οι απαντήσεις που παράγει η Υπηρεσία:

- Αποτελούν γενική κανονιστική πληροφόρηση, όχι εξατομικευμένη επαγγελματική γνωμοδότηση για τη συγκεκριμένη περίπτωσή σας.
- Μπορεί να περιέχουν σφάλματα, παραλείψεις, ή να βασίζονται σε πηγές που έχουν στο μεταξύ τροποποιηθεί.
- **Πρέπει πάντα να επαληθεύονται από αδειοδοτημένο επαγγελματία** (μηχανικό, λογιστή/φοροτεχνικό, δικηγόρο, ανάλογα με το αντικείμενο) πριν χρησιμοποιηθούν ως βάση για οποιαδήποτε επαγγελματική ενέργεια, υποβολή, ή απόφαση.

Η χρήση της Υπηρεσίας προϋποθέτει ότι είστε αδειοδοτημένος επαγγελματίας (ή στέλεχος εταιρείας αδειοδοτημένων επαγγελματιών) στον κλάδο σας και ότι διαθέτετε την τεχνική κρίση να αξιολογήσετε την απάντηση πριν την εφαρμόσετε.

---

## 3. Συνδρομές, Τιμολόγηση & Πληρωμές

### 3.1 Πλάνα Συνδρομής

Η Theke προσφέρεται σε επίπεδα συνδρομής ανά κάθετη υπηρεσία (Κατασκευαστικών / Λογιστικής), όπως αναλυτικά περιγράφονται στη σελίδα τιμολόγησης [www.theke.ai/pricing ή αντίστοιχο]. Ενδεικτικά:

| Κάθετη Υπηρεσία | Πλάνο | Μηνιαία (ετήσια δέσμευση) | Μηνιαία (χωρίς δέσμευση) |
|---|---|---|---|
| Κατασκευαστικών | Starter | €40,83 | €49 |
| Κατασκευαστικών | Professional | €82,50 | €99 |
| Κατασκευαστικών | Business | €165,83 | €199 |
| Λογιστικής | Starter | €49,17 | €59 |
| Λογιστικής | Professional | €99,17 | €119 |
| Λογιστικής | Business | €207,50 | €249 |

Οι παραπάνω τιμές **δεν συμπεριλαμβάνουν ΦΠΑ 24%**, ο οποίος προστίθεται κατά την τιμολόγηση. Σε περίπτωση μη ετήσιας δέσμευσης, ισχύει η μηνιαία τιμή χωρίς έκπτωση.

Κάθε πλάνο περιλαμβάνει όριο χρηστών, όριο μηνυμάτων/μήνα, και όριο αποθηκευτικού χώρου εγγράφων, όπως αναλυτικά περιγράφεται στη σελίδα τιμολόγησης. Η υπέρβαση του ορίου μηνυμάτων ενεργοποιεί δυνατότητα αγοράς πρόσθετου πακέτου (200 μηνύματα / €15 + ΦΠΑ) ή αναβάθμισης πλάνου. Η υπέρβαση του ορίου αποθηκευτικού χώρου εμποδίζει νέα ανεβάσματα εγγράφων μέχρι αναβάθμιση ή διαγραφή υπάρχοντων αρχείων.

### 3.2 Κύκλος Χρέωσης

Η συνδρομή χρεώνεται είτε μηνιαίως είτε ετησίως, ανάλογα με την επιλογή σας κατά την εγγραφή. Η ετήσια χρέωση καταβάλλεται εφάπαξ για το σύνολο των 12 μηνών. **Τιμολόγηση γίνεται προς το παρόν απευθείας από την Εταιρεία (χειροκίνητα)· η καταβολή μέσω κάρτας/αυτόματης ανανέωσης δεν είναι ακόμα διαθέσιμη.**

### 3.3 Ακύρωση Συνδρομής

- Μπορείτε να ακυρώσετε τη συνδρομή σας ανά πάσα στιγμή, με γραπτή ειδοποίηση προς info@theke.ai.
- Σε μηνιαία συνδρομή: η ακύρωση ισχύει από το τέλος του τρέχοντος μήνα χρέωσης· δεν γίνεται μερική επιστροφή για τις υπόλοιπες ημέρες του μήνα.
- Σε ετήσια συνδρομή: η ακύρωση δεν συνεπάγεται επιστροφή χρημάτων για το αδιάθετο διάστημα της τρέχουσας ετήσιας περιόδου. Η πρόσβαση στην Υπηρεσία παραμένει ενεργή κανονικά μέχρι τη λήξη της περιόδου για την οποία έχει ήδη καταβληθεί το τίμημα· η ακύρωση παύει μόνο την αυτόματη ανανέωση της συνδρομής για την επόμενη περίοδο.
- Η Εταιρεία διατηρεί το δικαίωμα αναστολής ή τερματισμού λογαριασμού σε περίπτωση παραβίασης των παρόντων Όρων, με προηγούμενη ειδοποίηση όπου αυτό είναι ευλόγως εφικτό.

### 3.4 Δεδομένα Μετά την Ακύρωση

Βλ. Ενότητα 9 (Δεδομένα κατά τη Λήξη Συνδρομής).

---

## 4. Αποδεκτή Χρήση

Απαγορεύεται:

- Η μεταπώληση, υπεκμίσθωση, ή παραχώρηση πρόσβασης στην Υπηρεσία σε τρίτους που δεν είναι εξουσιοδοτημένοι χρήστες του λογαριασμού του Πελάτη.
- Η μοιρασιά κωδικών πρόσβασης πέραν του αριθμού χρηστών που προβλέπει το πλάνο συνδρομής.
- Η συστηματική εξαγωγή, αντιγραφή, «scraping», ή χρήση αυτοματοποιημένων εργαλείων (bots, scrapers, crawlers) για μαζική εξαγωγή περιεχομένου της βάσης γνώσης της Theke, πέραν των απαντήσεων που λαμβάνετε στο πλαίσιο κανονικής, ανθρώπινης χρήσης της Υπηρεσίας.
- Η χρήση της Υπηρεσίας για την εκπαίδευση, βελτίωση, ή δημιουργία ανταγωνιστικού προϊόντος τεχνητής νοημοσύνης ή κανονιστικής βάσης δεδομένων.
- Η χρήση της Υπηρεσίας για παράνομο σκοπό, ή για την υποβολή περιεχομένου που παραβιάζει δικαιώματα τρίτων.
- Οποιαδήποτε ενέργεια που θέτει σε κίνδυνο την ακεραιότητα, ασφάλεια, ή διαθεσιμότητα της υποδομής της Υπηρεσίας.

Η παραβίαση της παρούσας ενότητας αποτελεί ουσιώδη λόγο άμεσου τερματισμού λογαριασμού, χωρίς επιστροφή τυχόν καταβληθέντων ποσών.

---

## 5. Πνευματική Ιδιοκτησία

### 5.1 Ιδιοκτησία της Εταιρείας

Η Εταιρεία διατηρεί την αποκλειστική κυριότητα επί:
- Του λογισμικού, της αρχιτεκτονικής, και του κώδικα της πλατφόρμας.
- Της πρωτότυπης σύνθεσης, ανάλυσης, και επεξηγηματικού περιεχομένου που έχει συνταχθεί από την Εταιρεία πάνω στις κανονιστικές πηγές.
- Της δομής, οργάνωσης, επιλογής, και ευρετηρίασης (indexing) του περιεχομένου της βάσης γνώσης ως σύνολο (βλ. αναλυτικά στο ξεχωριστό σημείωμα IP που ζήτησες, παραπέμπει στο άρθρο 2 §2α και στο ειδικό δικαίωμα κατασκευαστή βάσης δεδομένων του Ν.2121/1993).

### 5.2 Δημόσιος Χαρακτήρας των Υποκείμενων Πηγών

Οι υποκείμενες επίσημες κανονιστικές πηγές (νόμοι, ΦΕΚ, αποφάσεις δημόσιων αρχών) **δεν αποτελούν ιδιοκτησία της Εταιρείας**· πρόκειται για επίσημα κείμενα του Ελληνικού Δημοσίου, εξαιρούμενα από την προστασία πνευματικής ιδιοκτησίας δυνάμει του άρθρου 2 §5 του Ν.2121/1993. Η Theke τα αναπαράγει και τα παραπέμπει (cites) ως δημόσια διαθέσιμο υλικό.

### 5.3 Περιεχόμενο του Χρήστη

Έγγραφα, ερωτήσεις, και δεδομένα πελατών που ανεβάζετε ή εισάγετε στην Υπηρεσία («Περιεχόμενο Χρήστη») παραμένουν στην αποκλειστική σας κυριότητα. Η Εταιρεία δεν αποκτά κανένα δικαίωμα κυριότητας επί του Περιεχομένου Χρήστη. Παραχωρείτε στην Εταιρεία περιορισμένη άδεια επεξεργασίας του Περιεχομένου Χρήστη αποκλειστικά για τον σκοπό παροχής της Υπηρεσίας σε εσάς (συμπεριλαμβανομένης της επεξεργασίας μέσω τρίτων παρόχων όπως περιγράφεται στην Πολιτική Απορρήτου).

---

## 6. Περιορισμός Ευθύνης

**Στο μέγιστο βαθμό που επιτρέπει ο νόμος:**

- Η Theke παρέχεται «ως έχει» («as is»), χωρίς καμία εγγύηση πληρότητας, ακρίβειας, ή καταλληλότητας για συγκεκριμένο σκοπό.
- Η Εταιρεία δεν φέρει ευθύνη για αποφάσεις, ενέργειες, παραλείψεις, ή ζημίες (άμεσες ή έμμεσες, συμπεριλαμβανομένης διαφυγόντος κέρδους, διοικητικών προστίμων, ή αστικής/ποινικής ευθύνης του χρήστη έναντι τρίτων) που προκύπτουν από τη χρήση ή εξάρτηση σε απάντηση της Υπηρεσίας, χωρίς προηγούμενη επαλήθευση από αδειοδοτημένο επαγγελματία σύμφωνα με την Ενότητα 2.
- Σε κάθε περίπτωση όπου η ευθύνη της Εταιρείας δεν μπορεί να αποκλειστεί πλήρως κατά το εφαρμοστέο δίκαιο, η συνολική ευθύνη της Εταιρείας έναντι του Πελάτη περιορίζεται στο **σύνολο των συνδρομητικών τελών που κατέβαλε ο Πελάτης κατά τους δώδεκα (12) μήνες που προηγούνται του γεγονότος που γέννησε την αξίωση.**
- Ο περιορισμός αυτός δεν ισχύει σε περιπτώσεις δόλου ή βαρειάς αμέλειας της Εταιρείας, ούτε σε περιπτώσεις όπου η ευθύνη δεν μπορεί να περιοριστεί σύμφωνα με αναγκαστικού δικαίου διατάξεις (π.χ. σωματική βλάβη).


---

## 7. Διαθεσιμότητα Υπηρεσίας

Η Εταιρεία καταβάλλει εύλογες προσπάθειες για αδιάλειπτη διαθεσιμότητα, χωρίς όμως να εγγυάται συγκεκριμένο ποσοστό διαθεσιμότητας (SLA) στο παρόν στάδιο. Προγραμματισμένη συντήρηση ανακοινώνεται όπου είναι ευλόγως εφικτό.

---

## 8. Τρίτοι Πάροχοι

Για την παροχή της Υπηρεσίας, η Εταιρεία χρησιμοποιεί τρίτους παρόχους (OpenAI για την επεξεργασία ερωτημάτων μέσω τεχνητής νοημοσύνης, Hetzner για φιλοξενία υποδομής, Resend για αποστολή email). Αναλυτικά στην Πολιτική Απορρήτου.

---

## 9. Δεδομένα κατά τη Λήξη Συνδρομής

- Κατά την ακύρωση, ο λογαριασμός τίθεται σε κατάσταση «ανενεργός» για διάστημα **60 ημερών**, κατά το οποίο τα δεδομένα σας παραμένουν αποθηκευμένα αλλά μη προσβάσιμα, ώστε να μπορείτε να επανενεργοποιήσετε τη συνδρομή χωρίς απώλεια ιστορικού.
- Μετά το πέρας αυτού του διαστήματος, τα δεδομένα σας (ερωτήματα, ανεβασμένα έγγραφα, στοιχεία πελατών που έχετε καταχωρήσει) **διαγράφονται οριστικά**, εκτός αν υπάρχει νόμιμη υποχρέωση διατήρησης (π.χ. λογιστικά παραστατικά).
- Αν υποβάλετε ρητό αίτημα διαγραφής ανά πάσα στιγμή, η διαγραφή ολοκληρώνεται εντός **30 ημερών** από το αίτημα. Αυτό το χρονικό διάστημα υπερισχύει του 60ήμερου παραθύρου επανενεργοποίησης παραπάνω και το επισπεύδει, δεν το καθυστερεί.
- Μπορείτε να ζητήσετε **εξαγωγή των δεδομένων σας** σε αναγνώσιμη μορφή (π.χ. CSV/JSON) οποιαδήποτε στιγμή πριν τη διαγραφή, σύμφωνα με το δικαίωμα φορητότητας του ΓΚΠΔ (βλ. Πολιτική Απορρήτου).

---

## 10. Τροποποιήσεις Όρων

Η Εταιρεία διατηρεί το δικαίωμα τροποποίησης των παρόντων Όρων. Ουσιώδεις τροποποιήσεις θα ανακοινώνονται με εύλογη προειδοποίηση (π.χ. 30 ημέρες) μέσω email ή εντός της πλατφόρμας. Η συνέχιση χρήσης της Υπηρεσίας μετά την έναρξη ισχύος των τροποποιήσεων συνιστά αποδοχή τους.

---

## 11. Εφαρμοστέο Δίκαιο & Δικαιοδοσία

Οι παρόντες Όροι διέπονται από το Ελληνικό Δίκαιο. Για κάθε διαφορά που προκύπτει από ή σε σχέση με τους παρόντες Όρους, αρμόδια ορίζονται τα Δικαστήρια **[ΠΟΛΗ: προτείνεται Καβάλα ή Θεσσαλονίκη ανάλογα με έδρα ΙΚΕ]**.

---

## 12. Επικοινωνία

Για ερωτήσεις σχετικά με τους παρόντες Όρους: **info@theke.ai**
Στοιχεία Εταιρείας: **[πλήρη στοιχεία ΙΚΕ μετά τη σύσταση]**
', false, 1) ON CONFLICT (slug) DO NOTHING;

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
    tagline_en TEXT,
    welcome_message TEXT,
    welcome_message_en TEXT,
    disclaimer_text TEXT,
    disclaimer_text_en TEXT,
    system_prompt_override TEXT,
    off_topic_hint TEXT,
    uses_regional_scoping BOOLEAN NOT NULL DEFAULT true,
    status VARCHAR NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT now()
);
-- Added after the table above already existed on live databases - see
-- companies.vertical_id a few lines down for the same idempotent-retrofit
-- pattern.
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS disclaimer_text_en TEXT;
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS welcome_message_en TEXT;
ALTER TABLE verticals ADD COLUMN IF NOT EXISTS tagline_en TEXT;

INSERT INTO verticals (
    slug, display_name, tagline, welcome_message, disclaimer_text, uses_regional_scoping
) VALUES (
    'construction',
    'Θήκη Κατασκευαστικών',
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

-- English disclaimer translations (Phase 1f) - a plain UPDATE rather than
-- part of the INSERTs above, same backfill pattern as the plans.
-- annual_total_eur corrections further down, since the INSERTs'
-- ON CONFLICT DO NOTHING never touches a row that already exists.
UPDATE verticals SET disclaimer_text_en =
    'The information above is for informational purposes only. Consult a licensed engineer for your specific project.'
    WHERE slug = 'construction';
UPDATE verticals SET disclaimer_text_en =
    'The information above is for informational purposes only. Consult a licensed accountant or tax advisor for your specific matter.'
    WHERE slug = 'tax_accounting';

-- English welcome-message translations (Phase 3) - same backfill pattern.
UPDATE verticals SET welcome_message_en =
    'Ask about building permit requirements, document checks, or YDOM (building authority) procedures for your area.'
    WHERE slug = 'construction';
UPDATE verticals SET welcome_message_en =
    'Ask about tax obligations, AADE circulars, VAT, ENFIA, or any tax topic.'
    WHERE slug = 'tax_accounting';

-- English tagline translations (Section 8) - same backfill pattern.
UPDATE verticals SET tagline_en =
    'The knowledge base for building permits and construction regulations'
    WHERE slug = 'construction';
UPDATE verticals SET tagline_en =
    'The knowledge base for tax legislation and accounting procedures'
    WHERE slug = 'tax_accounting';

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

-- Company-less, vertical-scoped super_admin invite (see admin.py's
-- create_super_admin_invite / auth.py's register()) - the invitee creates
-- their own company at acceptance time, so company_id has to be nullable
-- (originally NOT NULL, hence the explicit DROP NOT NULL for an existing
-- volume) and company_type holds the pending company's type until then.
ALTER TABLE invites ALTER COLUMN company_id DROP NOT NULL;
ALTER TABLE invites ADD COLUMN IF NOT EXISTS company_type VARCHAR;

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
-- English translation (Phase 1g), same Greek-fallback pattern as
-- verticals.disclaimer_text_en/welcome_message_en - not auto-populated,
-- set by hand per project when a real translation exists.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archaeological_notes_en TEXT;
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

-- Split first/last name (was a single free-text `name` column) so the
-- sidebar avatar/footer can compute real initials and a display name
-- instead of falling back to the email whenever a single-field name was
-- never actually populated - see KNOWN_DECISIONS.md.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(255);

-- Self-serve email verification (see app/routers/auth.py's /auth/register,
-- /auth/verify-email, /auth/resend-verification and KNOWN_DECISIONS.md).
-- Defaults true so every existing row (demo accounts, admin-created users,
-- invite-completions) is unaffected - only the self-serve (company_name)
-- registration path explicitly sets this false and sends a real
-- verification email. Gates POST /chat/message only, not every write
-- endpoint (see app/routers/chat.py).
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id),
    token TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT now(),
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens(user_id);

-- Token consumption tracking, per completion call - NULL on any row where
-- no GPT call was made at all (e.g. the off-topic-guard gap path), not
-- just zero, so "no LLM call" and "a genuinely free response" stay
-- distinguishable. See app/routers/chat.py's _log_session.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS completion_tokens integer;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS total_tokens integer;
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS estimated_cost_eur decimal(10, 6);

-- Dead-column cleanup (2026-07-10 session audit): both columns were
-- write-only in practice - raw_json was populated by a one-off backfill
-- and never read by any router/service; applies_to_first_time_homeowner
-- was set aside for a "am I affected by this" filter that was never built.
-- Grepped the entire codebase (backend/frontend/crawler) before dropping -
-- zero references outside this file and the model definitions removed
-- alongside this migration.
ALTER TABLE documents DROP COLUMN IF EXISTS raw_json;
ALTER TABLE documents DROP COLUMN IF EXISTS applies_to_first_time_homeowner;

-- Optional free-text elaboration on a thumbs-down rating, plus a triage
-- status for the super-admin feedback screen. feedback_text stays NULL for
-- thumbs-up (never prompted) and for a thumbs-down where the user chose
-- "Παράλειψη" - both are valid, distinct from an empty string.
ALTER TABLE message_feedback ADD COLUMN IF NOT EXISTS feedback_text text;
ALTER TABLE message_feedback ADD COLUMN IF NOT EXISTS status varchar NOT NULL DEFAULT 'pending';  -- 'pending', 'solved', 'rejected'

-- Subscription plan management (manual, pre-Stripe). Beta plans exist so
-- early/soft-launch companies have a real plan row (message pool
-- enforcement needs one) without a real price or a public pricing listing -
-- is_active=false keeps them out of any future public pricing page while
-- is_beta=true makes them bypass the message pool check entirely in
-- app/routers/chat.py.
CREATE TABLE IF NOT EXISTS plans (
  id                  serial PRIMARY KEY,
  vertical_id         integer REFERENCES verticals(id),
  name                varchar NOT NULL,
  slug                varchar NOT NULL UNIQUE,
  billing_cycle       varchar NOT NULL DEFAULT 'monthly',
  price_eur           decimal(10, 2) NOT NULL,
  user_limit          integer NOT NULL,
  message_pool        integer NOT NULL,
  is_beta             boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT true,
  features            jsonb,
  created_at          timestamp NOT NULL DEFAULT now()
);

-- One row per company (UNIQUE company_id) - a company has exactly one
-- active subscription at a time, matching how billing_cycle here can
-- diverge from the plan's own default (e.g. Professional-but-annual).
CREATE TABLE IF NOT EXISTS company_subscriptions (
  id                  serial PRIMARY KEY,
  company_id          integer NOT NULL UNIQUE REFERENCES companies(id),
  plan_id             integer NOT NULL REFERENCES plans(id),
  status              varchar NOT NULL DEFAULT 'trial',  -- 'trial', 'active', 'expired', 'cancelled', 'suspended'
  billing_cycle       varchar NOT NULL DEFAULT 'monthly',
  started_at          timestamp NOT NULL DEFAULT now(),
  trial_ends_at       timestamp,
  current_period_start timestamp,
  current_period_end  timestamp,
  cancelled_at        timestamp,
  stripe_customer_id  varchar,
  stripe_subscription_id varchar,
  notes               text,
  created_at          timestamp NOT NULL DEFAULT now()
);

-- One row per company per calendar month - the message-pool counter
-- chat.py increments on every successful completion. Not the same counter
-- as the Redis hourly rate limit (chat_msg:{user_id}, see rate_limit.py) -
-- that one is a per-user abuse guard, this one is a per-company billing
-- quota, and they're checked independently in the same request.
CREATE TABLE IF NOT EXISTS subscription_usage (
  id                  serial PRIMARY KEY,
  company_id          integer NOT NULL REFERENCES companies(id),
  period_start        date NOT NULL,
  period_end          date NOT NULL,
  messages_used       integer NOT NULL DEFAULT 0,
  messages_limit      integer NOT NULL,
  updated_at          timestamp NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_start)
);

CREATE INDEX IF NOT EXISTS idx_company_subscriptions_status ON company_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscription_usage_company ON subscription_usage(company_id);

INSERT INTO plans (vertical_id, name, slug, billing_cycle, price_eur, user_limit, message_pool, is_beta, is_active) VALUES
    ((SELECT id FROM verticals WHERE slug = 'construction'), 'Beta', 'construction-beta', 'monthly', 0, 3, 300, true, false),
    ((SELECT id FROM verticals WHERE slug = 'construction'), 'Starter', 'construction-starter', 'monthly', 49, 3, 300, false, true),
    ((SELECT id FROM verticals WHERE slug = 'construction'), 'Professional', 'construction-professional', 'monthly', 99, 10, 1000, false, true),
    ((SELECT id FROM verticals WHERE slug = 'construction'), 'Business', 'construction-business', 'monthly', 199, 30, 3000, false, true),
    ((SELECT id FROM verticals WHERE slug = 'tax_accounting'), 'Beta', 'tax-beta', 'monthly', 0, 3, 300, true, false),
    ((SELECT id FROM verticals WHERE slug = 'tax_accounting'), 'Starter', 'tax-starter', 'monthly', 59, 3, 300, false, true),
    ((SELECT id FROM verticals WHERE slug = 'tax_accounting'), 'Professional', 'tax-professional', 'monthly', 119, 10, 1000, false, true),
    ((SELECT id FROM verticals WHERE slug = 'tax_accounting'), 'Business', 'tax-business', 'monthly', 249, 30, 3000, false, true)
ON CONFLICT (slug) DO NOTHING;

-- Every existing company starts on its vertical's Beta plan with a 60-day
-- trial - this is a one-time backfill for companies that existed before
-- subscription tracking did; new companies get assigned a plan explicitly
-- going forward (see POST /admin/subscriptions/{company_id}).
INSERT INTO company_subscriptions (company_id, plan_id, status, billing_cycle, trial_ends_at)
SELECT c.id,
       (SELECT p.id FROM plans p WHERE p.vertical_id = c.vertical_id AND p.is_beta = true LIMIT 1),
       'trial',
       'monthly',
       now() + interval '60 days'
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM company_subscriptions cs WHERE cs.company_id = c.id)
ON CONFLICT (company_id) DO NOTHING;

-- Customer-level document scope, sitting between company-wide (project_id
-- AND customer_id both NULL) and project-specific (project_id set). A
-- document scoped to a customer (project_id NULL, customer_id set) is
-- visible across every one of that customer's projects - e.g. a client's
-- ΑΦΜ/tax-registration paperwork that applies to all of their engagements -
-- without being tied to one specific project. Mutually exclusive with
-- project_id at the application layer (see app/routers/documents.py's
-- upload scope selector): a row never has both set. See
-- app/services/visibility.py's visible_documents_filter() for the
-- visibility rule and KNOWN_DECISIONS.md for why this needed a design pass
-- before implementation (cross-customer leakage risk in RAG results).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_documents_customer ON documents(customer_id);

-- Product-level feedback from the floating beta feedback widget (every
-- authenticated user, every page) - distinct from message_feedback above,
-- which rates one specific chat answer. 'content_gap' items feed directly
-- into the KB gap workflow (see the super admin Ανατροφοδότηση screen's
-- "Σχόλια Χρηστών" section), so they're kept as their own category rather
-- than folded into 'suggestion'.
CREATE TABLE IF NOT EXISTS user_feedback (
    id          serial PRIMARY KEY,
    user_id     integer REFERENCES users(id),
    company_id  integer REFERENCES companies(id),
    category    text NOT NULL,  -- 'bug', 'suggestion', 'content_gap'
    message     text,
    page_url    text,
    created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_created ON user_feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_feedback_category ON user_feedback(category);

-- True when rag.decompose_query() detected the question as compound and
-- split it into independent per-sub-topic retrieval passes (see
-- app/services/rag.py's _retrieve()) instead of one pass over the whole
-- question. NULL where retrieval never ran. Lets a super admin measure how
-- often the decomposition path actually fires in real traffic.
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS decomposed boolean;

-- Content-hash staleness detection: after a successful data-source sync
-- (see app/routers/admin.py's sync_data_source) fetches and extracts text
-- from base_url, its SHA-256 hash is compared against last_content_hash.
-- A change flags every document whose `source` starts with this source's
-- base_url as needs_review, catching a stale KB document automatically
-- instead of relying solely on the 6-month staleness sweep.
-- content_changed_at is set only when a real change is detected, not on
-- every sync - it answers "when did the source last actually change".
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS last_content_hash varchar(64);
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS content_changed_at timestamp;

-- source_verified_at: when this document's source was last successfully
-- re-fetched and hash-compared by a data_source sync - distinct from
-- documents.last_verified_at, which only moves when a human clears
-- needs_review via mark-reviewed. auto_needs_review_reason: the
-- machine-generated Greek explanation shown in the admin review queue when
-- needs_review was set by the hash-change detector specifically, not by a
-- human or the 6-month sweep; NULL for every other needs_review cause.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_verified_at timestamp;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS auto_needs_review_reason text;

-- Audit trail for the admin KB revalidation copilot (app/routers/admin.py's
-- revalidate_document/apply_document_suggestion/revalidate_all_documents).
-- One row per AI revalidation attempt, whether triggered singly or via the
-- bulk queue. status is 'source_unavailable' (fetch failed, no GPT-4o call
-- made) or 'validated' (GPT-4o compared stored content against the fetched
-- source). admin_action ('accepted'/'edited'/'dismissed') is set later,
-- when a human acts on the row - NULL until then.
CREATE TABLE IF NOT EXISTS document_validations (
  id                  serial PRIMARY KEY,
  document_id         integer NOT NULL REFERENCES documents(id),
  validated_by        integer REFERENCES users(id),
  status              varchar NOT NULL,
  still_accurate      boolean,
  changes_detected    text,
  suggested_content   text,
  confidence          varchar,
  reasoning           text,
  source_fetched_at   timestamp,
  admin_action        varchar,
  admin_note          text,
  created_at          timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_document_validations_document ON document_validations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_validations_created ON document_validations(created_at DESC);

-- Weekly infra-health snapshot (crawler/crawler/infra_health_check.py, cron
-- Monday mornings). Tracks the size of the shared embeddings/pgvector index
-- across the entire platform (public KB + every company's uploaded docs
-- combined) so growth toward a real Hetzner capacity limit shows up as a
-- trend line, not a surprise. threshold_level is 'watch' (log only, no
-- alert), 'warning' (notify super_admin - time to plan an upgrade), or
-- 'critical' (notify super_admin with urgency - act this week). Thresholds
-- themselves are a placeholder baseline set from the actual chunk count/
-- index size on 2026-07-17 (19,124 chunks / 162MB) at roughly 5x/10x/20x -
-- see KNOWN_DECISIONS.md for the reasoning and revisit trigger. This is
-- explicitly infra monitoring, not a billing/upload enforcement mechanism -
-- nothing reads this table to block anything.
CREATE TABLE IF NOT EXISTS infra_health_checks (
  id                serial PRIMARY KEY,
  total_chunks      integer NOT NULL,
  index_size_mb     numeric NOT NULL,
  threshold_level   varchar NOT NULL,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_infra_health_checks_created ON infra_health_checks(created_at DESC);

-- Platform-wide AI spend alerting (crawler/crawler/spend_alert_check.py, cron
-- daily - not Monday-only, since this specifically exists to catch
-- launch-window spend spikes fast). Single-row table holding the two
-- super-admin-editable thresholds compared against trailing 24h/7d spend
-- summed across chat_sessions.estimated_cost_eur, excluding is_test_account
-- companies (same exclusion idiom as GET /admin/stats). Seeded with
-- placeholder values - edit via PATCH /admin/spend-alerts/thresholds.
CREATE TABLE IF NOT EXISTS spend_alert_thresholds (
  id          integer PRIMARY KEY DEFAULT 1,
  daily_eur   numeric NOT NULL DEFAULT 5.00,
  weekly_eur  numeric NOT NULL DEFAULT 25.00,
  updated_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT spend_alert_thresholds_singleton CHECK (id = 1)
);

INSERT INTO spend_alert_thresholds (id, daily_eur, weekly_eur)
VALUES (1, 5.00, 25.00)
ON CONFLICT (id) DO NOTHING;

-- Trend log written by every spend_alert_check.py run (modeled on
-- infra_health_checks) - one row per day regardless of whether a threshold
-- was crossed, so the admin UI can chart spend over time, not just the
-- latest reading.
CREATE TABLE IF NOT EXISTS spend_alert_checks (
  id                serial PRIMARY KEY,
  spend_24h_eur     numeric NOT NULL,
  spend_7d_eur      numeric NOT NULL,
  daily_breached    boolean NOT NULL DEFAULT false,
  weekly_breached   boolean NOT NULL DEFAULT false,
  created_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spend_alert_checks_created ON spend_alert_checks(created_at DESC);

-- Data retention/deletion compliance (legal-blocking - closes the gap
-- between what the Privacy Policy/DPA claim and what the product actually
-- did before this). deletion_requested_at drives the 30-day hard-delete
-- clock (POST /account/request-deletion) - it ALWAYS overrides the 60-day
-- post-cancellation window computed from company_subscriptions.cancelled_at
-- (see crawler/crawler/retention_cleanup.py's _compute_deadline, the one
-- place that encodes this precedence). legal_name/afm/billing_address are
-- also used by Phase 0.5's invoicing (a valid Greek τιμολόγιο needs the
-- customer's ΑΦΜ/address) - added here rather than duplicated because
-- they're genuinely the same "who is this company, legally" fields either
-- feature would otherwise invent separately.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deletion_requested_at timestamp;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS dpa_accepted_at timestamp;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS dpa_version varchar;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS afm varchar(9);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS billing_address text;

-- Manual invoice generation (Phase 0.5) - a super_admin generates a real
-- τιμολόγιο when a payment is confirmed; not automated billing, not Stripe.
-- invoice_number is drawn from a dedicated sequence (see below), NEVER
-- reused or reassigned even if an invoice is later voided - void by
-- issuing a credit note referencing the original (a future invoices row
-- with a negative amount and a note, not a schema change), never by
-- deleting a row. company_name/afm/address are captured directly on the
-- row at generation time (denormalized, not FK'd live off companies) so a
-- historical invoice's legal content survives even if the company's own
-- companies.legal_name/afm/billing_address later changes or the company is
-- deleted (see crawler/crawler/retention_cleanup.py - it anonymizes a
-- deleted company's row but this table is never touched by that job,
-- structurally, and wouldn't need to be even if it were, since every
-- invoice already carries its own frozen copy of who the customer was).
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
  id               serial PRIMARY KEY,
  invoice_number   varchar NOT NULL UNIQUE,
  company_id       integer NOT NULL REFERENCES companies(id),
  plan_id          integer NOT NULL REFERENCES plans(id),
  billing_cycle    varchar NOT NULL,
  amount_net_eur   decimal(10, 2) NOT NULL,
  vat_rate         decimal(4, 2) NOT NULL DEFAULT 24.00,
  amount_vat_eur   decimal(10, 2) NOT NULL,
  amount_total_eur decimal(10, 2) NOT NULL,
  company_name     varchar NOT NULL,
  company_afm      varchar,
  company_address  text,
  issued_at        timestamp NOT NULL DEFAULT now(),
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  pdf_path         varchar,
  created_by       integer REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_invoices_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_issued ON invoices(issued_at DESC);

-- Pricing page + document storage enforcement + plan-change requests.
-- annual_total_eur is the real annual commitment (excl. VAT); the
-- annual-equivalent MONTHLY figure shown on the pricing page is derived at
-- read time (round(annual_total_eur / 12, 2)) in app/routers/plans.py, not
-- stored separately, so it can never drift from the total on a price edit.
-- storage_limit_bytes is the cumulative ceiling on a company's OWN uploaded
-- documents (Professional/Business only, NULL = not enforced) - see
-- app/services/subscription.py's check_storage_limit(); it never touches
-- the shared regulatory knowledge base, which has no owning company
-- (documents.company_id is NULL there). project_limit/client_limit are
-- DISPLAY-ONLY figures for the pricing page's third bullet - nothing in
-- this codebase enforces them (no code path blocks creating an 11th
-- project on a Construction Starter company); see KNOWN_DECISIONS.md.
-- max_file_size_bytes replaces the old hardcoded 25MB constant in
-- app/routers/documents.py with a real per-plan, super-admin-editable
-- field. promo_price_eur/starts_at/ends_at are a time-boxed price
-- override - GET /plans does a plain now()-between-bounds comparison at
-- read time, no scheduled job needed to "revert" it.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS annual_total_eur decimal(10, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS storage_limit_bytes bigint;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS project_limit integer;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS client_limit integer;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_file_size_bytes bigint NOT NULL DEFAULT 20000000;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS promo_price_eur decimal(10, 2);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS promo_starts_at timestamp;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS promo_ends_at timestamp;

-- Confirmed tier figures from the pricing spec - annual_total_eur/12
-- rounded to 2dp exactly matches every quoted "annual-equivalent monthly"
-- number (e.g. 490/12 = 40.8333... -> 40.83). storage_limit_bytes uses
-- DECIMAL GB (5,000,000,000 / 20,000,000,000), not binary GiB
-- (5,368,709,120 / 21,474,836,480) - decimal is what makes
-- storage_limit_bytes / max_file_size_bytes (20,000,000, also decimal)
-- equal exactly 250 / 1,000, matching the pricing page's own quoted
-- document-count figures precisely; the binary equivalents would give
-- 256/1,024 instead. Re-run safe: always converges to the same final
-- values regardless of prior state.
UPDATE plans SET annual_total_eur = 490,  project_limit = 10 WHERE slug = 'construction-starter';
UPDATE plans SET annual_total_eur = 990,  storage_limit_bytes = 5000000000  WHERE slug = 'construction-professional';
UPDATE plans SET annual_total_eur = 1990, storage_limit_bytes = 20000000000 WHERE slug = 'construction-business';
UPDATE plans SET annual_total_eur = 590,  client_limit = 20 WHERE slug = 'tax-starter';
UPDATE plans SET annual_total_eur = 1190, storage_limit_bytes = 5000000000  WHERE slug = 'tax-professional';
UPDATE plans SET annual_total_eur = 2490, storage_limit_bytes = 20000000000 WHERE slug = 'tax-business';

-- Raw uploaded file size, set only by POST /documents/upload (company
-- uploads) - NULL for every crawled/manual-entry KB document (whose
-- company_id is also NULL, already excluding them from a per-company SUM).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_size_bytes bigint;

-- Reporting-exclusion flag, set only via the super_admin "Νέα Εταιρεία"
-- modal's "Δοκιμαστικός χρήστης" toggle - excludes a company from
-- GET /admin/stats, token-cost totals, and the day-45 conversion nudge.
-- Every feature still works normally for the company; this only hides it
-- from platform-wide numbers.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

-- A company admin's click on the pricing page's "Αίτημα αναβάθμισης"/
-- "Αίτημα αλλαγής πλάνου" button (POST /plan-requests) - a sales lead for
-- manual follow-up, not a self-service change. direction is derived
-- server-side from price comparison, never trusted from the client.
-- current_plan_id is nullable for the (currently unreachable through the
-- UI, since the endpoint requires auth) edge case of a request logged with
-- no prior subscription row.
CREATE TABLE IF NOT EXISTS plan_requests (
  id                 serial PRIMARY KEY,
  company_id         integer NOT NULL REFERENCES companies(id),
  requested_by       integer NOT NULL REFERENCES users(id),
  current_plan_id    integer REFERENCES plans(id),
  requested_plan_id  integer NOT NULL REFERENCES plans(id),
  direction          varchar NOT NULL, -- 'upgrade', 'downgrade'
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_requests_company ON plan_requests(company_id);

-- One row per "request coverage for this region" click on an uncovered
-- (status='pending') municipality - a demand signal, not a trigger for any
-- automatic action (see KNOWN_DECISIONS.md: no auto-crawl on region
-- selection). Ranked by request_count in GET /admin/region-requests to
-- prioritize which municipalities get the manual ΓΠΣ/ΦΕΚ ingestion pass next.
CREATE TABLE IF NOT EXISTS region_requests (
  id            serial PRIMARY KEY,
  region_id     varchar NOT NULL REFERENCES regions(region_id),
  company_id    integer NOT NULL REFERENCES companies(id),
  requested_by  integer NOT NULL REFERENCES users(id),
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_region_requests_region ON region_requests(region_id);

-- Company-wide-document staleness/self-flag queue (company admin's own
-- review queue, distinct from the super admin's public-KB one). Uploader-
-- supplied reference_url lets a company-wide upload (project_id and
-- customer_id both NULL) participate in a periodic content-hash check the
-- same way a public data source does; a company-wide upload with no
-- reference_url can only be self-flagged via manual_review_note.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reference_url text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reference_content_hash text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS reference_checked_at timestamp;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS manual_review_note text;

-- Genuine per-answer follow-up questions (Section 5b), parsed out of the
-- same completion that produced the answer itself - a JSON string array,
-- empty/NULL when the model had no confident follow-up to offer, or on any
-- row where the successful-answer path never ran (gap responses, off-topic
-- guard, older rows predating this column).
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS followups jsonb;

-- History log for the Monday weekly digest email (Section 6a) - one row per
-- send, whether crawler/crawler/weekly_digest.py's scheduled run or a super
-- admin's manual "resend now" (POST /admin/digests/resend). Written every
-- time regardless of whether Resend actually delivered anything
-- (recipients_sent may be 0), so GET /admin/digests never silently drops a
-- run from its history.
CREATE TABLE IF NOT EXISTS weekly_digests (
  id                 serial PRIMARY KEY,
  total_messages     integer NOT NULL,
  gap_rate           numeric NOT NULL,
  spend_7d_eur       numeric NOT NULL,
  active_companies   integer NOT NULL,
  open_feedback      integer NOT NULL,
  needs_review       integer NOT NULL,
  recipients_sent    integer NOT NULL,
  recipients_total   integer NOT NULL,
  triggered_manually boolean NOT NULL DEFAULT false,
  created_at         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_weekly_digests_created ON weekly_digests(created_at DESC);

-- Staging table for the semi-automated ΥΔΟΜ/utility contact discovery
-- pipeline (crawler/crawler/region_contact_discovery.py). A row here is
-- ALWAYS an unverified candidate, never read by chat retrieval - only a
-- super admin Confirm (POST /admin/region-contact-candidates/{id}/confirm)
-- writes into the live regions.contact_phone/contact_email/ydom_authority_name
-- columns that chat actually reads. Deliberately separate from the fuller
-- "regulatory content ingested" notion of coverage - confirming a phone
-- number here only ever moves Region.status pending -> stub, never -> active
-- (see KNOWN_DECISIONS.md).
CREATE TABLE IF NOT EXISTS region_contact_candidates (
  id                        serial PRIMARY KEY,
  region_id                 varchar NOT NULL REFERENCES regions(region_id),
  candidate_authority_name  varchar,
  candidate_phone           varchar,
  candidate_email           varchar,
  source_url                text NOT NULL,
  discovered_at             timestamp NOT NULL DEFAULT now(),
  status                    varchar NOT NULL DEFAULT 'pending_review', -- 'pending_review', 'confirmed', 'rejected'
  review_note               text,
  reviewed_by               integer REFERENCES users(id),
  reviewed_at               timestamp
);

CREATE INDEX IF NOT EXISTS idx_region_contact_candidates_region ON region_contact_candidates(region_id);
CREATE INDEX IF NOT EXISTS idx_region_contact_candidates_status ON region_contact_candidates(status);

-- Singleton row (id always 1), same pattern as spend_alert_thresholds -
-- holds the admin-UI batch runner's cadence preference for the region
-- contact discovery pipeline above. cadence_type = 'manual' means exactly
-- that: nothing auto-runs a batch, matching data_sources' crawl_frequency_*
-- fields, which are likewise stored but not read by any scheduled job today
-- (see KNOWN_DECISIONS.md - kept manual-only given the pilot's ~40%
-- failure/false-positive rate).
CREATE TABLE IF NOT EXISTS region_discovery_settings (
  id                  integer PRIMARY KEY DEFAULT 1,
  cadence_type        varchar NOT NULL DEFAULT 'manual', -- 'manual', 'weekly', 'monthly'
  default_batch_size  integer NOT NULL DEFAULT 15,
  updated_at          timestamp NOT NULL DEFAULT now(),
  CONSTRAINT region_discovery_settings_singleton CHECK (id = 1)
);

INSERT INTO region_discovery_settings (id, cadence_type, default_batch_size)
VALUES (1, 'manual', 15)
ON CONFLICT (id) DO NOTHING;

-- Admin-editable content for the three transactional sends (invite,
-- welcome, password_reset) - see app/services/email_templates.py for the
-- {{variable}} substitution engine and app/services/email.py for how each
-- is rendered/combined at send time. Structural HTML (button markup,
-- header/footer chrome) stays code-owned; only wording is stored here.
-- ON CONFLICT DO NOTHING so a live DB with admin-edited rows is never
-- overwritten by a fresh init.sql apply, same discipline as legal_documents.
CREATE TABLE IF NOT EXISTS email_templates (
  id            serial PRIMARY KEY,
  template_key  varchar(20) NOT NULL UNIQUE CHECK (template_key IN ('invite', 'welcome', 'password_reset', 'email_verification', 'invite_no_company')),
  subject_el    text NOT NULL,
  subject_en    text NOT NULL,
  body_el       text NOT NULL,
  body_en       text NOT NULL,
  updated_at    timestamp NOT NULL DEFAULT now(),
  updated_by    integer REFERENCES users(id)
);

-- email_verification, then invite_no_company, were both added after this
-- table's original CHECK constraint - relax it for a container whose
-- volume predates either change (a fresh CREATE TABLE already gets the
-- full version above via IF NOT EXISTS never firing on a brand-new
-- database).
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_template_key_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_template_key_check
  CHECK (template_key IN ('invite', 'welcome', 'password_reset', 'email_verification', 'invite_no_company'));

INSERT INTO email_templates (template_key, subject_el, subject_en, body_el, body_en) VALUES
('invite',
 '{{company_name}} σας προσκαλεί στο Theke',
 'You''ve been invited to Theke',
 '<p>Γεια σας,</p>
<p>Ο/Η <b>{{inviter_name}}</b> σας προσκαλεί να συμμετάσχετε στην ομάδα της <b>{{company_name}}</b> στο Theke, στον κλάδο <b>{{vertical_name}}</b>.</p>
<p>Το Theke είναι εργαλείο κανονιστικής πληροφόρησης για επαγγελματίες {{audience}} — απαντά σε ερωτήσεις για {{examples}}, με παραπομπή σε επίσημες πηγές.</p>
<p>Θα συμμετέχετε ως <b>{{role_label}}</b>.</p>
{{accept_button_html}}
<p>Ο σύνδεσμος ισχύει για {{expiry_label}}.</p>
<p>Αν δεν αναγνωρίζετε αυτό το μήνυμα ή έχετε ερωτήσεις, επικοινωνήστε μαζί μας στο {{email_from}}.</p>',
 '<p style="font-size:13px; color:#737791;"><b>{{inviter_name}}</b> has invited you to join <b>{{company_name}}</b>''s team on Theke, a regulatory intelligence tool for {{audience_en}}. You''ll join as <b>{{role_label_en}}</b>. Use the button above to accept — the link is valid for {{expiry_label_en}}.</p>'
),
('welcome',
 'Καλώς ήρθατε στο Theke',
 'Welcome to Theke',
 '<p>Γεια σας,</p>
<p>Ο λογαριασμός σας στο Theke είναι έτοιμος. Έχετε ήδη πρόσβαση στη γνωσιακή βάση <b>{{vertical_name}}</b> και μπορείτε να ξεκινήσετε αμέσως.</p>
<p><b>Δοκιμάστε μια από αυτές τις ερωτήσεις για να δείτε πώς λειτουργεί:</b></p>
{{questions_html}}
{{chat_button_html}}
<p>Κάθε απάντηση συνοδεύεται από παραπομπές σε επίσημες πηγές (ΦΕΚ, ΤΕΕ, ΑΑΔΕ κ.ά.). Όταν δεν υπάρχει επαρκής πηγή, το Theke το δηλώνει ρητά αντί να μαντεύει.</p>
<p>Μπορείτε επίσης να δημιουργήσετε το πρώτο σας έργο όποτε είστε έτοιμοι.</p>
<p>Με εκτίμηση,<br>Theke</p>',
 '<p>Hello,</p>
<p>Your Theke account is ready, with access to the {{vertical_name}} knowledge base. Use the button below to ask your first question — every answer is cited against official sources, and Theke states plainly when it doesn''t have enough of one, rather than guessing.</p>
{{chat_button_html}}
<p>You can also create your first project whenever you''re ready.</p>
<p>Theke</p>'
),
('password_reset',
 'Επαναφορά κωδικού πρόσβασης — Theke',
 'Password reset — Theke',
 '<p>Γεια σας,</p>
<p>Λάβαμε αίτημα επαναφοράς του κωδικού πρόσβασής σας στο Theke.</p>
{{reset_button_html}}
<p>Ο σύνδεσμος ισχύει για {{expiry_label}}. Αν δεν ζητήσατε εσείς αυτή την ενέργεια, αγνοήστε αυτό το μήνυμα — ο κωδικός σας παραμένει αμετάβλητος.</p>
<p style="font-size:13px; color:#737791;">Για λόγους ασφαλείας, μην προωθήσετε αυτό το μήνυμα σε τρίτους.</p>',
 '<p>Hello,</p>
<p>We received a request to reset your Theke password.</p>
{{reset_button_html}}
<p>The link is valid for {{expiry_label}}. If you didn''t request this, no action is needed — your password is unchanged.</p>
<p style="font-size:13px; color:#737791;">For security reasons, don''t forward this message to anyone else.</p>'
),
('email_verification',
 'Επιβεβαιώστε τη διεύθυνση email σας — Theke',
 'Verify your email address — Theke',
 '<p>Γεια σας,</p>
<p>Ευχαριστούμε που δημιουργήσατε λογαριασμό στο Theke. Επιβεβαιώστε τη διεύθυνση email σας για να αποκτήσετε πλήρη πρόσβαση στις ερωτήσεις προς το σύστημα.</p>
{{verify_button_html}}
<p>Ο σύνδεσμος ισχύει για {{expiry_label}}. Αν δεν δημιουργήσατε εσείς αυτόν τον λογαριασμό, αγνοήστε αυτό το μήνυμα.</p>',
 '<p>Hello,</p>
<p>Thanks for creating a Theke account. Verify your email address to get full access to asking questions.</p>
{{verify_button_html}}
<p>The link is valid for {{expiry_label}}. If you did not create this account, you can safely ignore this message.</p>'
),
('invite_no_company',
 'Προσκληθήκατε στο Theke',
 'You''ve been invited to Theke',
 '<p>Γεια σας,</p>
<p>Σας προσκαλούμε στο theke, για {{vertical_name}}.</p>
<p>Ρωτάτε στα ελληνικά· το theke απαντά τεκμηριωμένα, με παραπομπή στην πηγή: νόμο, ΦΕΚ, εγκύκλιο.</p>
<p>Θα είστε διαχειριστής/τρια του χώρου εργασίας σας. Αν δουλεύετε μόνος/η, αυτό αρκεί.</p>
<p>30 ημέρες δωρεάν &middot; Χωρίς πιστωτική κάρτα.</p>
{{accept_button_html}}
<p>Ο σύνδεσμος ισχύει για {{expiry_label}}.</p>
<p>Ερωτήσεις; Γράψτε μας στο {{email_from}}.</p>',
 '<p>Hi,</p>
<p>You''re invited to theke, for {{vertical_name_en}}.</p>
<p>You ask in plain language, theke answers with documentation: the source, every time.</p>
<p>You''ll be the admin of your workspace. If you work solo, that''s all you need.</p>
<p>30 days free &middot; No credit card required.</p>
{{accept_button_html_en}}
<p>The link is valid for {{expiry_label_en}}.</p>
<p>Questions? Write to us at {{email_from}}.</p>'
)
ON CONFLICT (template_key) DO NOTHING;

-- Singleton row (id always 1), same pattern as spend_alert_thresholds -
-- holds the super-admin-editable recipient address for the email-templates
-- admin screen's "Δοκιμαστική αποστολή" test-send button, replacing what
-- was previously a manually-typed address in ad-hoc verification commands.
CREATE TABLE IF NOT EXISTS email_settings (
  id                  integer PRIMARY KEY DEFAULT 1,
  test_email_address  varchar NOT NULL DEFAULT 'manos_drams@hotmail.com',
  updated_at          timestamp NOT NULL DEFAULT now(),
  CONSTRAINT email_settings_singleton CHECK (id = 1)
);

INSERT INTO email_settings (id, test_email_address)
VALUES (1, 'manos_drams@hotmail.com')
ON CONFLICT (id) DO NOTHING;

-- Admin-editable Help page content, replacing the hardcoded sections/notes
-- that used to live in frontend/app/help/page.tsx's component logic.
-- visible_to_roles/vertical_scope/is_active are read at GET /help-sections
-- time (see app/routers/help.py) to reproduce the exact same filtering the
-- old component did, just data-driven. Seed content below is a verbatim
-- migration of the old translations.ts help.* strings (bullet lists
-- reformatted to real markdown "- " syntax, rendered via the same
-- react-markdown + remark-gfm pipeline already used for legal documents).
CREATE TABLE IF NOT EXISTS help_sections (
  id                serial PRIMARY KEY,
  slug              varchar(50) NOT NULL UNIQUE,
  title_el          text NOT NULL,
  title_en          text NOT NULL,
  body_el           text NOT NULL,
  body_en           text NOT NULL,
  visible_to_roles  text[] NOT NULL,
  vertical_scope    varchar(20),
  display_order     integer NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  updated_at        timestamp NOT NULL DEFAULT now(),
  updated_by        integer REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_help_sections_display_order ON help_sections(display_order);


INSERT INTO help_sections (slug, title_el, title_en, body_el, body_en, visible_to_roles, vertical_scope, display_order) VALUES
('chat-construction', 'Πώς λειτουργεί η συνομιλία', 'How the conversation works', 'Η Theke απαντά σε ερωτήσεις χρησιμοποιώντας τεχνητή νοημοσύνη που αναζητά σε αξιόπιστες πηγές πριν απαντήσει· δεν «μαντεύει».

Κάθε απάντηση συνοδεύεται από παραπομπές (citations) στις πηγές που χρησιμοποιήθηκαν, ώστε να μπορείτε να επαληθεύσετε την πληροφορία στην αρχική της μορφή.

Η Theke αντλεί πληροφορία από τέσσερα επίπεδα πηγών:
- Δημόσια βάση γνώσης: νόμοι, ΦΕΚ, εγκύκλιοι και άλλες επίσημες πηγές, κοινές για όλους τους χρήστες.
- Έγγραφα εταιρείας: αρχεία που έχει ανεβάσει η εταιρεία σας, ορατά σε όλα τα μέλη της. Αυτά τα έγγραφα είναι ορατά μόνο στην εταιρεία σας· καμία άλλη εταιρεία δεν μπορεί να τα δει.
- Έγγραφα πελάτη: αρχεία συνδεδεμένα με συγκεκριμένο πελάτη. Αυτά τα έγγραφα είναι απομονωμένα ανά πελάτη· δεν εμφανίζονται ποτέ σε συνομιλίες που αφορούν άλλους πελάτες σας.
- Έγγραφα έργου: αρχεία συνδεδεμένα με συγκεκριμένο έργο. Αυτά τα έγγραφα είναι απομονωμένα ανά έργο· δεν εμφανίζονται ποτέ σε συνομιλίες που αφορούν άλλα έργα, ακόμη και του ίδιου πελάτη.

Όταν δεν έχουμε αρκετά αξιόπιστη πηγή για να απαντήσουμε με σιγουριά, σας το λέμε καθαρά αντί να μαντέψουμε.

Το κουμπί «Νέα Εκκίνηση» ξεκινά μια καινούρια συνομιλία χωρίς το ιστορικό της προηγούμενης. Χρησιμοποιήστε το όταν αλλάζετε θέμα εντελώς.

Τα εικονίδια «μου αρέσει» / «δεν μου αρέσει» κάτω από κάθε απάντηση μας βοηθούν να εντοπίζουμε απαντήσεις που χρειάζονται βελτίωση. Η ανατροφοδότησή σας φτάνει απευθείας στην ομάδα μας.

Για ερωτήσεις εντός/εκτός σχεδίου και Ζώνης ΓΠΣ, δείτε την επεξήγηση δίπλα στο αντίστοιχο πεδίο κατά τη δημιουργία έργου.', 'Theke answers questions using AI that searches trustworthy sources before responding; it doesn''t "guess".

Every answer comes with citations pointing to the sources it used, so you can verify the information in its original form.

Theke draws on four tiers of sources:
- Public knowledge base: laws, official gazette entries, circulars, and other official sources shared by all users.
- Company documents: files your company has uploaded, visible to everyone at your company. These documents are only visible within your company; no other company can see them.
- Client documents: files linked to a specific client. These documents are isolated per client; they never appear in conversations about your other clients.
- Project documents: files linked to a specific project. These documents are isolated per project; they never appear in conversations about your other projects, even for the same client.

When we don''t have a reliable enough source to answer with confidence, we say so plainly instead of guessing.

The "New session" button starts a fresh conversation without the previous history. Use it when you''re switching topics entirely.

The thumbs up/down icons under each answer help us spot answers that need improvement. Your feedback goes straight to our team.

For questions about being inside or outside the town plan and ΓΠΣ zoning, see the explanation next to that field when creating a project.', '{member,admin}', 'construction', '1'),
('chat-tax', 'Πώς λειτουργεί η συνομιλία', 'How the conversation works', 'Η Theke απαντά σε ερωτήσεις χρησιμοποιώντας τεχνητή νοημοσύνη που αναζητά σε αξιόπιστες πηγές πριν απαντήσει· δεν «μαντεύει».

Κάθε απάντηση συνοδεύεται από παραπομπές (citations) στις πηγές που χρησιμοποιήθηκαν, ώστε να μπορείτε να επαληθεύσετε την πληροφορία στην αρχική της μορφή.

Η Theke αντλεί πληροφορία από τέσσερα επίπεδα πηγών:
- Δημόσια βάση γνώσης: νόμοι, ΦΕΚ, εγκύκλιοι και άλλες επίσημες πηγές, κοινές για όλους τους χρήστες.
- Έγγραφα εταιρείας: αρχεία που έχει ανεβάσει η εταιρεία σας, ορατά σε όλα τα μέλη της. Αυτά τα έγγραφα είναι ορατά μόνο στην εταιρεία σας· καμία άλλη εταιρεία δεν μπορεί να τα δει.
- Έγγραφα πελάτη: αρχεία συνδεδεμένα με συγκεκριμένο πελάτη. Αυτά τα έγγραφα είναι απομονωμένα ανά πελάτη· δεν εμφανίζονται ποτέ σε συνομιλίες που αφορούν άλλους πελάτες σας.
- Έγγραφα έργου: αρχεία συνδεδεμένα με συγκεκριμένο έργο. Αυτά τα έγγραφα είναι απομονωμένα ανά έργο· δεν εμφανίζονται ποτέ σε συνομιλίες που αφορούν άλλα έργα, ακόμη και του ίδιου πελάτη.

Όταν δεν έχουμε αρκετά αξιόπιστη πηγή για να απαντήσουμε με σιγουριά, σας το λέμε καθαρά αντί να μαντέψουμε.

Το κουμπί «Νέα Εκκίνηση» ξεκινά μια καινούρια συνομιλία χωρίς το ιστορικό της προηγούμενης. Χρησιμοποιήστε το όταν αλλάζετε θέμα εντελώς.

Τα εικονίδια «μου αρέσει» / «δεν μου αρέσει» κάτω από κάθε απάντηση μας βοηθούν να εντοπίζουμε απαντήσεις που χρειάζονται βελτίωση. Η ανατροφοδότησή σας φτάνει απευθείας στην ομάδα μας.', 'Theke answers questions using AI that searches trustworthy sources before responding; it doesn''t "guess".

Every answer comes with citations pointing to the sources it used, so you can verify the information in its original form.

Theke draws on four tiers of sources:
- Public knowledge base: laws, official gazette entries, circulars, and other official sources shared by all users.
- Company documents: files your company has uploaded, visible to everyone at your company. These documents are only visible within your company; no other company can see them.
- Client documents: files linked to a specific client. These documents are isolated per client; they never appear in conversations about your other clients.
- Project documents: files linked to a specific project. These documents are isolated per project; they never appear in conversations about your other projects, even for the same client.

When we don''t have a reliable enough source to answer with confidence, we say so plainly instead of guessing.

The "New session" button starts a fresh conversation without the previous history. Use it when you''re switching topics entirely.

The thumbs up/down icons under each answer help us spot answers that need improvement. Your feedback goes straight to our team.', '{member,admin}', 'tax_accounting', '2'),
('chat-platform', 'Πώς λειτουργεί η συνομιλία', 'How the conversation works', 'Η Theke απαντά σε ερωτήσεις χρησιμοποιώντας τεχνητή νοημοσύνη που αναζητά σε αξιόπιστες πηγές πριν απαντήσει· δεν «μαντεύει».

Κάθε απάντηση συνοδεύεται από παραπομπές (citations) στις πηγές που χρησιμοποιήθηκαν, ώστε να μπορείτε να επαληθεύσετε την πληροφορία στην αρχική της μορφή.

Η Theke αντλεί πληροφορία από τέσσερα επίπεδα πηγών:
- Δημόσια βάση γνώσης: νόμοι, ΦΕΚ, εγκύκλιοι και άλλες επίσημες πηγές, κοινές για όλους τους χρήστες.
- Έγγραφα εταιρείας: αρχεία που έχει ανεβάσει η εταιρεία σας, ορατά σε όλα τα μέλη της. Αυτά τα έγγραφα είναι ορατά μόνο στην εταιρεία σας· καμία άλλη εταιρεία δεν μπορεί να τα δει.
- Έγγραφα πελάτη: αρχεία συνδεδεμένα με συγκεκριμένο πελάτη. Αυτά τα έγγραφα είναι απομονωμένα ανά πελάτη· δεν εμφανίζονται ποτέ σε συνομιλίες που αφορούν άλλους πελάτες σας.
- Έγγραφα έργου: αρχεία συνδεδεμένα με συγκεκριμένο έργο. Αυτά τα έγγραφα είναι απομονωμένα ανά έργο· δεν εμφανίζονται ποτέ σε συνομιλίες που αφορούν άλλα έργα, ακόμη και του ίδιου πελάτη.

Όταν δεν έχουμε αρκετά αξιόπιστη πηγή για να απαντήσουμε με σιγουριά, σας το λέμε καθαρά αντί να μαντέψουμε.

Το κουμπί «Νέα Εκκίνηση» ξεκινά μια καινούρια συνομιλία χωρίς το ιστορικό της προηγούμενης. Χρησιμοποιήστε το όταν αλλάζετε θέμα εντελώς.

Τα εικονίδια «μου αρέσει» / «δεν μου αρέσει» κάτω από κάθε απάντηση μας βοηθούν να εντοπίζουμε απαντήσεις που χρειάζονται βελτίωση. Η ανατροφοδότησή σας φτάνει απευθείας στην ομάδα μας.', 'Theke answers questions using AI that searches trustworthy sources before responding; it doesn''t "guess".

Every answer comes with citations pointing to the sources it used, so you can verify the information in its original form.

Theke draws on four tiers of sources:
- Public knowledge base: laws, official gazette entries, circulars, and other official sources shared by all users.
- Company documents: files your company has uploaded, visible to everyone at your company. These documents are only visible within your company; no other company can see them.
- Client documents: files linked to a specific client. These documents are isolated per client; they never appear in conversations about your other clients.
- Project documents: files linked to a specific project. These documents are isolated per project; they never appear in conversations about your other projects, even for the same client.

When we don''t have a reliable enough source to answer with confidence, we say so plainly instead of guessing.

The "New session" button starts a fresh conversation without the previous history. Use it when you''re switching topics entirely.

The thumbs up/down icons under each answer help us spot answers that need improvement. Your feedback goes straight to our team.', '{super_admin}', NULL, '3'),
('onboarding-construction', 'Δύο τρόποι να ρωτήσετε', 'Two ways to ask', 'Υπάρχουν δύο τρόποι να χρησιμοποιήσετε τη Theke, ανάλογα με το τι ρωτάτε:

Γενικές ερωτήσεις: μπορείτε να ρωτήσετε οτιδήποτε απευθείας, χωρίς καμία προετοιμασία. Η Theke αναζητά στη δημόσια βάση γνώσης (νόμοι, ΦΕΚ, εγκύκλιοι) και απαντά αμέσως, με πηγές.

Ερωτήσεις για συγκεκριμένο έργο: αν η ερώτησή σας αφορά ένα συγκεκριμένο ακίνητο (π.χ. "τι χρειάζεται το έργο μου στο ΚΑΕΚ ...;"), δημιουργήστε πρώτα ένα έργο. Το ιστορικό της συνομιλίας παραμένει συνδεδεμένο με το έργο, ώστε να συνεχίσετε από εκεί που σταματήσατε την επόμενη φορά, χωρίς να επαναλαμβάνετε το πλαίσιο κάθε φορά.

Το καλύτερο: αν ανεβάσετε δικά σας έγγραφα του έργου (τοπογραφικά, άδειες, μελέτες), οι απαντήσεις γίνονται πιο ακριβείς, γιατί η Theke τα λαμβάνει υπόψη μαζί με τη δημόσια νομοθεσία. Αυτό είναι προαιρετικό - δεν απαιτείται για να ξεκινήσετε.', 'There are two ways to use Theke, depending on what you''re asking:

General questions: ask anything directly, no setup required. Theke searches the public knowledge base (laws, government gazette, circulars) and answers immediately, with sources.

Questions about a specific project: if your question concerns a specific property (e.g. "what does my project at KAEK ... need?"), create a project first. Your conversation history stays linked to that project, so you can pick up where you left off next time without repeating the context every time.

Making it better: if you upload your own project documents (surveys, permits, studies), answers get sharper, because Theke takes them into account alongside public legislation. This is optional - not required to get started.', '{member,admin}', 'construction', '4'),
('onboarding-tax', 'Δύο τρόποι να ρωτήσετε', 'Two ways to ask', 'Υπάρχουν δύο τρόποι να χρησιμοποιήσετε τη Theke, ανάλογα με το τι ρωτάτε:

Γενικές ερωτήσεις: μπορείτε να ρωτήσετε οτιδήποτε απευθείας, χωρίς καμία προετοιμασία. Η Theke αναζητά στη δημόσια βάση γνώσης (φορολογική νομοθεσία, εγκύκλιοι ΑΑΔΕ) και απαντά αμέσως, με πηγές.

Ερωτήσεις για συγκεκριμένο πελάτη: αν η ερώτησή σας αφορά έναν συγκεκριμένο πελάτη (π.χ. "τι ισχύει για τον πελάτη μου με ΑΦΜ ...;"), δημιουργήστε πρώτα έναν πελάτη. Το ιστορικό της συνομιλίας παραμένει συνδεδεμένο με τον πελάτη, ώστε να συνεχίσετε από εκεί που σταματήσατε την επόμενη φορά, χωρίς να επαναλαμβάνετε το πλαίσιο κάθε φορά.

Το καλύτερο: αν ανεβάσετε δικά του έγγραφα (δηλώσεις, παραστατικά, συμβάσεις), οι απαντήσεις γίνονται πιο ακριβείς, γιατί η Theke τα λαμβάνει υπόψη μαζί με τη δημόσια νομοθεσία. Αυτό είναι προαιρετικό - δεν απαιτείται για να ξεκινήσετε.', 'There are two ways to use Theke, depending on what you''re asking:

General questions: ask anything directly, no setup required. Theke searches the public knowledge base (tax legislation, ΑΑΔΕ circulars) and answers immediately, with sources.

Questions about a specific client: if your question concerns a specific client (e.g. "what applies to my client with VAT number ...?"), create a client first. Your conversation history stays linked to that client, so you can pick up where you left off next time without repeating the context every time.

Making it better: if you upload that client''s own documents (returns, receipts, contracts), answers get sharper, because Theke takes them into account alongside public legislation. This is optional - not required to get started.', '{member,admin}', 'tax_accounting', '5'),
('project-construction', 'Πώς να δημιουργήσετε έργο', 'How to create a project', 'Κατά τη δημιουργία νέου έργου, μπορείτε να προσδιορίσετε την τοποθεσία με τρεις τρόπους (επιλέξτε όποιον σας βολεύει):
- ΚΑΕΚ: αν το γνωρίζετε, η τοποθεσία συμπληρώνεται αυτόματα.
- Διεύθυνση: αναζήτηση με βάση τη διεύθυνση του ακινήτου.
- Pin στον χάρτη: τοποθετήστε το σημείο απευθείας πάνω στον χάρτη.

Μπορείτε προαιρετικά να συνδέσετε το έργο με έναν πελάτη από τη λίστα σας, ή να δημιουργήσετε νέο πελάτη απευθείας από τη φόρμα.

Κατά το ανέβασμα εγγράφων, επιλέγετε σε ποιο επίπεδο θα είναι ορατό το έγγραφο:
- Έργο: ορατό μόνο σε όσους έχουν πρόσβαση σε αυτό το συγκεκριμένο έργο.
- Πελάτης: ορατό σε όλα τα έργα του ίδιου πελάτη.
- Εταιρεία: ορατό σε όλη την εταιρεία, ανεξαρτήτως έργου ή πελάτη.', 'When creating a new project, you can set its location three ways (pick whichever suits you):
- KAEK: if you know it, the location fills in automatically.
- Address: search by the property''s address.
- Map pin: place the point directly on the map.

You can optionally link the project to a client from your list, or create a new client directly from the form.

When uploading documents, you choose which level the document is visible at:
- Project: visible only to people with access to this specific project.
- Client: visible across all of that client''s projects.
- Company: visible company-wide, regardless of project or client.', '{member,admin}', 'construction', '6'),
('project-tax', 'Πώς να δημιουργήσετε πελάτη', 'How to create a client', 'Οι πελάτες είναι ο βασικός τρόπος οργάνωσης της δουλειάς σας στη Theke Λογιστικής. Δημιουργήστε έναν νέο πελάτη με το όνομά του και προαιρετικά τον ΑΦΜ του, και προσθέστε σημειώσεις υπόθεσης όπως χρειάζεται.

Χρησιμοποιήστε το πεδίο αναζήτησης πελάτη για να βρείτε γρήγορα έναν υπάρχοντα πελάτη αντί να δημιουργήσετε διπλότυπο.

Κατά το ανέβασμα εγγράφων, επιλέγετε σε ποιο επίπεδο θα είναι ορατό το έγγραφο:
- Πελάτης: ορατό μόνο για τον συγκεκριμένο πελάτη.
- Εταιρεία: ορατό σε όλη την εταιρεία, ανεξαρτήτως πελάτη.', 'Clients are the main way work is organized in Theke Accounting. Create a new client with their name and, optionally, their ΑΦΜ, and add case notes as needed.

Use the client search field to quickly find an existing client instead of creating a duplicate.

When uploading documents, you choose which level the document is visible at:
- Client: visible only for that specific client.
- Company: visible company-wide, regardless of client.', '{member,admin}', 'tax_accounting', '7'),
('inside-outside-plan', 'Τι σημαίνει "εντός" ή "εκτός σχεδίου"', 'What "inside" or "outside the city plan" means', 'Όταν δημιουργείτε ένα έργο, το theke ρωτά αν το οικόπεδο βρίσκεται εντός ή εκτός εγκεκριμένου ρυμοτομικού σχεδίου. Αυτό δεν είναι λεπτομέρεια — καθορίζει ποιοι κανονισμοί δόμησης ισχύουν (συντελεστής δόμησης, αποστάσεις, όροι δόμησης), καθώς οι κανόνες διαφέρουν σημαντικά μεταξύ των δύο περιπτώσεων. Αν δεν είστε σίγουροι, ο μηχανικός σας ή η αρμόδια ΥΔΟΜ μπορεί να το επιβεβαιώσει.', 'When creating a project, theke asks whether the plot is inside or outside an approved city plan. This isn''t a minor detail — it determines which building regulations apply, since the rules differ significantly between the two cases. If unsure, your engineer or the local ΥΔΟΜ can confirm.', '{member,admin,super_admin}', 'construction', '8'),
('request-coverage', 'Ζητήστε κάλυψη για την περιοχή σας', 'Request coverage for your area', 'Το theke διαθέτει πλήρες τοπικό περιεχόμενο (κανονισμούς, στοιχεία επικοινωνίας ΥΔΟΜ/ΔΕΥΑ) για συγκεκριμένους δήμους. Αν επιλέξετε δήμο χωρίς ακόμη τοπικό περιεχόμενο, οι απαντήσεις θα βασίζονται μόνο στην εθνική νομοθεσία. Μπορείτε να πατήσετε "Ζητήστε κάλυψη" για να μας ενημερώσετε ότι χρειάζεστε αυτή την περιοχή — καταγράφουμε κάθε αίτημα και δίνουμε προτεραιότητα κάλυψης στις περιοχές με τη μεγαλύτερη ζήτηση.', 'theke has full local content (regulations, ΥΔΟΜ/ΔΕΥΑ contact info) for specific municipalities. If you select one without local content yet, answers will rely on national legislation only. Click "Request coverage" to let us know you need it — every request is logged and helps prioritize which areas we cover next.', '{member,admin,super_admin}', 'construction', '9'),
('users', 'Διαχείριση Χρηστών', 'Managing users', 'Από την καρτέλα «Χρήστες» του πίνακα διαχείρισης μπορείτε να προσκαλέσετε νέα μέλη με email, να ορίσετε τον ρόλο τους (μέλος ή διαχειριστής), και να απενεργοποιήσετε λογαριασμούς που δεν χρειάζονται πλέον πρόσβαση.

Μια πρόσκληση παραμένει ενεργή για 7 ημέρες. Μπορείτε να τη στείλετε ξανά αν λήξει.', 'From the "Users" tab of the admin dashboard you can invite new members by email, set their role (member or admin), and deactivate accounts that no longer need access.

An invite stays valid for 7 days. You can resend it if it expires.', '{admin}', NULL, '10'),
('invite-colleague', 'Πώς προσκαλείτε συνάδελφο', 'How to invite a colleague', 'Ως διαχειριστής, μπορείτε να προσκαλέσετε συναδέλφους στην ομάδα σας από την καρτέλα Χρήστες. Εισάγετε το email τους και επιλέξτε ρόλο (Μέλος ή Διαχειριστής). Θα λάβουν ένα email πρόσκλησης με σύνδεσμο εγγραφής, ο οποίος ισχύει για 7 ημέρες. Μόλις ολοκληρώσουν την εγγραφή, θα έχουν άμεση πρόσβαση στα υπάρχοντα έργα/πελάτες και έγγραφα της εταιρείας σας.', 'As an admin, invite colleagues from the Users tab — enter their email, choose a role (Member or Admin). They''ll receive an invite email with a registration link valid for 7 days. Once they complete registration, they immediately see your company''s existing projects/clients and documents.', '{admin}', NULL, '11'),
('usage', 'Παρακολούθηση Χρήσης', 'Monitoring usage', 'Η καρτέλα «Επισκόπηση» δείχνει τη χρήση της εταιρείας σας: αριθμό μηνυμάτων, ενεργούς χρήστες, και ποσοστό απαντήσεων με κενό (gap rate). Κρατήστε τον δείκτη πάνω σε κάθε στατιστικό για επεξήγηση.

Έγγραφα που επισημαίνονται ως «χρειάζονται επανεξέταση» σημαίνει ότι είτε η πηγή τους έχει αλλάξει από τότε που ανέβηκαν, είτε κάποιος τα σημείωσε χειροκίνητα για έλεγχο. Μπορείτε να τα βρείτε και να τα σημειώσετε ως ελεγμένα από την καρτέλα «Έγγραφα».', 'The "Overview" tab shows your company''s usage: message counts, active users, and the gap rate (the share of answers where we didn''t have a confident source). Hover over any stat for an explanation.

Documents flagged as "needs review" means either their source has changed since they were uploaded, or someone flagged them manually for a check. You can find and mark them reviewed from the "Documents" tab.', '{admin}', NULL, '12'),
('message-notifications', 'Τι σημαίνουν οι ειδοποιήσεις μηνυμάτων', 'What the message notices mean', 'Κατά τη χρήση, ενδέχεται να δείτε περιστασιακά μια σύντομη ειδοποίηση σχετικά με τα μηνύματά σας — π.χ. πόσα μηνύματα έχετε στείλει σήμερα, ή ότι το μηνιαίο όριο της εταιρείας σας πλησιάζει. Αυτές οι ειδοποιήσεις είναι απλώς ενημερωτικές· δεν αποτελούν προειδοποίηση προβλήματος και δεν σημαίνει ότι κάνατε κάτι λάθος. Αν χρειαστεί περισσότερος χώρος, ο διαχειριστής της εταιρείας σας μπορεί να ζητήσει αναβάθμιση πλάνου.', 'You may occasionally see a short notice about your messages — how many you''ve sent today, or that your company''s monthly limit is approaching. These are purely informational, not a warning that something''s wrong. If more room is ever needed, your company admin can request a plan upgrade.', '{member,admin,super_admin}', NULL, '13'),
('subscription', 'Συνδρομή & Πλάνο', 'Subscription & plan', 'Η καρτέλα «Συνδρομή» δείχνει το τρέχον πλάνο της εταιρείας σας, το όριο μηνυμάτων ανά μήνα, και τη χρήση αποθηκευτικού χώρου.

Αν χρειάζεστε αναβάθμιση πλάνου ή πρόσθετο πακέτο μηνυμάτων, μπορείτε να υποβάλετε αίτημα απευθείας από εκεί. Ειδοποιούμε την ομάδα μας αυτόματα.', 'The "Subscription" tab shows your company''s current plan, monthly message limit, and storage usage.

If you need a plan upgrade or an extra message pack, you can submit a request directly from there. It notifies our team automatically.', '{admin}', NULL, '14'),
('platform', 'Διαχείριση Πλατφόρμας', 'Managing the platform', 'Από το μενού διαχειριστή έχετε πρόσβαση σε τρεις βασικές ενότητες:
- Πλάνα: διαχείριση συνδρομητικών πλάνων ανά κάθετη υπηρεσία.
- Πηγές Δεδομένων: παρακολούθηση της κατάστασης άντλησης περιεχομένου από επίσημες πηγές.
- Ανατροφοδότηση: επισκόπηση όλων των σχολίων «μου αρέσει» / «δεν μου αρέσει» χρηστών σε όλες τις εταιρείες.', 'From the admin menu you have access to three core sections:
- Plans: manage subscription plans per vertical.
- Data Sources: monitor the status of content pulled from official sources.
- Feedback: review all thumbs up/down user feedback across every company.', '{super_admin}', NULL, '15'),
('data-privacy', 'Πού πηγαίνουν τα δεδομένα σας', 'Where your data goes', 'Τα ερωτήματά σας και τα έγγραφα που ανεβάζετε επεξεργάζονται με τη βοήθεια τεχνητής νοημοσύνης (OpenAI) για την παραγωγή απαντήσεων, και αποθηκεύονται με ασφάλεια στην υποδομή μας εντός ΕΕ. Τα έγγραφα της εταιρείας σας είναι απομονωμένα από άλλες εταιρείες. Η Πολιτική Απορρήτου και η Σύμβαση Επεξεργασίας Δεδομένων θα δημοσιευτούν σύντομα με πλήρεις λεπτομέρειες.', 'Your questions and uploaded documents are processed with AI assistance (OpenAI) to generate answers, and stored securely on our EU-based infrastructure. Your company''s documents are isolated from other companies. Our Privacy Policy and Data Processing Agreement will be published soon with full details.', '{member,admin,super_admin}', NULL, '16')

ON CONFLICT (slug) DO NOTHING;
