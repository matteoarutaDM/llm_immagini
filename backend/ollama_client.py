"""HTTP client for Ollama's native API (/api/chat, /api/generate, /api/tags).

This is the only module that talks to Ollama over HTTP. The rest of the
application goes through backend.llm_service. Ollama may run on this machine
(http://localhost:11434) or on a remote PC reachable over the private network
(e.g. Tailscale, http://100.x.x.x:11434): for this client it is just an HTTP
endpoint, there is no network-specific logic here.
"""
from __future__ import annotations

import logging
import time
from typing import Any

import httpx

from backend import perf
from backend.llm_errors import (
    LLMModelNotFoundError,
    LLMResponseError,
    LLMTimeoutError,
    LLMUnavailableError,
    error_for_status,
)

logger = logging.getLogger("backend.ollama")

# /api/tags is a cheap listing call: a health check must not wait as long as a generation.
HEALTH_CHECK_READ_TIMEOUT_SECONDS = 5.0


class OllamaClient:
    provider = "ollama"

    def __init__(
        self,
        base_url: str,
        model: str,
        timeout: float = 120.0,
        connect_timeout: float = 10.0,
        num_ctx: int | None = None,
        num_predict: int | None = None,
        keep_alive: str | int | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.num_ctx = num_ctx
        # Cap on generated tokens. Without it a model stuck in a repetition loop
        # keeps generating until the read timeout (seen: 300 s instead of 1-2 s).
        self.num_predict = num_predict
        # How long Ollama keeps the model in VRAM after a request ("30m", 3600, -1 = forever).
        # None = Ollama's default (5 minutes): the first question after a pause reloads it.
        self.keep_alive = keep_alive
        self._connect_timeout = connect_timeout
        # One pooled client per process, shared by every request thread
        # (httpx.Client is thread-safe). The read timeout bounds how long we
        # wait for the whole answer, since with stream=false Ollama sends
        # nothing until generation is finished.
        self._http = httpx.Client(
            base_url=self.base_url,
            timeout=httpx.Timeout(timeout, connect=connect_timeout),
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
        """POST /api/chat. `messages` use Ollama's format: {"role", "content"}
        plus an optional "images" list of base64 strings for vision models."""
        payload = {
            "model": model or self.model,
            "messages": messages,
            "stream": False,
            "options": self._options(temperature),
            **self._keep_alive(),
        }
        data = self._post("/api/chat", payload)
        message = data.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if not isinstance(content, str):
            logger.error("Ollama invalid response endpoint=/api/chat model=%s: missing message.content", payload["model"])
            raise LLMResponseError()
        return content.strip()

    def generate(self, prompt: str, *, model: str | None = None, temperature: float | None = None) -> str:
        """POST /api/generate, for single-shot prompts without a conversation."""
        payload = {
            "model": model or self.model,
            "prompt": prompt,
            "stream": False,
            "options": self._options(temperature),
            **self._keep_alive(),
        }
        data = self._post("/api/generate", payload)
        content = data.get("response")
        if not isinstance(content, str):
            logger.error("Ollama invalid response endpoint=/api/generate model=%s: missing response", payload["model"])
            raise LLMResponseError()
        return content.strip()

    def health_check(self) -> dict[str, Any]:
        """Lightweight check via GET /api/tags: server reachable and model installed.
        Never raises and never runs a generation. The result contains no URL/IP,
        so it can be returned by a public endpoint as is."""
        started = time.monotonic()
        try:
            response = self._http.get(
                "/api/tags",
                timeout=httpx.Timeout(HEALTH_CHECK_READ_TIMEOUT_SECONDS, connect=self._connect_timeout),
            )
            response.raise_for_status()
            models = response.json().get("models") or []
            installed = {str(item.get("name") or item.get("model")) for item in models if isinstance(item, dict)}
        except (httpx.HTTPError, ValueError, AttributeError) as exc:
            logger.warning(
                "Ollama health check failed base_url=%s duration=%.2fs error=%s",
                self.base_url, time.monotonic() - started, type(exc).__name__,
            )
            return {"status": "unavailable", "provider": self.provider}

        if not self._model_installed(installed):
            logger.warning("Ollama health check: model=%s not installed (run `ollama pull %s`)", self.model, self.model)
            return {"status": "unavailable", "provider": self.provider, "model": self.model, "reason": "model_not_found"}
        return {"status": "ok", "provider": self.provider, "model": self.model}

    def _model_installed(self, installed: set[str]) -> bool:
        # "llama3.2" and "llama3.2:latest" are the same model for Ollama.
        wanted = self.model if ":" in self.model else f"{self.model}:latest"
        return self.model in installed or wanted in installed

    def _keep_alive(self) -> dict[str, Any]:
        return {} if self.keep_alive is None else {"keep_alive": self.keep_alive}

    def _options(self, temperature: float | None) -> dict[str, Any]:
        options: dict[str, Any] = {}
        if temperature is not None:
            options["temperature"] = temperature
        if self.num_ctx:
            options["num_ctx"] = self.num_ctx
        if self.num_predict:
            options["num_predict"] = self.num_predict
        return options

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        # Log sizes, never contents: prompts contain company documents.
        model = payload["model"]
        logger.info("Ollama request start endpoint=%s model=%s base_url=%s", path, model, self.base_url)
        started = time.monotonic()
        try:
            response = self._http.post(path, json=payload)
        except httpx.ConnectTimeout as exc:
            # On a private network an unreachable host (PC off) usually shows up
            # as a connect timeout, not as a refused connection.
            self._log_failure(path, model, started, "connect timeout (server off or unreachable)")
            raise LLMUnavailableError() from exc
        except httpx.TimeoutException as exc:
            self._log_failure(path, model, started, f"timeout ({type(exc).__name__})")
            raise LLMTimeoutError() from exc
        except httpx.TransportError as exc:
            # ConnectError (refused / DNS), RemoteProtocolError and ReadError
            # (connection dropped mid-answer), ...
            self._log_failure(path, model, started, f"unreachable ({type(exc).__name__})")
            raise LLMUnavailableError() from exc

        duration = time.monotonic() - started
        if response.status_code == 404:
            logger.error(
                "Ollama request model=%s duration=%.2fs status=404: model not found, run `ollama pull %s`",
                model, duration, model,
            )
            raise LLMModelNotFoundError()
        if response.status_code >= 400:
            logger.error(
                "Ollama request endpoint=%s model=%s duration=%.2fs status=%s error=%s",
                path, model, duration, response.status_code, _upstream_error(response),
            )
            raise error_for_status(response.status_code)()
        try:
            data = response.json()
        except ValueError as exc:
            logger.error("Ollama request endpoint=%s model=%s status=%s: body is not JSON", path, model, response.status_code)
            raise LLMResponseError() from exc
        if not isinstance(data, dict) or data.get("error"):
            error = data.get("error") if isinstance(data, dict) else "not an object"
            logger.error("Ollama request endpoint=%s model=%s status=%s error=%s", path, model, response.status_code, str(error)[:200])
            raise LLMResponseError()

        logger.info("Ollama request model=%s duration=%.2fs status=%s", model, duration, response.status_code)
        _record_ollama_metrics(data, duration)
        return data

    def _log_failure(self, path: str, model: str, started: float, reason: str) -> None:
        logger.error(
            "Ollama request failed endpoint=%s model=%s base_url=%s duration=%.2fs reason=%s",
            path, model, self.base_url, time.monotonic() - started, reason,
        )


def _record_ollama_metrics(data: dict[str, Any], wall_seconds: float) -> None:
    """Logs the timings Ollama returns with every non-streamed answer (in ns), to
    tell apart model loading, a large prompt, slow generation and the network."""
    ns = 1_000_000
    total = data.get("total_duration")
    if not isinstance(total, int):
        return
    load = data.get("load_duration") or 0
    prompt_tokens = data.get("prompt_eval_count") or 0
    prompt_eval = data.get("prompt_eval_duration") or 0
    output_tokens = data.get("eval_count") or 0
    generation = data.get("eval_duration") or 0
    metrics = {
        "ollama_load_ms": round(load / ns),
        "ollama_prompt_tokens": prompt_tokens,
        "ollama_prompt_eval_ms": round(prompt_eval / ns),
        "ollama_prompt_tps": round(prompt_tokens / (prompt_eval / 1e9)) if prompt_eval else None,
        "ollama_output_tokens": output_tokens,
        "ollama_generation_ms": round(generation / ns),
        "ollama_generation_tps": round(output_tokens / (generation / 1e9)) if generation else None,
        "ollama_server_total_ms": round(total / ns),
        # Wall time seen by the backend minus time spent inside Ollama: network + HTTP.
        "ollama_network_ms": max(0, round(wall_seconds * 1000 - total / ns)),
    }
    logger.info("OLLAMA PERF %s", " ".join(f"{key.removeprefix('ollama_')}={value}" for key, value in metrics.items()))
    for key, value in metrics.items():
        perf.metric(key, value)


def _upstream_error(response: httpx.Response) -> str:
    """Ollama's own error message (e.g. out of memory), truncated. It never
    contains the prompt, so it is safe to log."""
    try:
        return str(response.json().get("error"))[:200]
    except (ValueError, AttributeError):
        return response.text[:200]
