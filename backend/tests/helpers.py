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


def capture_two_factor_emails(monkeypatch) -> dict[tuple[str, str], str]:
    """Intercepts email_service.send_two_factor_code_email so tests can read
    the plaintext code that would have been emailed out, instead of needing a
    real mailbox. Keyed by (email, purpose) -> code (latest wins)."""
    from backend import main as main_module

    captured: dict[tuple[str, str], str] = {}

    def fake_send(to_email: str, code: str, purpose: str, ttl_minutes: int) -> None:
        captured[(to_email, purpose)] = code

    monkeypatch.setattr(main_module.email_service, "send_two_factor_code_email", fake_send)
    return captured


def enable_two_factor(client: TestClient, token: str, email: str, captured: dict) -> list[str]:
    """Runs the full setup->confirm flow for an already-authenticated user
    using the code captured via capture_two_factor_emails(). Returns the
    recovery codes issued on confirmation."""
    setup_response = client.post("/api/auth/2fa/setup", headers=auth_headers(token))
    assert setup_response.status_code == 200, setup_response.text
    code = captured[(email, "enable")]

    confirm_response = client.post(
        "/api/auth/2fa/confirm", headers=auth_headers(token), data={"code": code}
    )
    assert confirm_response.status_code == 200, confirm_response.text
    return confirm_response.json()["recovery_codes"]
