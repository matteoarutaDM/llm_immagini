from __future__ import annotations

import io
import json

from backend import main as main_module
from backend.tests.helpers import auth_headers, login, signup
from backend.tests.test_ask_endpoint import TINY_PNG


class RecognizingAssistant:
    def ask_machine(self, **kwargs):
        return {
            "recognized": True,
            "machine_id": "carroponte",
            "machine": {"id": "carroponte", "macchina": "Carroponte portuale", "tipo": "gru"},
            "vision_score": 0.91,
            "vision_candidates": [{"machine_id": "carroponte", "machine_name": "Carroponte portuale", "score": 0.91}],
            "recognition_summary": {"exact_model_identified": True, "model_code": "CP-40", "serial_number": "SN1"},
            "answer": "Controllare il limitatore di carico.",
            "hits": [{"source": "manuale.pdf", "page": 12, "score": 0.8, "text": "Il limitatore di carico ..."}],
        }


class NotRecognizingAssistant:
    def ask_machine(self, **kwargs):
        raise ValueError("Macchina non riconosciuta con sufficiente confidenza.")


class FailingAssistant:
    def ask_machine(self, **kwargs):
        raise RuntimeError("GPU esaurita")


def _ask(client, token, **data):
    return client.post(
        "/api/ask",
        headers=auth_headers(token),
        data={"question": "Perché scatta l'allarme?", **data},
        files={"image": ("foto.png", io.BytesIO(TINY_PNG), "image/png")},
    )


def test_recognized_analysis_is_recorded_with_sources(client, db, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: RecognizingAssistant())
    token = signup(client, "tecnico@digitalmens.it")
    assert _ask(client, token).status_code == 200

    row = db.execute("SELECT * FROM analyses").fetchone()
    assert row["status"] == "recognized"
    assert row["machine_id"] == "carroponte"
    assert row["model_code"] == "CP-40"
    assert row["knowledge_mode"] == "base"
    assert row["image_filename"] == "foto.png"
    assert row["image_size_bytes"] == len(TINY_PNG)
    assert row["sources"][0] == {"source": "manuale.pdf", "page": 12, "score": 0.8, "excerpt": "Il limitatore di carico ..."}
    assert row["duration_ms"] >= 0


def test_not_recognized_analysis_is_recorded_with_reason(client, db, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: NotRecognizingAssistant())
    token = signup(client, "tecnico@digitalmens.it")
    assert _ask(client, token).json()["recognized"] is False

    row = db.execute("SELECT status, reason, machine_id FROM analyses").fetchone()
    assert row == {"status": "not_recognized", "reason": "Macchina non riconosciuta con sufficiente confidenza.", "machine_id": None}


def test_failed_analysis_keeps_the_error_server_side_only(client, db, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FailingAssistant())
    token = signup(client, "tecnico@digitalmens.it")
    response = _ask(client, token)
    assert response.status_code == 500
    assert "GPU" not in response.text

    row = db.execute("SELECT status, error_message FROM analyses").fetchone()
    assert row == {"status": "failed", "error_message": "RuntimeError: GPU esaurita"}


def test_analysis_is_linked_to_the_chat(client, db, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: RecognizingAssistant())
    token = signup(client, "tecnico@digitalmens.it")
    chat = client.post(
        "/api/chats",
        headers=auth_headers(token),
        data={"title": "Gru", "knowledge_mode": "merged", "company_document_ids": json.dumps(["manuale.pdf"])},
    ).json()
    assert _ask(client, token, chat_id=str(chat["id"])).status_code == 200

    row = db.execute("SELECT chat_id, knowledge_mode FROM analyses").fetchone()
    assert row == {"chat_id": chat["id"], "knowledge_mode": "merged"}
    listed = client.get("/api/chats", headers=auth_headers(token)).json()
    assert listed[0]["company_document_ids"] == ["manuale.pdf"]


def test_blocked_user_cannot_log_in_or_use_existing_token(client, db):
    token = signup(client, "bloccato@digitalmens.it")
    db.execute(
        "UPDATE users SET status = 'blocked', status_reason = 'abuso' WHERE email = %s", ("bloccato@digitalmens.it",)
    )
    db.commit()

    assert client.get("/api/auth/me", headers=auth_headers(token)).status_code == 403
    response = login(client, "bloccato@digitalmens.it")
    assert response.status_code == 403
    assert "sospeso" in response.json()["detail"]
    # Wrong password on a blocked account stays a generic 401 (no enumeration).
    assert login(client, "bloccato@digitalmens.it", "password-sbagliata").status_code == 401


def test_login_records_last_login(client, db):
    signup(client, "tecnico@digitalmens.it")
    assert login(client, "tecnico@digitalmens.it").status_code == 200
    row = db.execute("SELECT last_login_at FROM users").fetchone()
    assert row["last_login_at"] is not None
