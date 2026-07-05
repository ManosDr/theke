#!/usr/bin/env bash
# Dump the production Postgres database to a timestamped, gzipped file and
# prune anything past the last 7. Meant to run from cron - logs to a file
# rather than stdout (cron output is easy to lose), and its own exit code
# reflects whether the dump actually succeeded (not just whether gzip ran).
#
# Example crontab entry (daily at 03:00, full path since cron's PATH is
# minimal):
#   0 3 * * * /path/to/theke/scripts/backup.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="${BACKUP_DIR:-$REPO_ROOT/backups}"
LOG_FILE="${BACKUP_LOG_FILE:-$BACKUP_DIR/backup.log}"
KEEP_LAST=7
TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
DUMP_FILE="$BACKUP_DIR/theke_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*" >> "$LOG_FILE"; }

set -a
# shellcheck disable=SC1091
source .env
set +a

if docker compose -f "$COMPOSE_FILE" exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" | gzip > "$DUMP_FILE"; then
    log "SUCCESS: backup written to $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
else
    rm -f "$DUMP_FILE"
    log "FAILURE: pg_dump failed, no backup written"
    exit 1
fi

# Keep only the last KEEP_LAST backups - relies on the timestamp prefix
# sorting lexicographically the same as chronologically (it does: ISO 8601).
mapfile -t old_backups < <(ls -1 "$BACKUP_DIR"/theke_*.sql.gz 2>/dev/null | sort -r | tail -n "+$((KEEP_LAST + 1))")
for old in "${old_backups[@]:-}"; do
    [ -z "$old" ] && continue
    rm -f "$old"
    log "Removed old backup: $old"
done
