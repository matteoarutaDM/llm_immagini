"""Single entry point for text generation. The rest of the application calls
get_llm_service() / get_vision_llm_service() and never talks to a provider
directly, so the provider can change without touching the callers.

The model runs on OVHcloud AI Endpoints (Qwen3.5-9B, EU datacenters, billed
per token): there is no GPU server of our own and no fallback.

Configuration (environment variables, see .env.example):
    OVH_AI_API_KEY                    required; without it every AI request fails with 503
    OVH_AI_ALLOW_ANONYMOUS            true = without a key use OVH's anonymous access (2 requests
                                      a minute), for local tests; ignored with APP_ENV=production
    OVH_AI_BASE_URL                   default https://oai.endpoints.kepler.ai.cloud.ovh.net
    OVH_AI_MODEL                      default Qwen3.5-9B
    OVH_AI_REASONING_EFFORT           default none (Qwen reasons before answering otherwise)
    OVH_AI_MAX_TOKENS                 cap on generated tokens (default 1024)
    OVH_AI_TIMEOUT, OVH_AI_CONNECT_TIMEOUT, OVH_AI_MAX_CONCURRENT_REQUESTS
    VISION_LLM_MODEL                  model that reads nameplates when OCR_BACKEND is not
                                      "got" (default OVH_AI_MODEL: Qwen3.5-9B reads images)

Nothing here connects at import time: the backend starts even without a key,
and AI requests then fail with LLMUnavailableError (HTTP 503).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

from dotenv import load_dotenv

from backend import perf
from backend.llm_errors import LLMError, LLMUnavailableError
from backend.ovh_client import DEFAULT_OVH_BASE_URL, DEFAULT_OVH_MODEL, DEFAULT_OVH_REASONING_EFFORT, OVHClient

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger("backend.llm")

PROVIDER = "ovh"
DEFAULT_MAX_TOKENS = 1024


def _env(name: str) -> str | None:
    value = os.getenv(name, "").strip()
    return value or None


def ovh_model() -> str:
    return _env("OVH_AI_MODEL") or DEFAULT_OVH_MODEL


def vision_model() -> str:
    return _env("VISION_LLM_MODEL") or _env("OCR_MODEL") or ovh_model()


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


def _anonymous_allowed() -> bool:
    if (_env("OVH_AI_ALLOW_ANONYMOUS") or "").lower() not in {"1", "true", "yes", "on"}:
        return False
    if (_env("APP_ENV") or "development").lower() == "production":
        logger.warning("OVH_AI_ALLOW_ANONYMOUS is ignored with APP_ENV=production")
        return False
    return True


def _build_ovh(model: str) -> OVHClient | None:
    """None when OVH_AI_API_KEY is missing, unless anonymous access is allowed
    for local tests (OVH limits it to 2 requests a minute)."""
    api_key = _env("OVH_AI_API_KEY")
    if not api_key:
        if not _anonymous_allowed():
            logger.warning("OVH_AI_API_KEY is missing: AI requests will fail with 503")
            return None
        logger.warning("OVH_AI_API_KEY is missing: anonymous OVH access, max 2 requests a minute (local tests only)")
    client = OVHClient(
        base_url=_env("OVH_AI_BASE_URL") or DEFAULT_OVH_BASE_URL,
        api_key=api_key,
        model=model,
        timeout=_float_env("OVH_AI_TIMEOUT", 120.0),
        connect_timeout=_float_env("OVH_AI_CONNECT_TIMEOUT", 10.0),
        max_concurrent=_int_env("OVH_AI_MAX_CONCURRENT_REQUESTS", 4),
        max_tokens=_int_env("OVH_AI_MAX_TOKENS", DEFAULT_MAX_TOKENS),
        reasoning_effort=_env("OVH_AI_REASONING_EFFORT") or DEFAULT_OVH_REASONING_EFFORT,
    )
    # Server-side log only: the key never reaches logs or API responses.
    logger.info(
        "LLM provider configured provider=ovh model=%s max_concurrent=%s max_tokens=%s reasoning_effort=%s",
        client.model, client.max_concurrent, client.max_tokens, client.reasoning_effort,
    )
    return client


class LLMService:
    """Facade over the OVH client. Errors are raised unchanged (LLMError
    subclasses, mapped to 503/504/500 by the API); the caller, citation checks
    included, does not know which provider answered."""

    def __init__(self, provider: OVHClient | None, model: str | None = None) -> None:
        self._provider = provider
        self._model = provider.model if provider is not None else (model or ovh_model())

    @property
    def provider(self) -> OVHClient | None:
        return self._provider

    @property
    def provider_name(self) -> str:
        return PROVIDER

    @property
    def model(self) -> str:
        return self._model

    @property
    def configured(self) -> bool:
        return self._provider is not None

    def chat(self, messages: list[dict[str, Any]], *, temperature: float | None = None) -> str:
        return self._call(lambda provider: provider.chat(messages, temperature=temperature))

    def generate(self, prompt: str, *, temperature: float | None = None) -> str:
        return self._call(lambda provider: provider.generate(prompt, temperature=temperature))

    def health_check(self) -> dict[str, Any]:
        """Configuration only, never a network call: every OVH request is billed."""
        if self._provider is None:
            return {"status": "unavailable", "provider": PROVIDER, "configured": False, "reason": "missing_api_key"}
        status = {**self._provider.health_check(), "status": "ok"}
        if self._provider.anonymous:
            status["anonymous"] = True
        return status

    def _call(self, request: Callable[[OVHClient], str]) -> str:
        if self._provider is None:
            logger.error("llm provider=%s result=unavailable reason=missing_api_key", PROVIDER)
            raise LLMUnavailableError()
        perf.metric("llm_provider", PROVIDER)
        started = time.monotonic()
        try:
            result = request(self._provider)
        except LLMError as exc:
            logger.warning("llm provider=%s result=%s duration=%.2fs", PROVIDER, exc.kind, time.monotonic() - started)
            raise
        logger.info("llm provider=%s result=success duration=%.2fs", PROVIDER, time.monotonic() - started)
        return result


_lock = threading.Lock()
_llm_service: LLMService | None = None
_vision_llm_service: LLMService | None = None


def build_llm_service() -> LLMService:
    return LLMService(_build_ovh(ovh_model()))


def get_llm_service() -> LLMService:
    global _llm_service
    with _lock:
        if _llm_service is None:
            _llm_service = build_llm_service()
        return _llm_service


def get_vision_llm_service() -> LLMService:
    """Model used to read nameplates when OCR_BACKEND is not "got". Shares the
    text model's client when the model is the same."""
    global _vision_llm_service
    text_service = get_llm_service()
    with _lock:
        if _vision_llm_service is None:
            model = vision_model()
            if model == text_service.model:
                _vision_llm_service = text_service
            else:
                _vision_llm_service = LLMService(_build_ovh(model), model)
        return _vision_llm_service
