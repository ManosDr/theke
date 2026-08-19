import hashlib
import secrets
import string
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Excludes visually-ambiguous characters (0/O, 1/l/I) - a generated password
# is shown once and typed in manually by whoever reads it off the
# confirmation screen, so visual ambiguity there is a real support-ticket
# risk. Shared by both the super-admin (/admin/users/{id}/reset-password)
# and company-admin-scoped (/companies/me/users/{id}/reset-password) reset
# flows so they generate passwords the same way, not two divergent
# implementations.
_PASSWORD_ALPHABET = "".join(c for c in string.ascii_uppercase + string.ascii_lowercase + string.digits if c not in "0O1lI")


def generate_password(length: int = 12) -> str:
    return "".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(length))


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(*, user_id: int, company_id: int | None, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "company_id": company_id,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Invalid or expired token") from exc


def create_refresh_token() -> str:
    """A plain random opaque token, not a JWT - unlike the access token,
    nothing ever needs to decode this client-side (it's httpOnly, invisible
    to JS by design - see auth.py's cookie settings), and revocation has to
    be a real DB row lookup either way, which a JWT refresh token would
    still need on top of its own signature check. 48 bytes of entropy is
    generous for something with a 30-day lifetime."""
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str) -> str:
    """SHA-256, not bcrypt: this hash is looked up by equality (WHERE
    token_hash = ...) against however many live sessions exist, so it needs
    to be both deterministic (bcrypt's per-call salt means the same input
    hashes differently every time, making an equality lookup impossible)
    and fast (bcrypt is deliberately slow, which is the right trade for a
    low-entropy human password but wrong for a lookup key). The token
    itself already carries 48 bytes of real entropy from
    create_refresh_token() - a fast hash is fine here precisely because
    there's no low-entropy secret to protect against brute force, unlike a
    password hash."""
    return hashlib.sha256(token.encode()).hexdigest()
