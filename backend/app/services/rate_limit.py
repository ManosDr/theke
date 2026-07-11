"""Login failure rate limiting, backed by the Redis instance that's been in
docker-compose/config.py since early on but never actually used by any app
code until now.

Implemented directly against redis-py rather than slowapi: slowapi's request-
rate limiting doesn't distinguish failed attempts from successful ones, and
this needs to count only failures (a correct password shouldn't count
towards the cap) - a plain INCR/EXPIRE key per IP is a few lines and needs
no new dependency, since redis==5.0.6 is already in requirements.txt.
"""

import redis

from app.config import settings

LOGIN_FAILURE_LIMIT = 5
LOGIN_FAILURE_WINDOW_SECONDS = 15 * 60

_client: redis.Redis | None = None


def _get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def _key(ip: str) -> str:
    return f"login_fail:{ip}"


def seconds_until_login_unlocked(ip: str) -> int | None:
    """Returns remaining lockout seconds if this IP has hit the failure cap
    within the current window, else None (not locked out)."""
    client = _get_client()
    count = client.get(_key(ip))
    if count is None or int(count) < LOGIN_FAILURE_LIMIT:
        return None
    ttl = client.ttl(_key(ip))
    return ttl if ttl > 0 else LOGIN_FAILURE_WINDOW_SECONDS


def record_login_failure(ip: str) -> None:
    client = _get_client()
    key = _key(ip)
    count = client.incr(key)
    if count == 1:
        client.expire(key, LOGIN_FAILURE_WINDOW_SECONDS)


def reset_login_failures(ip: str) -> None:
    _get_client().delete(_key(ip))


# Chat message rate limiting: unlike the login lockout above (which counts
# only failures), every attempt through /chat/message costs a real OpenAI
# call, so this counts all attempts that pass validation - keyed by user_id
# rather than IP, since this is an authenticated endpoint and IP-keying
# would let one user exhaust another's budget behind a shared NAT/proxy.
CHAT_MESSAGE_LIMIT = 20
CHAT_MESSAGE_WINDOW_SECONDS = 60 * 60


def _chat_key(user_id: int) -> str:
    return f"chat_msg:{user_id}"


def check_chat_rate_limit(user_id: int) -> bool:
    """Increments this user's message count for the current fixed hour
    window and returns whether they're still within CHAT_MESSAGE_LIMIT.
    Fixed window (not sliding), same INCR/EXPIRE-on-first-hit shape as the
    login lockout above - simplest thing that resets predictably."""
    client = _get_client()
    key = _chat_key(user_id)
    count = client.incr(key)
    if count == 1:
        client.expire(key, CHAT_MESSAGE_WINDOW_SECONDS)
    return count <= CHAT_MESSAGE_LIMIT


def get_chat_rate_limit_status(user_id: int) -> tuple[int, int]:
    """(used, resets_in_seconds) for display, not enforcement - reads the
    counter without incrementing it, unlike check_chat_rate_limit above. No
    key yet this hour means 0 used and the full window still ahead."""
    client = _get_client()
    key = _chat_key(user_id)
    count = client.get(key)
    used = int(count) if count is not None else 0
    ttl = client.ttl(key)
    resets_in = ttl if ttl and ttl > 0 else CHAT_MESSAGE_WINDOW_SECONDS
    return used, resets_in
