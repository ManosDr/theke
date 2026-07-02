FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
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

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "-m", "crawler.main"]
