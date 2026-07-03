# theke

AI-powered assistant for Greek construction professionals. Ask permit questions, get instant answers with citations from official sources (ΦΕΚ, Law 4495/17, ΤΕΕ, ΥΠΕΝ, ΑΑΔΕ, e-ΕΦΚΑ, Κτηματολόγιο). Built with FastAPI, Next.js, PostgreSQL + pgvector. Targeting SME engineering firms and municipalities in Greece.

## Project structure

- `backend/` - FastAPI app: auth (JWT/bcrypt), multi-tenant roles & permissions, document upload/versioning/removal workflow, invites, company logos, audit log, locale/translation management, notifications
- `frontend/` - Next.js app: login/register, role-aware dashboards, a Sources browser, Search, and the Chat UI - fully bilingual (English/Greek, admin-extensible to more), dark/light mode, installable as a PWA
- `crawler/` - automated ingestion from 7 Greek government sources, scheduled monthly
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

The crawler pulls from these official sources, deduplicating by content hash so re-crawls are cheap:

- **ΦΕΚ** (Government Gazette, Series Α + Δ) via et.gr's search API
- **ΤΕΕ** (Technical Chamber) e-Άδειες circulars
- **ΥΠΕΝ** (Ministry of Environment & Energy) - indexed by title/link only, per their robots.txt
- **ΑΑΔΕ** (tax authority) - Ε9/ΕΝΦΙΑ circulars
- **e-ΕΦΚΑ** (social security) - construction insurance contribution guidance
- **Κτηματολόγιο** (Hellenic Cadastre) - institutional framework laws/decrees

Every crawled document records which source it came from, so it can be browsed by dataset (see Sources below) in addition to full-text search.

## Roles & multi-tenancy

Three visibility tiers on the knowledge base: public (crawled, everyone), company-private (uploaded, visible only within that company), and municipality-scoped (uploaded by a municipality, visible to anyone asking about that municipality). Company/municipality admins manage their own team (invite, revoke, change roles) and approve document removals; a platform super admin manages tenants and the public knowledge base.

Construction companies can track **projects** (a name + municipality + address) to scope which municipality's rules apply to a given job site, and mark a default project so chat auto-detects context - this concept doesn't apply to municipality accounts, since a municipality user's context is always their own municipality, so it's hidden from their dashboard.

## Interface

A fixed left sidebar (Dashboard / Sources / Search / Chat) plus a top header (page title, a search bar that works from any page, a notification bell, and the account menu) frame every page. The visual design - color palette, gradients, card/badge styling - is modeled on a reference dashboard design, recreated for both light and dark mode with the same layout in each. Dashboards use color-coded stat tiles (a suspended-tenant count, for instance, renders in red so it's impossible to miss) and a smooth multi-line activity chart (logins vs. everything else, from real audit-log data - no placeholder numbers).

## Knowledge base UI

- **Sources** (`/sources`): every dataset as a button (ΦΕΚ, ΤΕΕ, ΥΠΕΝ, ...) with a live document count; clicking one drills into a dated, paginated listing with links to the original source or an in-app reader.
- **Search** (`/search`): combined term + source + type + date-range filtering. Every filter (including the search term, debounced as you type) is reflected in the URL, so any results view is copy-paste shareable. Matches are highlighted directly in the results, and the snippet shown is centered on wherever the term actually matched in the document (not always the first few hundred characters), so it's obvious why a document matched. A document's "Read" link remembers exactly which search/sources page you came from, so the back link returns to your filtered, paginated results instead of a generic listing.
- **Chat** (`/chat`): natural-language Q&A with a context sidebar (role, account type, default project) and a quick document search - the flagship feature, currently a stub pending an OpenAI API key (see Current status).

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

Working end-to-end: crawler ingestion, auth, roles/permissions, document upload/versioning, the Sources browser, full-text Search (with shareable, highlighted, snippet-aware results), notifications, the full i18n system (bundled + admin-managed + per-user persisted), and the whole frontend shell in both themes.

**Not yet wired up:** the Chat page's actual RAG generation (embeddings + retrieval + GPT calls) - it's still a stub pending an OpenAI API key. Everything else on the Chat page (context sidebar, quick document search) is live.

See [construction-ai-platform-blueprint.md](construction-ai-platform-blueprint.md) for the full roadmap.
