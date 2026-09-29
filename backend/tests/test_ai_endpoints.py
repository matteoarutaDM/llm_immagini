from __future__ import annotations

import httpx
import pytest

from backend import main as main_module
from backend.llm_errors import LLMModelNotFoundError, LLMResponseError, LLMTimeoutError, LLMUnavailableError
from backend.llm_service import LLMService
from backend.ollama_client import OllamaClient
from backend.tests.helpers import auth_headers, signup
from backend.tests.test_ask_endpoint import _ask


def _service(handler) -> LLMService:
    client = OllamaClient(
        base_url="http://100.64.0.1:11434", model="llama3.1:8b", transport=httpx.MockTransport(handler)
    )
    return LLMService(client)


def _offline(request):
    raise httpx.ConnectError("simulated", request=request)


def test_health_ai_ok(client, monkeypatch):
    service = _service(lambda request: httpx.Response(200, json={"models": [{"name": "llama3.1:8b"}]}))
    monkeypatch.setattr(main_module, "get_llm_service", lambda: service)

    response = client.get("/health/ai")

    assert response.status_code == 200
    body = response.json()
    # Keys that existed before the fallback are unchanged.
    assert {key: body[key] for key in ("status", "provider", "model")} == {
        "status": "ok", "provider": "ollama", "model": "llama3.1:8b",
    }
    assert body["primary"] == {"provider": "ollama", "available": True, "circuit": "closed", "model": "llama3.1:8b"}
    assert body["fallback"] == {"provider": "modal", "enabled": False, "configured": False}


def test_health_ai_unavailable_returns_503_without_address(client, monkeypatch):
    monkeypatch.setattr(main_module, "get_llm_service", lambda: _service(_offline))

    response = client.get("/health/ai")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unavailable" and body["provider"] == "ollama"
    assert body["primary"]["available"] is False
    assert "100.64" not in response.text


def test_app_health_does_not_depend_on_ollama(client, monkeypatch):
    monkeypatch.setattr(main_module, "get_llm_service", lambda: _service(_offline))
    assert client.get("/health").status_code == 200


class FailingAssistant:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def ask_machine(self, **kwargs):
        raise self.exc


@pytest.mark.parametrize(
    ("exc", "status"),
    [
        (LLMUnavailableError(), 503),
        (LLMTimeoutError(), 504),
        (LLMModelNotFoundError(), 503),
        (LLMResponseError(), 500),
    ],
    ids=["unavailable", "timeout", "model-not-found", "http-error"],
)
def test_ask_maps_llm_errors_to_clean_responses(client, monkeypatch, db, exc, status):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FailingAssistant(exc))
    token = signup(client, "user@digitalmens.it")

    response = _ask(client, token)

    assert response.status_code == status
    assert response.json() == {"detail": exc.public_message}
    row = db.execute("SELECT status, error_message FROM app.analyses").fetchone()
    assert row["status"] == "failed"
    assert type(exc).__name__ in row["error_message"]


def test_ask_still_requires_authentication(client, monkeypatch):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FailingAssistant(LLMUnavailableError()))
    response = client.post("/api/ask", data={"question": "x"}, files={"image": ("a.png", b"x", "image/png")})
    assert response.status_code == 401
