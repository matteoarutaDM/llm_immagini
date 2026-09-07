from __future__ import annotations

import threading
import time
from collections import defaultdict, deque


class SlidingWindowRateLimiter:
    """Thread-safe, in-memory sliding-window rate limiter.

    Single-process only: fine for the current single-worker FastAPI deployment,
    but must be swapped for a shared store (e.g. Redis) before running multiple
    backend workers/processes behind a load balancer.
    """

    _SWEEP_EVERY_N_CALLS = 1000

    def __init__(self, max_requests: int, window_seconds: float) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._call_count = 0

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window_seconds:
                hits.popleft()
            allowed = len(hits) < self.max_requests
            if allowed:
                hits.append(now)

            # Distinct keys (IPs) accumulate forever otherwise, since a key
            # whose hits all expired is never removed from the dict. Sweep
            # periodically instead of on every call to keep this cheap.
            self._call_count += 1
            if self._call_count >= self._SWEEP_EVERY_N_CALLS:
                self._call_count = 0
                self._sweep(now)

            return allowed

    def _sweep(self, now: float) -> None:
        stale_keys = []
        for existing_key, existing_hits in self._hits.items():
            while existing_hits and now - existing_hits[0] > self.window_seconds:
                existing_hits.popleft()
            if not existing_hits:
                stale_keys.append(existing_key)
        for stale_key in stale_keys:
            del self._hits[stale_key]

    def clear(self) -> None:
        with self._lock:
            self._hits.clear()
            self._call_count = 0
