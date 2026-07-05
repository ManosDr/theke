import asyncio
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import SessionLocal
from app.routers import admin, auth, chat, companies, documents, notifications, projects, translations
from app.services.bootstrap import bootstrap_super_admin, seed_demo_data
from app.services.embeddings import embed_pending_documents

logger = logging.getLogger(__name__)

app = FastAPI(title="theke API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(admin.router)
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(companies.router)
app.include_router(companies.public_router)
app.include_router(documents.router)
app.include_router(notifications.router)
app.include_router(projects.router)
app.include_router(translations.router)


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
async def health() -> dict[str, str]:
    return {"status": "ok"}
