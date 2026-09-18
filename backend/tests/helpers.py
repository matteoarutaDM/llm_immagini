from __future__ import annotations

from fastapi.testclient import TestClient

DEFAULT_PASSWORD = "SuperSecret123"


def register(client: TestClient, email: str, password: str = DEFAULT_PASSWORD, terms_accepted: bool = True):
    return client.post(
        "/api/auth/register",
        data={"email": email, "password": password, "terms_accepted": str(terms_accepted).lower()},
    )


def register_user(
    client: TestClient,
    email: str,
    password: str = DEFAULT_PASSWORD,
) -> None:
    response = register(client, email, password)
    assert response.status_code == 200, response.text


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD):
    return client.post("/api/auth/login", data={"email": email, "password": password})


def signup(
    client: TestClient,
    email: str,
    password: str = DEFAULT_PASSWORD,
) -> str:
    """Registers a user and returns the bearer token issued at signup."""
    response = register(client, email, password)
    assert response.status_code == 200, response.text
    return response.json()["token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
