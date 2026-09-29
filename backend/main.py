from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import logging
import os
import secrets
import shutil
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from psycopg import Connection, errors as pg_errors
from psycopg.types.json import Jsonb

from backend import accounts, email_service, perf
from backend.auth import AuthenticatedUser, CompanyAdmin, CurrentUser
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
    public_user,
    register_failed_login,
    reset_failed_login,
    utc_now,
    verify_password,
)
from backend.llm_errors import LLMError
from backend.llm_service import get_llm_service
from backend.rate_limit import SlidingWindowRateLimiter
from backend.two_factor_service import generate_email_code, generate_recovery_codes


# Uvicorn configures its own loggers but not the application loggers.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s [%(request_id)s]: %(message)s",
)
for _handler in logging.getLogger().handlers:
    _handler.addFilter(perf.RequestIdFilter())

logger = logging.getLogger("backend.main")

COMPANY_DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "companies"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "30")) * 1024 * 1024
PDF_MAGIC_BYTES = b"%PDF-"
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_MB", "10")) * 1024 * 1024
# Photo thumbnail kept for the chat history: the original upload is deleted.
THUMBNAIL_MAX_SIDE = 320
THUMBNAIL_JPEG_QUALITY = 75
# How many past analyses the chat history shows.
CHAT_HISTORY_LIMIT = 100
# The frontend sends the answer a few sentences at a time, so a request stays short.
MAX_SPEAK_CHARS = int(os.getenv("MAX_SPEAK_CHARS", "2000"))

RATE_LIMIT_LOGIN_MAX = int(os.getenv("RATE_LIMIT_LOGIN_MAX", "10"))
RATE_LIMIT_LOGIN_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_LOGIN_WINDOW_SECONDS", "60"))
RATE_LIMIT_ASK_MAX = int(os.getenv("RATE_LIMIT_ASK_MAX", "20"))
RATE_LIMIT_ASK_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_ASK_WINDOW_SECONDS", "60"))
RATE_LIMIT_TRANSCRIBE_MAX = int(os.getenv("RATE_LIMIT_TRANSCRIBE_MAX", "20"))
RATE_LIMIT_TRANSCRIBE_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_TRANSCRIBE_WINDOW_SECONDS", "60"))
# One answer is read in several chunks, hence a higher limit than transcribe.
RATE_LIMIT_SPEAK_MAX = int(os.getenv("RATE_LIMIT_SPEAK_MAX", "120"))
RATE_LIMIT_SPEAK_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_SPEAK_WINDOW_SECONDS", "60"))
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
_ask_limiter = SlidingWindowRateLimiter(RATE_LIMIT_ASK_MAX, RATE_LIMIT_ASK_WINDOW_SECONDS)
_transcribe_limiter = SlidingWindowRateLimiter(RATE_LIMIT_TRANSCRIBE_MAX, RATE_LIMIT_TRANSCRIBE_WINDOW_SECONDS)
_speak_limiter = SlidingWindowRateLimiter(RATE_LIMIT_SPEAK_MAX, RATE_LIMIT_SPEAK_WINDOW_SECONDS)
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
_transcriber = None
_synthesizer = None


def get_assistant():
    global _assistant
    if _assistant is None:
        from backend.model_service import assistant as loaded_assistant

        _assistant = loaded_assistant
    return _assistant


def get_transcriber():
    global _transcriber
    if _transcriber is None:
        from backend.speech_service import transcriber as loaded_transcriber

        _transcriber = loaded_transcriber
    return _transcriber


def get_synthesizer():
    global _synthesizer
    if _synthesizer is None:
        from backend.tts_service import synthesizer as loaded_synthesizer

        _synthesizer = loaded_synthesizer
    return _synthesizer


# 1 = load SigLIP, embeddings, FAISS and GOT-OCR in the background at startup
# instead of on the first question (which otherwise waits minutes after a restart).
PRELOAD_MODELS = os.getenv("PRELOAD_MODELS", "0") == "1"


def _preload_models() -> None:
    """Best effort: on failure the API stays up and models load on first use as before."""
    started = time.perf_counter()
    try:
        from backend import model_service

        get_assistant().ensure_ready()
        if model_service.OCR_BACKEND == "got" and model_service.OCR_IN_PROCESS:
            from backend.ocr_service import got_ocr

            got_ocr.warm_up()
        logger.info("Models preloaded in %.1fs", time.perf_counter() - started)
    except Exception:
        logger.exception("Model preload failed: models will be loaded on the first question")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if PRELOAD_MODELS:
        threading.Thread(target=_preload_models, name="model-preload", daemon=True).start()
    yield


app = FastAPI(title="LLM YOLO Machine Assistant", lifespan=lifespan)

init_db()

