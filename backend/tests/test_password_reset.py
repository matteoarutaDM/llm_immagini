from __future__ import annotations

from backend.tests.helpers import auth_headers, login, register, signup_login


def _forgot_password(client, email: str):
    return client.post("/api/auth/forgot-password", data={"email": email})


def _reset_password(client, token: str, password: str):
    return client.post("/api/auth/reset-password", data={"token": token, "password": password})


def test_forgot_password_for_unknown_email_gives_generic_message_and_sends_nothing(
    client, captured_password_resets
):
    response = _forgot_password(client, "ghost@digitalmens.it")
    assert response.status_code == 200
    assert not captured_password_resets


def test_full_reset_flow_changes_password_and_invalidates_old_sessions(client, captured_password_resets):
    old_token = signup_login(client, "user@digitalmens.it")
    assert client.get("/api/auth/me", headers=auth_headers(old_token)).status_code == 200

    response = _forgot_password(client, "user@digitalmens.it")
    assert response.status_code == 200
    assert len(captured_password_resets) == 1
    reset_token = captured_password_resets[0]["token"]

    reset_response = _reset_password(client, reset_token, "BrandNewPassword1")
    assert reset_response.status_code == 200

    # Old password no longer works, new one does.
    assert login(client, "user@digitalmens.it", password="SuperSecret123").status_code == 401
    assert login(client, "user@digitalmens.it", password="BrandNewPassword1").status_code == 200

    # Resetting the password must revoke sessions issued before the reset.
    assert client.get("/api/auth/me", headers=auth_headers(old_token)).status_code == 401


def test_reset_token_cannot_be_reused(client, captured_password_resets):
    register(client, "user@digitalmens.it")
    _forgot_password(client, "user@digitalmens.it")
    reset_token = captured_password_resets[0]["token"]

    first = _reset_password(client, reset_token, "BrandNewPassword1")
    assert first.status_code == 200
    second = _reset_password(client, reset_token, "AnotherPassword2")
    assert second.status_code == 400


def test_reset_with_invalid_token_is_rejected(client):
    response = _reset_password(client, "not-a-real-token", "BrandNewPassword1")
    assert response.status_code == 400


def test_reset_with_short_password_is_rejected(client, captured_password_resets):
    register(client, "user@digitalmens.it")
    _forgot_password(client, "user@digitalmens.it")
    reset_token = captured_password_resets[0]["token"]

    response = _reset_password(client, reset_token, "short")
    assert response.status_code == 400


def test_forgot_password_endpoint_is_rate_limited(client, captured_password_resets, monkeypatch):
    from backend import main as main_module
    from backend.rate_limit import SlidingWindowRateLimiter

    monkeypatch.setattr(main_module, "_account_recovery_limiter", SlidingWindowRateLimiter(1, 60))
    register(client, "user@digitalmens.it")

    first = _forgot_password(client, "user@digitalmens.it")
    assert first.status_code == 200
    second = _forgot_password(client, "user@digitalmens.it")
    assert second.status_code == 429
