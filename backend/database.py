from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool


logger = logging.getLogger("backend.database")

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"

# This module is the first to read configuration from the environment (e.g.
# AUTH_SECRET below), so .env must be loaded here rather than deep inside
# model_service.py - otherwise anything read before the ML stack's lazy
# import (auth, SMTP, rate limits, ...) would silently ignore a local .env.
load_dotenv(ROOT_DIR / ".env")

SCHEMA_PATH = ROOT_DIR / "database" / "schema.sql"
SEED_PATH = ROOT_DIR / "database" / "seed.sql"

# postgresql://utente:password@host:porta/database
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5432/assistente")
DB_POOL_MIN_SIZE = int(os.getenv("DB_POOL_MIN_SIZE", "1"))
DB_POOL_MAX_SIZE = int(os.getenv("DB_POOL_MAX_SIZE", "10"))

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV == "production"

_auth_secret_env = os.getenv("AUTH_SECRET")
if _auth_secret_env:
    TOKEN_SECRET = _auth_secret_env.encode("utf-8")
elif IS_PRODUCTION:
    raise RuntimeError(
        "AUTH_SECRET non impostata. In produzione (APP_ENV=production) e' obbligatorio "
        "definire un secret esplicito e stabile per la firma dei token di autenticazione."
    )
else:
    logger.warning(
        "AUTH_SECRET non impostata: uso un secret casuale generato a runtime (solo sviluppo). "
        "Tutte le sessioni emesse diventeranno invalide al riavvio del processo."
    )
    TOKEN_SECRET = secrets.token_bytes(32)

AUTH_TOKEN_TTL_SECONDS = int(os.getenv("AUTH_TOKEN_TTL_SECONDS", str(24 * 3600)))
AUTH_MAX_FAILED_ATTEMPTS = int(os.getenv("AUTH_MAX_FAILED_ATTEMPTS", "5"))
AUTH_LOCKOUT_SECONDS = int(os.getenv("AUTH_LOCKOUT_SECONDS", "900"))

# Short-lived token issued by /api/auth/login when 2FA is required, exchanged
# for a normal auth token by /api/auth/2fa/verify or /2fa/recovery.
TWO_FA_CHALLENGE_TTL_SECONDS = int(os.getenv("TWO_FA_CHALLENGE_TTL_SECONDS", "300"))
PASSWORD_RESET_TOKEN_TTL_SECONDS = int(os.getenv("PASSWORD_RESET_TOKEN_TTL_SECONDS", "1800"))
# Generous compared to an authenticator-app code, since the user has to wait
# for an email to arrive rather than reading a code already on screen.
TWO_FA_EMAIL_CODE_TTL_SECONDS = int(os.getenv("TWO_FA_EMAIL_CODE_TTL_SECONDS", "600"))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _epoch_now() -> int:
    return int(time.time())


# Every connection resolves unqualified table names in the `app` schema, so
# queries read `FROM users` rather than `FROM app.users`.
_CONNECTION_KWARGS = {"row_factory": dict_row, "options": "-c search_path=app,public"}

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ConnectionPool:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(
                DATABASE_URL,
                min_size=DB_POOL_MIN_SIZE,
                max_size=DB_POOL_MAX_SIZE,
                kwargs=_CONNECTION_KWARGS,
                open=True,
            )
        return _pool


def close_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


def connect():
    """Pooled connection as a context manager: commits when the block exits
    normally, rolls back if it raises, then returns the connection to the pool.

        with connect() as connection:
            connection.execute("SELECT ...", (value,)).fetchone()
    """
    return _get_pool().connection()


def init_db() -> None:
    """Applies database/schema.sql on an empty database (no `app` schema yet).

    Later schema changes are migrations, not re-runs of the whole script. The
    development operator accounts (database/seed.sql) are only inserted
    outside production, so a production database never ships default
    passwords.
    """
    with psycopg.connect(DATABASE_URL, autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'"
        ).fetchone()
        if exists:
            return
        logger.info("Schema non trovato: applico %s", SCHEMA_PATH)
        connection.execute(SCHEMA_PATH.read_text(encoding="utf-8"))
        if not IS_PRODUCTION:
            connection.execute(SEED_PATH.read_text(encoding="utf-8"))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 310_000)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        salt_hex, digest_hex = encoded.split("$", 1)
        expected = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 310_000)
        return hmac.compare_digest(expected.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def make_token(user_id: int, token_version: int) -> str:
    expires_at = _epoch_now() + AUTH_TOKEN_TTL_SECONDS
    payload = f"{user_id}:{token_version}:{expires_at}:{secrets.token_urlsafe(16)}"
    signature = hmac.new(TOKEN_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def decode_token(token: str) -> dict | None:
    try:
        payload, signature = token.rsplit(".", 1)
        expected = hmac.new(TOKEN_SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        user_id_str, token_version_str, expires_at_str, _nonce = payload.split(":", 3)
        expires_at = int(expires_at_str)
        if _epoch_now() >= expires_at:
            return None
        return {
            "user_id": int(user_id_str),
            "token_version": int(token_version_str),
            "expires_at": expires_at,
        }
    except (ValueError, TypeError):
        return None


def make_challenge_token(user_id: int) -> str:
    """Short-lived token proving "password was correct, 2FA still pending".

    Deliberately NOT decodable by decode_token(): the payload starts with a
    "2fa" marker instead of the numeric user id decode_token() expects to
    parse first, so a challenge token can never be accepted as a normal
    Authorization bearer token on a protected endpoint.
    """
    expires_at = _epoch_now() + TWO_FA_CHALLENGE_TTL_SECONDS
    payload = f"2fa:{user_id}:{expires_at}:{secrets.token_urlsafe(16)}"
    signature = hmac.new(TOKEN_SECRET, payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{signature}"


def decode_challenge_token(token: str) -> dict | None:
    try:
        payload, signature = token.rsplit(".", 1)
        expected = hmac.new(TOKEN_SECRET, payload.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        marker, user_id_str, expires_at_str, _nonce = payload.split(":", 3)
        if marker != "2fa":
            return None
        expires_at = int(expires_at_str)
        if _epoch_now() >= expires_at:
            return None
        return {"user_id": int(user_id_str), "expires_at": expires_at}
    except (ValueError, TypeError):
        return None


def hash_reset_token(token: str) -> str:
    """Plain SHA-256, no salt: unlike a password, the token already carries
    ~256 bits of entropy from secrets.token_urlsafe(32), so a fast hash is
    sufficient and lets the reset-password lookup go straight by hash."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def bump_token_version(connection: psycopg.Connection, user_id: int) -> None:
    connection.execute("UPDATE users SET token_version = token_version + 1 WHERE id = %s", (user_id,))


def is_locked(row: dict) -> bool:
    locked_until = row["locked_until"]
    return locked_until is not None and locked_until > utc_now()


def register_failed_login(connection: psycopg.Connection, user_id: int, current_attempts: int) -> None:
    attempts = current_attempts + 1
    locked_until = None
    if attempts >= AUTH_MAX_FAILED_ATTEMPTS:
        locked_until = datetime.fromtimestamp(_epoch_now() + AUTH_LOCKOUT_SECONDS, tz=timezone.utc)
    connection.execute(
        "UPDATE users SET failed_login_attempts = %s, locked_until = %s WHERE id = %s",
        (attempts, locked_until, user_id),
    )


def reset_failed_login(connection: psycopg.Connection, user_id: int) -> None:
    connection.execute(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = %s", (user_id,)
    )


def public_user(row: dict) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "company_domain": row["domain"],
    }
