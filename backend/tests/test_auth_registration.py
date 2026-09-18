from __future__ import annotations

from backend.tests.helpers import auth_headers, login, register


def test_register_with_personal_domain_logs_user_in_without_company(client):
    response = register(client, "mario.rossi@gmail.com")

    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["email"] == "mario.rossi@gmail.com"
    assert payload["company_domain"] is None
    assert client.get("/api/auth/me", headers=auth_headers(payload["token"])).status_code == 200


def test_register_with_company_domain_logs_user_in_and_associates_company(client):
    response = register(client, "employee@digitalmens.it")

    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["company_domain"] == "digitalmens.it"


def test_login_works_immediately_after_registration(client):
    register(client, "user@digitalmens.it")

    response = login(client, "user@digitalmens.it")
    assert response.status_code == 200
    assert response.json()["token"]


def test_duplicate_email_registration_is_rejected(client):
    register(client, "dup@digitalmens.it")
    second = register(client, "dup@digitalmens.it")
    assert second.status_code == 409


def test_password_too_short_is_rejected(client):
    response = register(client, "short@digitalmens.it", password="short")
    assert response.status_code == 400


def test_invalid_email_format_is_rejected(client):
    response = register(client, "not-an-email")
    assert response.status_code == 400
