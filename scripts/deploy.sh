#!/usr/bin/env bash
# Deploy theke to this host: pull latest main, rebuild + restart the
# production stack, apply any schema changes, then confirm the app is
# actually serving before declaring success.
#
# Run from anywhere - resolves the repo root from this script's own
# location. Expects .env and docker-compose.prod.yml to already exist in
# the repo root (see infra/nginx.conf's header comment for the one-time
# SSL bootstrap this script does NOT handle).
#
# --- STANDING RULE: bind-mounted config/data files and container restarts
#     (see KNOWN_DECISIONS.md's matching entry for the full writeup) ---
#
# Any file mounted into a container via a bind mount (not baked into the
# image at build time) can go stale after `git pull` - the container keeps
# serving whatever it read at its own last startup, even though the file on
# disk has changed. `docker compose up -d` does NOT fix this on its own: it
# only recreates a container whose own image/service definition changed,
# and a bind-mounted file's *content* changing isn't part of that. This has
# bitten this project twice - db/init.sql (postgres) and nginx.conf
# (nginx), both silently serving outdated content with no error, discovered
# only by chance.
#
# Before adding any new bind-mounted file to docker-compose.prod.yml, or
# changing what an existing bind-mounted file controls:
#   1. Add an explicit restart step for the consuming container below -
#      do not assume `docker compose up -d --build` naturally restarts a
#      container whose own image/service definition didn't change.
#   2. Verify the restart actually applies the new file's content on a real
#      deploy run - don't just add the restart line and assume it works;
#      confirm post-restart state matches the current file on disk.
#   3. If a file is bind-mounted read-only (:ro) specifically because it's
#      meant to be edited on the server directly (rare, and generally a
#      pattern to avoid) - document why explicitly, since it breaks the
#      normal git-is-source-of-truth deploy model and creates exactly the
#      kind of silent server-side drift already found and fixed twice.
#
# Current restart coverage below (audit this list whenever a new
# bind-mounted file is added to docker-compose.prod.yml - it should stay
# in sync):
#   - postgres  (db/init.sql)
#   - nginx     (infra/nginx.conf)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker-compose.prod.yml"
HEALTH_URL="http://127.0.0.1:8000/health"
HEALTH_TIMEOUT_SECONDS=60
HEALTH_POLL_INTERVAL=3

log() { echo "[deploy] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

log "Pulling latest main..."
git fetch origin main
git checkout main
git pull --ff-only origin main

log "Building and starting production stack..."
docker compose -f "$COMPOSE_FILE" up --build -d

# `up -d` only recreates containers whose image/config changed - postgres's
# never does, so it can stay running across many deploys without a restart.
# Docker's single-file bind mount (./db/init.sql -> .../init.sql) is bound
# to the inode that existed when the container started; `git pull` above
# replaces the file via unlink+rename (a new inode), which orphans that
# mount. The result: the schema-apply step below can silently run against a
# stale, pre-pull copy of init.sql inside an already-running postgres
# container - no error, just whatever migration statements were added since
# get skipped. Restarting postgres on every deploy re-establishes the bind
# mount against the current file so this can't happen. Safe/cheap: schema
# and data live in the separate postgres_data named volume, untouched by
# container recreation.
log "Restarting postgres to pick up the current db/init.sql (single-file bind mounts don't follow git's replace-via-rename)..."
docker compose -f "$COMPOSE_FILE" restart postgres

log "Waiting for postgres to be healthy..."
until [ "$(docker compose -f "$COMPOSE_FILE" ps --format '{{.Health}}' postgres 2>/dev/null)" = "healthy" ]; do
    sleep 2
done

# No real migration framework yet (see KNOWN_DECISIONS.md) - db/init.sql is
# written to be safe to re-run against an already-populated database
# (CREATE TABLE/INDEX IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING), so
# reapplying it here is how a schema change added since the last deploy
# actually reaches an existing production database (the file only runs
# automatically via Postgres's own initdb hook on a brand-new, empty volume).
log "Applying schema (idempotent - safe on every deploy)..."
set -a
# shellcheck disable=SC1091
source .env
set +a
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/init.sql

log "Waiting for the app to respond healthy at $HEALTH_URL (up to ${HEALTH_TIMEOUT_SECONDS}s)..."
elapsed=0
until response="$(curl -fsS "$HEALTH_URL" 2>/dev/null)"; do
    elapsed=$((elapsed + HEALTH_POLL_INTERVAL))
    if [ "$elapsed" -ge "$HEALTH_TIMEOUT_SECONDS" ]; then
        log "FAILED: $HEALTH_URL never returned a healthy response within ${HEALTH_TIMEOUT_SECONDS}s."
        log "Recent backend logs:"
        docker compose -f "$COMPOSE_FILE" logs --tail=50 backend
        exit 1
    fi
    sleep "$HEALTH_POLL_INTERVAL"
done

# Same single-file bind-mount staleness class as db/init.sql above:
# infra/nginx.conf is bind-mounted read-only into nginx, `up -d` won't
# recreate the nginx container just because the mounted file's content
# changed (image/service config are unchanged), and nginx's own inode stays
# pinned to whatever `git pull` replaced it with via unlink+rename. Restart
# unconditionally so a future infra/nginx.conf edit actually takes effect
# instead of silently continuing to serve the pre-pull config.
log "Restarting nginx to pick up the current infra/nginx.conf (same bind-mount staleness issue as db/init.sql)..."
docker compose -f "$COMPOSE_FILE" restart nginx

log "Health check passed: $response"
log "Deploy complete."
