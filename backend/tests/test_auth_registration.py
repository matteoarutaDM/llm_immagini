from __future__ import annotations

from backend.tests.helpers import login, register, register_and_verify


def test_register_with_personal_domain_creates_pending_unverified_user(client, captured_emails):
    response = register(client, "mario.rossi@gmail.com")
    assert response.status_code == 200
    payload = response.json()
    assert "token" not in payload  # registration no longer logs the user in directly
    assert payload["email"] == "mario.rossi@gmail.com"
    assert len(captured_emails) == 1
    assert captured_emails[0]["to"] == "mario.rossi@gmail.com"


def test_register_with_company_domain_is_not_associated_until_verified(client, captured_emails):
    register(client, "employee@digitalmens.it")
    # Before verification the login must be blocked, so there is no way yet
    # to observe a company_domain for this account.
    login_response = login(client, "employee@digitalmens.it")
    assert login_response.status_code == 403


def test_personal_domain_user_has_no_company_after_verification(client, captured_emails):
    register_and_verify(client, captured_emails, "mario.rossi@gmail.com")
    login_response = login(client, "mario.rossi@gmail.com")
    assert login_response.status_code == 200
    assert login_response.json()["company_domain"] is None


def test_company_domain_user_is_associated_after_verification(client, captured_emails):
    register_and_verify(client, captured_emails, "employee@digitalmens.it")
    login_response = login(client, "employee@digitalmens.it")
    assert login_response.status_code == 200
    assert login_response.json()["company_domain"] == "digitalmens.it"


def test_duplicate_email_registration_is_rejected(client, captured_emails):
    register(client, "dup@digitalmens.it")
    second = register(client, "dup@digitalmens.it")
    assert second.status_code == 409


def test_password_too_short_is_rejected(client, captured_emails):
    response = register(client, "short@digitalmens.it", password="short")
    assert response.status_code == 400
    assert not captured_emails


def test_invalid_email_format_is_rejected(client, captured_emails):
    response = register(client, "not-an-email")
    assert response.status_code == 400
    assert not captured_emails


def test_login_blocked_before_verification(client, captured_emails):
    register(client, "pending@digitalmens.it")
    response = login(client, "pending@digitalmens.it")
    assert response.status_code == 403


def test_verify_email_with_invalid_token_is_rejected(client):
    from backend.tests.helpers import verify

    response = verify(client, "not-a-real-token")
    assert response.status_code == 400


def test_verify_email_token_cannot_be_reused(client, captured_emails):
    from backend.tests.helpers import verify

    register(client, "onceonly@digitalmens.it")
    token = captured_emails[-1]["token"]
    first = verify(client, token)
    assert first.status_code == 200
    second = verify(client, token)
    assert second.status_code == 400
