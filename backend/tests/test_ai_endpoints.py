from __future__ import annotations

import httpx
import pytest

from backend import main as main_module
from backend.llm_errors import LLMModelNotFoundError, LLMResponseError, LLMTimeoutError, LLMUnavailableError
from backend.llm_service import LLMService
from backend.ovh_client import OVHClient
from backend.tests.helpers import auth_headers, signup
from backend.tests.test_ask_endpoint import _ask

OVH_KEY = "test-ovh-secret-key"


def _calls_ovh(request):
    raise AssertionError("/health/ai must never make a billed OVH request")


def test_health_ai_ok_without_calling_ovh(client, monkeypatch):
    service = LLMService(OVHClient("https://oai.example.ovh.net", OVH_KEY, "Qwen3.5-9B", transport=httpx.MockTransport(_calls_ovh)))
    monkeypatch.setattr(main_module, "get_llm_service", lambda: service)

    response = client.get("/health/ai")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "provider": "ovh", "configured": True, "model": "Qwen3.5-9B"}
    assert OVH_KEY not in response.text and "oai.example" not in response.text


def test_health_ai_without_api_key_returns_503(client, monkeypatch):
    monkeypatch.setattr(main_module, "get_llm_service", lambda: LLMService(None))

    response = client.get("/health/ai")

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "provider": "ovh", "configured": False, "reason": "missing_api_key"}


def test_app_health_does_not_depend_on_the_llm(client, monkeypatch):
    monkeypatch.setattr(main_module, "get_llm_service", lambda: LLMService(None))
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
