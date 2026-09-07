from __future__ import annotations

from backend import main as main_module
from backend.rate_limit import SlidingWindowRateLimiter
from backend.tests.helpers import login, register


def test_sliding_window_rate_limiter_blocks_after_threshold():
    limiter = SlidingWindowRateLimiter(max_requests=2, window_seconds=60)
    assert limiter.allow("1.2.3.4") is True
    assert limiter.allow("1.2.3.4") is True
    assert limiter.allow("1.2.3.4") is False


def test_sliding_window_rate_limiter_is_per_key():
    limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=60)
    assert limiter.allow("client-a") is True
    assert limiter.allow("client-b") is True
    assert limiter.allow("client-a") is False


def test_sliding_window_rate_limiter_recovers_after_window(monkeypatch):
    fake_now = [1000.0]
    monkeypatch.setattr("backend.rate_limit.time.monotonic", lambda: fake_now[0])
    limiter = SlidingWindowRateLimiter(max_requests=1, window_seconds=10)
    assert limiter.allow("k") is True
    assert limiter.allow("k") is False
    fake_now[0] += 11
    assert limiter.allow("k") is True


def test_rate_limiter_sweeps_stale_keys_to_avoid_unbounded_growth(monkeypatch):
    fake_now = [0.0]
    monkeypatch.setattr("backend.rate_limit.time.monotonic", lambda: fake_now[0])
    limiter = SlidingWindowRateLimiter(max_requests=5, window_seconds=1)
    monkeypatch.setattr(limiter, "_SWEEP_EVERY_N_CALLS", 3)

    limiter.allow("client-1")
    limiter.allow("client-2")
    fake_now[0] += 10  # both keys' recorded hits are now outside the window
    limiter.allow("client-3")  # this is the 3rd call: triggers the sweep

    # Stale per-IP entries must be dropped, not kept forever.
    assert set(limiter._hits.keys()) == {"client-3"}


def test_login_endpoint_is_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(main_module, "_login_limiter", SlidingWindowRateLimiter(2, 60))
    for _ in range(2):
        response = login(client, "nobody@digitalmens.it")
        assert response.status_code == 401  # user does not exist, but request itself is allowed
    limited = login(client, "nobody@digitalmens.it")
    assert limited.status_code == 429


def test_register_endpoint_is_rate_limited_per_ip(client):
    main_module._register_limiter.clear()
    from backend.rate_limit import SlidingWindowRateLimiter as _SWL

    # Replace with a very tight limiter just for this test.
    tight_limiter = _SWL(1, 60)
    original = main_module._register_limiter
    main_module._register_limiter = tight_limiter
    try:
        first = register(client, "a@digitalmens.it")
        assert first.status_code == 200
        second = register(client, "b@digitalmens.it")
        assert second.status_code == 429
    finally:
        main_module._register_limiter = original
