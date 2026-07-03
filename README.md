# theke

AI-powered assistant for Greek construction professionals. Ask permit questions, get instant answers with citations from official sources (ΦΕΚ, Law 4495/17, ΤΕΕ, ΥΠΕΝ, ΑΑΔΕ, e-ΕΦΚΑ, Κτηματολόγιο). Built with FastAPI, Next.js, PostgreSQL + pgvector. Targeting SME engineering firms and municipalities in Greece.

## Project structure

- `backend/` - FastAPI app: auth (JWT/bcrypt), multi-tenant roles & permissions, document upload/versioning/removal workflow, invites, company logos, audit log
- `frontend/` - Next.js app: login/register, role-aware dashboards, a Sources browser, Search, and the Chat UI - English/Greek switchable, dark/light mode, installable as a PWA
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

## Roles & multi-tenancy

Three visibility tiers on the knowledge base: public (crawled, everyone), company-private (uploaded, visible only within that company), and municipality-scoped (uploaded by a municipality, visible to anyone asking about that municipality). Company/municipality admins manage their own team (invite, revoke, change roles) and approve document removals; a platform super admin manages tenants and the public knowledge base.

## Current status

Working end-to-end: crawler ingestion, auth, roles/permissions, document upload/versioning, the Sources browser, full-text Search (with date/type/source filters), and the whole frontend shell.

**Not yet wired up:** the Chat page's actual RAG generation (embeddings + retrieval + GPT calls) - it's still a stub pending an OpenAI API key. Everything else on the Chat page (context sidebar, quick document search) is live.

See [construction-ai-platform-blueprint.md](construction-ai-platform-blueprint.md) for the full roadmap.
