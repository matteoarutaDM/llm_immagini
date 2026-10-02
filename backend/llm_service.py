"""Single entry point for text generation. The rest of the application calls
get_llm_service() / get_vision_llm_service() and never talks to a provider
directly, so the model can live on this machine or on a remote GPU server
without code changes.

Configuration (environment variables, see .env.example):
    OLLAMA_BASE_URL          e.g. http://localhost:11434 or http://100.x.x.x:11434
    OLLAMA_MODEL             e.g. llama3.1:8b
    OLLAMA_TIMEOUT           seconds to wait for an answer (default 120)
    OLLAMA_CONNECT_TIMEOUT   seconds to open the connection (default 10)
    OLLAMA_NUM_CTX           optional context window override
    OLLAMA_NUM_PREDICT       optional cap on generated tokens (stops runaway generations)
    OLLAMA_KEEP_ALIVE        optional, how long the model stays in VRAM ("30m", -1 = always)

    LLM_FALLBACK_ENABLED     true = use Modal when the primary has an infrastructure error
    MODAL_BASE_URL, MODAL_API_KEY, MODAL_MODEL, MODAL_TIMEOUT, MODAL_CONNECT_TIMEOUT,
    MODAL_MAX_CONCURRENT_REQUESTS
    LLM_PRIMARY_FAILURE_THRESHOLD, LLM_PRIMARY_COOLDOWN_SECONDS   circuit breaker

The legacy variables OPENAI_BASE_URL (".../v1") and LLM_MODEL are still
honoured when the OLLAMA_* ones are not set, so existing .env files keep working.

Providers: Ollama on the company RTX 5090 is always the primary. Modal is only
a fallback, called when the primary fails for an infrastructure reason
(backend.llm_errors.INFRASTRUCTURE_ERRORS) and never in parallel with it.

Nothing here connects at import time: if the GPU server is off the backend
still starts, and AI requests fail with LLMUnavailableError (HTTP 503) or go
to the fallback.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Protocol, TypeVar

from dotenv import load_dotenv

from backend import perf
from backend.llm_errors import INFRASTRUCTURE_ERRORS, LLMError
from backend.modal_client import ModalClient
from backend.ollama_client import OllamaClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger("backend.llm")

DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "llama3.2"
DEFAULT_MODAL_MODEL = "meta-llama/Llama-3.1-8B-Instruct"
FALLBACK_PROVIDER = "modal"

T = TypeVar("T")


class LLMProvider(Protocol):
    provider: str
    model: str

    def chat(self, messages: list[dict[str, Any]], *, model: str | None = None, temperature: float | None = None) -> str: ...

    def generate(self, prompt: str, *, model: str | None = None, temperature: float | None = None) -> str: ...

    def health_check(self) -> dict[str, Any]: ...


def _strip_openai_suffix(url: str) -> str:
    """"http://host:11434/v1" (OpenAI-compatible endpoint) -> "http://host:11434" (native API)."""
    url = url.strip().rstrip("/")
    return url[:-3] if url.endswith("/v1") else url


def _env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def ollama_base_url() -> str:
    return _strip_openai_suffix(_env("OLLAMA_BASE_URL") or _env("OPENAI_BASE_URL") or DEFAULT_OLLAMA_BASE_URL)


def ollama_model() -> str:
    return _env("OLLAMA_MODEL") or _env("LLM_MODEL") or DEFAULT_OLLAMA_MODEL


def vision_base_url() -> str:
    legacy = _env("VISION_LLM_BASE_URL")
    return _strip_openai_suffix(legacy) if legacy else ollama_base_url()


def vision_model() -> str:
    return _env("VISION_LLM_MODEL") or _env("OCR_MODEL") or ollama_model()


def _float_env(name: str, default: float) -> float:
    try:
        return float(_env(name) or default)
    except ValueError:
        logger.warning("Invalid %s, using default %s", name, default)
        return default


def _int_env(name: str, default: int | None = None) -> int | None:
    value = _env(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("Invalid %s, using default %s", name, default)
        return default


def _bool_env(name: str) -> bool:
    return (_env(name) or "").lower() in {"1", "true", "yes", "on"}


def _keep_alive_env() -> str | int | None:
    value = _env("OLLAMA_KEEP_ALIVE")
    if value is None:
        return None
    # Ollama reads a bare number as seconds and a string as a duration ("30m").
    return int(value) if value.lstrip("-").isdigit() else value


def _build_ollama(base_url: str, model: str) -> OllamaClient:
    client = OllamaClient(
        base_url=base_url,
        model=model,
        timeout=_float_env("OLLAMA_TIMEOUT", 120.0),
        connect_timeout=_float_env("OLLAMA_CONNECT_TIMEOUT", 10.0),
        num_ctx=_int_env("OLLAMA_NUM_CTX"),
        num_predict=_int_env("OLLAMA_NUM_PREDICT"),
        keep_alive=_keep_alive_env(),
    )
    # Server-side log only: the address never reaches API responses.
    logger.info(
        "LLM provider configured role=primary provider=ollama base_url=%s model=%s num_ctx=%s num_predict=%s keep_alive=%s",
        client.base_url, model, client.num_ctx, client.num_predict, client.keep_alive,
    )
    return client


def _build_modal() -> ModalClient | None:
    """None unless both MODAL_BASE_URL and MODAL_API_KEY are set."""
    base_url, api_key = _env("MODAL_BASE_URL"), _env("MODAL_API_KEY")
    if not (base_url and api_key):
        return None
    client = ModalClient(
        base_url=base_url,
        api_key=api_key,
        model=_env("MODAL_MODEL") or DEFAULT_MODAL_MODEL,
        timeout=_float_env("MODAL_TIMEOUT", 300.0),
        connect_timeout=_float_env("MODAL_CONNECT_TIMEOUT", 10.0),
        max_concurrent=_int_env("MODAL_MAX_CONCURRENT_REQUESTS", 2),
        # Same output cap as the primary, so both behave alike.
        max_tokens=_int_env("OLLAMA_NUM_PREDICT"),
    )
    logger.info(
        "LLM provider configured role=fallback provider=modal model=%s max_concurrent=%s max_tokens=%s",
        client.model, client.max_concurrent, client.max_tokens,
    )
    return client


class CircuitBreaker:
    """After `threshold` consecutive infrastructure failures of the primary,
    skip it for `cooldown` seconds and go straight to the fallback, so that
    with the GPU PC off users do not wait for a connect timeout every time.
    After the cooldown one request probes the primary again (the others keep
    using the fallback meanwhile): success closes the circuit, failure opens
    it for another cooldown. In memory, per process."""

    def __init__(self, threshold: int = 3, cooldown: float = 60.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.threshold = max(1, threshold)
        self.cooldown = cooldown
        self._clock = clock
        self._failures = 0
        self._open_until = 0.0
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._failures < self.threshold:
                return "closed"
            return "open" if self._clock() < self._open_until else "half_open"

    def allow(self) -> bool:
        with self._lock:
            if self._failures < self.threshold:
                return True
            now = self._clock()
            if now < self._open_until:
                return False
            # Cooldown over: let this request probe, keep the others on the fallback.
            self._open_until = now + self.cooldown
            return True

    def record_success(self) -> None:
        with self._lock:
            if self._failures >= self.threshold:
                logger.info("llm circuit=closed provider primary is back")
            self._failures = 0
            self._open_until = 0.0

    def record_failure(self) -> bool:
        """Returns True when this failure opens the circuit."""
        with self._lock:
            self._failures += 1
            if self._failures < self.threshold:
                return False
            self._open_until = self._clock() + self.cooldown
            return True


COUNTERS = (
    "llm_primary_requests",
    "llm_primary_failures",
    "llm_primary_skipped",
    "llm_fallback_requests",
    "llm_fallback_successes",
    "llm_fallback_failures",
)


class LLMService:
    """Facade over the primary provider, with an optional fallback.

    Only errors in INFRASTRUCTURE_ERRORS move a request to the fallback; any
    other error (400, 401/403, invalid body...) is raised unchanged. Prompt,
    messages and parameters are the same for both providers, and the caller
    (citation checks included) does not know which one answered.
    """

    def __init__(
        self,
        provider: LLMProvider,
        fallback: LLMProvider | None = None,
        *,
        fallback_enabled: bool = False,
        breaker: CircuitBreaker | None = None,
    ) -> None:
        self._provider = provider
        self._fallback = fallback
        self._fallback_enabled = fallback_enabled and fallback is not None
        self._breaker = breaker or CircuitBreaker()
        self._counters = dict.fromkeys(COUNTERS, 0)
        self._counters_lock = threading.Lock()

    @property
    def primary(self) -> LLMProvider:
        return self._provider

    @property
    def provider_name(self) -> str:
        return self._provider.provider

    @property
    def model(self) -> str:
        return self._provider.model

    @property
    def fallback_enabled(self) -> bool:
        return self._fallback_enabled

    def counters(self) -> dict[str, int]:
        with self._counters_lock:
            return dict(self._counters)

    def chat(self, messages: list[dict[str, Any]], *, temperature: float | None = None) -> str:
        return self._call(lambda provider: provider.chat(messages, temperature=temperature))

    def generate(self, prompt: str, *, temperature: float | None = None) -> str:
        return self._call(lambda provider: provider.generate(prompt, temperature=temperature))

    def health_check(self) -> dict[str, Any]:
        """Primary: cheap check (/api/tags). Fallback: configuration only, never a
        network call, because reaching Modal may start a paid GPU container."""
        primary = self._provider.health_check()
        primary_ok = primary.get("status") == "ok"
        if primary_ok:
            status = "ok"
        else:
            status = "degraded" if self._fallback_enabled else "unavailable"
        primary_info = {"provider": self._provider.provider, "available": primary_ok, "circuit": self._breaker.state}
        for key in ("model", "reason"):
            if key in primary:
                primary_info[key] = primary[key]
        fallback_info: dict[str, Any] = {
            "provider": self._fallback.provider if self._fallback else FALLBACK_PROVIDER,
            "enabled": self._fallback_enabled,
            "configured": self._fallback is not None,
        }
        if self._fallback is not None:
            fallback_info["model"] = self._fallback.model
        # Top-level keys kept as before (status/provider/model) for existing monitors.
        return {**primary, "status": status, "primary": primary_info, "fallback": fallback_info, "counters": self.counters()}

    def _count(self, name: str) -> None:
        with self._counters_lock:
            self._counters[name] += 1

    def _call(self, request: Callable[[LLMProvider], T]) -> T:
        primary = self._provider.provider
        if self._fallback_enabled and not self._breaker.allow():
            self._count("llm_primary_skipped")
            logger.warning("llm provider=%s result=skipped reason=circuit_open fallback=%s", primary, self._fallback.provider)
            return self._call_fallback(request, reason="circuit_open")

        self._count("llm_primary_requests")
        started = time.monotonic()
        try:
            result = request(self._provider)
        except INFRASTRUCTURE_ERRORS as exc:
            self._count("llm_primary_failures")
            opened = self._breaker.record_failure()
            duration = time.monotonic() - started
            if not self._fallback_enabled:
                logger.warning("llm provider=%s result=%s duration=%.2fs fallback=disabled", primary, exc.kind, duration)
                raise
            logger.warning(
                "llm provider=%s result=%s duration=%.2fs fallback=%s%s",
                primary, exc.kind, duration, self._fallback.provider,
                f" circuit=open cooldown={self._breaker.cooldown:.0f}s" if opened else "",
            )
            return self._call_fallback(request, reason=exc.kind)
        except LLMError as exc:
            # Not an outage (bad request, auth, invalid body): another provider
            # would fail the same way, so no fallback and no circuit change.
            logger.warning("llm provider=%s result=%s fallback=not_applicable", primary, exc.kind)
            raise
        self._breaker.record_success()
        perf.metric("llm_provider", primary)
        logger.info("llm provider=%s result=success duration=%.2fs", primary, time.monotonic() - started)
        return result

    def _call_fallback(self, request: Callable[[LLMProvider], T], *, reason: str) -> T:
        fallback = self._fallback.provider
        self._count("llm_fallback_requests")
        perf.metric("llm_provider", fallback)
        perf.metric("llm_fallback_reason", reason)
        started = time.monotonic()
        try:
            result = request(self._fallback)
        except LLMError as exc:
            self._count("llm_fallback_failures")
            logger.error(
                "llm provider=%s result=%s duration=%.2fs reason=%s %s",
                fallback, exc.kind, time.monotonic() - started, reason, self._counters_text(),
            )
            raise
        self._count("llm_fallback_successes")
        logger.info(
            "llm provider=%s result=success duration=%.2fs reason=%s %s",
            fallback, time.monotonic() - started, reason, self._counters_text(),
        )
        return result

    def _counters_text(self) -> str:
        return " ".join(f"{key}={value}" for key, value in self.counters().items())


_lock = threading.Lock()
_llm_service: LLMService | None = None
_vision_llm_service: LLMService | None = None


def build_llm_service() -> LLMService:
    primary = _build_ollama(ollama_base_url(), ollama_model())
    fallback = _build_modal()
    enabled = _bool_env("LLM_FALLBACK_ENABLED")
    if enabled and fallback is None:
        logger.warning("LLM_FALLBACK_ENABLED=true but MODAL_BASE_URL/MODAL_API_KEY are missing: fallback disabled")
    elif fallback is not None and not enabled:
        logger.info("Modal is configured but LLM_FALLBACK_ENABLED is not true: fallback disabled")
    breaker = CircuitBreaker(
        threshold=_int_env("LLM_PRIMARY_FAILURE_THRESHOLD", 3),
        cooldown=_float_env("LLM_PRIMARY_COOLDOWN_SECONDS", 60.0),
    )
    return LLMService(primary, fallback, fallback_enabled=enabled, breaker=breaker)


def get_llm_service() -> LLMService:
    global _llm_service
    with _lock:
        if _llm_service is None:
            _llm_service = build_llm_service()
        return _llm_service


def get_vision_llm_service() -> LLMService:
    """Model used to read nameplates when OCR_BACKEND is not "got". Primary
    only: the fallback model is text-only. Shares the text model's client when
    server and model are the same."""
    global _vision_llm_service
    text_service = get_llm_service()
    with _lock:
        if _vision_llm_service is None:
            base_url, model = vision_base_url(), vision_model()
            same = base_url == ollama_base_url() and model == text_service.model
            _vision_llm_service = LLMService(text_service.primary if same else _build_ollama(base_url, model))
        return _vision_llm_service
