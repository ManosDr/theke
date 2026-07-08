# theke

AI-powered assistant for Greek construction professionals. Ask permit questions, get instant answers with citations from official sources (ΦΕΚ, Law 4495/17, ΤΕΕ, ΥΠΕΝ, ΑΑΔΕ, e-ΕΦΚΑ, Κτηματολόγιο). Built with FastAPI, Next.js, PostgreSQL + pgvector. Targeting SME engineering firms and municipalities in Greece.

## Project structure

- `backend/` - FastAPI app: auth (JWT/bcrypt), multi-tenant roles & permissions, document upload/versioning/removal workflow, invites, company logos, audit log, locale/translation management, notifications
- `frontend/` - Next.js app: login/register, role-aware dashboards, a Sources browser, Search, and the Chat UI - fully bilingual (English/Greek, admin-extensible to more), dark/light mode, installable as a PWA
- `crawler/` - automated ingestion from national and per-municipality Greek government sources, scheduled monthly, plus a weekly staleness sweep
- `db/init.sql` - Postgres + pgvector schema

## Getting started

```bash
cp .env.example .env
```

`.env.example` ships with production-oriented values for a couple of settings (`ENVIRONMENT=production`, and - see "Production environment guards" below - `SEED_DEMO_DATA=false`), since it doubles as the reference for a real deployment. For local dev, edit your new `.env` and set:

```
ENVIRONMENT=development
SEED_DEMO_DATA=true
```

then:

```bash
docker compose up --build
```

- Backend: http://localhost:8000/health
- Frontend: http://localhost:3000
- Postgres: localhost:5432 (pgvector enabled)

With `SEED_DEMO_DATA=true`, you get 5 fixed demo accounts on first startup - password `demo1234` for all:

| Email | Role |
|---|---|
| `demo-superadmin@theke.gr` | Platform super admin |
| `demo-admin@construction.theke.gr` | Construction company admin |
| `demo-member@construction.theke.gr` | Construction company member |
| `demo-admin@municipality.theke.gr` | Municipality admin |
| `demo-member@municipality.theke.gr` | Municipality member |

The login page has one-click buttons for all five, so you can try each role's experience without typing credentials.

The crawler and scheduler don't need to be started manually - `docker compose up` brings up a `scheduler` service that runs the crawler monthly via supercronic. To trigger an ingestion run on demand:

```bash
docker compose --profile crawler run --rm crawler
```

## Deployment

`docker-compose.prod.yml` is the production variant: no bind mounts (code is baked into images via `backend/Dockerfile.prod` / `frontend/Dockerfile.prod`), restart policies on every long-running service, Postgres/Redis not published to the host, and an `nginx` service in front (`infra/nginx.conf`) terminating SSL and proxying `/api/*` to the backend, everything else to the frontend.

First deploy, on the actual server (not automated - provisioning the VPS itself is a manual step):

```bash
git clone <repo> && cd theke
cp .env.example .env   # fill in real values - see infra/nginx.conf's header
                        # comment for the certbot bootstrap order (no SSL
                        # cert exists yet on a brand-new server)
./scripts/deploy.sh
```

