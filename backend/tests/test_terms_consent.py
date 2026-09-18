from __future__ import annotations

from backend.tests.helpers import register


def test_registration_without_terms_acceptance_is_rejected(client):
    response = client.post(
        "/api/auth/register",
        data={"email": "user@digitalmens.it", "password": "SuperSecret123", "terms_accepted": "false"},
    )
    assert response.status_code == 400


def test_registration_missing_terms_field_is_rejected(client):
    response = client.post(
        "/api/auth/register",
        data={"email": "user@digitalmens.it", "password": "SuperSecret123"},
    )
    assert response.status_code in (400, 422)


def test_registration_with_terms_acceptance_succeeds(client):
    response = register(client, "user@digitalmens.it", terms_accepted=True)
    assert response.status_code == 200
