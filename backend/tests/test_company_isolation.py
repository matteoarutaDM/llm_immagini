from __future__ import annotations

from backend.tests.helpers import auth_headers, signup_login


def _create_chat(client, token, knowledge_mode="base", company_document_ids=None):
    import json

    return client.post(
        "/api/chats",
        headers=auth_headers(token),
        data={
            "title": "Chat di test",
            "knowledge_mode": knowledge_mode,
            "company_document_ids": json.dumps(company_document_ids or []),
        },
    )


def test_user_without_company_cannot_create_merged_chat(client):
    token = signup_login(client, "solo@gmail.com")
    response = _create_chat(client, token, knowledge_mode="merged")
    assert response.status_code == 403


def test_company_user_can_create_merged_chat(client):
    token = signup_login(client, "user@digitalmens.it")
    response = _create_chat(client, token, knowledge_mode="merged")
    assert response.status_code == 200
    assert response.json()["knowledge_mode"] == "merged"


def test_user_cannot_access_another_users_chat(client):
    token_a = signup_login(client, "alice@digitalmens.it")
    token_b = signup_login(client, "bob@digitalmens.it")

    chat = _create_chat(client, token_a).json()

    # Not found, not forbidden: existence of another user's chat is not confirmed.
    response = client.get(f"/api/chats/{chat['id']}/messages", headers=auth_headers(token_b))
    assert response.status_code == 404

    rename = client.patch(
        f"/api/chats/{chat['id']}",
        headers=auth_headers(token_b),
        data={"title": "hijacked"},
    )
    assert rename.status_code == 404

    delete = client.delete(f"/api/chats/{chat['id']}", headers=auth_headers(token_b))
    assert delete.status_code == 404


def test_chat_list_only_shows_own_chats(client):
    token_a = signup_login(client, "alice@digitalmens.it")
    token_b = signup_login(client, "bob@digitalmens.it")

    _create_chat(client, token_a)
    _create_chat(client, token_b)

    chats_a = client.get("/api/chats", headers=auth_headers(token_a)).json()
    chats_b = client.get("/api/chats", headers=auth_headers(token_b)).json()

    assert len(chats_a) == 1
    assert len(chats_b) == 1
    assert chats_a[0]["id"] != chats_b[0]["id"]


def test_documents_are_isolated_between_two_companies(client, monkeypatch):
    import io

    from backend import main as main_module

    class FakeAssistant:
        def invalidate_company_rag(self, company_domain: str) -> None:
            pass

    monkeypatch.setattr(main_module, "get_assistant", lambda: FakeAssistant())

    token_company_a = signup_login(client, "user@digitalmens.it")
    token_company_b = signup_login(client, "user@othercorp.it")

    client.post(
        "/api/company/documents",
        headers=auth_headers(token_company_a),
        files={"document": ("manuale_a.pdf", io.BytesIO(b"%PDF-1.4\nA"), "application/pdf")},
    )
    client.post(
        "/api/company/documents",
        headers=auth_headers(token_company_b),
        files={"document": ("manuale_b.pdf", io.BytesIO(b"%PDF-1.4\nB"), "application/pdf")},
    )

    docs_a = client.get("/api/company/documents", headers=auth_headers(token_company_a)).json()
    docs_b = client.get("/api/company/documents", headers=auth_headers(token_company_b)).json()

    assert [doc["filename"] for doc in docs_a] == ["manuale_a.pdf"]
    assert [doc["filename"] for doc in docs_b] == ["manuale_b.pdf"]


def test_two_company_domains_get_different_company_records(client):
    token_a = signup_login(client, "user@digitalmens.it")
    token_b = signup_login(client, "user@othercorp.it")

    me_a = client.get("/api/auth/me", headers=auth_headers(token_a)).json()
    me_b = client.get("/api/auth/me", headers=auth_headers(token_b)).json()

    assert me_a["company_domain"] == "digitalmens.it"
    assert me_b["company_domain"] == "othercorp.it"
