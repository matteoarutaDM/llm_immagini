from __future__ import annotations

from backend.tests.helpers import auth_headers, create_account, login


def _token(client, email):
    return login(client, email).json()["token"]


def test_account_created_by_someone_else_must_accept_terms_before_using_the_site(client):
    create_account("new@acme.it", terms_accepted=False)
    token = _token(client, "new@acme.it")

    me = client.get("/api/auth/me", headers=auth_headers(token))
    assert me.status_code == 200
    assert me.json()["terms_accepted"] is False

    blocked = client.get("/api/chats", headers=auth_headers(token))
    assert blocked.status_code == 403
    assert "Termini" in blocked.json()["detail"]


def test_accepting_terms_unlocks_the_site_and_is_idempotent(client, db):
    create_account("new@acme.it", terms_accepted=False)
    token = _token(client, "new@acme.it")

    assert client.post("/api/auth/accept-terms", headers=auth_headers(token)).status_code == 200
    first = db.execute("SELECT terms_accepted_at FROM app.users WHERE email = 'new@acme.it'").fetchone()
    assert client.post("/api/auth/accept-terms", headers=auth_headers(token)).status_code == 200
    second = db.execute("SELECT terms_accepted_at FROM app.users WHERE email = 'new@acme.it'").fetchone()

    assert first["terms_accepted_at"] is not None
    assert first == second
    assert client.get("/api/chats", headers=auth_headers(token)).status_code == 200


def test_accept_terms_requires_authentication(client):
    assert client.post("/api/auth/accept-terms").status_code == 401
