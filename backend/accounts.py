"""Accounts created by someone else, and the shared activity log.

There is no self-registration: the super admin (backoffice) creates companies
and their company admins, company admins create their employees. Every new
account gets a temporary password, shown once to its creator; the owner can
keep it or change it from their profile.
"""
from __future__ import annotations

import ipaddress
import re
import secrets
from typing import Any

from fastapi import HTTPException
from psycopg import Connection, errors as pg_errors
from psycopg.types.json import Jsonb

from backend.auth import email_domain
from backend.database import bump_token_version, hash_password, utc_now

ROLES = ("employee", "company_admin")
# No 0/O, 1/l/I: the password is read from a screen and typed by someone else.
_TEMPORARY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
TEMPORARY_PASSWORD_LENGTH = 12
MAX_NAME_LENGTH = 200
DOMAIN_RE = re.compile(r"^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def generate_temporary_password() -> str:
    while True:
        password = "".join(secrets.choice(_TEMPORARY_ALPHABET) for _ in range(TEMPORARY_PASSWORD_LENGTH))
        # At least one digit, one lower and one upper case letter.
        if any(c.isdigit() for c in password) and any(c.islower() for c in password) and any(c.isupper() for c in password):
            return password


def clean_name(value: str | None, *, required: bool, field: str) -> str | None:
    value = (value or "").strip()
    if not value:
        if required:
            raise HTTPException(status_code=400, detail=f"Il campo {field} e' obbligatorio.")
        return None
    if len(value) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Il campo {field} e' troppo lungo.")
    return value


def clean_domain(value: str) -> str:
    domain = (value or "").strip().lower().removeprefix("@")
    if not DOMAIN_RE.fullmatch(domain):
        raise HTTPException(status_code=400, detail="Dominio non valido (esempio: azienda.it).")
    return domain


def create_account(
    connection: Connection,
    *,
    email: str,
    full_name: str | None,
    company_id: int,
    role: str,
    created_by_user_id: int | None = None,
    created_by_operator_id: int | None = None,
) -> tuple[dict, str]:
    """Creates a user with a temporary password. Returns (row, password): the
    password is never stored in clear and must be handed over by the creator."""
    if role not in ROLES:
        raise HTTPException(status_code=400, detail="Ruolo non valido.")
    email = email.strip().lower()
    email_domain(email)  # validates the format
    full_name = clean_name(full_name, required=False, field="nome")
    password = generate_temporary_password()
    try:
        row = connection.execute(
            """
            INSERT INTO users(email, password_hash, company_id, role, full_name, password_is_temporary,
                              created_by_user_id, created_by_operator_id, created_at)
            VALUES (%s, %s, %s, %s, %s, true, %s, %s, %s)
            RETURNING id, email, full_name, role, company_id, status, created_at
            """,
            (email, hash_password(password), company_id, role, full_name,
             created_by_user_id, created_by_operator_id, utc_now()),
        ).fetchone()
    except pg_errors.UniqueViolation as exc:
        raise HTTPException(status_code=409, detail="Esiste gia' un account con questa email.") from exc
    return row, password


def reset_to_temporary_password(connection: Connection, user_id: int) -> str:
    """New temporary password, every session revoked, lockout cleared."""
    password = generate_temporary_password()
    connection.execute(
        "UPDATE users SET password_hash = %s, password_is_temporary = true, failed_login_attempts = 0, "
        "locked_until = NULL WHERE id = %s",
        (hash_password(password), user_id),
    )
    bump_token_version(connection, user_id)
    return password


def record_audit(
    connection: Connection,
    *,
    action: str,
    target_type: str,
    target_id: Any,
    company_id: int | None,
    actor_user_id: int | None = None,
    operator_id: int | None = None,
    reason: str | None = None,
    metadata: dict | None = None,
    ip: str | None = None,
) -> None:
    """Appends to ops.audit_log, the single activity log read by the super admin
    (everything) and by each company admin (only rows of their company)."""
    connection.execute(
        """
        INSERT INTO ops.audit_log(operator_id, actor_user_id, company_id, action, target_type, target_id,
                                  reason, metadata, ip)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (operator_id, actor_user_id, company_id, action, target_type, str(target_id), reason,
         Jsonb(metadata or {}), _valid_ip(ip)),
    )


def _valid_ip(value: str | None) -> str | None:
    """The column is inet: anything that is not an IP (e.g. behind some proxies) is dropped."""
    try:
        return str(ipaddress.ip_address(value)) if value else None
    except ValueError:
        return None
