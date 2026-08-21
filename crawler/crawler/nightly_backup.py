"""Nightly backup (see crawler/crontab) - a real pg_dump of the whole
database plus a tar.gz of the uploaded-documents volume, both uploaded to
Hetzner Object Storage (S3-compatible; see config.py's HETZNER_S3_* vars,
set from the real bucket/endpoint/keys in .env - gitignored, never
committed). Runs in the `scheduler` service, the only container with the
uploads_data volume mounted at the same path the backend writes to (see
docker-compose.yml) and network access to postgres.

Retention: keeps the most recent BACKUP_RETENTION_COUNT nightly RUNS (paired
db+uploads objects sharing one run timestamp), pruning older runs from the
bucket - not a separate expiry job, since a bucket listing is already the
one source of truth for what backups exist (no new DB table for something
this infrequent and this fully described by the bucket itself).

Failure alerting reuses the exact same super-admin in-app notification
pattern as data_source_health_check.py/spend_alert_check.py (see those
files) - not email, consistent with every other daily/weekly automated
infra check in this crontab (only weekly_digest.py sends real email, by
deliberate design - a human-curated weekly summary, not a routine alert).
A failed backup is print()ed with a non-zero exit too, so it's also visible
in supercronic's own stdout/stderr capture regardless of whether the DB
notify itself succeeds.
"""

import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import boto3
import psycopg
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from crawler.config import (
    BACKUP_RETENTION_COUNT,
    DATABASE_URL,
    HETZNER_S3_ACCESS_KEY,
    HETZNER_S3_BUCKET,
    HETZNER_S3_ENDPOINT,
    HETZNER_S3_SECRET_KEY,
    UPLOADS_DIR,
)

DB_PREFIX = "db-"
UPLOADS_PREFIX = "uploads-"


class BackupError(Exception):
    pass


def _s3_client():
    if not (HETZNER_S3_ACCESS_KEY and HETZNER_S3_SECRET_KEY and HETZNER_S3_BUCKET and HETZNER_S3_ENDPOINT):
        raise BackupError("Hetzner Object Storage credentials are not fully configured (HETZNER_S3_* in .env)")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{HETZNER_S3_ENDPOINT}",
        aws_access_key_id=HETZNER_S3_ACCESS_KEY,
        aws_secret_access_key=HETZNER_S3_SECRET_KEY,
        # Hetzner Object Storage is S3-compatible but path-style addressing
        # (bucket in the URL path, not a bucket.subdomain) is what its docs
        # specify - virtual-hosted-style (boto3's default) doesn't resolve.
        config=BotoConfig(s3={"addressing_style": "path"}),
    )


def _dump_database(dest: Path) -> None:
    """Custom-format (-Fc) pg_dump - already compressed, and restorable
    with pg_restore against a differently-named/configured target database,
    unlike a plain SQL dump tied to the exact original database name."""
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")
    result = subprocess.run(
        ["pg_dump", conninfo, "-Fc", "-f", str(dest)],
        capture_output=True,
        text=True,
        timeout=1800,
    )
    if result.returncode != 0:
        raise BackupError(f"pg_dump failed (exit {result.returncode}): {result.stderr.strip()[:2000]}")
    if not dest.exists() or dest.stat().st_size == 0:
        raise BackupError("pg_dump reported success but produced no output file")


def _archive_uploads(dest: Path) -> None:
    if not UPLOADS_DIR.exists():
        # Nothing uploaded yet on a fresh deployment - a real, expected
        # state, not a failure. An empty archive still gets uploaded so a
        # missing nightly object never looks like "the job didn't run".
        with tarfile.open(dest, "w:gz"):
            pass
        return
    with tarfile.open(dest, "w:gz") as tar:
        tar.add(UPLOADS_DIR, arcname="uploads")


def _upload(client, local_path: Path, key: str) -> None:
    try:
        client.upload_file(str(local_path), HETZNER_S3_BUCKET, key)
    except (BotoCoreError, ClientError) as exc:
        raise BackupError(f"Upload of {key} failed: {exc}") from exc


