from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import admin, auth, chat, companies, documents, projects, translations
from app.services.bootstrap import bootstrap_super_admin, seed_demo_data

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
app.include_router(projects.router)
app.include_router(translations.router)


@app.on_event("startup")
async def on_startup() -> None:
    bootstrap_super_admin()
    seed_demo_data()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
