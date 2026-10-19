from __future__ import annotations

import json
import logging
import threading

import httpx
import pytest

from backend import llm_service
from backend import perf
from backend.llm_errors import LLMAuthError, LLMModelNotFoundError, LLMResponseError, LLMTimeoutError, LLMUnavailableError
from backend.llm_service import LLMService
from backend.ovh_client import OVHClient

MESSAGES = [{"role": "user", "content": "PASSAGGI riservati: ..."}]
OVH_KEY = "test-ovh-secret-key"
OVH_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net"


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

    def body(self, index: int = 0) -> dict:
        return json.loads(self.requests[index].content)


def ovh_ok(request):
    return httpx.Response(
        200,
        json={
            "choices": [{"message": {"content": "risposta OVH", "reasoning": "Thinking Process: ..."}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 3},
        },
    )


def raise_(exc_type):
    def handler(request):
        raise exc_type("simulated", request=request)

    return handler


def status(code, body=None):
    return lambda request: httpx.Response(code, json=body or {"error": "simulated"})


def make_client(behaviour=ovh_ok, **kwargs):
    calls = Recorder(behaviour)
    kwargs.setdefault("max_tokens", 1024)
    return OVHClient(OVH_URL, OVH_KEY, "Qwen3.5-9B", transport=httpx.MockTransport(calls), **kwargs), calls


def make_service(behaviour=ovh_ok, **kwargs):
    client, calls = make_client(behaviour, **kwargs)
    return LLMService(client), calls


# ------------------------------------------------------------ request sent to OVH


def test_ovh_receives_messages_parameters_and_no_reasoning():
    service, calls = make_service()
    assert service.chat(MESSAGES, temperature=0) == "risposta OVH"
    request = calls.requests[0]
    assert request.url.path == "/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {OVH_KEY}"
    assert calls.body() == {
        "model": "Qwen3.5-9B",
        "messages": MESSAGES,
        "stream": False,
        "temperature": 0,
        "max_tokens": 1024,
        "reasoning_effort": "none",
    }


def test_reasoning_effort_can_be_omitted():
    client, calls = make_client(reasoning_effort=None)
    client.chat(MESSAGES)
    assert "reasoning_effort" not in calls.body()


def test_base_url_with_v1_suffix_is_accepted():
    calls = Recorder(ovh_ok)
    client = OVHClient(f"{OVH_URL}/v1/", OVH_KEY, "m", transport=httpx.MockTransport(calls))
    client.chat(MESSAGES)
    assert calls.requests[0].url.path == "/v1/chat/completions"


def test_images_are_sent_as_data_uris_next_to_the_text():
    client, calls = make_client()
    png, jpeg = "iVBORw0KGgo=", "/9j/4AAQ"
    client.chat([{"role": "user", "content": "Leggi la targhetta", "images": [png, jpeg]}])
    assert calls.body()["messages"] == [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Leggi la targhetta"},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{png}"}},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{jpeg}"}},
        ],
    }]


def test_generate_is_a_single_user_message():
    client, calls = make_client()
    assert client.generate("ciao", temperature=0.2) == "risposta OVH"
    assert calls.body()["messages"] == [{"role": "user", "content": "ciao"}]


# ------------------------------------------------------------ answers


def test_reasoning_that_uses_all_tokens_is_a_response_error():
    # Seen live: with a low max_tokens Qwen3.5 spends them all reasoning and returns no content.
    def reasoning_only(request):
        return httpx.Response(200, json={"choices": [{"message": {"reasoning": "Thinking..."}, "finish_reason": "length"}]})

    client, _calls = make_client(reasoning_only)
    with pytest.raises(LLMResponseError):
        client.chat(MESSAGES)