def _list_run_timestamps(client) -> list[str]:
    """Every run timestamp (the sortable YYYYMMDDTHHMMSSZ token in each
    object's key) that has a db- object in the bucket, newest first. Used
    both to decide what to prune and, in a forced-failure/verification run,
    to see exactly what's actually landed."""
    paginator = client.get_paginator("list_objects_v2")
    timestamps: set[str] = set()
    for page in paginator.paginate(Bucket=HETZNER_S3_BUCKET, Prefix=DB_PREFIX):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.startswith(DB_PREFIX) and key.endswith(".dump"):
                timestamps.add(key[len(DB_PREFIX):-len(".dump")])
    return sorted(timestamps, reverse=True)


def _prune_old_runs(client) -> list[str]:
    """Keeps the newest BACKUP_RETENTION_COUNT runs, deletes both objects
    (db + uploads) for every older one. A missing uploads- object for an old
    run (e.g. a prior partial failure) is tolerated silently - delete_object
    on a key that doesn't exist is not an error in S3's API."""
    timestamps = _list_run_timestamps(client)
    to_prune = timestamps[BACKUP_RETENTION_COUNT:]
    for ts in to_prune:
        for key in (f"{DB_PREFIX}{ts}.dump", f"{UPLOADS_PREFIX}{ts}.tar.gz"):
            try:
                client.delete_object(Bucket=HETZNER_S3_BUCKET, Key=key)
            except (BotoCoreError, ClientError) as exc:
                # Pruning failure is logged, not fatal - the backup that
                # just succeeded is real and must not be reported as failed
                # just because an old object was hard to delete.
                print(f"WARNING: failed to prune {key}: {exc}", file=sys.stderr)
    return to_prune


def _notify_super_admins_failure(conninfo: str, error: str) -> bool:
    """Same in-app-only pattern as data_source_health_check.py's
    _notify_super_admins - see that module's docstring for why routine
    automated alerts stay in-app rather than emailing."""
    title = "Το νυχτερινό αντίγραφο ασφαλείας απέτυχε"
    body = (
        f"Το nightly backup (pg_dump + αρχειοθέτηση uploads προς Hetzner Object Storage) απέτυχε.\n"
        f"Σφάλμα: {error}\n"
        "Ελέγξτε τα logs του scheduler container (crawler.nightly_backup) και επαληθεύστε "
        "χειροκίνητα το backup το συντομότερο - κάθε ημέρα χωρίς επιτυχές backup είναι ένα "
        "ακόμα παράθυρο πιθανής απώλειας δεδομένων."
    )
    try:
        with psycopg.connect(conninfo) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
                user_ids = [row[0] for row in cur.fetchall()]
                if not user_ids:
                    return False
                cur.executemany(
                    "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
                    [(user_id, "backup_failed", title, body, "/admin") for user_id in user_ids],
                )
            conn.commit()
        return True
    except psycopg.Error as exc:
        # The backup alert itself failing to send must not raise past this
        # point - the caller already has a non-zero exit and a stderr line
        # from the original failure, which is what supercronic surfaces.
        print(f"WARNING: failed to send backup-failure notification: {exc}", file=sys.stderr)
        return False


def run() -> int:
    run_ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    try:
        client = _s3_client()
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / f"{DB_PREFIX}{run_ts}.dump"
            uploads_path = Path(tmp) / f"{UPLOADS_PREFIX}{run_ts}.tar.gz"

            _dump_database(db_path)
            _archive_uploads(uploads_path)

            _upload(client, db_path, db_path.name)
            _upload(client, uploads_path, uploads_path.name)

            db_size = db_path.stat().st_size
            uploads_size = uploads_path.stat().st_size

        pruned = _prune_old_runs(client)
        print(
            f"Nightly backup complete: run={run_ts}, db_bytes={db_size}, "
            f"uploads_bytes={uploads_size}, pruned_runs={len(pruned)}"
        )
        return 0
    except BackupError as exc:
        print(f"ERROR: nightly backup failed: {exc}", file=sys.stderr)
        _notify_super_admins_failure(conninfo, str(exc))
        return 1
    except Exception as exc:  # noqa: BLE001 - anything unexpected must still alert, not vanish silently
        print(f"ERROR: nightly backup failed unexpectedly: {exc!r}", file=sys.stderr)
        _notify_super_admins_failure(conninfo, repr(exc))
        return 1


if __name__ == "__main__":
    sys.exit(run())
