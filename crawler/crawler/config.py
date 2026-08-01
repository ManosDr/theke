import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://theke:changeme@localhost:5432/theke"
).replace("postgresql+psycopg://", "postgresql://")

# Mirrors backend/app/config.py's Settings.resend_api_key/email_from/
# email_enabled - the crawler can't import that backend module (see
# weekly_digest.py), so it reads the same .env vars directly instead.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "noreply@theke.ai")
EMAIL_ENABLED = os.environ.get("EMAIL_ENABLED", "false").lower() == "true"
