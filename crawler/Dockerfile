FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl gnupg lsb-release \
    && rm -rf /var/lib/apt/lists/*

# postgresql-client-16 specifically (not Debian's stock postgresql-client,
# which trails the current major version) - nightly_backup.py's pg_dump
# needs to match docker-compose.yml's pgvector/pgvector:pg16 server, since
# an older client dumping a newer server's catalog is exactly the kind of
# gap you don't want to discover the day you actually need to restore.
RUN curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*

# supercronic: cron built for containers (stdout/stderr logging, no syslog,
# single static binary). Used by the `scheduler` compose service to run the
# crawler monthly without mounting the Docker socket into any container.
ENV SUPERCRONIC_VERSION=v0.2.46
ENV SUPERCRONIC_SHA1SUM=5bcefed628e32adc08e32634db2d10e9230dbca0
RUN curl -fsSLO "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-amd64" \
    && echo "${SUPERCRONIC_SHA1SUM}  supercronic-linux-amd64" | sha1sum -c - \
    && chmod +x supercronic-linux-amd64 \
    && mv supercronic-linux-amd64 /usr/local/bin/supercronic

COPY crawler/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY crawler/ .
# Pure logic shared with the backend service - see
# KNOWN_DECISIONS.md's "crawler/backend discovery-logic duplication" entry.
COPY shared/theke_shared ./theke_shared

CMD ["python", "-m", "crawler.main"]
