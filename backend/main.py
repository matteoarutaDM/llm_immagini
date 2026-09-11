from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import shutil
import sqlite3
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend import email_service
from backend.auth import CurrentUser, email_domain
from backend.database import (
    bump_token_version,
    connect,
    consume_password_reset_token,
    create_password_reset_token,
    hash_password,
    init_db,
    is_locked,
    make_token,
    register_failed_login,
    reset_failed_login,
    utc_now,
    verify_password,
)
from backend.public_email_domains import is_public_domain
from backend.rate_limit import SlidingWindowRateLimiter


# Without this, every logger in the app (this module's, email_service's,
# ...) inherits the root logger's default WARNING level with no handler
# attached, so all INFO-level logging - including the dev-mode "verification
# link" fallback in email_service.py - is silently dropped. uvicorn only
# configures its own "uvicorn.*" loggers, not the root logger, so this must
# be done here.
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
RATE_LIMIT_ACCOUNT_RECOVERY_MAX = int(os.getenv("RATE_LIMIT_ACCOUNT_RECOVERY_MAX", "5"))
RATE_LIMIT_ACCOUNT_RECOVERY_WINDOW_SECONDS = float(os.getenv("RATE_LIMIT_ACCOUNT_RECOVERY_WINDOW_SECONDS", "60"))

# Fixed dummy hash used to keep the login endpoint's timing constant whether
# or not the email exists (see login()). Computed once at import time.
_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))

_login_limiter = SlidingWindowRateLimiter(RATE_LIMIT_LOGIN_MAX, RATE_LIMIT_LOGIN_WINDOW_SECONDS)
_register_limiter = SlidingWindowRateLimiter(RATE_LIMIT_REGISTER_MAX, RATE_LIMIT_REGISTER_WINDOW_SECONDS)
_ask_limiter = SlidingWindowRateLimiter(RATE_LIMIT_ASK_MAX, RATE_LIMIT_ASK_WINDOW_SECONDS)
# Used by forgot-password: it sends an email to an address supplied by the
# caller, so it needs abuse protection independent of the login limiter.
_account_recovery_limiter = SlidingWindowRateLimiter(
    RATE_LIMIT_ACCOUNT_RECOVERY_MAX, RATE_LIMIT_ACCOUNT_RECOVERY_WINDOW_SECONDS
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


def enforce_account_recovery_rate_limit(request: Request) -> None:
    if not _account_recovery_limiter.allow(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Troppe richieste. Riprova piu tardi.")


def _associate_company_if_applicable(connection: sqlite3.Connection, user_id: int, email: str) -> None:
    """Creates (if needed) and links the company matching the user's email
    domain, unless the domain is a public/personal one. Called at
    registration, since accounts are active immediately."""
    domain = email_domain(email)
    if is_public_domain(domain):
        return
    connection.execute(
        "INSERT OR IGNORE INTO companies(domain, name, created_at) VALUES (?, ?, ?)",
        (domain, domain, utc_now()),
    )
    company_id = connection.execute("SELECT id FROM companies WHERE domain = ?", (domain,)).fetchone()[0]
    connection.execute("UPDATE users SET company_id = ? WHERE id = ?", (company_id, user_id))


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
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="La password deve contenere almeno 8 caratteri.")
    if not terms_accepted:
        raise HTTPException(
            status_code=400,
            detail="Devi accettare i Termini di servizio e l'Informativa sulla privacy per registrarti.",
        )
    email_domain(email)  # validates the email format; the domain itself is used below

    with connect() as connection:
        try:
            cursor = connection.execute(
                "INSERT INTO users(email, password_hash, company_id, email_verified, terms_accepted_at, created_at) "
                "VALUES (?, ?, NULL, 1, ?, ?)",
                (email, hash_password(password), utc_now(), utc_now()),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Questa email e gia registrata.") from exc
        user_id = cursor.lastrowid

        _associate_company_if_applicable(connection, user_id, email)
        row = connection.execute(
            "SELECT users.*, companies.domain FROM users LEFT JOIN companies ON companies.id = users.company_id "
            "WHERE users.id = ?",
            (user_id,),
        ).fetchone()
        return {
            "token": make_token(row["id"], row["token_version"]),
            "email": row["email"],
            "company_domain": row["domain"],
        }


@app.post("/api/auth/login", dependencies=[Depends(enforce_login_rate_limit)])
def login(email: str = Form(), password: str = Form()) -> dict:
    normalized_email = email.strip().lower()
    with connect() as connection:
        row = connection.execute(
            "SELECT users.*, companies.domain FROM users LEFT JOIN companies ON companies.id = users.company_id "
            "WHERE email = ?",
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

    return {
        "token": make_token(row["id"], row["token_version"]),
        "email": row["email"],
        "company_domain": row["domain"],
    }


@app.post("/api/auth/logout")
def logout(user: CurrentUser) -> dict:
    with connect() as connection:
        bump_token_version(connection, user["id"])
    return {"message": "Logout effettuato."}


@app.post("/api/auth/forgot-password", dependencies=[Depends(enforce_account_recovery_rate_limit)])
def forgot_password(email: str = Form()) -> dict:
    generic_message = {"message": "Se l'indirizzo esiste, riceverai un'email con le istruzioni per il reset."}
    with connect() as connection:
        row = connection.execute(
            "SELECT id FROM users WHERE email = ?", (email.strip().lower(),)
        ).fetchone()
        if row is None:
            # Same response as the success case: don't reveal whether the
            # email is registered.
            return generic_message
        reset_token = create_password_reset_token(connection, row["id"])
    email_service.send_password_reset_email(email.strip().lower(), reset_token)
    return generic_message


@app.post("/api/auth/reset-password")
def reset_password(token: str = Form(), password: str = Form()) -> dict:
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="La password deve contenere almeno 8 caratteri.")
    with connect() as connection:
        user_id = consume_password_reset_token(connection, token)
        if user_id is None:
            raise HTTPException(status_code=400, detail="Token di reset non valido o scaduto.")
        connection.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(password), user_id)
        )
        # Resetting the password invalidates every session issued before now,
        # in case the reset was triggered because the old password/sessions
        # were compromised.
        bump_token_version(connection, user_id)
    return {"message": "Password aggiornata. Ora puoi accedere con la nuova password."}


