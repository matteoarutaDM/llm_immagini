from __future__ import annotations

import io
import json

from backend import main as main_module
from backend.tests.helpers import auth_headers, signup_login

TINY_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc```\x00\x00"
    b"\x00\x04\x00\x01\xf6\x178U\x00\x00\x00\x00IEND\xaeB`\x82"
)


class FakeAssistant:
    def __init__(self, answer: str = "Risposta di test", raise_error: bool = False) -> None:
        self.calls: list[dict] = []
        self.answer = answer
        self.raise_error = raise_error

    def ask_machine(self, **kwargs):
        self.calls.append(kwargs)
        if self.raise_error:
            raise RuntimeError("boom: dettaglio interno sensibile")
        return {
            "recognized": True,
            "question": kwargs["question"],
            "machine_id": "test-machine",
            "answer": self.answer,
            "hits": [],
        }


def _ask(client, token, chat_id=None, question="Come funziona?"):
    data = {"question": question}
    if chat_id is not None:
        data["chat_id"] = str(chat_id)
    return client.post(
        "/api/ask",
        headers=auth_headers(token),
        data=data,
        files={"image": ("machine.png", io.BytesIO(TINY_PNG), "image/png")},
    )


def _create_chat(client, token, knowledge_mode="base", document_ids=None):
    return client.post(
        "/api/chats",
        headers=auth_headers(token),
        data={
            "title": "Chat di test",
            "knowledge_mode": knowledge_mode,
            "company_document_ids": json.dumps(document_ids or []),
        },
    ).json()


def test_ask_rejects_non_image_upload(client, captured_emails, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FakeAssistant())
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    response = client.post(
        "/api/ask",
        headers=auth_headers(token),
        data={"question": "domanda"},
        files={"image": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert response.status_code == 400


def test_ask_rejects_empty_question(client, captured_emails, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FakeAssistant())
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    response = _ask(client, token, question="   ")
    assert response.status_code == 400


def test_ask_without_chat_uses_base_knowledge_mode(client, captured_emails, monkeypatch):
    fake = FakeAssistant()
    monkeypatch.setattr(main_module, "get_assistant", lambda: fake)
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    response = _ask(client, token)
    assert response.status_code == 200
    assert fake.calls[0]["knowledge_mode"] == "base"
    assert fake.calls[0]["company_document_ids"] is None


def test_ask_with_merged_chat_forwards_selected_documents(client, captured_emails, monkeypatch):
    fake = FakeAssistant()
    monkeypatch.setattr(main_module, "get_assistant", lambda: fake)
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    chat = _create_chat(client, token, knowledge_mode="merged", document_ids=["manuale_carroponte.pdf"])

    response = _ask(client, token, chat_id=chat["id"])
    assert response.status_code == 200
    assert fake.calls[0]["knowledge_mode"] == "merged"
    assert fake.calls[0]["company_document_ids"] == ["manuale_carroponte.pdf"]


def test_ask_persists_history_in_order_and_bumps_updated_at(client, captured_emails, monkeypatch):
    fake = FakeAssistant(answer="42")
    monkeypatch.setattr(main_module, "get_assistant", lambda: fake)
    token = signup_login(client, captured_emails, "user@digitalmens.it")
    chat = _create_chat(client, token)
    before_updated_at = chat.get("updated_at")

    _ask(client, token, chat_id=chat["id"], question="Prima domanda")
    _ask(client, token, chat_id=chat["id"], question="Seconda domanda")

    messages = client.get(f"/api/chats/{chat['id']}/messages", headers=auth_headers(token)).json()
    roles_and_content = [(m["role"], m["content"]) for m in messages]
    assert roles_and_content == [
        ("user", "Prima domanda"),
        ("assistant", "42"),
        ("user", "Seconda domanda"),
        ("assistant", "42"),
    ]

    chats = client.get("/api/chats", headers=auth_headers(token)).json()
    assert chats[0]["id"] == chat["id"]
    if before_updated_at is not None:
        assert chats[0]["updated_at"] >= before_updated_at


def test_ask_with_another_users_chat_id_is_not_found(client, captured_emails, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FakeAssistant())
    token_a = signup_login(client, captured_emails, "alice@digitalmens.it")
    token_b = signup_login(client, captured_emails, "bob@digitalmens.it")
    chat = _create_chat(client, token_a)

    response = _ask(client, token_b, chat_id=chat["id"])
    assert response.status_code == 404


def test_ask_internal_error_returns_generic_message_and_hides_details(client, captured_emails, monkeypatch, caplog):
    fake = FakeAssistant(raise_error=True)
    monkeypatch.setattr(main_module, "get_assistant", lambda: fake)
    token = signup_login(client, captured_emails, "user@digitalmens.it")

    response = _ask(client, token)
    assert response.status_code == 500
    detail = response.json()["detail"]
    assert "dettaglio interno sensibile" not in detail
    assert "boom" not in detail