@app.middleware("http")
async def profile_ask(request: Request, call_next):
    """One PERF log line per /api/ask with the time of every stage, correlated by
    request id (also returned as X-Request-ID)."""
    if request.url.path != "/api/ask":
        return await call_next(request)
    profile = perf.start("/api/ask", request.headers.get("x-request-id", "")[:64] or None)
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = profile.request_id
        return response
    finally:
        profile.log(status=status)


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


def enforce_ask_rate_limit(request: Request) -> None:
    if not _ask_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova piu tardi.")


def enforce_transcribe_rate_limit(request: Request) -> None:
    if not _transcribe_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova piu tardi.")


def enforce_speak_rate_limit(request: Request) -> None:
    if not _speak_limiter.allow(_client_ip(request)):
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
            "SELECT users.*, companies.domain, companies.name AS company_name FROM users LEFT JOIN companies ON companies.id = users.company_id "
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


def _ensure_not_blocked(row: dict) -> None:
    if row["status"] == "blocked":
        raise HTTPException(status_code=403, detail="Account sospeso. Contatta l'assistenza.")


def _session_response(row: dict) -> dict:
    """Issues the bearer token for a fully authenticated user and records the login."""
    with connect() as connection:
        connection.execute(
            "UPDATE users SET last_login_at = now(), last_active_at = now() WHERE id = %s", (row["id"],)
        )
    return {"token": make_token(row["id"], row["token_version"]), **public_user(row)}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ai")
def health_ai(response: Response) -> dict:
    """Primary: cheap model listing, no generation. Fallback: configuration only,
    so a health check never starts a paid GPU. No server address in the body.
    200 = ok or degraded (primary down, fallback answering); 503 = no provider."""
    status = get_llm_service().health_check()
    if status.get("status") == "unavailable":
        response.status_code = 503
    return status


