from __future__ import annotations

from backend import main as main_module
from backend.tests.helpers import (
    DEFAULT_PASSWORD,
    auth_headers,
    capture_two_factor_emails,
    enable_two_factor,
    login,
    signup,
)

GENERIC_MESSAGE = (
    "Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password."
)


def _capture_reset_link(monkeypatch) -> dict:
    captured: dict = {}

    def fake_send(to_email, reset_link, ttl_minutes):
        captured["to_email"] = to_email
        captured["reset_link"] = reset_link
        captured["ttl_minutes"] = ttl_minutes

    monkeypatch.setattr(main_module.email_service, "send_password_reset_email", fake_send)
    return captured


def _token_from_link(reset_link: str) -> str:
    return reset_link.split("token=", 1)[1]


def test_forgot_password_existing_email_sends_link(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)

    response = client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    assert response.status_code == 200
    assert response.json()["message"] == GENERIC_MESSAGE
    assert captured["to_email"] == "user@digitalmens.it"
    assert "/reset-password?token=" in captured["reset_link"]


def test_forgot_password_unknown_email_does_not_send(client, monkeypatch):
    captured = _capture_reset_link(monkeypatch)

    response = client.post("/api/auth/forgot-password", data={"email": "nobody@digitalmens.it"})
    assert response.status_code == 200
    assert response.json()["message"] == GENERIC_MESSAGE
    assert captured == {}


def test_forgot_password_response_identical_for_existing_and_unknown_email(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    _capture_reset_link(monkeypatch)

    existing = client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    unknown = client.post("/api/auth/forgot-password", data={"email": "nobody@digitalmens.it"})

    assert existing.status_code == unknown.status_code == 200
    assert existing.json() == unknown.json()


def test_reset_password_with_valid_token(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)
    client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    token = _token_from_link(captured["reset_link"])

    response = client.post(
        "/api/auth/reset-password", data={"token": token, "new_password": "BrandNewPass456"}
    )
    assert response.status_code == 200
    assert response.json() == {"reset": True}


def test_reset_password_with_invalid_token(client):
    response = client.post(
        "/api/auth/reset-password", data={"token": "not-a-real-token", "new_password": "BrandNewPass456"}
    )
    assert response.status_code == 400


def test_reset_password_with_expired_token(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)
    monkeypatch.setattr(main_module, "PASSWORD_RESET_TOKEN_TTL_SECONDS", -10)
    client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    token = _token_from_link(captured["reset_link"])

    response = client.post(
        "/api/auth/reset-password", data={"token": token, "new_password": "BrandNewPass456"}
    )
    assert response.status_code == 400
    assert "scaduto" in response.json()["detail"]


def test_reset_password_token_is_single_use(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)
    client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    token = _token_from_link(captured["reset_link"])

    first = client.post("/api/auth/reset-password", data={"token": token, "new_password": "BrandNewPass456"})
    assert first.status_code == 200

    second = client.post("/api/auth/reset-password", data={"token": token, "new_password": "AnotherPass789"})
    assert second.status_code == 400
    assert "utilizzato" in second.json()["detail"]


def test_old_password_stops_working_after_reset(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)
    client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    token = _token_from_link(captured["reset_link"])
    client.post("/api/auth/reset-password", data={"token": token, "new_password": "BrandNewPass456"})

    response = login(client, "user@digitalmens.it", DEFAULT_PASSWORD)
    assert response.status_code == 401


def test_new_password_works_after_reset(client, monkeypatch):
    signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)
    client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    token = _token_from_link(captured["reset_link"])
    client.post("/api/auth/reset-password", data={"token": token, "new_password": "BrandNewPass456"})

    response = login(client, "user@digitalmens.it", "BrandNewPass456")
    assert response.status_code == 200
    assert response.json()["token"]


def test_reset_password_invalidates_old_sessions(client, monkeypatch):
    old_token = signup(client, "user@digitalmens.it")
    captured = _capture_reset_link(monkeypatch)
    client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    reset_token = _token_from_link(captured["reset_link"])
    client.post("/api/auth/reset-password", data={"token": reset_token, "new_password": "BrandNewPass456"})

    response = client.get("/api/auth/me", headers=auth_headers(old_token))
    assert response.status_code == 401


def test_reset_password_does_not_disable_2fa(client, monkeypatch):
    email = "user@digitalmens.it"
    two_factor_codes = capture_two_factor_emails(monkeypatch)
    token = signup(client, email)
    enable_two_factor(client, token, email, two_factor_codes)

    captured = _capture_reset_link(monkeypatch)
    client.post("/api/auth/forgot-password", data={"email": email})
    reset_token = _token_from_link(captured["reset_link"])
    client.post("/api/auth/reset-password", data={"token": reset_token, "new_password": "BrandNewPass456"})

    # 2FA must still be required, with the new password.
    login_response = login(client, email, "BrandNewPass456")
    assert login_response.status_code == 200
    assert login_response.json()["requires_2fa"] is True

    challenge_token = login_response.json()["challenge_token"]
    verify_response = client.post(
        "/api/auth/2fa/verify",
        data={"challenge_token": challenge_token, "code": two_factor_codes[(email, "login")]},
    )
    assert verify_response.status_code == 200


def test_forgot_password_rate_limited(client, monkeypatch):
    _capture_reset_link(monkeypatch)
    monkeypatch.setattr(main_module, "RATE_LIMIT_FORGOT_PASSWORD_MAX", 3)
    main_module._forgot_password_ip_limiter.max_requests = 3
    main_module._forgot_password_email_limiter.max_requests = 3

    for _ in range(3):
        response = client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
        assert response.status_code == 200

    limited = client.post("/api/auth/forgot-password", data={"email": "user@digitalmens.it"})
    assert limited.status_code == 429
