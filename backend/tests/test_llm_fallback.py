from __future__ import annotations

import json
import logging
import threading

import httpx
import pytest

from backend import llm_service
from backend import main as main_module
from backend.llm_errors import LLMAuthError, LLMResponseError, LLMTimeoutError, LLMUnavailableError
from backend.llm_service import CircuitBreaker, LLMService
from backend.modal_client import ModalClient
from backend.ollama_client import OllamaClient

MESSAGES = [{"role": "user", "content": "PASSAGGI riservati: ..."}]
MODAL_KEY = "test-modal-secret-key"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class Recorder:
    """MockTransport handler that records calls and replays a scripted behaviour."""

    def __init__(self, behaviour) -> None:
        self.behaviour = behaviour
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.behaviour(request)

    @property
    def calls(self) -> int:
        return len(self.requests)


def ollama_ok(request):
    return httpx.Response(200, json={"message": {"content": "risposta RTX 5090"}})


def modal_ok(request):
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": "risposta Modal"}}], "usage": {"prompt_tokens": 10, "completion_tokens": 3}},
    )


def raise_(exc_type):
    def handler(request):
        raise exc_type("simulated", request=request)

    return handler


def status(code, body=None):
    return lambda request: httpx.Response(code, json=body or {"error": "simulated"})


def make_service(primary_behaviour, modal_behaviour=modal_ok, *, enabled=True, breaker=None):
    primary = Recorder(primary_behaviour)
    modal = Recorder(modal_behaviour)
    service = LLMService(
        OllamaClient("http://100.64.0.1:11434", "llama3.1:8b", num_predict=1024, transport=httpx.MockTransport(primary)),
        ModalClient(
            "https://workspace--assistente-llm.modal.run",
            MODAL_KEY,
            "meta-llama/Llama-3.1-8B-Instruct",
            max_tokens=1024,
            transport=httpx.MockTransport(modal),
        ),
        fallback_enabled=enabled,
        breaker=breaker or CircuitBreaker(threshold=3, cooldown=60, clock=FakeClock()),
    )
    return service, primary, modal


# ------------------------------------------------------------ primary / fallback decisions


def test_primary_ok_never_calls_modal():
    service, primary, modal = make_service(ollama_ok)
    assert service.chat(MESSAGES, temperature=0) == "risposta RTX 5090"
    assert primary.calls == 1 and modal.calls == 0
    assert service.counters()["llm_fallback_requests"] == 0


@pytest.mark.parametrize(
    "behaviour",
    [
        raise_(httpx.ConnectError),  # connection refused / host unreachable / DNS
        raise_(httpx.ConnectTimeout),  # PC off, Tailscale unreachable
        raise_(httpx.RemoteProtocolError),  # connection reset mid-answer
        raise_(httpx.ReadTimeout),  # response timeout
        status(502),
        status(503),
        status(504),
        status(404, {"error": 'model "llama3.1:8b" not found'}),  # model missing on the PC
    ],
    ids=["refused", "connect-timeout", "reset", "read-timeout", "502", "503", "504", "model-missing"],
)
def test_infrastructure_errors_fall_back_to_modal(behaviour):
    service, primary, modal = make_service(behaviour)
    assert service.chat(MESSAGES, temperature=0) == "risposta Modal"
    assert primary.calls == 1 and modal.calls == 1
    counters = service.counters()
    assert counters["llm_primary_failures"] == 1
    assert counters["llm_fallback_requests"] == counters["llm_fallback_successes"] == 1


@pytest.mark.parametrize(
    ("behaviour", "error"),
    [
        (status(400), LLMResponseError),
        (status(401), LLMAuthError),
        (status(403), LLMAuthError),
        (status(500), LLMResponseError),
        (lambda request: httpx.Response(200, text="not json"), LLMResponseError),
    ],
    ids=["400", "401", "403", "500", "invalid-body"],
)
def test_non_infrastructure_errors_do_not_call_modal(behaviour, error):
    service, _primary, modal = make_service(behaviour)
    with pytest.raises(error):
        service.chat(MESSAGES)
    assert modal.calls == 0


def test_fallback_disabled_propagates_the_primary_error():
    service, _primary, modal = make_service(raise_(httpx.ConnectError), enabled=False)
    with pytest.raises(LLMUnavailableError):
        service.chat(MESSAGES)
    assert modal.calls == 0


def test_fallback_enabled_without_modal_configuration_is_off():
    primary = Recorder(raise_(httpx.ConnectError))
    service = LLMService(OllamaClient("http://x:11434", "m", transport=httpx.MockTransport(primary)), None, fallback_enabled=True)
    assert service.fallback_enabled is False
    with pytest.raises(LLMUnavailableError):
        service.chat(MESSAGES)


