"""Pure, I/O-free logic shared between the backend and crawler services -
see contact_discovery.py and politeness_shared.py's module docstrings, and
KNOWN_DECISIONS.md's "crawler/backend discovery-logic duplication" entry for
why this exists and why it stops here (the HTTP-fetching wrappers on each
side stay separately implemented on purpose).

Reachable from both containers via docker-compose.yml's build context
(repo root) and each Dockerfile's explicit COPY of shared/theke_shared -
neither service pip-installs this as a package, it's just a sibling
directory on sys.path (Python adds the current directory to sys.path for
both `python -m crawler.main` and a uvicorn app run from WORKDIR /app).
"""
