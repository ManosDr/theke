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
docker compose up --build
```

- Backend: http://localhost:8000/health
- Frontend: http://localhost:3000
- Postgres: localhost:5432 (pgvector enabled)

Set `SEED_DEMO_DATA=true` in `.env` (already the default in `.env.example`) to get 5 fixed demo accounts on first startup - password `demo1234` for all:

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

## Data sources

The crawler pulls from official sources, deduplicating by content hash so re-crawls are cheap. Every document is tagged `scope: national` or `scope: regional` and records which source it came from, so it can be browsed by dataset (see Sources below) in addition to full-text search.

**National:**

- **ΦΕΚ** (Government Gazette, Series Α, Δ, and Α.Α.Π. - forced expropriations & urban planning matters, which is where Γενικά Πολεοδομικά Σχέδια get published) via et.gr's search API
- **ΤΕΕ** (Technical Chamber) e-Άδειες circulars, plus EUGO's e-Άδειες permit-issuance overview
- **ΥΠΕΝ** (Ministry of Environment & Energy) - mostly indexed by title/link only per their robots.txt, with a handful of documents manually text-extracted where the source PDF was hand-verified
- **ΑΑΔΕ** (tax authority) - Ε9/ΕΝΦΙΑ circulars and the real-estate transfer tax overview
- **e-ΕΦΚΑ** (social security) - construction insurance contribution guidance
- **Κτηματολόγιο** (Hellenic Cadastre) - institutional framework laws/decrees
- **ΔΕΔΔΗΕ** (electricity grid operator) - new grid connection procedure

**Regional** (per-municipality ΥΔΟΜ building-permit offices and ΔΕΥΑ water utilities, currently covering Δήμος Καβάλας, Παγγαίου, Θάσου, Δράμας, and Ξάνθης - see "Knowledge base regions" below): building-directorate contact/forms pages, water/sewer new-connection requirements, and (where locatable) the municipality's Γ.Π.Σ. approval ΦΕΚ with actual zone-level building-coefficient figures.

Adding a new region is meant to be mostly data, not code: a `regions` + `utility_providers` row and a couple of crawler source entries reusing the existing generic page-scraping logic. In practice this has held for straightforward WordPress-templated municipal sites; a Joomla site and a site whose theme injects decoy `<article>` tags both required a manual research/judgment call instead of a clean drop-in (see [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md)).

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

A fixed left sidebar (Dashboard / Sources / Search / Chat) plus a top header (page title, a search bar that works from any page, a notification bell, and the account menu) frame every page. The visual design - color palette, gradients, card/badge styling - is modeled on a reference dashboard design, recreated for both light and dark mode with the same layout in each. Dashboards use color-coded stat tiles (a suspended-tenant count, for instance, renders in red so it's impossible to miss) and a smooth multi-line activity chart (logins vs. everything else, from real audit-log data - no placeholder numbers).

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

Untranslated strings in a new language fall back to the English default until an admin fills them in. Each signed-in user's language choice is saved to their account (`users.preferred_locale`) and follows them to any device; logged-out visitors get whatever language was last used on that browser.

The account menu (click your email/role in the header) tucks the language switcher, dark/light mode toggle, and sign out into a single dropdown.

## Current status

Working end-to-end: crawler ingestion (national + 5 onboarded regions), auth, roles/permissions, document upload/versioning, the Sources browser, full-text Search (with shareable, highlighted, snippet-aware results), region-scoped visibility, notifications, the staleness/review queue, the full i18n system (bundled + admin-managed + per-user persisted), the whole frontend shell in both themes, and the Chat RAG pipeline (chunking + embedding via `text-embedding-3-small`, pgvector cosine-distance retrieval scoped through the same visibility rules as everywhere else, GPT-4o generation grounded only in retrieved excerpts with numbered citations, and a structural honest-gap fallback - no chat completion is ever called when nothing relevant enough is found).

Per-plot coefficient lookup (as opposed to zone-level legal text) is explicitly out of scope for now - see "Knowledge base regions" above.

`POST /search` exposes the same retrieval (embedding + pgvector + visibility scoping, with an optional `region_id` to narrow further, and `needs_review` documents excluded twice over - once by never being embedded, once by the shared visibility filter) with no completion step, returning raw chunks, distances, and source metadata directly. It exists to let retrieval quality be inspected on its own before results feed into `/chat`'s generation step; there's no frontend for it yet.

`POST /chat/message` is a second, more strictly-specified chat endpoint alongside `/chat`: region scope comes from the caller's `project_id` (its linked region, not a raw parameter) rather than the company's full region set; retrieval calls the shared retrieval core directly rather than going through `/search`'s own route; and the response carries a `gap` flag that can be `true` even when a real, cited answer was generated - whenever fewer supporting excerpts were found than requested, or the weakest of them is a stretch match - so the frontend can present that answer as lower-confidence rather than treating every non-empty answer as equally solid. Every turn (message, answer, citations, `gap`) is persisted to `chat_sessions` and readable back via `GET /chat/history`. The Chat page now calls this endpoint, not the older `/chat` (which still exists, unchanged, for backward compatibility).

**Test coverage:** the automated suite currently covers only a basic backend health check. Everything described in "Knowledge base regions" and "Data quality & staleness" above was verified manually (direct API calls and/or a real browser session), not by an automated test.

See [construction-ai-platform-blueprint.md](construction-ai-platform-blueprint.md) for the full roadmap, [KNOWN_DECISIONS.md](KNOWN_DECISIONS.md) for judgment calls made along the way that are deliberate but worth revisiting under specific conditions, and [PROJECT_STATE.md](PROJECT_STATE.md) for a point-in-time, codebase-verified snapshot of exact schema, data, and test coverage.
