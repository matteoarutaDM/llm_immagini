from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import secrets
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from psycopg import Connection, errors as pg_errors
from psycopg.types.json import Jsonb

from backend import email_service
from backend.auth import CurrentUser, email_domain
from backend.database import (
    PASSWORD_RESET_TOKEN_TTL_SECONDS,
    TWO_FA_EMAIL_CODE_TTL_SECONDS,
    bump_token_version,
    connect,
    decode_challenge_token,
    hash_password,
    hash_reset_token,
    init_db,
    is_locked,
    make_challenge_token,
    make_token,
    register_failed_login,
    reset_failed_login,
    utc_now,
    verify_password,
)
from backend.public_email_domains import is_public_domain
from backend.rate_limit import SlidingWindowRateLimiter
from backend.two_factor_service import generate_email_code, generate_recovery_codes


# Uvicorn configures its own loggers but not the application loggers.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger("backend.main")

COMPANY_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "companies"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "30")) * 1024 * 1024
PDF_MAGIC_BYTES = b"%PDF-"

RATE_LIMIT_LOGIN_MAX = int(os.getenv("RATE_LIMIT_LOGIN_MAX", "10"))
RATE_LIMIT_LOGIN_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_LOGIN_WINDOW_SECONDS", "60"))
RATE_LIMIT_REGISTER_MAX = int(os.getenv("RATE_LIMIT_REGISTER_MAX", "5"))
RATE_LIMIT_REGISTER_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_REGISTER_WINDOW_SECONDS", "60"))
RATE_LIMIT_ASK_MAX = int(os.getenv("RATE_LIMIT_ASK_MAX", "20"))
RATE_LIMIT_ASK_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_ASK_WINDOW_SECONDS", "60"))
RATE_LIMIT_2FA_MAX = int(os.getenv("RATE_LIMIT_2FA_MAX", "10"))
RATE_LIMIT_2FA_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_2FA_WINDOW_SECONDS", "300"))
RATE_LIMIT_2FA_SEND_MAX = int(os.getenv("RATE_LIMIT_2FA_SEND_MAX", "5"))
RATE_LIMIT_2FA_SEND_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_2FA_SEND_WINDOW_SECONDS", "300"))
RATE_LIMIT_FORGOT_PASSWORD_MAX = int(os.getenv("RATE_LIMIT_FORGOT_PASSWORD_MAX", "5"))
RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS", "300"))

MIN_PASSWORD_LENGTH = 8
# Bounds PBKDF2's per-request cost: without a cap, an attacker could submit a
# multi-megabyte "password" and force the server to hash it 310k times.
MAX_PASSWORD_LENGTH = 128

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# Shared secret for server-to-server calls from the backoffice (Next.js).
# Unset = the /internal endpoints are disabled.
BACKOFFICE_API_TOKEN = os.getenv("BACKOFFICE_API_TOKEN", "").strip()

# Fixed dummy hash used to keep the login endpoint's timing constant whether
# or not the email exists (see login()). Computed once at import time.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))

_login_limiter = SlidingWindowRateLimiter(RATE_LIMIT_LOGIN_MAX, RATE_LIMIT_LOGIN_WINDOW_SECONDS)
_register_limiter = SlidingWindowRateLimiter(RATE_LIMIT_REGISTER_MAX, RATE_LIMIT_REGISTER_WINDOW_SECONDS)
_ask_limiter = SlidingWindowRateLimiter(RATE_LIMIT_ASK_MAX, RATE_LIMIT_ASK_WINDOW_SECONDS)
_2fa_verify_limiter = SlidingWindowRateLimiter(RATE_LIMIT_2FA_MAX, RATE_LIMIT_2FA_WINDOW_SECONDS)
_2fa_recovery_limiter = SlidingWindowRateLimiter(RATE_LIMIT_2FA_MAX, RATE_LIMIT_2FA_WINDOW_SECONDS)
# Separate from the verify/recovery limiters above: this one guards how often
# a *new* code can be emailed out (login resend, setup, disable, regenerate),
# so it protects against inbox spam rather than code-guessing.
_2fa_send_limiter = SlidingWindowRateLimiter(RATE_LIMIT_2FA_SEND_MAX, RATE_LIMIT_2FA_SEND_WINDOW_SECONDS)
# Two separate limiter instances (not two keys on one instance) so an attacker
# flooding many distinct emails from one IP and a spammer hitting one victim's
# email from many IPs are both capped independently.
_forgot_password_ip_limiter = SlidingWindowRateLimiter(
    RATE_LIMIT_FORGOT_PASSWORD_MAX, RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS
)
_forgot_password_email_limiter = SlidingWindowRateLimiter(
    RATE_LIMIT_FORGOT_PASSWORD_MAX, RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS
)

_default_origins = "http://localhost:3000,http://127.0.0.1:3000"
ALLOWED_ORIGINS = [
    origin.strip() for origin in os.getenv("ALLOWED_ORIGINS", _default_origins).split(",") if origin.strip()
]

