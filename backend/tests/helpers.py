from __future__ import annotations

from fastapi.testclient import TestClient

DEFAULT_PASSWORD = "SuperSecret123"


def register(client: TestClient, email: str, password: str = DEFAULT_PASSWORD, terms_accepted: bool = True):
    return client.post(
        "/api/auth/register",
        data={"email": email, "password": password, "terms_accepted": str(terms_accepted).lower()},
    )


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD):
    return client.post("/api/auth/login", data={"email": email, "password": password})


def signup_login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> str:
    """Registers (accounts are active immediately, no email verification) and
    logs in, returning a bearer token."""
    response = register(client, email, password)
    assert response.status_code == 200, response.text
    login_response = login(client, email, password)
    assert login_response.status_code == 200, login_response.text
    return login_response.json()["token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
