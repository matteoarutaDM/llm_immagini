from __future__ import annotations

from backend.tests.helpers import create_account, login


def test_self_registration_endpoint_no_longer_exists(client):
    """Accounts are created by the super admin (company admins) and by company
    admins (employees): nobody can sign up alone."""
    response = client.post(
        "/api/auth/register",
        data={"email": "someone@digitalmens.it", "password": "SuperSecret123", "terms_accepted": "true"},
    )
    assert response.status_code in (404, 405)


def test_login_does_not_create_or_join_companies_from_the_email_domain(client, db):
    create_account("solo@gmail.com")
    response = login(client, "solo@gmail.com")
    assert response.status_code == 200
    assert response.json()["company_domain"] is None
    assert db.execute("SELECT count(*) FROM app.companies").fetchone()["count"] == 0


def test_login_response_describes_role_company_and_temporary_password(client):
    create_account("boss@acme.it", role="company_admin", full_name="Mario Rossi")
    body = login(client, "boss@acme.it").json()
    assert body["role"] == "company_admin"
    assert body["company_domain"] == "acme.it"
    assert body["full_name"] == "Mario Rossi"
    assert body["password_is_temporary"] is False
    assert body["terms_accepted"] is True
