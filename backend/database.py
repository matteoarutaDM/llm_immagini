from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv


logger = logging.getLogger("backend.database")

ROOT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT_DIR / "data"

# This module is the first to read configuration from the environment (e.g.
# AUTH_SECRET below), so .env must be loaded here rather than deep inside
# model_service.py - otherwise anything read before the ML stack's lazy
# import (auth, SMTP, rate limits, ...) would silently ignore a local .env.
load_dotenv(ROOT_DIR / ".env")

DB_PATH = Path(os.getenv("DATABASE_PATH", DATA_DIR / "app.db"))

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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _epoch_now() -> int:
    return int(time.time())


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    # WAL + busy_timeout let concurrent requests read/write without hitting
    # "database is locked" errors under the FastAPI thread pool.
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    return connection


SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    company_id INTEGER REFERENCES companies(id),
    token_version INTEGER NOT NULL DEFAULT 0,
    failed_login_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    terms_accepted_at TEXT,
    two_factor_enabled INTEGER NOT NULL DEFAULT 0,
    two_factor_secret TEXT,
    two_factor_pending_secret TEXT,
    two_factor_confirmed_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS two_factor_email_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('enable', 'login', 'disable', 'regenerate')),
    code_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    knowledge_mode TEXT NOT NULL CHECK(knowledge_mode IN ('base', 'merged')),
    company_document_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexed', 'failed')),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_recovery_codes_user_id ON user_recovery_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_two_factor_email_codes_user_id ON two_factor_email_codes(user_id);
"""


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
    ).fetchone()
    return row is not None


def _column_names(connection: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})").fetchall()}


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, ddl: str) -> None:
    if column not in _column_names(connection, table):
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def init_db() -> None:
    with connect() as connection:
        users_table_existed = _table_exists(connection, "users")

        connection.executescript(SCHEMA)

        _ensure_column(connection, "documents", "status", "status TEXT NOT NULL DEFAULT 'indexed'")

        _ensure_column(connection, "users", "token_version", "token_version INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "users", "failed_login_attempts", "failed_login_attempts INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "users", "locked_until", "locked_until TEXT")
        _ensure_column(connection, "users", "two_factor_enabled", "two_factor_enabled INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "users", "two_factor_secret", "two_factor_secret TEXT")
        _ensure_column(connection, "users", "two_factor_pending_secret", "two_factor_pending_secret TEXT")
        _ensure_column(connection, "users", "two_factor_confirmed_at", "two_factor_confirmed_at TEXT")

        # Accounts created before the terms/privacy checkbox existed could not
        # have accepted it, so we
        # grandfather them in using their original signup date rather than
        # leaving them with a null (and thus seemingly "never consented") value.
        if users_table_existed and "terms_accepted_at" not in _column_names(connection, "users"):
            _ensure_column(connection, "users", "terms_accepted_at", "terms_accepted_at TEXT")
            connection.execute("UPDATE users SET terms_accepted_at = created_at WHERE terms_accepted_at IS NULL")
        else:
            _ensure_column(connection, "users", "terms_accepted_at", "terms_accepted_at TEXT")


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


def bump_token_version(connection: sqlite3.Connection, user_id: int) -> None:
    connection.execute("UPDATE users SET token_version = token_version + 1 WHERE id = ?", (user_id,))


def is_locked(row: sqlite3.Row) -> bool:
    locked_until = row["locked_until"]
    if not locked_until:
        return False
    return datetime.fromisoformat(locked_until) > datetime.now(timezone.utc)


def register_failed_login(connection: sqlite3.Connection, user_id: int, current_attempts: int) -> None:
    attempts = current_attempts + 1
    locked_until = None
    if attempts >= AUTH_MAX_FAILED_ATTEMPTS:
        locked_until = datetime.fromtimestamp(
            _epoch_now() + AUTH_LOCKOUT_SECONDS, tz=timezone.utc
        ).isoformat()
    connection.execute(
        "UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?",
        (attempts, locked_until, user_id),
    )


def reset_failed_login(connection: sqlite3.Connection, user_id: int) -> None:
    connection.execute(
        "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?", (user_id,)
    )


def public_user(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "company_domain": row["domain"],
    }