# The ML/RAG/vision stack (backend.model_service) is imported lazily on first
# use rather than at module import time. This keeps auth, chat and document
# endpoints usable (and unit-testable) even when the heavy torch/transformers/
# ragmens-core dependency chain is unavailable or broken, and it no longer
# takes down the whole API if the ML stack fails to import.
_assistant = None


def get_assistant():
    global _assistant
    if _assistant is None:
        from backend.model_service import assistant as loaded_assistant

        _assistant = loaded_assistant
    return _assistant


app = FastAPI(title="LLM YOLO Machine Assistant")

init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def enforce_login_rate_limit(request: Request) -> None:
    if not _login_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppi tentativi di accesso. Riprova piu tardi.")


def enforce_register_rate_limit(request: Request) -> None:
    if not _register_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppe richieste di registrazione. Riprova piu tardi.")


def enforce_ask_rate_limit(request: Request) -> None:
    if not _ask_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova piu tardi.")


def enforce_2fa_verify_rate_limit(request: Request) -> None:
    if not _2fa_verify_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova piu tardi.")


def enforce_2fa_recovery_rate_limit(request: Request) -> None:
    if not _2fa_recovery_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppi tentativi. Riprova piu tardi.")


def enforce_2fa_send_rate_limit(request: Request) -> None:
    if not _2fa_send_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova piu tardi.")


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"La password deve contenere almeno {MIN_PASSWORD_LENGTH} caratteri."
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"La password non puo' superare {MAX_PASSWORD_LENGTH} caratteri."
        )


_TOKEN_CLEANUP_GRACE_SECONDS = 3600