def test_inline_reasoning_is_stripped_from_the_answer():
    def inline_think(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": "<think>ragiono...</think>\n\nciao"}}]})

    client, _calls = make_client(inline_think)
    assert client.chat(MESSAGES) == "ciao"


@pytest.mark.parametrize(
    "behaviour",
    [lambda r: httpx.Response(200, json={"choices": []}), lambda r: httpx.Response(200, text="not json")],
    ids=["no-choices", "not-json"],
)
def test_invalid_body_is_a_response_error(behaviour):
    client, _calls = make_client(behaviour)
    with pytest.raises(LLMResponseError):
        client.chat(MESSAGES)


# ------------------------------------------------------------ errors


@pytest.mark.parametrize(
    ("behaviour", "error"),
    [
        (raise_(httpx.ConnectError), LLMUnavailableError),
        (raise_(httpx.ConnectTimeout), LLMUnavailableError),
        (raise_(httpx.RemoteProtocolError), LLMUnavailableError),
        (raise_(httpx.ReadTimeout), LLMTimeoutError),
        (status(429), LLMUnavailableError),  # rate limit
        (status(502), LLMUnavailableError),
        (status(503), LLMUnavailableError),
        (status(504), LLMUnavailableError),
        (status(404), LLMModelNotFoundError),  # wrong OVH_AI_MODEL
        (status(401), LLMAuthError),
        (status(403), LLMAuthError),
        (status(400), LLMResponseError),
        (status(500), LLMResponseError),
    ],
    ids=["refused", "connect-timeout", "reset", "read-timeout", "429", "502", "503", "504", "404", "401", "403", "400", "500"],
)
def test_provider_errors_map_to_llm_errors(behaviour, error):
    service, calls = make_service(behaviour)
    with pytest.raises(error):
        service.chat(MESSAGES)
    assert calls.calls == 1  # no retry, no other provider


def test_timeout_is_a_504():
    service, _calls = make_service(raise_(httpx.ReadTimeout))
    with pytest.raises(LLMTimeoutError) as info:
        service.chat(MESSAGES)
    assert info.value.status_code == 504


def test_api_key_and_prompt_never_reach_the_logs(caplog):
    service, _calls = make_service()
    with caplog.at_level(logging.DEBUG):
        service.chat(MESSAGES)
        with pytest.raises(LLMAuthError):
            make_service(status(401))[0].chat(MESSAGES)
    assert OVH_KEY not in caplog.text
    assert "PASSAGGI riservati" not in caplog.text
    assert "llm provider=ovh result=success" in caplog.text


def test_concurrency_limit_caps_parallel_requests():
    running, peak, lock = 0, 0, threading.Lock()
    release = threading.Event()

    def slow_ovh(request):
        nonlocal running, peak
        with lock:
            running += 1
            peak = max(peak, running)
        release.wait(5)
        with lock:
            running -= 1
        return ovh_ok(request)

    client = OVHClient(OVH_URL, OVH_KEY, "m", max_concurrent=2, transport=httpx.MockTransport(slow_ovh))
    threads = [threading.Thread(target=client.chat, args=(MESSAGES,)) for _ in range(5)]
    for thread in threads:
        thread.start()
    threading.Timer(0.3, release.set).start()
    for thread in threads:
        thread.join(10)
    assert peak == 2


def test_token_usage_is_recorded_in_the_request_profile():
    service, _calls = make_service()
    profile = perf.start("test")
    service.chat(MESSAGES)
    summary = profile.summary()
    perf._current.set(None)
    assert summary["ovh_prompt_tokens"] == 10
    assert summary["ovh_output_tokens"] == 3
    assert summary["llm_provider"] == "ovh"


# ------------------------------------------------------------ health and configuration


def test_health_check_makes_no_network_call():
    service, calls = make_service()
    assert service.health_check() == {"status": "ok", "provider": "ovh", "configured": True, "model": "Qwen3.5-9B"}
    assert calls.calls == 0


def test_without_api_key_requests_fail_with_503_and_health_is_unavailable():
    service = LLMService(None)
    assert service.configured is False
    with pytest.raises(LLMUnavailableError) as info:
        service.chat(MESSAGES)
    assert info.value.status_code == 503
    assert service.health_check()["status"] == "unavailable"


def _clear_ovh_env(monkeypatch):
    for name in (
        "OVH_AI_API_KEY", "OVH_AI_BASE_URL", "OVH_AI_MODEL", "OVH_AI_MAX_TOKENS", "OVH_AI_REASONING_EFFORT",
        "OVH_AI_TIMEOUT", "OVH_AI_MAX_CONCURRENT_REQUESTS", "VISION_LLM_MODEL", "OCR_MODEL",
        "OVH_AI_ALLOW_ANONYMOUS", "APP_ENV",
    ):
        monkeypatch.delenv(name, raising=False)


def test_build_service_without_api_key(monkeypatch):
    _clear_ovh_env(monkeypatch)
    service = llm_service.build_llm_service()
    assert service.configured is False
    assert service.model == "Qwen3.5-9B"


def test_build_service_defaults(monkeypatch):
    _clear_ovh_env(monkeypatch)
    monkeypatch.setenv("OVH_AI_API_KEY", OVH_KEY)
    client = llm_service.build_llm_service().provider
    assert client.base_url == OVH_URL
    assert client.model == "Qwen3.5-9B"
    assert client.max_tokens == 1024
    assert client.reasoning_effort == "none"
    assert client.max_concurrent == 4


def test_build_service_reads_the_environment(monkeypatch):
    _clear_ovh_env(monkeypatch)
    monkeypatch.setenv("OVH_AI_API_KEY", OVH_KEY)
    monkeypatch.setenv("OVH_AI_MODEL", "Qwen3.6-27B")
    monkeypatch.setenv("OVH_AI_MAX_TOKENS", "512")
    monkeypatch.setenv("OVH_AI_REASONING_EFFORT", "low")
    monkeypatch.setenv("OVH_AI_MAX_CONCURRENT_REQUESTS", "2")
    client = llm_service.build_llm_service().provider
    assert (client.model, client.max_tokens, client.reasoning_effort, client.max_concurrent) == ("Qwen3.6-27B", 512, "low", 2)


def test_anonymous_access_for_local_tests_sends_no_key(monkeypatch):
    _clear_ovh_env(monkeypatch)
    monkeypatch.setenv("OVH_AI_ALLOW_ANONYMOUS", "true")
    service = llm_service.build_llm_service()
    assert service.configured and service.provider.anonymous
    assert service.health_check()["anonymous"] is True
    calls = Recorder(ovh_ok)
    service.provider._http._transport = httpx.MockTransport(calls)
    assert service.chat(MESSAGES) == "risposta OVH"
    assert "authorization" not in calls.requests[0].headers


def test_anonymous_access_is_ignored_in_production(monkeypatch):
    _clear_ovh_env(monkeypatch)
    monkeypatch.setenv("OVH_AI_ALLOW_ANONYMOUS", "true")
    monkeypatch.setenv("APP_ENV", "production")
    assert llm_service.build_llm_service().configured is False


def test_a_key_always_wins_over_anonymous_access(monkeypatch):
    _clear_ovh_env(monkeypatch)
    monkeypatch.setenv("OVH_AI_ALLOW_ANONYMOUS", "true")
    monkeypatch.setenv("OVH_AI_API_KEY", OVH_KEY)
    service = llm_service.build_llm_service()
    assert service.provider.anonymous is False and "anonymous" not in service.health_check()


def _reset_singletons(monkeypatch):
    monkeypatch.setattr(llm_service, "_llm_service", None)
    monkeypatch.setattr(llm_service, "_vision_llm_service", None)


def test_vision_service_shares_the_text_client_by_default(monkeypatch):
    _clear_ovh_env(monkeypatch)
    _reset_singletons(monkeypatch)
    monkeypatch.setenv("OVH_AI_API_KEY", OVH_KEY)
    assert llm_service.get_vision_llm_service() is llm_service.get_llm_service()


def test_vision_service_can_use_another_ovh_model(monkeypatch):
    _clear_ovh_env(monkeypatch)
    _reset_singletons(monkeypatch)
    monkeypatch.setenv("OVH_AI_API_KEY", OVH_KEY)
    monkeypatch.setenv("VISION_LLM_MODEL", "Qwen3.6-27B")
    vision = llm_service.get_vision_llm_service()
    assert vision is not llm_service.get_llm_service()
    assert vision.model == "Qwen3.6-27B" and vision.provider.model == "Qwen3.6-27B"
