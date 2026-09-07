from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Header, HTTPException

from backend.database import connect, decode_token, public_user


EMAIL_RE = re.compile(r"^[^@\s]+@([^@\s]+)$")


def email_domain(email: str) -> str:
    match = EMAIL_RE.fullmatch(email.strip().lower())
    if not match:
        raise HTTPException(status_code=400, detail="Inserisci un indirizzo email valido.")
    return match.group(1)


def current_user(authorization: Annotated[str | None, Header()] = None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Autenticazione richiesta.")
    decoded = decode_token(authorization.removeprefix("Bearer ").strip())
    if decoded is None:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto.")
    with connect() as connection:
        row = connection.execute(
            """
            SELECT users.*, companies.domain
            FROM users LEFT JOIN companies ON companies.id = users.company_id
            WHERE users.id = ?
            """,
            (decoded["user_id"],),
        ).fetchone()
    if row is None or row["token_version"] != decoded["token_version"]:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto.")
    return public_user(row)


CurrentUser = Annotated[dict, Depends(current_user)]
