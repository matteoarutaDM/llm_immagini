"""HTTP client for OVHcloud AI Endpoints (Qwen3.5-9B), the only LLM provider.

AI Endpoints is serverless and OpenAI-compatible: this client calls
POST {OVH_AI_BASE_URL}/v1/chat/completions with `Authorization: Bearer
<OVH_AI_API_KEY>`. No GPU to start, so no cold start; billed per token.
The rest of the application goes through backend.llm_service.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

import httpx

from backend import perf
from backend.llm_errors import LLMResponseError, LLMTimeoutError, LLMUnavailableError, error_for_status

logger = logging.getLogger("backend.ovh")

DEFAULT_OVH_BASE_URL = "https://oai.endpoints.kepler.ai.cloud.ovh.net"
DEFAULT_OVH_MODEL = "Qwen3.5-9B"
# Qwen3.5 reasons before answering by default: the reasoning is billed and
# counts against max_tokens, and can leave the answer empty. OVH rejects
# vLLM's chat_template_kwargs but accepts the standard reasoning_effort.
DEFAULT_OVH_REASONING_EFFORT = "none"

# OVH returns the reasoning in a separate "reasoning" field; strip an inline
# block too in case it ends up in content.
_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


class OVHClient:
    provider = "ovh"

    def __init__(
        self,
        base_url: str,
        api_key: str | None,
        model: str,
        timeout: float = 120.0,
        connect_timeout: float = 10.0,
        max_concurrent: int = 4,
        max_tokens: int | None = None,
        reasoning_effort: str | None = DEFAULT_OVH_REASONING_EFFORT,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        base_url = base_url.strip().rstrip("/")
        # Accept the URL with or without /v1: the path below adds it.
        self.base_url = base_url[:-3] if base_url.endswith("/v1") else base_url
        self.model = model
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort
        self.anonymous = not api_key
        self.max_concurrent = max(1, max_concurrent)
        self._timeout = timeout
        # Cost control: never more than max_concurrent paid requests at once
        # from this backend; extra ones wait for a free slot.
        self._slots = threading.BoundedSemaphore(self.max_concurrent)
        self._http = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout, connect=connect_timeout),
            # The key lives only in this header: never logged, never sent to the browser.
            # No key = anonymous access (OVH allows 2 requests a minute), local tests only.
            headers={"Authorization": f"Bearer {api_key}"} if api_key else None,
            transport=transport,
        )

    def close(self) -> None:
        self._http.close()

    def chat(
        self,
        messages: list[dict[str, Any]],
        *,
        model: str | None = None,
        temperature: float | None = None,
    ) -> str:
        payload: dict[str, Any] = {
            "model": model or self.model,
            "messages": [_openai_message(item) for item in messages],
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if self.max_tokens:
            payload["max_tokens"] = self.max_tokens
        if self.reasoning_effort:
            payload["reasoning_effort"] = self.reasoning_effort
        data = self._post("/v1/chat/completions", payload)
        try:
            choice = data["choices"][0]
            content = choice["message"].get("content")
        except (KeyError, IndexError, TypeError, AttributeError):
            choice, content = None, None
        if isinstance(content, str):
            content = _THINK_BLOCK.sub("", content).strip()
        if not content:
            # Typically the reasoning used up max_tokens before any answer was written.
            finish = choice.get("finish_reason") if isinstance(choice, dict) else None
            logger.error("OVH invalid response model=%s: empty message.content finish_reason=%s", payload["model"], finish)
            raise LLMResponseError()
        return content

    def generate(self, prompt: str, *, model: str | None = None, temperature: float | None = None) -> str:
        return self.chat([{"role": "user", "content": prompt}], model=model, temperature=temperature)

    def health_check(self) -> dict[str, Any]:
        """Configuration only, no network call: every OVH request is billed and
        counts against the rate limit, so a public health check never makes one."""
        return {"provider": self.provider, "configured": True, "model": self.model}

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        model = payload["model"]
        if not self._slots.acquire(timeout=self._timeout):
            logger.error("OVH busy: %s requests already running, gave up waiting", self.max_concurrent)
            raise LLMUnavailableError()
        started = time.monotonic()
        try:
            logger.info("OVH request start model=%s", model)
            try:
                response = self._http.post(path, json=payload)
            except httpx.ConnectTimeout as exc:
                self._log_failure(model, started, "connect timeout")
                raise LLMUnavailableError() from exc
            except httpx.TimeoutException as exc:
                self._log_failure(model, started, f"timeout ({type(exc).__name__})")
                raise LLMTimeoutError() from exc
            except httpx.TransportError as exc:
                self._log_failure(model, started, f"unreachable ({type(exc).__name__})")
                raise LLMUnavailableError() from exc
        finally:
            self._slots.release()

        duration = time.monotonic() - started
        if response.status_code >= 400:
            logger.error(
                "OVH request model=%s duration_seconds=%.2f status=%s error=%s",
                model, duration, response.status_code, response.text[:200],
            )
            raise error_for_status(response.status_code)()
        try:
            data = response.json()
        except ValueError as exc:
            logger.error("OVH request model=%s status=%s: body is not JSON", model, response.status_code)
            raise LLMResponseError() from exc
        if not isinstance(data, dict):
            raise LLMResponseError()

        usage = data.get("usage") or {}
        # OVH bills per token (input and output priced separately); no price
        # is configured here, so no cost is estimated.
        logger.info(
            "OVH request provider=ovh model=%s duration_seconds=%.2f status=%s prompt_tokens=%s output_tokens=%s",
            model, duration, response.status_code, usage.get("prompt_tokens"), usage.get("completion_tokens"),
        )
        perf.metric("ovh_duration_ms", round(duration * 1000))
        perf.metric("ovh_prompt_tokens", usage.get("prompt_tokens"))
        perf.metric("ovh_output_tokens", usage.get("completion_tokens"))
        return data

    def _log_failure(self, model: str, started: float, reason: str) -> None:
        logger.error(
            "OVH request failed model=%s duration_seconds=%.2f reason=%s",
            model, time.monotonic() - started, reason,
        )


def _openai_message(item: dict[str, Any]) -> dict[str, Any]:
    """{"role", "content", "images": [base64...]} -> OpenAI format, where images
    travel as data URIs next to the text (Qwen3.5-9B reads images)."""
    images = item.get("images") or []
    if not images:
        return {"role": item["role"], "content": item["content"]}
    parts: list[dict[str, Any]] = [{"type": "text", "text": item["content"]}]
    parts += [{"type": "image_url", "image_url": {"url": f"data:{_image_mime(data)};base64,{data}"}} for data in images]
    return {"role": item["role"], "content": parts}


def _image_mime(data: str) -> str:
    # The first base64 characters encode the file signature.
    if data.startswith("iVBOR"):
        return "image/png"
    if data.startswith("UklGR"):
        return "image/webp"
    return "image/jpeg"
