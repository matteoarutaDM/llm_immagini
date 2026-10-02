"""Per-request profiling: stage timings and non-sensitive metrics, logged as one
"PERF" line per request and correlated through a request id.

    with perf.stage("ocr"):
        ...
    perf.metric("rag_chunks", 12)

Outside a profiled request stage() and metric() are no-ops, so library code
(startup, tests, CLI scripts) can call them freely. Only sizes, counts and
durations are recorded: never prompts, documents, images or credentials.
"""
from __future__ import annotations

import contextvars
import logging
import time
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("backend.perf")


class RequestProfile:
    def __init__(self, name: str, request_id: str | None = None) -> None:
        self.name = name
        self.request_id = request_id or uuid.uuid4().hex[:12]
        self.started = time.perf_counter()
        self.stages: dict[str, float] = {}
        self.metrics: dict[str, Any] = {}
        self._depth = 0

    def add(self, stage: str, ms: float) -> None:
        self.stages[stage] = self.stages.get(stage, 0.0) + ms

    def total_ms(self) -> float:
        return (time.perf_counter() - self.started) * 1000

    def summary(self) -> dict[str, Any]:
        total = self.total_ms()
        stages = {key: round(value) for key, value in self.stages.items()}
        # Top-level stages only, so nested ones (e.g. ocr inside ask_machine) are not counted twice.
        accounted = sum(value for key, value in self.stages.items() if "." not in key)
        return {"total_ms": round(total), **stages, "other_ms": round(max(0.0, total - accounted)), **self.metrics}

    def log(self, **extra: Any) -> None:
        fields = {**self.summary(), **extra}
        logger.info("PERF %s rid=%s %s", self.name, self.request_id, " ".join(f"{k}={v}" for k, v in fields.items()))


_current: contextvars.ContextVar[RequestProfile | None] = contextvars.ContextVar("perf_profile", default=None)


def start(name: str, request_id: str | None = None) -> RequestProfile:
    profile = RequestProfile(name, request_id)
    _current.set(profile)
    return profile


def current() -> RequestProfile | None:
    return _current.get()


def request_id() -> str:
    profile = _current.get()
    return profile.request_id if profile else "-"


@contextmanager
def stage(name: str) -> Iterator[None]:
    """Times a block as `<name>_ms`. A dotted name ("ask.ocr") marks a sub-stage
    that is shown but not added to the top-level total."""
    profile = _current.get()
    if profile is None:
        yield
        return
    started = time.perf_counter()
    try:
        yield
    finally:
        profile.add(f"{name}_ms", (time.perf_counter() - started) * 1000)


def add(name: str, ms: float) -> None:
    profile = _current.get()
    if profile is not None:
        profile.add(f"{name}_ms", ms)


def metric(name: str, value: Any) -> None:
    profile = _current.get()
    if profile is not None:
        profile.metrics[name] = value


class RequestIdFilter(logging.Filter):
    """Adds %(request_id)s to every log record, so all lines of a request can be grepped together."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id()
        return True
