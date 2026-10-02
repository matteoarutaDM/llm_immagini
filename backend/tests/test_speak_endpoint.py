from __future__ import annotations

from backend import main as main_module
from backend.tests.helpers import auth_headers, signup


class FakeSynthesizer:
    def __init__(self, raise_error: bool = False) -> None:
        self.calls: list[str] = []
        self.raise_error = raise_error

    def synthesize(self, text: str) -> bytes:
        self.calls.append(text)
        if self.raise_error:
            raise RuntimeError("boom: dettaglio interno sensibile")
        return b"RIFF-fake-wav"


def _speak(client, token, text="Spegni il motore."):
    return client.post("/api/speak", headers=auth_headers(token), data={"text": text})


def test_speak_requires_authentication(client):
    assert client.post("/api/speak", data={"text": "ciao"}).status_code == 401


def test_speak_returns_wav_audio(client, monkeypatch):
    fake = FakeSynthesizer()
    monkeypatch.setattr(main_module, "_synthesizer", fake)
    token = signup(client, "tecnico@example.com")

    response = _speak(client, token, text="  Spegni il motore.  ")

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.content == b"RIFF-fake-wav"
    assert fake.calls == ["Spegni il motore."]


def test_speak_rejects_empty_and_too_long_text(client, monkeypatch):
    fake = FakeSynthesizer()
    monkeypatch.setattr(main_module, "_synthesizer", fake)
    monkeypatch.setattr(main_module, "MAX_SPEAK_CHARS", 10)
    token = signup(client, "tecnico@example.com")

    assert _speak(client, token, text="   ").status_code == 400
    assert _speak(client, token, text="x" * 11).status_code == 413
    assert fake.calls == []


def test_speak_hides_internal_errors(client, monkeypatch):
    monkeypatch.setattr(main_module, "_synthesizer", FakeSynthesizer(raise_error=True))
    token = signup(client, "tecnico@example.com")

    response = _speak(client, token)

    assert response.status_code == 500
    assert "sensibile" not in response.text
