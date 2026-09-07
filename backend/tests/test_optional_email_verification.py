from __future__ import annotations

from backend import main as main_module
from backend.tests.helpers import login, register


def test_registration_auto_activates_when_verification_disabled(client, captured_emails, monkeypatch):
    monkeypatch.setattr(main_module, "REQUIRE_EMAIL_VERIFICATION", False)

    response = register(client, "user@digitalmens.it")
    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["company_domain"] == "digitalmens.it"
    assert not captured_emails  # no verification email is sent in this mode


def test_login_works_immediately_when_verification_disabled(client, captured_emails, monkeypatch):
    monkeypatch.setattr(main_module, "REQUIRE_EMAIL_VERIFICATION", False)

    register(client, "user@digitalmens.it")
    response = login(client, "user@digitalmens.it")
    assert response.status_code == 200


def test_personal_domain_still_has_no_company_when_verification_disabled(client, captured_emails, monkeypatch):
    monkeypatch.setattr(main_module, "REQUIRE_EMAIL_VERIFICATION", False)

    response = register(client, "user@gmail.com")
    assert response.status_code == 200
    assert response.json()["company_domain"] is None