@app.get("/api/auth/me")
def me(user: CurrentUser) -> dict:
    return user


@app.get("/api/chats")
def list_chats(user: CurrentUser) -> list[dict]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT id, title, knowledge_mode, company_document_ids, created_at, updated_at "
            "FROM chats WHERE user_id = ? ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
    return [{**dict(row), "company_document_ids": json.loads(row["company_document_ids"])} for row in rows]


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
        cursor = connection.execute(
            "INSERT INTO chats(user_id, title, knowledge_mode, company_document_ids, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], title.strip() or "Nuova chat", knowledge_mode, json.dumps(selected_documents), now, now),
        )
        chat_id = cursor.lastrowid
    return {"id": chat_id, "title": title.strip() or "Nuova chat", "knowledge_mode": knowledge_mode}


@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: int, user: CurrentUser, title: str = Form()) -> dict:
    clean_title = title.strip() or "Nuova chat"
    with connect() as connection:
        cursor = connection.execute(
            "UPDATE chats SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (clean_title, utc_now(), chat_id, user["id"]),
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
    return {"id": chat_id, "title": clean_title}


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int, user: CurrentUser) -> dict:
    with connect() as connection:
        cursor = connection.execute(
            "DELETE FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"])
        )
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
    return {"deleted": True}


@app.get("/api/chats/{chat_id}/messages")
def chat_messages(chat_id: int, user: CurrentUser) -> list[dict]:
    with connect() as connection:
        chat = connection.execute(
            "SELECT id FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"])
        ).fetchone()
        if chat is None:
            raise HTTPException(status_code=404, detail="Chat non trovata.")
        rows = connection.execute(
            "SELECT id, role, content, created_at FROM messages WHERE chat_id = ? ORDER BY id",
            (chat_id,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/company/documents")
def company_documents(user: CurrentUser) -> list[dict]:
    if not user["company_domain"]:
        return []
    with connect() as connection:
        rows = connection.execute(
            """
            SELECT documents.id, documents.filename, documents.created_at
            FROM documents JOIN companies ON companies.id = documents.company_id
            WHERE companies.domain = ? ORDER BY documents.created_at DESC
            """,
            (user["company_domain"],),
        ).fetchall()
    return [dict(row) for row in rows]


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
            "SELECT id FROM companies WHERE domain = ?", (user["company_domain"],)
        ).fetchone()
        cursor = connection.execute(
            "INSERT INTO documents(company_id, filename, path, created_at) VALUES (?, ?, ?, ?)",
            (company["id"], safe_name, str(destination), utc_now()),
        )
    get_assistant().invalidate_company_rag(user["company_domain"])
    return {"id": cursor.lastrowid, "filename": safe_name}


@app.delete("/api/company/documents/{document_id}")
def delete_company_document(document_id: int, user: CurrentUser) -> dict:
    if not user["company_domain"]:
        raise HTTPException(status_code=403, detail="Solo gli utenti aziendali possono gestire documenti.")
    with connect() as connection:
        row = connection.execute(
            """
            SELECT documents.id, documents.path FROM documents
            JOIN companies ON companies.id = documents.company_id
            WHERE documents.id = ? AND companies.domain = ?
            """,
            (document_id, user["company_domain"]),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Documento non trovato.")
        connection.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    Path(row["path"]).unlink(missing_ok=True)
    get_assistant().invalidate_company_rag(user["company_domain"])
    return {"deleted": True}


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

    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(prefix="machine-upload-", suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(image.file, tmp)
        image_path = Path(tmp.name)

    try:
        knowledge_mode = "base"
        if chat_id is not None:
            with connect() as connection:
                chat = connection.execute(
                    "SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"])
                ).fetchone()
            if chat is None:
                raise HTTPException(status_code=404, detail="Chat non trovata.")
            knowledge_mode = chat["knowledge_mode"]
            company_document_ids = json.loads(chat["company_document_ids"])
        else:
            company_document_ids = None
        result = get_assistant().ask_machine(
            image_path=image_path,
            question=question.strip(),
            top_k=top_k,
            knowledge_mode=knowledge_mode,
            company_domain=user["company_domain"],
            company_document_ids=company_document_ids,
        )
        if chat_id is not None:
            with connect() as connection:
                connection.execute(
                    "INSERT INTO messages(chat_id, role, content, created_at) VALUES (?, 'user', ?, ?)",
                    (chat_id, question.strip(), utc_now()),
                )
                if result.get("answer"):
                    connection.execute(
                        "INSERT INTO messages(chat_id, role, content, created_at) VALUES (?, 'assistant', ?, ?)",
                        (chat_id, result["answer"], utc_now()),
                    )
                connection.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (utc_now(), chat_id))
        return result
    except ValueError as exc:
        return {"recognized": False, "reason": str(exc), "question": question}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Errore interno durante l'elaborazione di /api/ask")
        raise HTTPException(status_code=500, detail="Si e verificato un errore interno. Riprova piu tardi.")
    finally:
        image_path.unlink(missing_ok=True)
