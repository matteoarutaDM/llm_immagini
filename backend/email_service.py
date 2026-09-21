from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

from backend.database import IS_PRODUCTION

logger = logging.getLogger("backend.email")

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "no-reply@assistente-macchine.local")
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Assistente Macchine")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "true").strip().lower() != "false"

# Local-dev convenience only: when SMTP isn't configured, log the reset link
# instead of silently dropping it so the flow stays testable end-to-end.
# Must never be enabled in production (enforced below).
DEBUG_EMAIL_TOKENS = os.getenv("DEBUG_EMAIL_TOKENS", "false").strip().lower() == "true"
if DEBUG_EMAIL_TOKENS and IS_PRODUCTION:
    raise RuntimeError(
        "DEBUG_EMAIL_TOKENS non puo' essere abilitata quando APP_ENV=production."
    )


def _build_message(to_email: str, subject: str, body: str) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>"
    message["To"] = to_email
    message.set_content(body)
    return message


def _send(message: EmailMessage) -> None:
    if not SMTP_HOST:
        if DEBUG_EMAIL_TOKENS:
            logger.info(
                "DEBUG_EMAIL_TOKENS attivo, SMTP non configurato: email non inviata.\n%s",
                message.get_content(),
            )
        else:
            logger.info("SMTP non configurato: email a %s non inviata (modalita' sviluppo).", message["To"])
        return
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as client:
            if SMTP_USE_TLS:
                client.starttls()
            if SMTP_USERNAME and SMTP_PASSWORD:
                client.login(SMTP_USERNAME, SMTP_PASSWORD)
            client.send_message(message)
    except Exception:
        # Never let an SMTP failure surface to the caller: forgot-password
        # must always return its generic response regardless of delivery.
        logger.exception("Invio email non riuscito.")


def send_password_reset_email(to_email: str, reset_link: str, ttl_minutes: int) -> None:
    subject = "Reimposta la password — Assistente Macchine"
    body = (
        "Abbiamo ricevuto una richiesta per reimpostare la password del tuo account.\n\n"
        f"Reimposta la password: {reset_link}\n\n"
        f"Il link scadra' tra {ttl_minutes} minuti.\n\n"
        "Se non hai richiesto questa modifica, puoi ignorare questa email."
    )
    if DEBUG_EMAIL_TOKENS and not SMTP_HOST:
        logger.info("DEBUG_EMAIL_TOKENS: link di reset per %s -> %s", to_email, reset_link)
    _send(_build_message(to_email, subject, body))


_PURPOSE_INTRO = {
    "enable": "Stai attivando l'autenticazione a due fattori sul tuo account.",
    "login": "Stai effettuando l'accesso al tuo account.",
    "disable": "Stai disattivando l'autenticazione a due fattori sul tuo account.",
    "regenerate": "Stai generando nuovi codici di recupero per l'autenticazione a due fattori.",
}


def send_two_factor_code_email(to_email: str, code: str, purpose: str, ttl_minutes: int) -> None:
    subject = "Il tuo codice di verifica — Assistente Macchine"
    intro = _PURPOSE_INTRO.get(purpose, "Ti serve un codice di verifica per il tuo account.")
    body = (
        f"{intro}\n\n"
        f"Codice di verifica: {code}\n\n"
        f"Il codice scadra' tra {ttl_minutes} minuti ed e' valido una sola volta.\n\n"
        "Se non sei stato tu a richiederlo, ignora questa email e valuta di cambiare la password."
    )
    if DEBUG_EMAIL_TOKENS and not SMTP_HOST:
        logger.info("DEBUG_EMAIL_TOKENS: codice 2FA (%s) per %s -> %s", purpose, to_email, code)
    _send(_build_message(to_email, subject, body))
