from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger("backend.email")

# Works with any standard SMTP relay. For Brevo (https://app.brevo.com,
# free tier: 300 emails/day, no domain verification needed to get started):
#   SMTP_HOST=smtp-relay.brevo.com
#   SMTP_PORT=587
#   SMTP_USER=<the login shown on the Brevo SMTP & API page>
#   SMTP_PASSWORD=<the SMTP key generated on that same page - not your account password>
#   SMTP_FROM=<a "From" address you verified in Brevo>
SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")
SMTP_FROM = os.getenv("SMTP_FROM", "no-reply@example.com")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "1") == "1"
APP_BASE_URL = os.getenv("APP_BASE_URL", "http://localhost:3000")


def verification_link(token: str) -> str:
    return f"{APP_BASE_URL.rstrip('/')}/verify-email?token={token}"


def password_reset_link(token: str) -> str:
    return f"{APP_BASE_URL.rstrip('/')}/reset-password?token={token}"


def _send_or_log(to_email: str, subject: str, body: str, link: str, kind: str) -> None:
    """Send an email via SMTP, or - if no SMTP provider is configured - log
    it instead so dev/test flows keep working without a real mailbox."""
    if not SMTP_HOST:
        logger.info(
            "SMTP non configurato: link di %s per %s stampato nei log invece che inviato via email: %s",
            kind,
            to_email,
            link,
        )
        return

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = SMTP_FROM
    message["To"] = to_email
    message.set_content(body)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as client:
        if SMTP_USE_TLS:
            client.starttls()
        if SMTP_USER and SMTP_PASSWORD:
            client.login(SMTP_USER, SMTP_PASSWORD)
        client.send_message(message)


def send_verification_email(to_email: str, token: str) -> None:
    """Send (or log, if SMTP is not configured) the account verification link."""
    link = verification_link(token)
    _send_or_log(
        to_email,
        subject="Conferma il tuo account",
        body=f"Conferma il tuo account seguendo questo link:\n{link}\n\nIl link scade tra 24 ore.",
        link=link,
        kind="verifica",
    )


def send_password_reset_email(to_email: str, token: str) -> None:
    """Send (or log, if SMTP is not configured) the password reset link."""
    link = password_reset_link(token)
    _send_or_log(
        to_email,
        subject="Reimposta la tua password",
        body=(
            f"Hai chiesto di reimpostare la password. Segui questo link:\n{link}\n\n"
            "Il link scade tra 1 ora. Se non hai richiesto tu il reset, ignora questa email."
        ),
        link=link,
        kind="reset password",
    )
