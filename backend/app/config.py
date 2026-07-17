from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://theke:changeme@localhost:5432/theke"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "changeme-dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15

    # Base URL the password-reset link is built against - the frontend's
    # origin, not this API's. Actually emailed when email_enabled is true
    # (see app/services/email.py); otherwise still logged rather than sent
    # (see app/routers/auth.py and KNOWN_DECISIONS.md).
    frontend_url: str = "http://localhost:3000"
    password_reset_token_expire_minutes: int = 60

    # Resend (https://resend.com) for transactional email - currently just
    # password-reset links (see app/services/email.py). email_enabled must
    # be explicitly set true in production; false means send_password_reset_
    # email() is a no-op and the caller falls back to logging the link, same
    # as before this was added.
    resend_api_key: str = ""
    email_from: str = "noreply@theke.ai"
    email_enabled: bool = False

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
    # Retrieval breadth - how many chunks get handed to GPT-4o for synthesis.
    # Raised from 6 to 10 so compound, multi-topic questions (e.g. "5 income
    # types, which DTAs apply") don't have a relevant chunk crowded out of
    # the window by chunks matching the question's other sub-topics - see
    # KNOWN_DECISIONS.md's stress-benchmark entries. Deliberately NOT also
    # used as the confidence-flag reference below - see rag_min_confident_hits.
    rag_top_k: int = 10

    # Softer inner bound used only by POST /chat/message's `gap` flag - a hit
    # beyond this still clears rag_max_distance (so an answer IS generated),
    # but is weak enough that the response should be presented as lower-
    # confidence rather than as solid as a comfortably-close match.
    rag_warn_distance: float = 0.45

    # Minimum hit count for a *confident* answer - deliberately a separate,
    # fixed number from rag_top_k, not the same value. If these were tied
    # together, raising rag_top_k (retrieval breadth, tuned for compound
    # questions) would silently also raise the bar for "enough hits to be
    # confident" - a narrow, well-answered question with 7-8 genuinely
    # relevant chunks would get flagged low-confidence purely because
    # rag_top_k grew, not because the answer is actually weaker. Keeps the
    # original calibrated value (6) as the confidence bar regardless of how
    # wide retrieval is.
    rag_min_confident_hits: int = 6

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

    # theke's own legal details, printed on every invoice it issues (see
    # app/services/invoices.py) - the "who is billing you" side of a valid
    # Greek τιμολόγιο. Deliberately left blank by default rather than
    # pre-filled with a placeholder: POST /admin/invoices refuses to
    # generate an invoice while business_afm is empty, so a real value must
    # be set via .env before the first real invoice can ever be issued -
    # see KNOWN_DECISIONS.md.
    business_name: str = ""
    business_afm: str = ""
    business_address: str = ""


settings = Settings()
