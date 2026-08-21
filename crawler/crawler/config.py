import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://theke:changeme@localhost:5432/theke"
).replace("postgresql+psycopg://", "postgresql://")

# Mirrors backend/app/config.py's Settings.resend_api_key/email_from/
# email_enabled - the crawler can't import that backend module (see
# weekly_digest.py), so it reads the same .env vars directly instead.
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "info@theke.ai")
EMAIL_ENABLED = os.environ.get("EMAIL_ENABLED", "false").lower() == "true"

# Forward-proxy URL (e.g. "http://user:pass@1.2.3.4:3128") for every outbound
# crawler fetch - see politeness.py's PoliteFetcher and KNOWN_DECISIONS.md's
# "Crawler egress decoupling" runbook. Unset by default: with no value here,
# PoliteFetcher makes requests directly (today's behavior, unchanged) - this
# only takes effect once a dedicated egress instance/proxy actually exists
# and this var is set on the server's own .env.
CRAWLER_PROXY_URL = os.environ.get("CRAWLER_PROXY_URL", "") or None