# ------------------------------------------------------------ Modal as fallback


def test_modal_receives_the_same_messages_and_parameters():
    service, _primary, modal = make_service(raise_(httpx.ConnectError))
    service.chat(MESSAGES, temperature=0)
    request = modal.requests[0]
    assert request.url.path == "/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {MODAL_KEY}"
    assert json.loads(request.content) == {
        "model": "meta-llama/Llama-3.1-8B-Instruct",
        "messages": MESSAGES,
        "stream": False,
        "temperature": 0,
        "max_tokens": 1024,
    }


def test_modal_timeout_is_the_final_error():
    service, _primary, _modal = make_service(raise_(httpx.ConnectError), raise_(httpx.ReadTimeout))
    with pytest.raises(LLMTimeoutError) as info:
        service.chat(MESSAGES)
    assert info.value.status_code == 504
    assert service.counters()["llm_fallback_failures"] == 1


def test_modal_500_is_the_final_error():
    service, _primary, _modal = make_service(raise_(httpx.ConnectError), status(500))
    with pytest.raises(LLMResponseError) as info:
        service.chat(MESSAGES)
    assert info.value.status_code == 500


def test_modal_wrong_key_is_an_auth_error():
    service, _primary, _modal = make_service(raise_(httpx.ConnectError), status(401))
    with pytest.raises(LLMAuthError):
        service.chat(MESSAGES)


def test_modal_invalid_body_is_a_response_error():
    service, _primary, _modal = make_service(raise_(httpx.ConnectError), lambda r: httpx.Response(200, json={"choices": []}))
    with pytest.raises(LLMResponseError):
        service.chat(MESSAGES)


def test_modal_api_key_and_prompt_never_reach_the_logs(caplog):
    service, _primary, _modal = make_service(raise_(httpx.ConnectError))
    with caplog.at_level(logging.DEBUG):
        service.chat(MESSAGES)
    assert MODAL_KEY not in caplog.text
    assert "PASSAGGI riservati" not in caplog.text
    assert "provider=modal result=success" in caplog.text


def test_modal_concurrency_limit_caps_parallel_requests():
    running, peak, lock = 0, 0, threading.Lock()
    release = threading.Event()

    def slow_modal(request):
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        release.wait(5)
        with lock:
            running -= 1
        return modal_ok(request)

    client = ModalClient("https://m.modal.run", MODAL_KEY, "m", max_concurrent=2, transport=httpx.MockTransport(slow_modal))
    threads = [threading.Thread(target=client.chat, args=(MESSAGES,)) for _ in range(5)]
    for thread in threads:
        thread.start()
    threading.Timer(0.3, release.set).start()
    for thread in threads:
        thread.join(10)
    assert peak == 2


def test_modal_health_check_makes_no_network_call():
    calls = Recorder(modal_ok)
    client = ModalClient("https://m.modal.run", MODAL_KEY, "m", transport=httpx.MockTransport(calls))
    assert client.health_check() == {"provider": "modal", "configured": True, "model": "m"}
    assert calls.calls == 0


# ------------------------------------------------------------ circuit breaker


def test_circuit_opens_after_threshold_and_skips_the_primary():
    clock = FakeClock()
    service, primary, modal = make_service(raise_(httpx.ConnectTimeout), breaker=CircuitBreaker(3, 60, clock))
    for _ in range(3):
        service.chat(MESSAGES)
    assert primary.calls == 3 and modal.calls == 3

    service.chat(MESSAGES)  # circuit open: the primary is not even tried
    assert primary.calls == 3 and modal.calls == 4
    assert service.counters()["llm_primary_skipped"] == 1


def test_after_cooldown_the_primary_is_probed_again():
    clock = FakeClock()
    service, primary, modal = make_service(raise_(httpx.ConnectTimeout), breaker=CircuitBreaker(3, 60, clock))
    for _ in range(3):
        service.chat(MESSAGES)
    clock.now += 61
    service.chat(MESSAGES)  # probe fails -> fallback, circuit open again
    assert primary.calls == 4
    service.chat(MESSAGES)  # still inside the new cooldown: skipped
    assert primary.calls == 4 and modal.calls == 5


