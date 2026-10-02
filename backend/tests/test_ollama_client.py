from __future__ import annotations

import json

import httpx
import pytest

from backend import llm_service
from backend.llm_errors import (
    LLMModelNotFoundError,
    LLMResponseError,
    LLMTimeoutError,
    LLMUnavailableError,
)
from backend.ollama_client import OllamaClient

# Never contacted: every test injects a MockTransport.
BASE_URL = "http://100.64.0.1:11434"


def make_client(handler, **kwargs) -> OllamaClient:
    return OllamaClient(base_url=BASE_URL, model="llama3.1:8b", transport=httpx.MockTransport(handler), **kwargs)


def raising(exc_type):
    def handler(request):
        raise exc_type("simulated", request=request)

    return handler


def test_chat_sends_native_payload_and_returns_content():
    seen = {}

    def handler(request):
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"message": {"role": "assistant", "content": "  Ciao!  "}, "done": True})

    client = make_client(handler)
    answer = client.chat([{"role": "user", "content": "Ciao"}], temperature=0)

    assert answer == "Ciao!"
    assert seen["path"] == "/api/chat"
    assert seen["body"] == {
        "model": "llama3.1:8b",
        "messages": [{"role": "user", "content": "Ciao"}],
        "stream": False,
        "options": {"temperature": 0},
    }


def test_generate_uses_api_generate():
    def handler(request):
        assert request.url.path == "/api/generate"
        body = json.loads(request.content)
        assert body["prompt"] == "Ciao" and body["stream"] is False
        return httpx.Response(200, json={"response": "Risposta", "done": True})

    assert make_client(handler).generate("Ciao") == "Risposta"


def test_num_ctx_is_forwarded_when_configured():
    def handler(request):
        assert json.loads(request.content)["options"] == {"num_ctx": 8192}
        return httpx.Response(200, json={"message": {"content": "ok"}})

    assert make_client(handler, num_ctx=8192).chat([{"role": "user", "content": "x"}]) == "ok"


@pytest.mark.parametrize(
    "exc_type",
    [httpx.ConnectError, httpx.ConnectTimeout, httpx.RemoteProtocolError, httpx.ReadError],
    ids=["offline", "pc-spento", "connessione-interrotta", "read-error"],
)
def test_unreachable_server_raises_unavailable(exc_type):
    with pytest.raises(LLMUnavailableError) as info:
        make_client(raising(exc_type)).chat([{"role": "user", "content": "x"}])
    assert info.value.status_code == 503
    # The public message never carries the private address.
    assert "100.64" not in str(info.value)


def test_read_timeout_raises_timeout():
    with pytest.raises(LLMTimeoutError) as info:
        make_client(raising(httpx.ReadTimeout)).chat([{"role": "user", "content": "x"}])
    assert info.value.status_code == 504


def test_missing_model_raises_model_not_found():
    def handler(request):
        return httpx.Response(404, json={"error": 'model "llama3.1:8b" not found, try pulling it first'})

    with pytest.raises(LLMModelNotFoundError):
        make_client(handler).chat([{"role": "user", "content": "x"}])


def test_http_error_raises_response_error():
    def handler(request):
        return httpx.Response(500, json={"error": "CUDA out of memory"})

    with pytest.raises(LLMResponseError) as info:
        make_client(handler).chat([{"role": "user", "content": "x"}])
    assert info.value.status_code == 500
    assert "CUDA" not in str(info.value)


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, text="<html>proxy error</html>"),
        httpx.Response(200, json={"done": True}),
        httpx.Response(200, json={"message": {"content": None}}),
        httpx.Response(200, json=["not", "an", "object"]),
        httpx.Response(200, json={"error": "something went wrong"}),
    ],
    ids=["not-json", "no-message", "null-content", "not-object", "error-field"],
)
def test_invalid_response_raises_response_error(response):
    with pytest.raises(LLMResponseError):
        make_client(lambda request: response).chat([{"role": "user", "content": "x"}])


def test_health_check_ok_when_model_installed():
    def handler(request):
        assert request.method == "GET" and request.url.path == "/api/tags"
        return httpx.Response(200, json={"models": [{"name": "llama3.1:8b"}, {"name": "nomic-embed-text:latest"}]})

    assert make_client(handler).health_check() == {"status": "ok", "provider": "ollama", "model": "llama3.1:8b"}


def test_health_check_accepts_implicit_latest_tag():
    client = OllamaClient(
        base_url=BASE_URL,
        model="llama3.2",
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"models": [{"name": "llama3.2:latest"}]})),
    )
    assert client.health_check()["status"] == "ok"


def test_health_check_reports_missing_model():
    client = make_client(lambda request: httpx.Response(200, json={"models": [{"name": "mistral:latest"}]}))
    status = client.health_check()
    assert status["status"] == "unavailable"
    assert status["reason"] == "model_not_found"


@pytest.mark.parametrize("exc_type", [httpx.ConnectError, httpx.ConnectTimeout, httpx.ReadTimeout])
def test_health_check_unavailable_never_raises_nor_leaks_address(exc_type):
    status = make_client(raising(exc_type)).health_check()
    assert status == {"status": "unavailable", "provider": "ollama"}
    assert "100.64" not in json.dumps(status)


# ------------------------------------------------------------ configuration


def _clear_llm_env(monkeypatch):
    for name in ("OLLAMA_BASE_URL", "OPENAI_BASE_URL", "OLLAMA_MODEL", "LLM_MODEL", "VISION_LLM_BASE_URL", "VISION_LLM_MODEL", "OCR_MODEL"):
        monkeypatch.delenv(name, raising=False)


def test_config_defaults_to_local_ollama(monkeypatch):
    _clear_llm_env(monkeypatch)
    assert llm_service.ollama_base_url() == "http://localhost:11434"
    assert llm_service.ollama_model() == "llama3.2"


def test_config_ollama_variables_win(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://server-ai:11434/")
    monkeypatch.setenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
    monkeypatch.setenv("OLLAMA_MODEL", "llama3.1:8b")
    monkeypatch.setenv("LLM_MODEL", "llama3.2")
    assert llm_service.ollama_base_url() == "http://server-ai:11434"
    assert llm_service.ollama_model() == "llama3.1:8b"


def test_config_legacy_openai_variables_still_work(monkeypatch):
    _clear_llm_env(monkeypatch)
    monkeypatch.setenv("OPENAI_BASE_URL", "http://host.docker.internal:11434/v1")
    monkeypatch.setenv("LLM_MODEL", "llama3.2")
    assert llm_service.ollama_base_url() == "http://host.docker.internal:11434"
    assert llm_service.ollama_model() == "llama3.2"
    assert llm_service.vision_base_url() == "http://host.docker.internal:11434"
    assert llm_service.vision_model() == "llama3.2"


def test_num_predict_caps_generated_tokens_when_configured():
    def handler(request):
        assert json.loads(request.content)["options"] == {"temperature": 0, "num_predict": 1024}
        return httpx.Response(200, json={"message": {"content": "ok"}})

    assert make_client(handler, num_predict=1024).chat([{"role": "user", "content": "x"}], temperature=0) == "ok"