def _cleanup_password_reset_tokens(connection: Connection) -> None:
    """Opportunistic cleanup instead of a scheduler: prune rows that can no
    longer be used. The grace period keeps this from ever touching the row
    the current request just created/consumed."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_TOKEN_CLEANUP_GRACE_SECONDS)
    connection.execute(
        "DELETE FROM password_reset_tokens WHERE expires_at < %s OR (used_at IS NOT NULL AND used_at < %s)",
        (cutoff, cutoff),
    )


def _cleanup_two_factor_email_codes(connection: Connection) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=_TOKEN_CLEANUP_GRACE_SECONDS)
    connection.execute(
        "DELETE FROM two_factor_email_codes WHERE expires_at < %s OR (used_at IS NOT NULL AND used_at < %s)",
        (cutoff, cutoff),
    )


def _issue_two_factor_code(connection: Connection, user_id: int, purpose: str) -> str:
    """Invalidates any previous unused code for this (user, purpose) and
    stores a freshly generated one, hashed. Returns the plaintext code so the
    caller can email it out - it is never persisted in cleartext."""
    _cleanup_two_factor_email_codes(connection)
    connection.execute(
        "UPDATE two_factor_email_codes SET used_at = %s WHERE user_id = %s AND purpose = %s AND used_at IS NULL",
        (utc_now(), user_id, purpose),
    )
    code = generate_email_code()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=TWO_FA_EMAIL_CODE_TTL_SECONDS)
    connection.execute(
        "INSERT INTO two_factor_email_codes(user_id, purpose, code_hash, expires_at, created_at) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, purpose, hash_password(code), expires_at, utc_now()),
    )
    return code


def _consume_two_factor_code(connection: Connection, user_id: int, purpose: str, code: str) -> bool:
    row = connection.execute(
        "SELECT id, code_hash, expires_at FROM two_factor_email_codes "
        "WHERE user_id = %s AND purpose = %s AND used_at IS NULL ORDER BY id DESC LIMIT 1",
        (user_id, purpose),
    ).fetchone()
    if row is None:
        return False
    if row["expires_at"] < datetime.now(timezone.utc):
        return False
    if not verify_password((code or "").strip(), row["code_hash"]):
        return False
    connection.execute("UPDATE two_factor_email_codes SET used_at = %s WHERE id = %s", (utc_now(), row["id"]))
    return True


def _send_two_factor_email(background_tasks: BackgroundTasks, to_email: str, code: str, purpose: str) -> None:
    background_tasks.add_task(
        email_service.send_two_factor_code_email, to_email, code, purpose, TWO_FA_EMAIL_CODE_TTL_SECONDS // 60
    )


def _resolve_challenge_user(challenge_token: str) -> dict:
    decoded = decode_challenge_token(challenge_token)
    if decoded is None:
        raise HTTPException(status_code=401, detail="Sessione di verifica scaduta. Accedi di nuovo.")
    with connect() as connection:
        row = connection.execute(
            "SELECT users.*, companies.domain FROM users LEFT JOIN companies ON companies.id = users.company_id "
            "WHERE users.id = %s",
            (decoded["user_id"],),
        ).fetchone()
    if row is None or not row["two_factor_enabled"]:
        raise HTTPException(status_code=401, detail="Sessione di verifica non valida.")
    _ensure_not_blocked(row)
    return row


def _find_unused_recovery_code(connection: Connection, user_id: int, recovery_code: str) -> dict | None:
    candidates = connection.execute(
        "SELECT id, code_hash FROM user_recovery_codes WHERE user_id = %s AND used_at IS NULL",
        (user_id,),
    ).fetchall()
    return next((row for row in candidates if verify_password(recovery_code.strip(), row["code_hash"])), None)


def _associate_company_if_applicable(connection: Connection, user_id: int, email: str) -> None:
    """Creates (if needed) and links the company matching the user's email
    domain, unless the domain is a public/personal one."""
    domain = email_domain(email)
    if is_public_domain(domain):
        return
    connection.execute(
        "INSERT INTO companies(domain, name, created_at) VALUES (%s, %s, %s) ON CONFLICT (domain) DO NOTHING",
        (domain, domain, utc_now()),
    )
    company_id = connection.execute("SELECT id FROM companies WHERE domain = %s", (domain,)).fetchone()["id"]
    connection.execute("UPDATE users SET company_id = %s WHERE id = %s", (company_id, user_id))


def _ensure_not_blocked(row: dict) -> None:
    if row["status"] == "blocked":
        raise HTTPException(status_code=403, detail="Account sospeso. Contatta l'assistenza.")


def _session_response(row: dict) -> dict:
    """Issues the bearer token for a fully authenticated user and records the login."""
    with connect() as connection:
        connection.execute(
            "UPDATE users SET last_login_at = now(), last_active_at = now() WHERE id = %s", (row["id"],)
        )
    return {
        "token": make_token(row["id"], row["token_version"]),
        "email": row["email"],
        "company_domain": row["domain"],
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/auth/register", dependencies=[Depends(enforce_register_rate_limit)])
def register(
    email: str = Form(),
    password: str = Form(),
    terms_accepted: bool = Form(...),
) -> dict:
    email = email.strip().lower()
    _validate_password(password)
    if not terms_accepted:
        raise HTTPException(
            status_code=400,
            detail="Devi accettare i Termini di servizio e l'Informativa sulla privacy per registrarti.",
        )
    email_domain(email)

    with connect() as connection:
        try:
            user_id = connection.execute(
                "INSERT INTO users(email, password_hash, company_id, terms_accepted_at, created_at) "
                "VALUES (%s, %s, NULL, %s, %s) RETURNING id",
                (email, hash_password(password), utc_now(), utc_now()),
            ).fetchone()["id"]
        except pg_errors.UniqueViolation as exc:
            raise HTTPException(status_code=409, detail="Questa email e gia registrata.") from exc
        _associate_company_if_applicable(connection, user_id, email)
        row = connection.execute(
            "SELECT users.*, companies.domain FROM users LEFT JOIN companies ON companies.id = users.company_id "
            "WHERE users.id = %s",
            (user_id,),
        ).fetchone()

    return {
        "token": make_token(row["id"], row["token_version"]),
        "email": row["email"],
        "company_domain": row["domain"],
    }


@app.post("/api/auth/login", dependencies=[Depends(enforce_login_rate_limit)])
def login(background_tasks: BackgroundTasks, email: str = Form(), password: str = Form()) -> dict:
    normalized_email = email.strip().lower()
    with connect() as connection:
        row = connection.execute(
            "SELECT users.*, companies.domain FROM users LEFT JOIN companies ON companies.id = users.company_id "
            "WHERE email = %s",
            (normalized_email,),
        ).fetchone()
        locked = row is not None and is_locked(row)
        # Always run the (slow, PBKDF2) password check, even for an unknown
        # email, against a fixed dummy hash. Short-circuiting it only for
        # existing users would make responses for "unknown email" measurably
        # faster than "wrong password", leaking which emails are registered.
        password_hash_to_check = row["password_hash"] if row is not None else _DUMMY_PASSWORD_HASH
        password_matches = verify_password(password, password_hash_to_check)
        credentials_ok = row is not None and not locked and password_matches
        if row is not None and not locked:
            if credentials_ok:
                reset_failed_login(connection, row["id"])
                if row["company_id"] is None:
                    _associate_company_if_applicable(connection, row["id"], row["email"])
                    row = connection.execute(
                        "SELECT users.*, companies.domain FROM users "
                        "LEFT JOIN companies ON companies.id = users.company_id WHERE users.id = %s",
                        (row["id"],),
                    ).fetchone()
            else:
                register_failed_login(connection, row["id"], row["failed_login_attempts"])
        # The connection commits here (context manager exit) before any
        # HTTPException is raised below, so failed-attempt bookkeeping is
        # never rolled back by the exception.

    if locked:
        raise HTTPException(
            status_code=429,
            detail="Account temporaneamente bloccato per troppi tentativi falliti. Riprova piu tardi.",
        )
    if row is None or not credentials_ok:
        raise HTTPException(status_code=401, detail="Email o password non validi.")
    # Checked only after the password, so a 403 never reveals that an email
    # exists to someone who does not know its password.
    _ensure_not_blocked(row)

    if row["two_factor_enabled"]:
        # Password was correct, but a second factor is still required: don't
        # hand out a usable session token yet, only a short-lived challenge.
        with connect() as connection:
            code = _issue_two_factor_code(connection, row["id"], "login")
        _send_two_factor_email(background_tasks, row["email"], code, "login")
        return {"requires_2fa": True, "challenge_token": make_challenge_token(row["id"])}

    return _session_response(row)


@app.post("/api/auth/logout")
def logout(user: CurrentUser) -> dict:
    with connect() as connection:
        bump_token_version(connection, user["id"])
    return {"message": "Logout effettuato."}


@app.get("/api/auth/me")
def me(user: CurrentUser) -> dict:
    return user


@app.post("/api/auth/2fa/setup", dependencies=[Depends(enforce_2fa_send_rate_limit)])
def setup_two_factor(user: CurrentUser, background_tasks: BackgroundTasks) -> dict:
    with connect() as connection:
        row = connection.execute(
            "SELECT two_factor_enabled FROM users WHERE id = %s", (user["id"],)
        ).fetchone()
        if row["two_factor_enabled"]:
            raise HTTPException(
                status_code=400, detail="La 2FA e' gia' attiva. Disattivala prima di riconfigurarla."
            )
        code = _issue_two_factor_code(connection, user["id"], "enable")
    _send_two_factor_email(background_tasks, user["email"], code, "enable")
    return {"sent": True, "email": user["email"]}


@app.post("/api/auth/2fa/confirm")
def confirm_two_factor(user: CurrentUser, code: str = Form()) -> dict:
    with connect() as connection:
        if not _consume_two_factor_code(connection, user["id"], "enable", code):
            raise HTTPException(status_code=400, detail="Codice non valido o scaduto.")

        recovery_codes = generate_recovery_codes()
        now = utc_now()
        connection.execute(
            "UPDATE users SET two_factor_enabled = true, two_factor_confirmed_at = %s WHERE id = %s",
            (now, user["id"]),
        )
        connection.execute("DELETE FROM user_recovery_codes WHERE user_id = %s", (user["id"],))
        connection.cursor().executemany(
            "INSERT INTO user_recovery_codes(user_id, code_hash, created_at) VALUES (%s, %s, %s)",
            [(user["id"], hash_password(recovery_code), now) for recovery_code in recovery_codes],
        )
    return {"enabled": True, "recovery_codes": recovery_codes}


@app.post("/api/auth/2fa/resend", dependencies=[Depends(enforce_2fa_send_rate_limit)])
def resend_two_factor_code(background_tasks: BackgroundTasks, challenge_token: str = Form()) -> dict:
    row = _resolve_challenge_user(challenge_token)
    with connect() as connection:
        code = _issue_two_factor_code(connection, row["id"], "login")
    _send_two_factor_email(background_tasks, row["email"], code, "login")
    return {"sent": True}


@app.post("/api/auth/2fa/verify", dependencies=[Depends(enforce_2fa_verify_rate_limit)])
def verify_two_factor(challenge_token: str = Form(), code: str = Form()) -> dict:
    row = _resolve_challenge_user(challenge_token)
    with connect() as connection:
        if not _consume_two_factor_code(connection, row["id"], "login", code):
            raise HTTPException(status_code=401, detail="Codice non valido o scaduto.")
    return _session_response(row)


@app.post("/api/auth/2fa/recovery", dependencies=[Depends(enforce_2fa_recovery_rate_limit)])
def recover_two_factor(challenge_token: str = Form(), recovery_code: str = Form()) -> dict:
    row = _resolve_challenge_user(challenge_token)
    with connect() as connection:
        matched = _find_unused_recovery_code(connection, row["id"], recovery_code)
        if matched is None:
            raise HTTPException(status_code=401, detail="Codice di recupero non valido.")
        connection.execute("UPDATE user_recovery_codes SET used_at = %s WHERE id = %s", (utc_now(), matched["id"]))
    return _session_response(row)


def _require_password(connection: Connection, user_id: int, password: str) -> dict:
    row = connection.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
    if row is None or not verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Password non corretta.")
    if not row["two_factor_enabled"]:
        raise HTTPException(status_code=400, detail="La 2FA non e' attiva.")
    return row


@app.post("/api/auth/2fa/disable/request-code", dependencies=[Depends(enforce_2fa_send_rate_limit)])
def request_disable_two_factor_code(
    user: CurrentUser, background_tasks: BackgroundTasks, password: str = Form()
) -> dict:
    with connect() as connection:
        _require_password(connection, user["id"], password)
        code = _issue_two_factor_code(connection, user["id"], "disable")
    _send_two_factor_email(background_tasks, user["email"], code, "disable")
    return {"sent": True}


@app.post("/api/auth/2fa/disable")
def disable_two_factor(
    user: CurrentUser,
    password: str = Form(),
    code: Annotated[str | None, Form()] = None,
    recovery_code: Annotated[str | None, Form()] = None,
) -> dict:
    with connect() as connection:
        _require_password(connection, user["id"], password)

        second_factor_ok = bool(code) and _consume_two_factor_code(connection, user["id"], "disable", code)
        if not second_factor_ok and recovery_code:
            matched = _find_unused_recovery_code(connection, user["id"], recovery_code)
            if matched is not None:
                connection.execute(
                    "UPDATE user_recovery_codes SET used_at = %s WHERE id = %s", (utc_now(), matched["id"])
                )
                second_factor_ok = True
        if not second_factor_ok:
            raise HTTPException(status_code=401, detail="Codice di verifica non valido.")

        connection.execute(
            "UPDATE users SET two_factor_enabled = false, two_factor_confirmed_at = NULL WHERE id = %s",
            (user["id"],),
        )
        connection.execute("DELETE FROM user_recovery_codes WHERE user_id = %s", (user["id"],))
        connection.execute(
            "UPDATE two_factor_email_codes SET used_at = %s WHERE user_id = %s AND used_at IS NULL",
            (utc_now(), user["id"]),
        )
        # Disabling 2FA weakens the account: force every existing session
        # (this device included) to re-authenticate from scratch.
        bump_token_version(connection, user["id"])
    return {"disabled": True}


@app.post("/api/auth/2fa/recovery-codes/regenerate/request-code", dependencies=[Depends(enforce_2fa_send_rate_limit)])
def request_regenerate_recovery_codes_code(
    user: CurrentUser, background_tasks: BackgroundTasks, password: str = Form()
) -> dict:
    with connect() as connection:
        _require_password(connection, user["id"], password)
        code = _issue_two_factor_code(connection, user["id"], "regenerate")
    _send_two_factor_email(background_tasks, user["email"], code, "regenerate")
    return {"sent": True}


@app.post("/api/auth/2fa/recovery-codes/regenerate")
def regenerate_recovery_codes(user: CurrentUser, password: str = Form(), code: str = Form()) -> dict:
    with connect() as connection:
        _require_password(connection, user["id"], password)
        if not _consume_two_factor_code(connection, user["id"], "regenerate", code):
            raise HTTPException(status_code=401, detail="Codice non valido o scaduto.")

        connection.execute("DELETE FROM user_recovery_codes WHERE user_id = %s", (user["id"],))
        recovery_codes = generate_recovery_codes()
        now = utc_now()
        connection.cursor().executemany(
            "INSERT INTO user_recovery_codes(user_id, code_hash, created_at) VALUES (%s, %s, %s)",
            [(user["id"], hash_password(recovery_code), now) for recovery_code in recovery_codes],
        )
    return {"recovery_codes": recovery_codes}


@app.get("/api/auth/2fa/status")
def two_factor_status(user: CurrentUser) -> dict:
    with connect() as connection:
        row = connection.execute(
            "SELECT two_factor_enabled FROM users WHERE id = %s", (user["id"],)
        ).fetchone()
        remaining = connection.execute(
            "SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = %s AND used_at IS NULL",
            (user["id"],),
        ).fetchone()["n"]
    return {"enabled": bool(row["two_factor_enabled"]), "recovery_codes_remaining": remaining}


_FORGOT_PASSWORD_MESSAGE = (
    "Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password."
)


@app.post("/api/auth/forgot-password")
def forgot_password(request: Request, background_tasks: BackgroundTasks, email: str = Form()) -> dict:
    normalized_email = email.strip().lower()
    # Same limiter check regardless of whether the account exists, so a 429
    # never leaks account existence either.
    ip_ok = _forgot_password_ip_limiter.allow(_client_ip(request))
    email_ok = _forgot_password_email_limiter.allow(normalized_email)
    if not ip_ok or not email_ok:
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova piu tardi.")

    token = secrets.token_urlsafe(32)
    token_hash = hash_reset_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=PASSWORD_RESET_TOKEN_TTL_SECONDS)

    with connect() as connection:
        _cleanup_password_reset_tokens(connection)
        row = connection.execute("SELECT id, email FROM users WHERE email = %s", (normalized_email,)).fetchone()
        if row is not None:
            # Superseding any still-valid link keeps only the most recently
            # requested one usable, so stale links in old emails stop working.
            connection.execute(
                "UPDATE password_reset_tokens SET used_at = %s WHERE user_id = %s AND used_at IS NULL",
                (utc_now(), row["id"]),
            )
            connection.execute(
                "INSERT INTO password_reset_tokens(user_id, token_hash, expires_at, created_at) VALUES (%s, %s, %s, %s)",
                (row["id"], token_hash, expires_at, utc_now()),
            )

    if row is not None:
        # Sending in the background keeps the response time (and therefore
        # any observable timing side-channel) independent of SMTP latency.
        reset_link = f"{FRONTEND_URL}/reset-password?token={token}"
        background_tasks.add_task(
            email_service.send_password_reset_email,
            row["email"],
            reset_link,
            PASSWORD_RESET_TOKEN_TTL_SECONDS // 60,
        )

    return {"message": _FORGOT_PASSWORD_MESSAGE}


@app.post("/api/auth/reset-password")
def reset_password(token: str = Form(), new_password: str = Form()) -> dict:
    _validate_password(new_password)
    token_hash = hash_reset_token(token)
    with connect() as connection:
        row = connection.execute(
            "SELECT * FROM password_reset_tokens WHERE token_hash = %s", (token_hash,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="Il link per reimpostare la password non e' valido.")
        if row["used_at"] is not None:
            raise HTTPException(status_code=400, detail="Questo link e' gia' stato utilizzato.")
        if row["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Il link per reimpostare la password e' scaduto.")

        now = utc_now()
        connection.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(new_password), row["user_id"])
        )
        # Invalidate this token and any other still-outstanding reset link
        # for the same account in one sweep.
        connection.execute(
            "UPDATE password_reset_tokens SET used_at = %s WHERE user_id = %s AND used_at IS NULL",
            (now, row["user_id"]),
        )
        # Password reset must kill every existing session; 2FA (if enabled)
        # is left untouched on purpose, so the next login still challenges it.
        bump_token_version(connection, row["user_id"])
    return {"reset": True}


@app.get("/api/chats")
def list_chats(user: CurrentUser) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT id, title, knowledge_mode, company_document_ids, created_at, updated_at "
            "FROM chats WHERE user_id = %s ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
    return rows


@app.post("/api/chats")
def create_chat(
    user: CurrentUser,
    title: str = Form("Nuova chat"),
    knowledge_mode: str = Form("base"),
    company_document_ids: str = Form("[]"),
) -> dict:
    if knowledge_mode not in {"base", "merged"} or (knowledge_mode == "merged" and not user["company_domain"]):
        raise HTTPException(status_code=403, detail="Modalita di conoscenza non disponibile per questo utente.")
    try:
        selected_documents = json.loads(company_document_ids)
        if not isinstance(selected_documents, list) or not all(isinstance(item, str) for item in selected_documents):
            raise ValueError
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Elenco documenti non valido.") from exc
    now = utc_now()
    with connect() as connection:
        chat_id = connection.execute(
            "INSERT INTO chats(user_id, title, knowledge_mode, company_document_ids, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (user["id"], title.strip() or "Nuova chat", knowledge_mode, selected_documents, now, now),
        ).fetchone()["id"]
    return {"id": chat_id, "title": title.strip() or "Nuova chat", "knowledge_mode": knowledge_mode}


@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: int, user: CurrentUser, title: str = Form()) -> dict:
    clean_title = title.strip() or "Nuova chat"
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE chats SET title = %s, updated_at = %s WHERE id = %s AND user_id = %s",
            (clean_title, utc_now(), chat_id, user["id"]),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
    return {"id": chat_id, "title": clean_title}


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int, user: CurrentUser) -> dict:
    with connect() as connection:
        cursor = connection.execute(
            "DELETE FROM chats WHERE id = %s AND user_id = %s", (chat_id, user["id"])
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
    return {"deleted": True}


@app.get("/api/chats/{chat_id}/messages")
def chat_messages(chat_id: int, user: CurrentUser) -> list[dict]:
    with connect() as connection:
        chat = connection.execute(
            "SELECT id FROM chats WHERE id = %s AND user_id = %s", (chat_id, user["id"])
        ).fetchone()
        if chat is None:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
        rows = connection.execute(
            "SELECT id, role, content, created_at FROM messages WHERE chat_id = %s ORDER BY id",
            (chat_id,),
        ).fetchall()
    return rows


@app.get("/api/company/documents")
def company_documents(user: CurrentUser) -> list[dict]:
    if not user["company_domain"]:
        return []
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT documents.id, documents.filename, documents.status, documents.created_at
            FROM company_documents AS documents JOIN companies ON companies.id = documents.company_id
            WHERE companies.domain = %s ORDER BY documents.created_at DESC
            """,
            (user["company_domain"],),
        ).fetchall()
    return rows