def test_primary_back_online_is_used_again_and_circuit_closes():
    clock = FakeClock()
    state = {"up": False}

    def primary_behaviour(request):
        if not state["up"]:
            raise httpx.ConnectError("offline", request=request)
        return ollama_ok(request)

    breaker = CircuitBreaker(3, 60, clock)
    service, primary, modal = make_service(primary_behaviour, breaker=breaker)
    for _ in range(3):
        service.chat(MESSAGES)
    assert breaker.state == "open"

    state["up"] = True
    clock.now += 61
    assert service.chat(MESSAGES) == "risposta RTX 5090"
    assert breaker.state == "closed"
    assert service.chat(MESSAGES) == "risposta RTX 5090"
    assert modal.calls == 3


def test_only_one_probe_per_cooldown_while_the_others_use_the_fallback():
    clock = FakeClock()
    breaker = CircuitBreaker(1, 60, clock)
    breaker.record_failure()
    clock.now += 61
    assert breaker.allow() is True  # the probe
    assert breaker.allow() is False  # everybody else keeps using the fallback


def test_non_infrastructure_errors_do_not_open_the_circuit():
    breaker = CircuitBreaker(1, 60, FakeClock())
    service, _primary, _modal = make_service(status(400), breaker=breaker)
    with pytest.raises(LLMResponseError):
        service.chat(MESSAGES)
    assert breaker.state == "closed"


# ------------------------------------------------------------ health and configuration


def test_health_is_degraded_but_200_when_primary_down_and_fallback_ready(client, monkeypatch):
    service, _primary, modal = make_service(raise_(httpx.ConnectError))
    monkeypatch.setattr(main_module, "get_llm_service", lambda: service)

    response = client.get("/health/ai")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "degraded"
    assert body["primary"]["available"] is False
    assert body["fallback"] == {
        "provider": "modal", "enabled": True, "configured": True, "model": "meta-llama/Llama-3.1-8B-Instruct",
    }
    assert modal.calls == 0  # the health check never wakes up Modal
    assert "modal.run" not in response.text and MODAL_KEY not in response.text


def _clear_fallback_env(monkeypatch):
    for name in ("LLM_FALLBACK_ENABLED", "MODAL_BASE_URL", "MODAL_API_KEY", "MODAL_MODEL", "OLLAMA_NUM_PREDICT"):
        monkeypatch.delenv(name, raising=False)


def test_build_service_without_modal_configuration(monkeypatch):
    _clear_fallback_env(monkeypatch)
    monkeypatch.setenv("LLM_FALLBACK_ENABLED", "true")
    service = llm_service.build_llm_service()
    assert service.fallback_enabled is False
    assert service.health_check  # still usable


def test_build_service_with_modal_configuration(monkeypatch):
    _clear_fallback_env(monkeypatch)
    monkeypatch.setenv("LLM_FALLBACK_ENABLED", "true")
    monkeypatch.setenv("MODAL_BASE_URL", "https://workspace--assistente-llm.modal.run/")
    monkeypatch.setenv("MODAL_API_KEY", MODAL_KEY)
    monkeypatch.setenv("OLLAMA_NUM_PREDICT", "1024")
    monkeypatch.setenv("LLM_PRIMARY_FAILURE_THRESHOLD", "2")
    monkeypatch.setenv("LLM_PRIMARY_COOLDOWN_SECONDS", "30")
    service = llm_service.build_llm_service()
    assert service.fallback_enabled is True
    assert service._fallback.model == "meta-llama/Llama-3.1-8B-Instruct"
    assert service._fallback.max_tokens == 1024
    assert service._breaker.threshold == 2 and service._breaker.cooldown == 30


def test_fallback_can_be_switched_off_by_env_alone(monkeypatch):
    _clear_fallback_env(monkeypatch)
    monkeypatch.setenv("LLM_FALLBACK_ENABLED", "false")
    monkeypatch.setenv("MODAL_BASE_URL", "https://workspace--assistente-llm.modal.run")
    monkeypatch.setenv("MODAL_API_KEY", MODAL_KEY)
    service = llm_service.build_llm_service()
    assert service.fallback_enabled is False
    assert service.health_check()["fallback"]["configured"] is True


def test_vision_service_never_uses_the_text_only_fallback(monkeypatch):
    service, _primary, _modal = make_service(ollama_ok)
    monkeypatch.setattr(llm_service, "_llm_service", service)
    monkeypatch.setattr(llm_service, "_vision_llm_service", None)
    monkeypatch.setattr(llm_service, "ollama_base_url", lambda: "http://100.64.0.1:11434")
    monkeypatch.setattr(llm_service, "vision_base_url", lambda: "http://100.64.0.1:11434")
    monkeypatch.setattr(llm_service, "vision_model", lambda: "llama3.1:8b")
    vision = llm_service.get_vision_llm_service()
    assert vision.fallback_enabled is False
    assert vision.primary is service.primary
