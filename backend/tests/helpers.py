from __future__ import annotations

from fastapi.testclient import TestClient

DEFAULT_PASSWORD = "SuperSecret123"


def register(client: TestClient, email: str, password: str = DEFAULT_PASSWORD, terms_accepted: bool = True):
    return client.post(
        "/api/auth/register",
        data={"email": email, "password": password, "terms_accepted": str(terms_accepted).lower()},
    )


def verify(client: TestClient, token: str):
    return client.post("/api/auth/verify-email", data={"token": token})


def register_and_verify(
    client: TestClient,
    captured_emails: list[dict[str, str]],
    email: str,
    password: str = DEFAULT_PASSWORD,
) -> None:
    response = register(client, email, password)
    assert response.status_code == 200, response.text
    token = next(item["token"] for item in reversed(captured_emails) if item["to"] == email)
    verify_response = verify(client, token)
    assert verify_response.status_code == 200, verify_response.text


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD):
    return client.post("/api/auth/login", data={"email": email, "password": password})


def signup_login(
    client: TestClient,
    captured_emails: list[dict[str, str]],
    email: str,
    password: str = DEFAULT_PASSWORD,
) -> str:
    """Registers, verifies and logs in a user, returning a bearer token."""
    register_and_verify(client, captured_emails, email, password)
    response = login(client, email, password)
    assert response.status_code == 200, response.text
    return response.json()["token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}
