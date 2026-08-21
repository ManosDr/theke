import os
from pathlib import Path

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

# --- Nightly backups (see crawler/nightly_backup.py) ---
# Hetzner Object Storage (S3-compatible) - real values live only in the
# server's own .env (gitignored, never committed - see README/KNOWN_
# DECISIONS.md on secret handling). All four blank means nightly_backup.py
# fails loudly (BackupError) rather than silently skipping the run.
HETZNER_S3_ACCESS_KEY = os.environ.get("HETZNER_S3_ACCESS_KEY", "")
HETZNER_S3_SECRET_KEY = os.environ.get("HETZNER_S3_SECRET_KEY", "")
HETZNER_S3_BUCKET = os.environ.get("HETZNER_S3_BUCKET", "")
HETZNER_S3_ENDPOINT = os.environ.get("HETZNER_S3_ENDPOINT", "")
# Nightly RUNS to retain (a run = one db dump + one uploads archive sharing
# a timestamp), not raw object count - see nightly_backup.py's _prune_old_runs.
BACKUP_RETENTION_COUNT = int(os.environ.get("BACKUP_RETENTION_COUNT", "30"))
# Same path the backend container writes to (docker-compose.yml's
# uploads_data volume, mounted at /app/uploads in both backend and
# scheduler) - the scheduler is the only cron-running service with this
# volume attached, which is why nightly_backup.py runs there.
UPLOADS_DIR = Path(os.environ.get("UPLOADS_DIR", "/app/uploads"))
