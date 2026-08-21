#!/usr/bin/env bash
# ALWAYS use this instead of calling `docker compose -f docker-compose.prod.yml`
# directly on the server - for ANY ad hoc production operation (proxy/env
# changes, --force-recreate, restart, stop/start, whatever). This is not a
# style preference: a raw `docker compose ... --force-recreate scheduler
# crawler` run outside scripts/deploy.sh is exactly what caused a real
# ~3h20m production login outage on 2026-08-21 (see KNOWN_DECISIONS.md) -
# it silently recreated `backend` too (Compose detected the shared .env had
# drifted), giving it a new internal Docker IP that nginx never re-resolved
# because nothing restarted nginx afterward. scripts/deploy.sh was already
# safe from this (it restarts nginx unconditionally, for an unrelated
# bind-mount-staleness reason - see its own header), but that safety only
# covers deploy.sh's own code path. This script is the same safety net for
# every OTHER production docker compose invocation, so "remember to restart
# nginx if you touch backend" stops being a rule a human or an agent has to
# recall in the moment - it's automatic and detected, not remembered.
#
# What it does, automatically, regardless of which subcommand you pass:
#   1. Records backend's current container ID before your command runs
#      (empty string if backend isn't running at all).
#   2. Runs your actual docker compose command, passed through verbatim.
#   3. Re-checks backend's container ID afterward. If it changed - recreated,
#      for ANY reason, not just ones this script already knows about -
#      restarts nginx to clear its stale cached upstream IP.
#   4. ALWAYS runs a real end-to-end smoke test afterward, regardless of
#      whether backend changed: an actual HTTPS request to the public login
#      page, plus a real (deliberately-wrong-credentials) POST to
#      /api/auth/login, checked for a genuine 401 - not just "the container
#      is running" or an internal /health check. Both of those would have
#      reported everything fine throughout the entire 2026-08-21 outage,
#      since backend itself was perfectly healthy the whole time; only
#      nginx's path *to* it was broken. A 502 here means nginx can't reach
#      backend - exactly the failure mode this script exists to catch
#      immediately instead of three hours later when a real user reports it.
#
# Usage: scripts/docker-compose-prod.sh <any normal docker compose args>
# e.g.:  scripts/docker-compose-prod.sh up -d --force-recreate scheduler crawler
# e.g.:  scripts/docker-compose-prod.sh restart backend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker-compose.prod.yml"
PUBLIC_URL="https://theke.ai"

log() { echo "[docker-compose-prod] $(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <docker compose args>  e.g. $0 up -d --force-recreate scheduler" >&2
    exit 1
fi

get_backend_id() {
    docker compose -f "$COMPOSE_FILE" ps -q backend 2>/dev/null || true
}

before_id="$(get_backend_id)"

log "Running: docker compose -f $COMPOSE_FILE $*"
docker compose -f "$COMPOSE_FILE" "$@"

after_id="$(get_backend_id)"

if [ -n "$after_id" ] && [ "$before_id" != "$after_id" ]; then
    log "backend container identity changed (${before_id:-<not running>} -> $after_id) - restarting nginx to clear its stale cached upstream IP."
    docker compose -f "$COMPOSE_FILE" restart nginx
    sleep 2
else
    log "backend container identity unchanged - no nginx restart needed for that reason, but running the smoke test anyway."
fi

log "Running real smoke test against $PUBLIC_URL (public HTTPS path through nginx, not an internal /health check)..."
login_page_code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/login" || echo "000")"
login_post_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PUBLIC_URL/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"email":"smoketest@invalid.example","password":"deliberately-wrong"}' || echo "000")"

if [ "$login_page_code" != "200" ] || [ "$login_post_code" != "401" ]; then
    log "SMOKE TEST FAILED: GET /login=$login_page_code (want 200), POST /api/auth/login=$login_post_code (want 401 - a 502 means nginx can't reach backend, 000 means no response at all)."
    log "Production is likely broken right now - investigate before walking away from this."
    exit 1
fi

log "Smoke test passed: GET /login=200, POST /api/auth/login=401 (a real auth rejection reached the app, not a proxy failure). Production is confirmed reachable end-to-end."