@app.post("/api/auth/login", dependencies=[Depends(enforce_login_rate_limit)])
def login(background_tasks: BackgroundTasks, email: str = Form(), password: str = Form()) -> dict:
    normalized_email = email.strip().lower()
    with connect() as connection:
        row = connection.execute(
            "SELECT users.*, companies.domain, companies.name AS company_name FROM users LEFT JOIN companies ON companies.id = users.company_id "
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
def logout(user: AuthenticatedUser) -> dict:
    with connect() as connection:
        bump_token_version(connection, user["id"])
    return {"message": "Logout effettuato."}


@app.get("/api/auth/me")
def me(user: AuthenticatedUser) -> dict:
    return user


@app.post("/api/auth/accept-terms")
def accept_terms(user: AuthenticatedUser) -> dict:
    """Accounts are created by someone else: the owner accepts the Terms and the
    Privacy notice at the first login, before using the site."""
    with connect() as connection:
        connection.execute(
            "UPDATE users SET terms_accepted_at = COALESCE(terms_accepted_at, now()) WHERE id = %s", (user["id"],)
        )
    return {"terms_accepted": True}


@app.post("/api/auth/change-password", dependencies=[Depends(enforce_login_rate_limit)])
def change_password(user: AuthenticatedUser, current_password: str = Form(), new_password: str = Form()) -> dict:
    """Optional: the owner of an account decides whether to replace the temporary
    password received from their company admin. Other sessions are revoked; the
    caller gets a fresh token so it stays signed in."""
    _validate_password(new_password)
    with connect() as connection:
        row = connection.execute("SELECT password_hash FROM users WHERE id = %s", (user["id"],)).fetchone()
        if not verify_password(current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="La password attuale non e' corretta.")
        if verify_password(new_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="La nuova password deve essere diversa da quella attuale.")
        connection.execute(
            "UPDATE users SET password_hash = %s, password_is_temporary = false WHERE id = %s",
            (hash_password(new_password), user["id"]),
        )
        bump_token_version(connection, user["id"])
        token_version = connection.execute(
            "SELECT token_version FROM users WHERE id = %s", (user["id"],)
        ).fetchone()["token_version"]
    return {"changed": True, "token": make_token(user["id"], token_version)}


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
            "UPDATE users SET password_hash = %s, password_is_temporary = false WHERE id = %s",
            (hash_password(new_password), row["user_id"]),
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


@app.get("/api/chats/{chat_id}/analyses")
def chat_analyses(chat_id: int, user: CurrentUser) -> list[dict]:
    """Past searches of a chat, newest first, for the history cards."""
    with connect() as connection:
        chat = connection.execute(
            "SELECT id FROM chats WHERE id = %s AND user_id = %s", (chat_id, user["id"])
        ).fetchone()
        if chat is None:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
        rows = connection.execute(
            """
            SELECT id, created_at, question, status, machine_name, machine_type, vision_score,
                   answer, reason, sources, image_thumbnail
            FROM analyses
            WHERE chat_id = %s AND user_id = %s
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (chat_id, user["id"], CHAT_HISTORY_LIMIT),
        ).fetchall()
    return [
        {
            "id": str(row["id"]),
            "created_at": row["created_at"],
            "question": row["question"],
            "status": row["status"],
            "machine_name": row["machine_name"],
            "machine_type": row["machine_type"],
            "vision_score": row["vision_score"],
            "answer": row["answer"],
            # The internal error stays in the backoffice: the user gets a generic reason.
            "reason": "Si e verificato un errore durante l'analisi." if row["status"] == "failed" else row["reason"],
            "sources": [{"source": s.get("source"), "page": s.get("page")} for s in row["sources"] or []],
            "thumbnail": (
                "data:image/jpeg;base64," + base64.b64encode(row["image_thumbnail"]).decode("ascii")
                if row["image_thumbnail"]
                else None
            ),
        }
        for row in rows
    ]


# =============================================================================
# Company area: documents (managed by the company admin, used by everybody in
# the company), employees, dashboard and activity log. The company always
# comes from the caller's account, never from the request, so a company admin
# can never reach another company's data.
# =============================================================================
AUDIT_METADATA_KEYS = ("email", "full_name", "filename", "role", "name", "domain")


def _company_dirs(company_domain: str) -> tuple[Path, Path]:
    """pdfs/ is what the company RAG indexes; archive/ keeps files excluded from it."""
    company_key = hashlib.sha256(company_domain.encode("utf-8")).hexdigest()[:16]
    base = COMPANY_DATA_DIR / company_key
    return base / "pdfs", base / "archive"


def _rebuild_company_index(company_id: int, company_domain: str) -> bool:
    """Rebuilds the company's RAG index from its pdfs/ folder now, so the caller
    can report whether indexing worked. Pending documents become indexed, or
    failed if the build raised."""
    get_assistant().invalidate_company_rag(company_domain)
    try:
        get_assistant().ensure_company_rag_ready(company_domain)
    except Exception:
        logger.exception("Indicizzazione RAG fallita per l'azienda %s", company_domain)
        with connect() as connection:
            connection.execute(
                "UPDATE company_documents SET status = 'failed' WHERE company_id = %s AND status = 'pending'",
                (company_id,),
            )
        return False
    with connect() as connection:
        connection.execute(
            "UPDATE company_documents SET status = 'indexed', indexed_at = now() "
            "WHERE company_id = %s AND status IN ('pending', 'failed')",
            (company_id,),
        )
    return True


def _company_document(connection: Connection, company_id: int, document_id: int) -> dict:
    row = connection.execute(
        "SELECT * FROM company_documents WHERE id = %s AND company_id = %s", (document_id, company_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Documento non trovato.")
    return row


def _document_status(document_id: int) -> str | None:
    with connect() as connection:
        row = connection.execute("SELECT status FROM company_documents WHERE id = %s", (document_id,)).fetchone()
    return row["status"] if row else None


def archive_company_document(company_id: int, company_domain: str, document_id: int) -> dict:
    """Removes the document from the RAG but keeps the file, so it can be re-indexed."""
    _, archive_dir = _company_dirs(company_domain)
    with connect() as connection:
        row = _company_document(connection, company_id, document_id)
        if row["status"] == "archived":
            raise HTTPException(status_code=409, detail="Il documento e' gia' escluso dalla ricerca.")
        source = Path(row["storage_path"])
        if not source.exists():
            raise HTTPException(status_code=409, detail="Il file del documento non e' piu' presente sul server.")
        archive_dir.mkdir(parents=True, exist_ok=True)
        destination = archive_dir / source.name
        shutil.move(str(source), destination)
        connection.execute(
            "UPDATE company_documents SET status = 'archived', indexed_at = NULL, storage_path = %s WHERE id = %s",
            (str(destination), document_id),
        )
    # The next question rebuilds the index without this PDF.
    get_assistant().invalidate_company_rag(company_domain)
    return {"id": document_id, "filename": row["filename"], "status": "archived"}


def reindex_company_document(company_id: int, company_domain: str, document_id: int) -> dict:
    """Puts an archived or failed document back into the RAG and rebuilds the index now."""
    pdf_dir, _ = _company_dirs(company_domain)
    with connect() as connection:
        row = _company_document(connection, company_id, document_id)
        if row["status"] == "indexed":
            raise HTTPException(status_code=409, detail="Il documento e' gia' indicizzato.")
        source = Path(row["storage_path"])
        if not source.exists():
            raise HTTPException(status_code=409, detail="Il file del documento non e' piu' presente sul server.")
        destination = pdf_dir / source.name
        if source != destination:
            pdf_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), destination)
        connection.execute(
            "UPDATE company_documents SET status = 'pending', storage_path = %s WHERE id = %s",
            (str(destination), document_id),
        )
    _rebuild_company_index(company_id, company_domain)
    return {"id": document_id, "filename": row["filename"], "status": _document_status(document_id)}


def delete_company_document_everywhere(company_id: int, company_domain: str, document_id: int) -> dict:
    """Deletes row and file; the next question rebuilds the index without it."""
    with connect() as connection:
        row = _company_document(connection, company_id, document_id)
        connection.execute("DELETE FROM company_documents WHERE id = %s", (document_id,))
    Path(row["storage_path"]).unlink(missing_ok=True)
    get_assistant().invalidate_company_rag(company_domain)
    return {"deleted": True, "filename": row["filename"]}


def _audit_company_action(request: Request, user: dict, action: str, target_type: str, target_id, **metadata) -> None:
    reason = metadata.pop("reason", None)
    with connect() as connection:
        accounts.record_audit(
            connection,
            action=action,
            target_type=target_type,
            target_id=target_id,
            company_id=user["company_id"],
            actor_user_id=user["id"],
            reason=reason,
            metadata={key: value for key, value in metadata.items() if value is not None},
            ip=_client_ip(request),
        )


@app.get("/api/company/documents")
def company_documents(user: CurrentUser) -> list[dict]:
    """Company admin: every document with its state. Employees: only the indexed
    ones, which are the ones they can pick for a chat."""
    if not user["company_id"]:
        return []
    with connect() as connection:
        if user["role"] == "company_admin":
            return connection.execute(
                """
                SELECT documents.id, documents.filename, documents.status, documents.created_at,
                       documents.size_bytes, documents.indexed_at, uploader.email AS uploaded_by
                FROM company_documents AS documents LEFT JOIN users AS uploader ON uploader.id = documents.uploaded_by
                WHERE documents.company_id = %s ORDER BY documents.created_at DESC
                """,
                (user["company_id"],),
            ).fetchall()
        return connection.execute(
            "SELECT id, filename, status, created_at FROM company_documents "
            "WHERE company_id = %s AND status = 'indexed' ORDER BY created_at DESC",
            (user["company_id"],),
        ).fetchall()


@app.post("/api/company/documents")
def upload_company_document(request: Request, user: CompanyAdmin, document: UploadFile = File(...)) -> dict:
    if document.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Carica un documento PDF.")
    safe_name = Path(document.filename or "document.pdf").name
    if not safe_name.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Il file deve avere estensione PDF.")

    header = document.file.read(len(PDF_MAGIC_BYTES))
    document.file.seek(0)
    if header != PDF_MAGIC_BYTES:
        raise HTTPException(status_code=400, detail="Il file non e' un PDF valido.")

    pdf_dir, _ = _company_dirs(user["company_domain"])
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
        document_id = connection.execute(
            "INSERT INTO company_documents(company_id, uploaded_by, filename, storage_path, size_bytes, status, created_at) "
            "VALUES (%s, %s, %s, %s, %s, 'pending', %s) RETURNING id",
            (user["company_id"], user["id"], safe_name, str(destination), total_written, utc_now()),
        ).fetchone()["id"]
    _audit_company_action(request, user, "document.upload", "company_document", document_id, filename=safe_name)

    _rebuild_company_index(user["company_id"], user["company_domain"])
    return {"id": document_id, "filename": safe_name, "status": _document_status(document_id)}


@app.post("/api/company/documents/{document_id}/archive")
def archive_document(request: Request, document_id: int, user: CompanyAdmin) -> dict:
    result = archive_company_document(user["company_id"], user["company_domain"], document_id)
    _audit_company_action(request, user, "document.archive", "company_document", document_id, filename=result["filename"])
    return result


@app.post("/api/company/documents/{document_id}/reindex")
def reindex_document(request: Request, document_id: int, user: CompanyAdmin) -> dict:
    result = reindex_company_document(user["company_id"], user["company_domain"], document_id)
    _audit_company_action(request, user, "document.reindex", "company_document", document_id, filename=result["filename"])
    return result


@app.delete("/api/company/documents/{document_id}")
def delete_company_document(request: Request, document_id: int, user: CompanyAdmin) -> dict:
    result = delete_company_document_everywhere(user["company_id"], user["company_domain"], document_id)
    _audit_company_action(request, user, "document.delete", "company_document", document_id, filename=result["filename"])
    return {"deleted": True}


def _manageable_employee(connection: Connection, admin: dict, employee_id: int) -> dict:
    """An employee of the admin's company. Company admins (including the caller)
    are managed by the super admin only."""
    row = connection.execute(
        "SELECT id, email, full_name, role, status FROM users WHERE id = %s AND company_id = %s",
        (employee_id, admin["company_id"]),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Dipendente non trovato.")
    if row["role"] != "employee":
        raise HTTPException(status_code=403, detail="I responsabili dell'azienda sono gestiti dall'amministrazione.")
    return row


@app.get("/api/company/employees")
def list_employees(user: CompanyAdmin) -> list[dict]:
    with connect() as connection:
        return connection.execute(
            """
            SELECT users.id, users.email, users.full_name, users.role, users.status, users.status_reason,
                   users.password_is_temporary, users.two_factor_enabled, users.last_login_at,
                   users.last_active_at, users.created_at,
                   (SELECT count(*) FROM analyses WHERE analyses.user_id = users.id) AS analyses_count
            FROM users WHERE users.company_id = %s
            ORDER BY users.role DESC, users.created_at
            """,
            (user["company_id"],),
        ).fetchall()


@app.post("/api/company/employees")
def create_employee(request: Request, user: CompanyAdmin, email: str = Form(), full_name: str = Form("")) -> dict:
    """Returns the temporary password once: it is not stored in clear anywhere."""
    with connect() as connection:
        row, password = accounts.create_account(
            connection, email=email, full_name=full_name, company_id=user["company_id"], role="employee",
            created_by_user_id=user["id"],
        )
    _audit_company_action(
        request, user, "employee.create", "user", row["id"], email=row["email"], full_name=row["full_name"]
    )
    return {"employee": row, "temporary_password": password}


@app.post("/api/company/employees/{employee_id}/status")
def set_employee_status(
    request: Request, employee_id: int, user: CompanyAdmin, status: str = Form(), reason: str = Form("")
) -> dict:
    if status not in {"active", "blocked"}:
        raise HTTPException(status_code=400, detail="Stato non valido.")
    reason = reason.strip()[:500]
    if status == "blocked" and not reason:
        raise HTTPException(status_code=400, detail="Indica il motivo della sospensione.")
    with connect() as connection:
        row = _manageable_employee(connection, user, employee_id)
        if row["status"] == status:
            raise HTTPException(status_code=409, detail="Il dipendente e' gia' in questo stato.")
        connection.execute(
            "UPDATE users SET status = %s, status_reason = %s, status_changed_at = now(), status_changed_by = NULL "
            "WHERE id = %s",
            (status, reason if status == "blocked" else None, employee_id),
        )
        if status == "blocked":
            bump_token_version(connection, employee_id)  # ends the employee's sessions now
    action = "employee.block" if status == "blocked" else "employee.unblock"
    _audit_company_action(request, user, action, "user", employee_id, email=row["email"], reason=reason or None)
    return {"id": employee_id, "status": status}


@app.post("/api/company/employees/{employee_id}/reset-password")
def reset_employee_password(request: Request, employee_id: int, user: CompanyAdmin) -> dict:
    with connect() as connection:
        row = _manageable_employee(connection, user, employee_id)
        password = accounts.reset_to_temporary_password(connection, employee_id)
    _audit_company_action(request, user, "employee.reset_password", "user", employee_id, email=row["email"])
    return {"id": employee_id, "temporary_password": password}


@app.get("/api/company/dashboard")
def company_dashboard(user: CompanyAdmin, days: int = 30) -> dict:
    """Statistics only: the company admin never sees the text of questions or answers."""
    days = min(max(days, 1), 365)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    company_id = user["company_id"]
    with connect() as connection:
        people = connection.execute(
            """
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE status = 'active') AS active,
                   count(*) FILTER (WHERE status = 'blocked') AS blocked,
                   count(*) FILTER (WHERE last_active_at >= %s) AS active_in_period,
                   count(*) FILTER (WHERE password_is_temporary) AS temporary_passwords
            FROM users WHERE company_id = %s
            """,
            (since, company_id),
        ).fetchone()
        documents = {
            row["status"]: row["count"]
            for row in connection.execute(
                "SELECT status, count(*) FROM company_documents WHERE company_id = %s GROUP BY status", (company_id,)
            ).fetchall()
        }
        analyses_filter = "FROM analyses JOIN users ON users.id = analyses.user_id WHERE users.company_id = %s AND analyses.created_at >= %s"
        totals = connection.execute(
            f"""
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE analyses.status = 'recognized') AS recognized,
                   count(*) FILTER (WHERE analyses.status = 'not_recognized') AS not_recognized,
                   count(*) FILTER (WHERE analyses.status = 'failed') AS failed,
                   count(*) FILTER (WHERE analyses.knowledge_mode = 'merged') AS with_company_documents,
                   round(avg(analyses.duration_ms)) AS avg_duration_ms
            {analyses_filter}
            """,
            (company_id, since),
        ).fetchone()
        daily_rows = connection.execute(
            f"""
            SELECT (analyses.created_at AT TIME ZONE 'Europe/Rome')::date AS day, count(*) AS total,
                   count(*) FILTER (WHERE analyses.status = 'recognized') AS recognized
            {analyses_filter} GROUP BY 1 ORDER BY 1
            """,
            (company_id, since),
        ).fetchall()
        machines = connection.execute(
            f"""
            SELECT analyses.machine_name, count(*) AS analyses
            {analyses_filter} AND analyses.machine_name IS NOT NULL
            GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5
            """,
            (company_id, since),
        ).fetchall()
        per_employee = connection.execute(
            """
            SELECT users.id, users.email, users.full_name, users.role, users.status, users.last_active_at,
                   count(analyses.id) AS analyses,
                   count(analyses.id) FILTER (WHERE analyses.status = 'recognized') AS recognized,
                   max(analyses.created_at) AS last_analysis_at
            FROM users LEFT JOIN analyses ON analyses.user_id = users.id AND analyses.created_at >= %s
            WHERE users.company_id = %s
            GROUP BY users.id ORDER BY analyses DESC, users.email
            """,
            (since, company_id),
        ).fetchall()
        today = connection.execute("SELECT (now() AT TIME ZONE 'Europe/Rome')::date AS today").fetchone()["today"]

    by_day = {row["day"]: row for row in daily_rows}
    daily = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        row = by_day.get(day)
        daily.append({"day": day.isoformat(), "total": row["total"] if row else 0,
                      "recognized": row["recognized"] if row else 0})
    total = totals["total"]
    return {
        "days": days,
        "employees": people,
        "documents": {status: documents.get(status, 0) for status in ("indexed", "archived", "pending", "failed")},
        "analyses": {
            **totals,
            "avg_duration_ms": int(totals["avg_duration_ms"]) if totals["avg_duration_ms"] is not None else None,
            "recognition_rate": round(totals["recognized"] / total, 3) if total else None,
        },
        "daily": daily,
        "top_machines": machines,
        "per_employee": per_employee,
    }


@app.get("/api/company/audit")
def company_audit(user: CompanyAdmin, page: int = 1, page_size: int = 50) -> dict:
    """Activity log rows of the caller's company: actions of its admins and of the
    platform administration on it. Metadata is reduced to non-sensitive fields."""
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT log.id, log.created_at, log.action, log.target_type, log.target_id, log.reason,
                   log.metadata, log.operator_id, actor.email AS actor_email, actor.full_name AS actor_name,
                   count(*) OVER () AS total
            FROM ops.audit_log AS log LEFT JOIN users AS actor ON actor.id = log.actor_user_id
            WHERE log.company_id = %s
            ORDER BY log.created_at DESC, log.id DESC
            LIMIT %s OFFSET %s
            """,
            (user["company_id"], page_size, (page - 1) * page_size),
        ).fetchall()
    items = [
        {
            "id": row["id"],
            "created_at": row["created_at"],
            "action": row["action"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "reason": row["reason"],
            "actor": row["actor_name"] or row["actor_email"]
            or ("Amministrazione piattaforma" if row["operator_id"] else None),
            "details": {key: row["metadata"][key] for key in AUDIT_METADATA_KEYS if key in (row["metadata"] or {})},
        }
        for row in rows
    ]
    return {"items": items, "total": rows[0]["total"] if rows else 0, "page": page, "page_size": page_size}


_SOURCE_EXCERPT_CHARS = 400


def _make_thumbnail(image_path: Path) -> bytes | None:
    """Small JPEG of the uploaded photo for the chat history. Best effort: a
    photo Pillow can't read simply has no thumbnail."""
    try:
        from PIL import Image, ImageOps

        with Image.open(image_path) as image:
            thumbnail = ImageOps.exif_transpose(image).convert("RGB")
            thumbnail.thumbnail((THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE))
            buffer = io.BytesIO()
            thumbnail.save(buffer, format="JPEG", quality=THUMBNAIL_JPEG_QUALITY, optimize=True)
            return buffer.getvalue()
    except Exception:
        logger.warning("Impossibile creare la miniatura di %s", image_path.name, exc_info=True)
        return None


def _record_analysis(
    *,
    user: dict,
    chat_id: int | None,
    knowledge_mode: str,
    question: str,
    image: UploadFile,
    image_size: int,
    started: float,
    thumbnail: bytes | None = None,
    result: dict | None = None,
    error: str | None = None,
) -> str | None:
    """Stores one row in app.analyses for the backoffice and the chat history,
    and returns its id. Best effort: a failure here is logged and never breaks
    the user's answer."""
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
            row = connection.execute(
                """
                INSERT INTO analyses(
                    user_id, chat_id, knowledge_mode, question, status,
                    machine_id, machine_name, machine_type, vision_score, exact_model_identified,
                    model_code, serial_number, asset_tag, vision_candidates,
                    answer, sources, reason, error_message,
                    image_filename, image_content_type, image_size_bytes, image_thumbnail, duration_ms
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s
                )
                RETURNING id
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
                    Path(image.filename or "").name or None, image.content_type, image_size, thumbnail,
                    int((time.monotonic() - started) * 1000),
                ),
            ).fetchone()
            connection.execute("UPDATE users SET last_active_at = now() WHERE id = %s", (user["id"],))
        return str(row["id"])
    except Exception:
        logger.exception("Impossibile registrare l'analisi per l'utente %s", user["id"])
        return None


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


class InternalCompanyIn(BaseModel):
    name: str
    domain: str
    operator_id: int | None = None


class InternalAccountIn(BaseModel):
    email: str
    full_name: str | None = None
    operator_id: int | None = None


class InternalRoleIn(BaseModel):
    role: str


def _internal_company(connection: Connection, company_id: int) -> dict:
    row = connection.execute("SELECT id, name, domain FROM companies WHERE id = %s", (company_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Azienda non trovata.")
    return row


@app.post("/internal/companies", dependencies=[Depends(require_backoffice_token)])
def internal_create_company(body: InternalCompanyIn) -> dict:
    """Super admin: new company. The domain identifies it (and its documents folder)."""
    name = accounts.clean_name(body.name, required=True, field="nome dell'azienda")
    domain = accounts.clean_domain(body.domain)
    with connect() as connection:
        try:
            return connection.execute(
                "INSERT INTO companies(name, domain, created_by_operator_id, created_at) VALUES (%s, %s, %s, %s) "
                "RETURNING id, name, domain, created_at",
                (name, domain, body.operator_id, utc_now()),
            ).fetchone()
        except pg_errors.UniqueViolation as exc:
            raise HTTPException(status_code=409, detail="Esiste gia' un'azienda con questo dominio.") from exc


@app.post("/internal/companies/{company_id}/accounts", dependencies=[Depends(require_backoffice_token)])
def internal_create_account(company_id: int, body: InternalAccountIn, role: str = "company_admin") -> dict:
    """Super admin: new company admin (default) or employee, with a temporary password returned once."""
    with connect() as connection:
        company = _internal_company(connection, company_id)
        row, password = accounts.create_account(
            connection, email=body.email, full_name=body.full_name, company_id=company["id"], role=role,
            created_by_operator_id=body.operator_id,
        )
    return {"user": row, "company": company, "temporary_password": password}


@app.post("/internal/users/{user_id}/role", dependencies=[Depends(require_backoffice_token)])
def internal_set_role(user_id: int, body: InternalRoleIn) -> dict:
    """Super admin: promote an employee to company admin, or back."""
    if body.role not in accounts.ROLES:
        raise HTTPException(status_code=400, detail="Ruolo non valido.")
    with connect() as connection:
        row = connection.execute(
            "SELECT id, email, role, company_id FROM users WHERE id = %s", (user_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Utente non trovato.")
        if row["company_id"] is None:
            raise HTTPException(status_code=409, detail="L'utente non appartiene a nessuna azienda.")
        if row["role"] == body.role:
            raise HTTPException(status_code=409, detail="L'utente ha gia' questo ruolo.")
        connection.execute("UPDATE users SET role = %s WHERE id = %s", (body.role, user_id))
    return {"id": user_id, "email": row["email"], "company_id": row["company_id"], "role": body.role,
            "previous_role": row["role"]}


@app.post("/internal/users/{user_id}/reset-password", dependencies=[Depends(require_backoffice_token)])
def internal_reset_password(user_id: int) -> dict:
    with connect() as connection:
        row = connection.execute("SELECT id, email, company_id FROM users WHERE id = %s", (user_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Utente non trovato.")
        password = accounts.reset_to_temporary_password(connection, user_id)
    return {"id": user_id, "email": row["email"], "company_id": row["company_id"], "temporary_password": password}


def _internal_document_company(document_id: int) -> dict:
    with connect() as connection:
        row = connection.execute(
            "SELECT companies.id, companies.domain FROM company_documents AS documents "
            "JOIN companies ON companies.id = documents.company_id WHERE documents.id = %s",
            (document_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Documento non trovato.")
    return row


@app.post("/internal/company-documents/{document_id}/archive", dependencies=[Depends(require_backoffice_token)])
def internal_archive_document(document_id: int) -> dict:
    company = _internal_document_company(document_id)
    return {**archive_company_document(company["id"], company["domain"], document_id), "company_id": company["id"]}


@app.post("/internal/company-documents/{document_id}/reindex", dependencies=[Depends(require_backoffice_token)])
def internal_reindex_document(document_id: int) -> dict:
    company = _internal_document_company(document_id)
    return {**reindex_company_document(company["id"], company["domain"], document_id), "company_id": company["id"]}


@app.post("/api/transcribe", dependencies=[Depends(enforce_transcribe_rate_limit)])
def transcribe(user: CurrentUser, audio: Annotated[UploadFile, File()]) -> dict:
    content_type = (audio.content_type or "").split(";")[0].strip()
    if not content_type.startswith("audio/") and content_type != "video/webm":
        raise HTTPException(status_code=400, detail="Carica un file audio valido.")

    suffix = Path(audio.filename or "recording.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(prefix="question-audio-", suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(audio.file, tmp)
        audio_path = Path(tmp.name)
    try:
        size = audio_path.stat().st_size
        if size == 0:
            raise HTTPException(status_code=400, detail="La registrazione e vuota.")
        if size > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="Registrazione troppo lunga.")
        try:
            text = get_transcriber().transcribe(audio_path)
        except Exception:
            logger.exception("Transcription failed for user %s", user["id"])
            raise HTTPException(status_code=500, detail="Trascrizione non riuscita. Riprova.") from None
    finally:
        audio_path.unlink(missing_ok=True)

    if not text:
        raise HTTPException(status_code=422, detail="Non ho capito la domanda. Riprova parlando piu vicino al microfono.")
    return {"text": text}


@app.post("/api/speak", dependencies=[Depends(enforce_speak_rate_limit)])
def speak(user: CurrentUser, text: Annotated[str, Form()]) -> Response:
    text = text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Nessun testo da leggere.")
    if len(text) > MAX_SPEAK_CHARS:
        raise HTTPException(status_code=413, detail="Testo troppo lungo.")
    try:
        audio = get_synthesizer().synthesize(text)
    except Exception:
        logger.exception("Speech synthesis failed for user %s", user["id"])
        raise HTTPException(status_code=500, detail="Lettura non riuscita. Riprova.") from None
    return Response(content=audio, media_type="audio/wav")


@app.post("/api/ask", dependencies=[Depends(enforce_ask_rate_limit)])
def ask(
    user: CurrentUser,
    question: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
    chat_id: Annotated[int | None, Form()] = None,
    top_k: Annotated[int, Form()] = 12,
) -> dict:
    profile = perf.current()
    if profile is not None:
        # Multipart parsing of the upload + CurrentUser (token check, user lookup).
        perf.add("upload_auth", profile.total_ms())
    if not question.strip():
        raise HTTPException(status_code=400, detail="La domanda e obbligatoria.")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Carica un file immagine valido.")

    started = time.monotonic()
    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    with perf.stage("image_save"), tempfile.NamedTemporaryFile(prefix="machine-upload-", suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(image.file, tmp)
        image_path = Path(tmp.name)
    image_size = image_path.stat().st_size
    perf.metric("image_bytes", image_size)

    knowledge_mode = "base"
    record = {
        "user": user,
        "chat_id": chat_id,
        "question": question.strip(),
        "image": image,
        "image_size": image_size,
        "started": started,
    }
    with perf.stage("thumbnail"):
        record["thumbnail"] = _make_thumbnail(image_path)
    try:
        if chat_id is not None:
            with perf.stage("db_chat"), connect() as connection:
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
        db_started = time.perf_counter()
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
        analysis_id = _record_analysis(**record, knowledge_mode=knowledge_mode, result=result)
        perf.add("db_save", (time.perf_counter() - db_started) * 1000)
        return {**result, "analysis_id": analysis_id}
    except ValueError as exc:
        analysis_id = _record_analysis(
            **record, knowledge_mode=knowledge_mode, result={"recognized": False, "reason": str(exc)}
        )
        return {"recognized": False, "reason": str(exc), "question": question, "analysis_id": analysis_id}
    except HTTPException:
        raise
    except LLMError as exc:
        # Already logged by the provider; the client only gets the public message.
        _record_analysis(**record, knowledge_mode=knowledge_mode, error=f"{type(exc).__name__}: {exc}"[:2000])
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from None
    except Exception as exc:
        logger.exception("Errore interno durante l'elaborazione di /api/ask")
        _record_analysis(**record, knowledge_mode=knowledge_mode, error=f"{type(exc).__name__}: {exc}"[:2000])
        raise HTTPException(status_code=500, detail="Si e verificato un errore interno. Riprova piu tardi.")
    finally:
        image_path.unlink(missing_ok=True)
