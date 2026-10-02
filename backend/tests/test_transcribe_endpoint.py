from __future__ import annotations

import io

from backend import main as main_module
from backend.tests.helpers import auth_headers, signup


class FakeTranscriber:
    def __init__(self, text: str = "Come si cambia il filtro?", raise_error: bool = False) -> None:
        self.calls: list[bytes] = []
        self.text = text
        self.raise_error = raise_error

    def transcribe(self, audio_path):
        self.calls.append(audio_path.read_bytes())
        if self.raise_error:
            raise RuntimeError("boom: dettaglio interno sensibile")
        return self.text


def _transcribe(client, token, content=b"fake-webm-audio", content_type="audio/webm;codecs=opus"):
    return client.post(
        "/api/transcribe",
        headers=auth_headers(token),
        files={"audio": ("recording.webm", io.BytesIO(content), content_type)},
    )


def test_transcribe_requires_authentication(client):
    response = client.post(
        "/api/transcribe", files={"audio": ("recording.webm", io.BytesIO(b"x"), "audio/webm")}
    )
    assert response.status_code == 401


def test_transcribe_returns_text(client, monkeypatch):
    fake = FakeTranscriber()
    monkeypatch.setattr(main_module, "_transcriber", fake)
    token = signup(client, "tecnico@example.com")

    response = _transcribe(client, token)

    assert response.status_code == 200
    assert response.json() == {"text": "Come si cambia il filtro?"}
    assert fake.calls == [b"fake-webm-audio"]


def test_transcribe_rejects_non_audio_upload(client, monkeypatch):
    fake = FakeTranscriber()
    monkeypatch.setattr(main_module, "_transcriber", fake)
    token = signup(client, "tecnico@example.com")

    response = _transcribe(client, token, content_type="image/png")

    assert response.status_code == 400
    assert fake.calls == []


def test_transcribe_rejects_empty_and_oversized_audio(client, monkeypatch):
    fake = FakeTranscriber()
    monkeypatch.setattr(main_module, "_transcriber", fake)
    monkeypatch.setattr(main_module, "MAX_AUDIO_BYTES", 10)
    token = signup(client, "tecnico@example.com")

    assert _transcribe(client, token, content=b"").status_code == 400
    assert _transcribe(client, token, content=b"x" * 11).status_code == 413
    assert fake.calls == []


def test_transcribe_reports_unintelligible_audio(client, monkeypatch):
    monkeypatch.setattr(main_module, "_transcriber", FakeTranscriber(text=""))
    token = signup(client, "tecnico@example.com")

    assert _transcribe(client, token).status_code == 422


def test_transcribe_hides_internal_errors(client, monkeypatch):
    monkeypatch.setattr(main_module, "_transcriber", FakeTranscriber(raise_error=True))
    token = signup(client, "tecnico@example.com")

    response = _transcribe(client, token)

    assert response.status_code == 500
    assert "sensibile" not in response.text
