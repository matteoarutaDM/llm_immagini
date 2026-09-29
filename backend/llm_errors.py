"""Provider-agnostic LLM errors.

Every provider (Ollama today, RunPod in the future) raises these, so the API
layer can map them to clean HTTP responses without knowing which provider
answered. `str(exc)` is always the public, user-facing message: internal
details (URLs, upstream bodies) only go to the logs, never to the frontend.
"""
from __future__ import annotations


class LLMError(Exception):
    """Base class. Deliberately NOT a ValueError: /api/ask treats ValueError
    as "machine not recognized", which is a different outcome."""

    status_code = 500
    public_message = "Errore del servizio AI. Riprova piu tardi."
    kind = "error"  # short label for logs: result=<kind>

    def __init__(self, message: str | None = None) -> None:
        super().__init__(message or self.public_message)


class LLMUnavailableError(LLMError):
    """Server unreachable: PC off, Ollama not running, network down, connection dropped."""

    status_code = 503
    public_message = "Servizio AI non disponibile. Riprova piu tardi."
    kind = "unavailable"


class LLMTimeoutError(LLMError):
    """Server reachable but the answer took longer than the configured timeout."""

    status_code = 504
    public_message = "Il servizio AI non ha risposto in tempo. Riprova piu tardi."
    kind = "timeout"


class LLMModelNotFoundError(LLMError):
    """The configured model is not installed on the server (`ollama pull` missing)."""

    status_code = 503
    public_message = "Modello AI non disponibile sul server. Contatta l'amministratore."
    kind = "model_not_found"


class LLMResponseError(LLMError):
    """Upstream HTTP error or a response body that cannot be parsed."""

    status_code = 500
    public_message = "Errore del servizio AI. Riprova piu tardi."


class LLMAuthError(LLMResponseError):
    """401/403 from the provider: wrong or missing API key. A configuration
    error, not an outage, so it never triggers the fallback."""

    kind = "auth"


# Errors meaning "the provider cannot serve right now", for which retrying on
# another provider makes sense. Everything else (400, 401/403, invalid body,
# answers that fail citation checks, database errors...) is NOT here and is
# returned as is, because another provider would fail the same way.
# The model missing on the primary counts: that server cannot answer at all,
# and the fallback runs its own copy of the model.
INFRASTRUCTURE_ERRORS: tuple[type[LLMError], ...] = (LLMUnavailableError, LLMTimeoutError, LLMModelNotFoundError)


def error_for_status(status_code: int) -> type[LLMError]:
    """Error class for an HTTP error status returned by a provider."""
    if status_code == 404:
        return LLMModelNotFoundError
    if status_code in (401, 403):
        return LLMAuthError
    if status_code == 408:
        return LLMTimeoutError
    if status_code in (429, 502, 503, 504):
        # Overloaded, or a gateway in front of the model cannot reach it.
        return LLMUnavailableError
    return LLMResponseError
