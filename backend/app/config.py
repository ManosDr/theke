from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://theke:changeme@localhost:5432/theke"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "changeme-dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o"

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


settings = Settings()
