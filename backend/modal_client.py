"""HTTP client for the Modal fallback (deploy/modal_app.py).

The Modal app runs vLLM's OpenAI-compatible server, so this client calls
POST {MODAL_BASE_URL}/v1/chat/completions with `Authorization: Bearer
<MODAL_API_KEY>`. It only does inference: prompt, RAG and citation checks
stay in the backend and are identical whichever provider answers.

Same interface as OllamaClient (chat, generate, health_check), so
backend.llm_service can use either one without knowing which.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Any

import httpx

from backend import perf
from backend.llm_errors import LLMResponseError, LLMTimeoutError, LLMUnavailableError, error_for_status

logger = logging.getLogger("backend.modal")


class ModalClient:
    provider = "modal"

    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = 120.0,
        connect_timeout: float = 10.0,
        max_concurrent: int = 2,
        max_tokens: int | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.max_tokens = max_tokens
        self.max_concurrent = max(1, max_concurrent)
        self._timeout = timeout
        # Cost control: never more than max_concurrent paid requests at once
        # from this backend; extra ones wait for a free slot.
        self._slots = threading.BoundedSemaphore(self.max_concurrent)
        self._http = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout, connect=connect_timeout),
            # The key lives only in this header: never logged, never sent to the browser.
            headers={"Authorization": f"Bearer {api_key}"},
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
            # Same messages the primary receives; only role/content are standard.
            "messages": [{"role": item["role"], "content": item["content"]} for item in messages],
            "stream": False,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if self.max_tokens:
            payload["max_tokens"] = self.max_tokens
        data = self._post("/v1/chat/completions", payload)
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError):
            content = None
        if not isinstance(content, str):
            logger.error("Modal invalid response model=%s: missing choices[0].message.content", payload["model"])
            raise LLMResponseError()
        return content.strip()

    def generate(self, prompt: str, *, model: str | None = None, temperature: float | None = None) -> str:
        return self.chat([{"role": "user", "content": prompt}], model=model, temperature=temperature)

    def health_check(self) -> dict[str, Any]:
        """Configuration only, no network call: any request to Modal may start a
        paid GPU container, so a public health check must never do that."""
        return {"provider": self.provider, "configured": True, "model": self.model}

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        model = payload["model"]
        if not self._slots.acquire(timeout=self._timeout):
            logger.error("Modal busy: %s requests already running, gave up waiting", self.max_concurrent)
            raise LLMUnavailableError()
        started = time.monotonic()
        try:
            logger.info("Modal request start model=%s", model)
            try:
                response = self._http.post(path, json=payload)
            except httpx.ConnectTimeout as exc:
                self._log_failure(model, started, "connect timeout")
                raise LLMUnavailableError() from exc
            except httpx.TimeoutException as exc:
                # Includes a cold start (GPU container + model load) longer than MODAL_TIMEOUT.
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
                "Modal request model=%s duration_seconds=%.2f status=%s error=%s",
                model, duration, response.status_code, response.text[:200],
            )
            raise error_for_status(response.status_code)()
        try:
            data = response.json()
        except ValueError as exc:
            logger.error("Modal request model=%s status=%s: body is not JSON", model, response.status_code)
            raise LLMResponseError() from exc
        if not isinstance(data, dict):
            raise LLMResponseError()

        usage = data.get("usage") or {}
        # Duration is what Modal bills (plus cold start and idle time); no price
        # is configured here, so no cost is estimated.
        logger.info(
            "Modal request provider=modal model=%s duration_seconds=%.2f status=%s prompt_tokens=%s output_tokens=%s",
            model, duration, response.status_code, usage.get("prompt_tokens"), usage.get("completion_tokens"),
        )
        perf.metric("modal_duration_ms", round(duration * 1000))
        perf.metric("modal_prompt_tokens", usage.get("prompt_tokens"))
        perf.metric("modal_output_tokens", usage.get("completion_tokens"))
        return data

    def _log_failure(self, model: str, started: float, reason: str) -> None:
        logger.error(
            "Modal request failed model=%s duration_seconds=%.2f reason=%s",
            model, time.monotonic() - started, reason,
        )