`scripts/deploy.sh` pulls `main`, rebuilds and restarts the stack, reapplies `db/init.sql` (idempotent - see KNOWN_DECISIONS.md on why there's no Alembic yet), and polls `/health` before declaring success, dumping recent backend logs if it never comes up healthy. Re-run the same script for every subsequent deploy.

`scripts/backup.sh` dumps Postgres to a timestamped, gzipped file under `backups/`, keeps the last 7, and logs success/failure to `backups/backup.log` - meant to run from cron (see the script's header for a crontab example), not manually.

## Data sources

The crawler pulls from official sources, deduplicating by content hash so re-crawls are cheap. Every document is tagged `scope: national` or `scope: regional` and records which source it came from, so it can be browsed by dataset (see Sources below) in addition to full-text search.

**National:**

- **ΦΕΚ** (Government Gazette, Series Α, Δ, and Α.Α.Π. - forced expropriations & urban planning matters, which is where Γενικά Πολεοδομικά Σχέδια get published) via et.gr's search API
- **ΤΕΕ** (Technical Chamber) e-Άδειες circulars, plus EUGO's e-Άδειες permit-issuance overview, mitos.gov.gr's full e-Άδειες and small-scale-works (Εργασίες Δόμησης Μικρής Κλίμακας) service descriptions, and a curated summary of the permit cost structure (engineer fees, e-Άδειες platform fee, e-ΕΦΚΑ contributions - honest about which figures aren't publicly available rather than guessing)
- **ΥΠΕΝ** (Ministry of Environment & Energy) - mostly indexed by title/link only per their robots.txt, with a handful of documents manually text-extracted where the source PDF was hand-verified, plus the opengov.gr public-consultation text of the building-permit-documents article (Ν.4495/2017 Άρθρο 50) and the full text of Ν.4495/2017's Τμήμα Δ (unauthorized buildings/regularization, Άρθρα 81-95, from e-nomothesia.gr)
- **ΑΑΔΕ** (tax authority) - Ε9/ΕΝΦΙΑ circulars and the real-estate transfer tax overview
- **e-ΕΦΚΑ** (social security) - construction insurance contribution guidance
- **Κτηματολόγιο** (Hellenic Cadastre) - institutional framework laws/decrees, plus a curated summary of the post-construction property-declaration procedure (documents, cost, steps)
- **Δασαρχείο** (Forest Service) - the Πράξη Χαρακτηρισμού (forest-characterization) procedure required before a building permit on land that may be forest, curated from N.998/1979 Άρθρο 14 and its opengov.gr consultation text
- **ΔΕΔΔΗΕ** (electricity grid operator) - new grid connection procedure

**Regional** (per-municipality ΥΔΟΜ building-permit offices and ΔΕΥΑ water utilities, currently covering Δήμος Καβάλας, Παγγαίου, Θάσου, Δράμας, and Ξάνθης - see "Knowledge base regions" below): building-directorate contact/forms pages, water/sewer new-connection requirements, and (where locatable) the municipality's Γ.Π.Σ. approval ΦΕΚ with actual zone-level building-coefficient figures.

Adding a new region is meant to be mostly data, not code: a `regions` + `utility_providers` row and a couple of crawler source entries reusing the existing generic page-scraping logic. In practice this has held for straightforward WordPress-templated municipal sites; a Joomla site and a site whose theme injects decoy `<article>` tags both required a manual research/judgment call instead of a clean drop-in (see [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md)).

## Multi-vertical architecture

theke now serves more than one professional domain from the same codebase. A `verticals` table (currently `construction` and `tax_accounting`) drives per-vertical system prompts, off-topic guards, disclaimers, and knowledge-base scoping - every `Company` and `Document` belongs to exactly one vertical, and registration requires picking a valid vertical slug. A super admin manages this from a dedicated admin surface, gated behind a sidebar **vertical switcher** (Κατασκευές / Λογιστική / Όλα) that filters every screen below it: `/admin/documents` (Knowledge Base browsing/filtering, status badges, a supersede-document flow with a searchable replacement modal), `/admin/data-sources` (per-source sync health, cadence editor), `/admin/companies` (table + a detail modal with users/projects/usage and a vertical-reassignment flow that warns how many documents the company would lose access to), and `/admin/verticals` (tagline/welcome-message/disclaimer/system-prompt-override editing - takes effect on the next request, no restart). The Dashboard itself shows either two side-by-side per-vertical stat cards (Όλα) or one full-width panel (a single vertical selected).

**Tax & accounting KB**: the core tax codes - Κώδικας Φορολογίας Εισοδήματος (ΚΦΕ, Ν.4172/2013), Κώδικας Φορολογικής Διαδικασίας (ΚΦΔ, Ν.4174/2013), the current VAT code (Ν.5144/2024 - its predecessor Ν.2859/2000 was repealed in 2024), and ΕΝΦΙΑ (Ν.4223/2013) - plus myAADE/ΑΑΔΕ-circular/ΕΦΚΑ/ΔΕΔ procedural guidance and a handful of curated bridge documents for facts (current rates, deadlines, penalty amounts) that don't sit cleanly inside a single statute article. `crawler/crawler/tax_laws.py` scrapes lawspot.gr's full inline article text where available and falls back to the original ΦΕΚ enactment PDF (via the same et.gr blob storage the construction crawler uses) where it isn't - see [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md) for exactly which laws use which source and why.

**Client-scoped documents**: any vertical can create a project marked `is_client=true` (the default for tax_accounting, since it has no regional-scoping concept) and upload private, project-only documents (PDF/DOCX/TXT) to it - a chat scoped to that project sees both the public vertical KB and that project's private uploads; a chat without a project only sees the public KB.

## Authentication

Registration (create a company or join via invite), login, and JWTs (15-minute
access tokens, re-checked against the DB on every request so a revoked user or
suspended company locks out immediately rather than waiting for the token to
expire) are covered in more depth in [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md).
Two things worth calling out here:

- **Login rate limiting**: 5 failed attempts from the same IP within 15
  minutes returns `429` for the rest of that window, backed by the Redis
  instance that's been in `docker-compose.yml`/`config.py` since early on but
  unused until this. A correct password doesn't count towards the cap; a
  correct password doesn't clear it early either once it's tripped.
- **Password reset**: `POST /auth/forgot-password` + `/reset-password`, with
  a `/forgot-password` and `/reset-password` page on the frontend. No email
  provider is configured yet, so the reset link is logged (`docker logs
  theke-backend-1`) rather than emailed - the mechanism is real and
  testable end-to-end, just not wired to an inbox yet.

`company_type` at registration is validated against a fixed whitelist
(`construction`, `architecture`, `engineering`, `contractor`, `municipality`)
rather than accepted as an arbitrary string.

## Roles & multi-tenancy

Three visibility tiers on the knowledge base: public (crawled, everyone), company-private (uploaded, visible only within that company), and municipality-scoped (uploaded by a municipality, visible to anyone asking about that municipality). Company/municipality admins manage their own team (invite, revoke, change roles) and approve document removals; a platform super admin manages tenants and the public knowledge base.

Construction companies can track **projects** (a name + municipality + optional region + address) to scope which municipality's rules apply to a given job site, and mark a default project so chat auto-detects context - this concept doesn't apply to municipality accounts, since a municipality user's context is always their own municipality, so it's hidden from their dashboard.

When a project is linked to a tracked region, its company gains visibility into that region's regional-scope KB documents (ΥΔΟΜ/ΔΕΥΑ/ΔΕΔΔΗΕ paperwork) everywhere - Sources, Search, and Chat - on top of the always-visible national documents. This is company-wide (any project unlocks the region for the whole company, not just that project's users) - a deliberate choice, not an oversight; see [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md) for the reasoning and the condition under which it'd be worth revisiting.

## Interface

A collapsible left sidebar (280px ⇄ 64px, toggle next to the wordmark) plus a top bar (page title + breadcrumb, an A-/A+ font-size control, a language pill, a theme toggle, a notification bell, and an avatar) frame every page - rebuilt pixel-for-pixel from the Theke Admin design handoff's own interactive prototype (not just its written briefs), application-wide rather than admin-screen-only. Sign-out lives in a solid-navy sidebar footer alongside the account avatar/email/role. For a super admin, the sidebar additionally shows the vertical switcher and an expandable nav tree (Γνωσιακή Βάση → Έγγραφα/Πηγές Δεδομένων, Εταιρείες & Χρήστες, Ρυθμίσεις Συστήματος → Verticals & Content). The visual design - color palette, gradients, card/badge styling - is modeled on a reference dashboard design, recreated for both light and dark mode with the same layout in each; the admin-redesign token set (navy/stone/parchment plus per-vertical green/bronze accents) now drives the shell chrome too, not just the admin screens' cards/tables/badges.

The Super Admin dashboard is organized by urgency rather than a flat wall of stat tiles: the per-vertical stat cards described above sit at the top, followed by an **attention row** surfacing the three numbers that actually need a decision (suspended tenants, chat gap rate, stale documents), each with a severity-colored card and a CTA that opens a dedicated page explaining what the number means and what to do about it - `/admin/suspended-tenants`, `/admin/chat-gap-rate`, and the `/admin/stale-documents` queue; an **analytics row** pairs the multi-line activity chart (logins vs. everything else, from real audit-log data, always the same height as its neighbor) with a chat & knowledge-base health panel (message/document counts plus a large thumbs up/down sentiment donut); and the lower-frequency admin tools (staleness review, languages, audit log) are consolidated into a single **tabbed panel**. The companies table and public-KB search that used to live on this page moved to their own dedicated `/admin/companies` and `/admin/documents` screens (see "Multi-vertical architecture" above), which cover the same ground with considerably more depth.

## Knowledge base UI

- **Sources** (`/sources`): every dataset as a quick-filter button (ΦΕΚ, ΤΕΕ, ΥΠΕΝ, ...) with a live document count, plus authority/content-type/region filters underneath - all combinable, all reflected in the URL. A document with `extraction_status: manual_entry_pending` shows a "source pending verification" label instead of being hidden; `needs_review` documents never appear at all (enforced once, in `visible_documents_filter`, not per-page).
- **Search** (`/search`): combined term + source + type + date-range filtering. Every filter (including the search term, debounced as you type) is reflected in the URL, so any results view is copy-paste shareable. Matches are highlighted directly in the results, and the snippet shown is centered on wherever the term actually matched in the document (not always the first few hundred characters), so it's obvious why a document matched. A document's "Read" link remembers exactly which search/sources page you came from, so the back link returns to your filtered, paginated results instead of a generic listing.
- **Chat** (`/chat`): the flagship feature, now wired to `POST /chat/message` (Phase 2.3) rather than the plain `/chat` used earlier - per-project view (a project selector scopes both retrieval and which conversation thread is shown), a persistent disclaimer banner, and a muted "answer with limited sources" label on any answer whose `gap` flag came back true (thinner-than-usual or weaker-than-usual supporting excerpts, not necessarily "no answer"). Conversation history survives a refresh - `GET /chat/history` reads it back from `chat_sessions`, which now also stores each turn's citations and `gap` value, not just the raw text.

## Knowledge base regions

Beyond the always-national KB, `regions` and `utility_providers` tables track per-municipality coverage. A construction company links one of its projects to a tracked region via a dropdown on its dashboard (a project name + region + address form, backed by `GET /projects/regions`) - onboarding the region itself (crawling its ΥΔΟΜ/ΔΕΥΑ pages and creating its `regions`/`utility_providers` rows) is a one-time setup step per municipality, not something a company does themselves.

Two fields track how complete a region's coefficient data is, and they mean different things on purpose:

- `has_coefficient_data` - whether the region's own ΥΔΟΜ (building office) page has building-coefficient/setback content. Currently `false` for every onboarded region except two where it was never actually possible to check (the page failed to load cleanly).
- `has_zone_level_coefficient_text` - whether an actual Γ.Π.Σ. approval ΦΕΚ has been located and ingested, with genuine coefficient figures organized by named zone (not by address or parcel).

**Important limitation, stated plainly rather than implied by the data:** theke can currently answer "what does the law say for this municipality's zones" (and for a couple of regions, real zone-named coefficient figures), but **not** "what applies to my specific plot." Resolving a real address to its zone requires GIS/map data outside this pipeline, plus correct legal interpretation of conditional clauses in the source ΦΕΚ - both are explicitly out of scope for now (see [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md)).

`regions` and `utility_providers` also carry a nullable `contact_phone`/`contact_email` per authority (ΥΔΟΜ on `regions`, ΔΕΥΑ/ΔΕΔΔΗΕ on `utility_providers`). When populated, chat surfaces them next to the relevant citation, and appends them to the honest-gap response for that region; when a real answer is generated instead, that answer is unaffected by contact data either way. All five onboarded regions currently have these fields `NULL` - populating them is a manual research pass, not something the crawler can do (contact pages vary too much to auto-extract reliably, the same reasoning as `base_url`/`ydom_authority_name`).

### Data quality & staleness

- **`extraction_status`** on every document is one of `full_text`, `reference_only` (indexed by title/link only, per a source's robots.txt), or `manual_entry_pending` (a real gap - the topic is known and worth covering, but no usable source content was found; the reason is recorded and surfaced instead of left silently absent).
- **`needs_review`** flags a document whose extraction may have grabbed the wrong content entirely (e.g. a page template that injects unrelated "recent posts" `<article>` tags ahead of the real content). A flagged document is suppressed everywhere a normal user can see it - Search, Sources, Chat, direct document links - and only remains visible to a super admin via the KB management search and the staleness/review queue, until someone corrects it.
- A **weekly job** flags any public document whose `last_verified_at` is missing or older than six months into that same super admin review queue (`GET /admin/stale-documents`, surfaced on the Super Admin dashboard, plus its own `/admin/stale-documents` and `/admin/needs-review` pages - same one queue behind both routes, since staleness and needs_review share a single flag by design). The flag only ever gets raised automatically, never cleared automatically - it comes off the queue only once a human has actually addressed it.

## Notifications

A bell in the header (unread badge, dropdown with mark-as-read / mark-all-read) covers:

- A digest after each monthly crawl run ("12 new documents added")
- New content in a municipality tied to one of a construction company's projects
- An admin's invite being accepted
- A document removal request awaiting an admin's decision
- The requester being told once that removal is approved or rejected

## Internationalization

English and Greek ship bundled in the frontend, so the app works instantly with zero backend dependency for those two. On top of that, a super admin can (from the **Languages** panel on their dashboard):

- Add an entirely new language (e.g. German, Turkish, Hebrew) by code + display name
- Override any individual string in any language, including the bundled English/Greek defaults - changes apply live, no redeploy
- Remove a custom language

Untranslated strings in a new language fall back to the English default until an admin fills them in. Greek is the universal default for anyone who hasn't chosen otherwise; each signed-in user's language choice is saved to their account (`users.preferred_locale`) and follows them to any device, and a device that has picked a language while logged out remembers it for next time. Dark/light mode works the same way (`users.preferred_theme`) - light is the default for everyone until an account explicitly switches to dark, regardless of OS/browser color-scheme settings.

The account menu (click your email/role in the header) tucks the language switcher, dark/light mode toggle, and sign out into a single dropdown.

## Current status

Working end-to-end: crawler ingestion (national + 5 onboarded regions), auth, roles/permissions, document upload/versioning, the Sources browser, full-text Search (with shareable, highlighted, snippet-aware results), region-scoped visibility, notifications, the staleness/review queue, the full i18n system (bundled + admin-managed + per-user persisted), the whole frontend shell in both themes, and the Chat RAG pipeline (chunking + embedding via `text-embedding-3-small`, hybrid retrieval - pgvector cosine distance merged with PostgreSQL full-text search via Reciprocal Rank Fusion, scoped through the same visibility rules as everywhere else - GPT-4o generation grounded only in retrieved excerpts with numbered citations, and a structural honest-gap fallback - no chat completion is ever called when nothing relevant enough is found).

Per-plot coefficient lookup (as opposed to zone-level legal text) is explicitly out of scope for now - see "Knowledge base regions" above.

`POST /search` exposes the same retrieval (embedding + pgvector + visibility scoping, with an optional `region_id` to narrow further, and `needs_review` documents excluded twice over - once by never being embedded, once by the shared visibility filter) with no completion step, returning raw chunks, distances, and source metadata directly. It exists to let retrieval quality be inspected on its own before results feed into `/chat`'s generation step; there's no frontend for it yet.

`POST /chat/message` is a second, more strictly-specified chat endpoint alongside `/chat`: region scope comes from the caller's `project_id` (its linked region, not a raw parameter) rather than the company's full region set; retrieval calls the shared retrieval core directly rather than going through `/search`'s own route; and the response carries a `gap` flag that can be `true` even when a real, cited answer was generated - whenever fewer supporting excerpts were found than requested, or the weakest of them is a stretch match - so the frontend can present that answer as lower-confidence rather than treating every non-empty answer as equally solid. Every turn (message, answer, citations, `gap`) is persisted to `chat_sessions` and readable back via `GET /chat/history`. The Chat page now calls this endpoint, not the older `/chat` (which still exists, unchanged, for backward compatibility).

**Guardrails on `/chat/message` and `/search`** (Phase 5): both reject queries over 500 characters with a 400; both return a graceful 503 (not a raw OpenAI error or an unhandled 500) if the embedding or completion call fails. `/chat/message` additionally rate-limits to 20 messages/hour per user (Redis-backed, mirroring the login-lockout pattern in `services/rate_limit.py`, keyed by `user_id` since this is an authenticated endpoint) with a 429 past that; and runs a real LLM classification call (not a keyword list) before retrieval to catch off-topic questions and prompt-injection attempts, returning the same gap response shape as zero-retrieval without ever reaching the main completion. `/search` deliberately doesn't get the rate limit or topic guard - it stays a lightweight, completion-free introspection endpoint.

**Test coverage:** `backend/tests/test_critical_path.py` covers five critical paths end-to-end against the real dev database (self-contained fixtures, no mocking): a known-good query citing its source document, the gap-response shape for an irrelevant query, region-based multi-tenant isolation, 401 on an expired JWT, and `needs_review` suppression. Everything else described in "Knowledge base regions" and "Data quality & staleness" above was verified manually (direct API calls and/or a real browser session), not by an automated test.

See [construction-ai-platform-blueprint.md](construction-ai-platform-blueprint.md) for the full roadmap, [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md) for judgment calls made along the way that are deliberate but worth revisiting under specific conditions, and [PROJECT_STATE.md](PROJECT_STATE.md) for a point-in-time, codebase-verified snapshot of exact schema, data, and test coverage.
