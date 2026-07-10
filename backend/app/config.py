from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://theke:changeme@localhost:5432/theke"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "changeme-dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15

    # Base URL the password-reset link is built against - the frontend's
    # origin, not this API's. No email provider is configured yet, so the
    # link is logged rather than sent (see app/routers/auth.py and
    # KNOWN_DECISIONS.md).
    frontend_url: str = "http://localhost:3000"
    password_reset_token_expire_minutes: int = 60

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o"

    # Published per-1K-token pricing, USD - used only to estimate
    # chat_sessions.estimated_cost_eur for the admin usage screens (see
    # app/routers/chat.py's _log_session). Not billing-accurate: OpenAI's
    # actual invoice may differ slightly and these are not auto-updated.
    gpt4o_input_cost_per_1k: float = 0.0025
    gpt4o_output_cost_per_1k: float = 0.010
    usd_to_eur: float = 0.92

    # Cosine distance (pgvector's <=> operator) above which a retrieved chunk
    # is considered too weak to ground an answer - see app/services/rag.py.
    # Lower is stricter. text-embedding-3-small cosine distances for genuinely
    # relevant Greek legal/procedural text vs. a real question tend to land
    # well under this in practice; tune from real query logs once there are any.
    rag_max_distance: float = 0.5
    rag_top_k: int = 6

    # Softer inner bound used only by POST /chat/message's `gap` flag - a hit
    # beyond this still clears rag_max_distance (so an answer IS generated),
    # but is weak enough that the response should be presented as lower-
    # confidence rather than as solid as a comfortably-close match.
    rag_warn_distance: float = 0.45

    # If both set, a super_admin user is created on startup if it doesn't
    # already exist. There is no public endpoint that can mint a super_admin -
    # this out-of-band bootstrap is the only way one gets created.
    super_admin_email: str = ""
    super_admin_password: str = ""

    # Creates 5 fixed demo accounts (one per role) on startup if they don't
    # exist yet, so the login page's "try a demo account" buttons always
    # work in dev. Leave false for any real deployment.
    seed_demo_data: bool = False

    # "development" or "production" - gates things that are convenient in
    # dev but must not ship live (currently: /docs and /redoc, see
    # main.py). Not validated against the two literal values here since
    # pydantic-settings would just reject anything else at startup anyway.
    environment: str = "development"

    # Comma-separated list of allowed frontend origins for CORS (see
    # main.py). Defaults to the local dev frontend regardless of what
    # .env.example documents for production - an unset/missing var must
    # never silently widen access.
    cors_origins: str = "http://localhost:3000"


settings = Settings()
