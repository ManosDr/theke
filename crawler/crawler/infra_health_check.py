"""Weekly infra-health snapshot (see crawler/crontab) - system-wide pgvector
index monitoring, not billing enforcement. Queries the total chunk count
across the entire embeddings table (public KB + every company's uploaded
documents combined) and the on-disk size of the ivfflat/HNSW vector index,
classifies the reading against three fixed thresholds, and writes one row
to infra_health_checks (db/init.sql) every run so there's a trend line, not
just a point-in-time snapshot.

Thresholds are placeholders set from the actual baseline on 2026-07-17
(19,124 chunks / 162MB), at roughly 5x/10x/20x that volume - see
KNOWN_DECISIONS.md for the reasoning and when to revisit with real numbers.
This never blocks an upload or enforces anything - it only tells a human
(via a notification to every super admin, at warning/critical) that the
shared infrastructure itself may need attention. That decision belongs to
a human, not to this job.
"""

import psycopg

from crawler.config import DATABASE_URL

# Baseline: 19,124 chunks / 162MB on 2026-07-17 (the day this job was
# introduced). Deliberately round numbers at ~5x/10x/20x that volume, not
# precisely 5.000x - placeholders until real growth data justifies more
# precise thresholds.
THRESHOLD_WATCH_CHUNKS = 100_000
THRESHOLD_WARNING_CHUNKS = 200_000
THRESHOLD_CRITICAL_CHUNKS = 400_000


def _classify(total_chunks: int) -> str:
    if total_chunks >= THRESHOLD_CRITICAL_CHUNKS:
        return "critical"
    if total_chunks >= THRESHOLD_WARNING_CHUNKS:
        return "warning"
    return "watch"


def _vector_index_size_mb(conn: psycopg.Connection) -> float:
    """Finds whichever ivfflat/HNSW index actually exists on
    embeddings.embedding by access method rather than a hardcoded index
    name, so this survives a future ivfflat->HNSW migration or a rename
    without needing a code change."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT pg_relation_size(c.oid) FROM pg_class c "
            "JOIN pg_index i ON i.indexrelid = c.oid "
            "JOIN pg_am am ON am.oid = c.relam "
            "WHERE c.relkind = 'i' AND i.indrelid = 'embeddings'::regclass "
            "AND am.amname IN ('ivfflat', 'hnsw') LIMIT 1"
        )
        row = cur.fetchone()
    size_bytes = row[0] if row else 0
    return round(size_bytes / (1024 * 1024), 2)


def _notify_super_admins(conn: psycopg.Connection, level: str, total_chunks: int, index_size_mb: float) -> None:
    if level == "critical":
        title = "URGENT: pgvector index size critical - act this week"
        body = (
            f"Total chunks: {total_chunks:,} (critical threshold: {THRESHOLD_CRITICAL_CHUNKS:,}). "
            f"Index size: {index_size_mb:.1f}MB. Query latency is likely already degrading - "
            "this needs a Hetzner upgrade or index retuning this week, not next sprint."
        )
    else:
        title = "pgvector index size warning - plan a capacity upgrade"
        body = (
            f"Total chunks: {total_chunks:,} (warning threshold: {THRESHOLD_WARNING_CHUNKS:,}). "
            f"Index size: {index_size_mb:.1f}MB. Time to start planning a Hetzner upgrade or "
            "index retuning - not urgent yet, but don't let it slip."
        )
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM users WHERE role = 'super_admin' AND is_active = true")
        user_ids = [row[0] for row in cur.fetchall()]
        if not user_ids:
            return
        cur.executemany(
            "INSERT INTO notifications (user_id, type, title, body, link) VALUES (%s, %s, %s, %s, %s)",
            [(user_id, "infra_health_check", title, body, "/admin/infra-health") for user_id in user_ids],
        )
    conn.commit()


def run() -> None:
    conninfo = DATABASE_URL.replace("postgresql+psycopg://", "postgresql://")

    with psycopg.connect(conninfo) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM embeddings")
            total_chunks = cur.fetchone()[0]

        index_size_mb = _vector_index_size_mb(conn)
        level = _classify(total_chunks)

        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO infra_health_checks (total_chunks, index_size_mb, threshold_level) VALUES (%s, %s, %s)",
                (total_chunks, index_size_mb, level),
            )
        conn.commit()

        if level in ("warning", "critical"):
            _notify_super_admins(conn, level, total_chunks, index_size_mb)

    print(f"Infra health check complete: {total_chunks:,} chunks, {index_size_mb:.1f}MB index, level={level}")


if __name__ == "__main__":
    run()
