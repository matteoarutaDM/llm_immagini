from __future__ import annotations

import time

from backend import database as database_module
from backend import main as main_module
from backend.tests.helpers import auth_headers, login, register_and_verify, signup_login


def test_login_with_correct_credentials_succeeds(client, captured_emails):
    register_and_verify(client, captured_emails, "user@digitalmens.it")
    response = login(client, "user@digitalmens.it")
    assert response.status_code == 200
    assert response.json()["token"]


def test_login_with_wrong_password_is_rejected(client, captured_emails):
    register_and_verify(client, captured_emails, "user@digitalmens.it")
    response = login(client, "user@digitalmens.it", password="WrongPassword1")
    assert response.status_code == 401


def test_login_with_unknown_email_gives_same_message_as_wrong_password(client, captured_emails):
    register_and_verify(client, captured_emails, "user@digitalmens.it")
    wrong_password = login(client, "user@digitalmens.it", password="WrongPassword1")
    unknown_email = login(client, "ghost@digitalmens.it")
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json()["detail"] == unknown_email.json()["detail"]


def test_login_hashes_password_even_for_unknown_email(client, monkeypatch):
    # Regression guard for a user-enumeration timing side-channel: skipping
    # the (slow) password hash comparison for unknown emails would make
    # "unknown email" responses measurably faster than "wrong password" ones.
    calls: list[str] = []
    original_verify = main_module.verify_password

    def spy(password: str, encoded: str) -> bool:
        calls.append(encoded)
        return original_verify(password, encoded)

    monkeypatch.setattr(main_module, "verify_password", spy)

    login(client, "ghost@digitalmens.it")

    assert calls == [main_module._DUMMY_PASSWORD_HASH]


def test_protected_endpoint_rejects_missing_token(client):
    response = client.get("/api/auth/me")
    assert response.status_code == 401


def test_protected_endpoint_rejects_malformed_token(client):
    response = client.get("/api/auth/me", headers=auth_headers("not-a-real-token"))
    assert response.status_code == 401


def test_protected_endpoint_rejects_tampered_signature(client, captured_emails):
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    payload, _signature = token.rsplit(".", 1)
    tampered = f"{payload}.deadbeef"
    response = client.get("/api/auth/me", headers=auth_headers(tampered))
    assert response.status_code == 401


def test_expired_token_is_rejected(client, captured_emails, monkeypatch):
    monkeypatch.setattr(database_module, "AUTH_TOKEN_TTL_SECONDS", 1)
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    time.sleep(1.2)
    response = client.get("/api/auth/me", headers=auth_headers(token))
    assert response.status_code == 401


def test_logout_revokes_the_token_server_side(client, captured_emails):
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    ok_response = client.get("/api/auth/me", headers=auth_headers(token))
    assert ok_response.status_code == 200

    logout_response = client.post("/api/auth/logout", headers=auth_headers(token))
    assert logout_response.status_code == 200

    after_logout = client.get("/api/auth/me", headers=auth_headers(token))
    assert after_logout.status_code == 401


def test_login_locks_account_after_repeated_failures(client, captured_emails, monkeypatch):
    monkeypatch.setattr(database_module, "AUTH_MAX_FAILED_ATTEMPTS", 3)
    register_and_verify(client, captured_emails, "user@digitalmens.it")

    for _ in range(3):
        response = login(client, "user@digitalmens.it", password="WrongPassword1")
        assert response.status_code == 401

    locked_response = login(client, "user@digitalmens.it")  # correct password, but now locked
    assert locked_response.status_code == 429


def test_successful_login_resets_failed_attempts_counter(client, captured_emails, monkeypatch):
    monkeypatch.setattr(database_module, "AUTH_MAX_FAILED_ATTEMPTS", 3)
    register_and_verify(client, captured_emails, "user@digitalmens.it")

    login(client, "user@digitalmens.it", password="WrongPassword1")
    login(client, "user@digitalmens.it", password="WrongPassword1")
    ok = login(client, "user@digitalmens.it")
    assert ok.status_code == 200

    # Counter was reset, so two more failures should not lock the account yet.
    login(client, "user@digitalmens.it", password="WrongPassword1")
    still_ok = login(client, "user@digitalmens.it")
    assert still_ok.status_code == 200
