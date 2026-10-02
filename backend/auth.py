from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from backend.database import USER_COMPANY_COLUMNS, connect, decode_token, public_user


EMAIL_RE = re.compile(r"^[^@\s]+@([^@\s]+)$")


def email_domain(email: str) -> str:
    match = EMAIL_RE.fullmatch(email.strip().lower())
    if not match:
        raise HTTPException(status_code=400, detail="Inserisci un indirizzo email valido.")
    return match.group(1)


def authenticated_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    """Valid session, whatever the state of the account's onboarding. Only for
    the endpoints an account needs before it can use the site: profile, terms
    acceptance, password change, logout."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Autenticazione richiesta.")
    decoded = decode_token(authorization.removeprefix("Bearer ").strip())
    if decoded is None:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto.")
    with connect() as connection:
        row = connection.execute(
            f"""
            SELECT users.*, {USER_COMPANY_COLUMNS}
            FROM users LEFT JOIN companies ON companies.id = users.company_id
            WHERE users.id = %s
            """,
            (decoded["user_id"],),
        ).fetchone()
    if row is None or row["token_version"] != decoded["token_version"]:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto.")
    if row["status"] == "blocked":
        raise HTTPException(status_code=403, detail="Account sospeso. Contatta l'assistenza.")
    return public_user(row)


def current_user(user: Annotated[dict, Depends(authenticated_user)]) -> dict:
    """Default dependency: also requires the Terms to be accepted. Accounts are
    created by someone else, so the owner accepts them at the first login."""
    if not user["terms_accepted"]:
        raise HTTPException(
            status_code=403,
            detail="Accetta i Termini di servizio e l'Informativa sulla privacy per continuare.",
        )
    return user


def company_admin(user: Annotated[dict, Depends(current_user)]) -> dict:
    if user["role"] != "company_admin" or user["company_id"] is None:
        raise HTTPException(status_code=403, detail="Funzione riservata al responsabile dell'azienda.")
    return user


AuthenticatedUser = Annotated[dict, Depends(authenticated_user)]
CurrentUser = Annotated[dict, Depends(current_user)]
CompanyAdmin = Annotated[dict, Depends(company_admin)]
