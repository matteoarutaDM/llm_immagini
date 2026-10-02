from __future__ import annotations

import base64

from backend import main as main_module
from backend.tests.helpers import auth_headers, signup
from backend.tests.test_analyses_and_blocking import (
    FailingAssistant,
    NotRecognizingAssistant,
    RecognizingAssistant,
    _ask,
)


def _new_chat(client, token, title="Gru"):
    return client.post("/api/chats", headers=auth_headers(token), data={"title": title, "knowledge_mode": "base"}).json()


def _history(client, token, chat_id):
    return client.get(f"/api/chats/{chat_id}/analyses", headers=auth_headers(token))


def test_ask_returns_the_analysis_id_and_stores_a_thumbnail(client, db, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: RecognizingAssistant())
    token = signup(client, "tecnico@digitalmens.it")

    response = _ask(client, token)

    row = db.execute("SELECT id, image_thumbnail FROM analyses").fetchone()
    assert response.json()["analysis_id"] == str(row["id"])
    assert bytes(row["image_thumbnail"]).startswith(b"\xff\xd8")  # JPEG


def test_history_lists_the_chat_searches_newest_first(client, monkeypatch):
    token = signup(client, "tecnico@digitalmens.it")
    chat = _new_chat(client, token)
    other_chat = _new_chat(client, token, title="Altra")
    monkeypatch.setattr(main_module, "get_assistant", lambda: RecognizingAssistant())
    _ask(client, token, chat_id=str(chat["id"]), question="Prima domanda")
    _ask(client, token, chat_id=str(other_chat["id"]), question="Domanda di un'altra chat")
    monkeypatch.setattr(main_module, "get_assistant", lambda: NotRecognizingAssistant())
    _ask(client, token, chat_id=str(chat["id"]), question="Seconda domanda")

    history = _history(client, token, chat["id"]).json()

    assert [entry["question"] for entry in history] == ["Seconda domanda", "Prima domanda"]
    latest, first = history
    assert latest["status"] == "not_recognized"
    assert latest["reason"] == "Macchina non riconosciuta con sufficiente confidenza."
    assert first["status"] == "recognized"
    assert first["machine_name"] == "Carroponte portuale"
    assert first["vision_score"] == 0.91
    assert first["answer"] == "Controllare il limitatore di carico."
    assert first["sources"] == [{"source": "manuale.pdf", "page": 12}]
    assert first["thumbnail"].startswith("data:image/jpeg;base64,")
    assert base64.b64decode(first["thumbnail"].split(",", 1)[1]).startswith(b"\xff\xd8")


def test_history_hides_internal_errors(client, monkeypatch):
    token = signup(client, "tecnico@digitalmens.it")
    chat = _new_chat(client, token)
    monkeypatch.setattr(main_module, "get_assistant", lambda: FailingAssistant())
    _ask(client, token, chat_id=str(chat["id"]))

    response = _history(client, token, chat["id"])

    assert response.json()[0]["status"] == "failed"
    assert "GPU" not in response.text


def test_history_of_someone_elses_chat_is_not_found(client, monkeypatch):
    owner = signup(client, "tecnico@digitalmens.it")
    chat = _new_chat(client, owner)
    intruder = signup(client, "altro@digitalmens.it")

    assert _history(client, intruder, chat["id"]).status_code == 404
    assert client.get(f"/api/chats/{chat['id']}/analyses").status_code == 401


def test_a_photo_pillow_cannot_read_has_no_thumbnail(tmp_path):
    broken = tmp_path / "rotta.png"
    broken.write_bytes(b"non e una foto")
    assert main_module._make_thumbnail(broken) is None
