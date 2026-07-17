import asyncio
import logging

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal, get_db
from app.models import Document
from app.routers import (
    account,
    admin,
    auth,
    chat,
    companies,
    customers,
    documents,
    gis,
    invoices,
    legal,
    notifications,
    plan_requests,
    plans,
    projects,
    search,
    subscription,
    translations,
    user_feedback,
    users,
)
from app.services.bootstrap import bootstrap_super_admin, seed_demo_data
from app.services.embeddings import embed_pending_documents

# Root logger defaults to WARNING with no handler configured, which was
# silently swallowing every app-level logger.info() call (the embedding
# backfill summary, and now the password-reset link log) - confirmed via
# `docker logs` never showing them despite the code running correctly.
# Uvicorn's own loggers are unaffected either way (it configures those
# itself); this only affects our own `logging.getLogger(__name__)` calls.
logging.basicConfig(level=logging.INFO)

logger = logging.getLogger(__name__)

# /docs and /redoc expose the full API schema (every route, every field) -
# convenient in dev, not something a production deployment should serve
# publicly. Gated on ENVIRONMENT rather than removed outright so local dev
# keeps them by default (see app/config.py).
_is_production = settings.environment == "production"
app = FastAPI(
    title="theke API",
    version="0.1.0",
    docs_url=None if _is_production else "/docs",
    redoc_url=None if _is_production else "/redoc",
    # Explicit, not just relying on FastAPI's own default - debug mode
    # renders unhandled-exception tracebacks straight into HTTP responses,
    # which must never happen in production and has no real use in this
    # project's dev workflow either (uvicorn --reload already covers dev
    # convenience).
    debug=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()],
    # Dev-only convenience: the preview tool's autoPort assigns a fresh
    # random localhost port per session (whenever :3000 is already taken by
    # the real docker-compose frontend), so a fixed allow_origins entry
    # would need updating every time. Regex-matching any localhost port is
    # never enabled in production - the explicit allow_origins list above
    # is what actually matters there.
    allow_origin_regex=None if _is_production else r"http://localhost:\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(account.router)
app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(companies.router)
app.include_router(companies.public_router)
app.include_router(customers.router)
app.include_router(documents.router)
app.include_router(gis.router)
app.include_router(invoices.router)
app.include_router(legal.router)
app.include_router(notifications.router)
app.include_router(plan_requests.router)
app.include_router(plans.router)
app.include_router(projects.router)
app.include_router(search.router)
app.include_router(subscription.router)
app.include_router(translations.router)
app.include_router(user_feedback.router)
app.include_router(users.router)


def _run_embedding_backfill() -> None:
    """Catch-up sweep for any full_text document that isn't embedded yet -
    the initial 200+ document backfill, and (on every subsequent restart)
    anything the crawler ingested since. Not hooked directly into the
    crawler itself: the crawler is a separate process/dependency stack with
    no OpenAI client, so "runs on backend startup/restart" is the deliberate
    stand-in for "runs automatically on ingest" (see KNOWN_DECISIONS.md)."""
    db = SessionLocal()
    try:
        result = embed_pending_documents(db)
        logger.info("Embedding backfill: %s", result)
    except Exception:
        logger.exception("Embedding backfill failed")
    finally:
        db.close()


@app.on_event("startup")
async def on_startup() -> None:
    bootstrap_super_admin()
    seed_demo_data()
    asyncio.create_task(asyncio.to_thread(_run_embedding_backfill))


@app.get("/health")
async def health(db: Session = Depends(get_db)) -> dict:
    """Deliberately does a real query, not just a bare 200 - a misconfigured
    DATABASE_URL (wrong host/credentials after a deploy) would otherwise
    still return 200 here, since the connection pool is lazy and nothing
    else touches it until the first real request. active_documents is a
    cheap, meaningful number to eyeball post-deploy: 0 on a fresh KB is
    expected, 0 on a DB that should have thousands is a red flag."""
    try:
        active_documents = db.scalar(select(func.count()).select_from(Document).where(Document.status == "active"))
    except Exception as exc:
        logger.error("Health check DB query failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable") from exc
    return {"status": "ok", "database": "connected", "active_documents": active_documents}
