from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://theke:changeme@localhost:5432/theke"
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret: str = "changeme-dev-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-ada-002"
    chat_model: str = "gpt-4o"

    # If both set, a super_admin user is created on startup if it doesn't
    # already exist. There is no public endpoint that can mint a super_admin -
    # this out-of-band bootstrap is the only way one gets created.
    super_admin_email: str = ""
    super_admin_password: str = ""


settings = Settings()