@app.post("/api/company/documents")
def upload_company_document(user: CurrentUser, document: UploadFile = File(...)) -> dict:
    if not user["company_domain"]:
        raise HTTPException(status_code=403, detail="Solo gli utenti aziendali possono caricare documenti.")
    if document.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Carica un documento PDF.")
    safe_name = Path(document.filename or "document.pdf").name
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Il file deve avere estensione PDF.")

    header = document.file.read(len(PDF_MAGIC_BYTES))
    document.file.seek(0)
    if header != PDF_MAGIC_BYTES:
        raise HTTPException(status_code=400, detail="Il file non e' un PDF valido.")

    company_key = hashlib.sha256(user["company_domain"].encode("utf-8")).hexdigest()[:16]
    pdf_dir = COMPANY_DATA_DIR / company_key / "pdfs"
    pdf_dir.mkdir(parents=True, exist_ok=True)
    # A random filename on disk avoids collisions/overwrites between uploads
    # that share the same original name; the original name is kept only as
    # display metadata in the database.
    stored_name = f"{secrets.token_hex(16)}{Path(safe_name).suffix.lower()}"
    destination = pdf_dir / stored_name

    total_written = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = document.file.read(1024 * 1024)
                if not chunk:
                    break
                total_written += len(chunk)
                if total_written > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Il file supera il limite di {MAX_UPLOAD_BYTES // (1024 * 1024)}MB.",
                    )
                output.write(chunk)
    except HTTPException:
        destination.unlink(missing_ok=True)
        raise

    with connect() as connection:
        company = connection.execute(
            "SELECT id FROM companies WHERE domain = %s", (user["company_domain"],)
        ).fetchone()
        document_id = connection.execute(
            "INSERT INTO company_documents(company_id, uploaded_by, filename, storage_path, size_bytes, status, created_at) "
            "VALUES (%s, %s, %s, %s, %s, 'pending', %s) RETURNING id",
            (company["id"], user["id"], safe_name, str(destination), total_written, utc_now()),
        ).fetchone()["id"]

    get_assistant().invalidate_company_rag(user["company_domain"])
    try:
        get_assistant().ensure_company_rag_ready(user["company_domain"])
    except Exception:
        logger.exception("Indicizzazione RAG fallita per l'azienda %s", user["company_domain"])
        with connect() as connection:
            connection.execute("UPDATE company_documents SET status = 'failed' WHERE id = %s", (document_id,))
        return {"id": document_id, "filename": safe_name, "status": "failed"}

    with connect() as connection:
        connection.execute(
            "UPDATE company_documents SET status = 'indexed', indexed_at = now() "
            "WHERE company_id = %s AND status <> 'indexed'",
            (company["id"],),
        )
    return {"id": document_id, "filename": safe_name, "status": "indexed"}


