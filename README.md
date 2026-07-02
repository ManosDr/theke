# theke
AI-powered assistant for Greek construction professionals. Ask permit questions, get instant answers with citations from official sources (ΦΕΚ, Law 4495/17, TEE, ΥΠΕΝ). Built with FastAPI, Next.js, PostgreSQL + pgvector, and RAG. Targeting SME engineering firms in Greece.

## Project structure

- `backend/` - FastAPI app (auth, chat/RAG, document search)
- `frontend/` - Next.js app (chat UI)
- `crawler/` - ingestion pipeline stubs for ΦΕΚ / ΥΠΕΝ / ΤΕΕ sources
- `db/init.sql` - Postgres + pgvector schema

## Getting started

```bash
cp .env.example .env
docker compose up --build
```

- Backend: http://localhost:8000/health
- Frontend: http://localhost:3000
- Postgres: localhost:5432 (pgvector enabled)

The crawler doesn't start automatically (it's a one-off/scheduled job). Run it manually with:

```bash
docker compose --profile crawler run --rm crawler
```

See [construction-ai-platform-blueprint.md](construction-ai-platform-blueprint.md) for the full roadmap.
