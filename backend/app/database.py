from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

# connect_timeout bounds a brand-new TCP handshake; statement_timeout (set
# via libpq's `options`) bounds every query on the connection, including
# pool_pre_ping's own "SELECT 1" - without it, a DB that's frozen rather
# than cleanly down (e.g. `docker pause`, a stuck replica, a network
# partition) leaves an already-established connection accepting no
# response, and pre-ping waits on that dead socket forever instead of
# detecting it's dead. Confirmed live during Section 9.3 testing: /health
# hung 45s+ with no response under `docker pause theke-postgres-1`, rather
# than the expected fast 503. 10s is generous for anything this app does.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={
        "connect_timeout": 5,
        "options": "-c statement_timeout=10000",
        # statement_timeout alone doesn't help against a frozen (not just
        # slow) postgres process - `docker pause` suspends postgres via the
        # cgroup freezer, so there's no server-side code running to enforce
        # its own timeout. TCP keepalives are enforced by the kernel on the
        # client side instead, so they still detect a dead peer even when
        # the peer process can't respond at all: after keepalives_idle
        # seconds of silence, probe every keepalives_interval seconds, give
        # up after keepalives_count failures.
        "keepalives": 1,
        "keepalives_idle": 3,
        "keepalives_interval": 2,
        "keepalives_count": 2,
    },
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