@app.delete("/api/company/documents/{document_id}")
def delete_company_document(document_id: int, user: CurrentUser) -> dict:
    if not user["company_domain"]:
        raise HTTPException(status_code=403, detail="Solo gli utenti aziendali possono gestire documenti.")
    with connect() as connection:
        row = connection.execute(
            """
            SELECT documents.id, documents.storage_path FROM company_documents AS documents
            JOIN companies ON companies.id = documents.company_id
            WHERE documents.id = %s AND companies.domain = %s
            """,
            (document_id, user["company_domain"]),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Documento non trovato.")
        connection.execute("DELETE FROM company_documents WHERE id = %s", (document_id,))
    Path(row["storage_path"]).unlink(missing_ok=True)
    get_assistant().invalidate_company_rag(user["company_domain"])
    return {"deleted": True}


_SOURCE_EXCERPT_CHARS = 400


def _record_analysis(
    *,
    user: dict,
    chat_id: int | None,
    knowledge_mode: str,
    question: str,
    image: UploadFile,
    image_size: int,
    started: float,
    result: dict | None = None,
    error: str | None = None,
) -> None:
    """Stores one row in app.analyses for the backoffice. Best effort: a
    failure here is logged and never breaks the user's answer."""
    result = result or {}
    machine = result.get("machine") or {}
    summary = result.get("recognition_summary") or {}
    identifiers = result.get("image_identifiers") or {}
    if error is not None:
        status = "failed"
    elif result.get("recognized"):
        status = "recognized"
    else:
        status = "not_recognized"
    sources = [
        {
            "source": hit.get("source"),
            "page": hit.get("page"),
            "score": hit.get("score"),
            "excerpt": (hit.get("text") or "")[:_SOURCE_EXCERPT_CHARS],
        }
        for hit in result.get("hits") or []
    ]
    candidates = [
        {"machine_id": c.get("machine_id"), "machine_name": c.get("machine_name"), "score": c.get("score")}
        for c in result.get("vision_candidates") or []
    ]
    try:
        with connect() as connection:
            connection.execute(
                """
                INSERT INTO analyses(
                    user_id, chat_id, knowledge_mode, question, status,
                    machine_id, machine_name, machine_type, vision_score, exact_model_identified,
                    model_code, serial_number, asset_tag, vision_candidates,
                    answer, sources, reason, error_message,
                    image_filename, image_content_type, image_size_bytes, duration_ms
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
                """,
                (
                    user["id"], chat_id, knowledge_mode, question, status,
                    machine.get("id") or result.get("machine_id"), machine.get("macchina"), machine.get("tipo"),
                    result.get("vision_score"), summary.get("exact_model_identified"),
                    summary.get("model_code") or identifiers.get("model_code"),
                    summary.get("serial_number") or identifiers.get("serial_number"),
                    summary.get("asset_tag") or identifiers.get("asset_tag"),
                    Jsonb(candidates),
                    result.get("answer"), Jsonb(sources), result.get("reason"), error,
                    Path(image.filename or "").name or None, image.content_type, image_size,
                    int((time.monotonic() - started) * 1000),
                ),
            )
            connection.execute("UPDATE users SET last_active_at = now() WHERE id = %s", (user["id"],))
    except Exception:
        logger.exception("Impossibile registrare l'analisi per l'utente %s", user["id"])


def require_backoffice_token(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    """Guards server-to-server endpoints. They live under /internal (not /api),
    so the public Next.js proxy (/api/backend/* → /api/*) can never reach them,
    and the proxy does not forward this header anyway."""
    if not BACKOFFICE_API_TOKEN:
        raise HTTPException(status_code=503, detail="Endpoint interni non configurati (BACKOFFICE_API_TOKEN).")
    if not x_internal_token or not hmac.compare_digest(x_internal_token, BACKOFFICE_API_TOKEN):
        raise HTTPException(status_code=401, detail="Token interno non valido.")


@app.delete("/internal/company-documents/{document_id}", dependencies=[Depends(require_backoffice_token)])
def backoffice_delete_company_document(document_id: int) -> dict:
    """Deletes a company document on behalf of a backoffice operator: row, file
    on disk and the company's cached RAG index (rebuilt on the next question
    without this PDF). Authorization and audit are done by the backoffice."""
    with connect() as connection:
        row = connection.execute(
            """
            DELETE FROM company_documents AS documents USING companies
            WHERE documents.id = %s AND companies.id = documents.company_id
            RETURNING documents.filename, documents.storage_path, companies.domain
            """,
            (document_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Documento non trovato.")
    Path(row["storage_path"]).unlink(missing_ok=True)
    # Only an already-loaded assistant can hold a cached index; don't import
    # the whole ML stack just to clear a cache that cannot exist yet.
    if _assistant is not None:
        _assistant.invalidate_company_rag(row["domain"])
    return {"deleted": True, "filename": row["filename"], "company_domain": row["domain"]}


@app.post("/api/ask", dependencies=[Depends(enforce_ask_rate_limit)])
def ask(
    user: CurrentUser,
    question: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
    chat_id: Annotated[int | None, Form()] = None,
    top_k: Annotated[int, Form()] = 12,
) -> dict:
    if not question.strip():
        raise HTTPException(status_code=400, detail="La domanda e obbligatoria.")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Carica un file immagine valido.")

    started = time.monotonic()
    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(prefix="machine-upload-", suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(image.file, tmp)
        image_path = Path(tmp.name)
    image_size = image_path.stat().st_size

    knowledge_mode = "base"
    record = {
        "user": user,
        "chat_id": chat_id,
        "question": question.strip(),
        "image": image,
        "image_size": image_size,
        "started": started,
    }
    try:
        if chat_id is not None:
            with connect() as connection:
                chat = connection.execute(
                    "SELECT * FROM chats WHERE id = %s AND user_id = %s", (chat_id, user["id"])
                ).fetchone()
            if chat is None:
                raise HTTPException(status_code=404, detail="Chat non trovata.")
            knowledge_mode = chat["knowledge_mode"]
            company_document_ids = list(chat["company_document_ids"])
        else:
            company_document_ids = None
        result = get_assistant().ask_machine(
            image_path=image_path,
            question=question.strip(),
            top_k=top_k,
            knowledge_mode=knowledge_mode,
            company_domain=user["company_domain"],
            company_document_ids=company_document_ids,
            chat_id=chat_id,
        )
        if chat_id is not None:
            with connect() as connection:
                connection.execute(
                    "INSERT INTO messages(chat_id, role, content, created_at) VALUES (%s, 'user', %s, %s)",
                    (chat_id, question.strip(), utc_now()),
                )
                if result.get("answer"):
                    connection.execute(
                        "INSERT INTO messages(chat_id, role, content, created_at) VALUES (%s, 'assistant', %s, %s)",
                        (chat_id, result["answer"], utc_now()),
                    )
                connection.execute("UPDATE chats SET updated_at = %s WHERE id = %s", (utc_now(), chat_id))
        _record_analysis(**record, knowledge_mode=knowledge_mode, result=result)
        return result
    except ValueError as exc:
        _record_analysis(**record, knowledge_mode=knowledge_mode, result={"recognized": False, "reason": str(exc)})
        return {"recognized": False, "reason": str(exc), "question": question}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Errore interno durante l'elaborazione di /api/ask")
        _record_analysis(**record, knowledge_mode=knowledge_mode, error=f"{type(exc).__name__}: {exc}"[:2000])
        raise HTTPException(status_code=500, detail="Si e verificato un errore interno. Riprova piu tardi.")
    finally:
        image_path.unlink(missing_ok=True)
