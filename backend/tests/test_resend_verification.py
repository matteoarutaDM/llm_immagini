from __future__ import annotations

from backend.tests.helpers import login, register, register_and_verify, verify


def _resend(client, email: str):
    return client.post("/api/auth/resend-verification", data={"email": email})


def test_resend_gives_a_new_working_token(client, captured_emails):
    register(client, "user@digitalmens.it")
    assert len(captured_emails) == 1

    response = _resend(client, "user@digitalmens.it")
    assert response.status_code == 200
    assert len(captured_emails) == 2

    new_token = captured_emails[-1]["token"]
    verify_response = verify(client, new_token)
    assert verify_response.status_code == 200

    assert login(client, "user@digitalmens.it").status_code == 200


def test_resend_for_unknown_email_gives_generic_message_and_sends_nothing(client, captured_emails):
    response = _resend(client, "ghost@digitalmens.it")
    assert response.status_code == 200
    assert not captured_emails


def test_resend_for_already_verified_user_sends_nothing(client, captured_emails):
    register_and_verify(client, captured_emails, "user@digitalmens.it")
    captured_emails.clear()

    response = _resend(client, "user@digitalmens.it")
    assert response.status_code == 200
    assert not captured_emails


def test_resend_endpoint_is_rate_limited(client, captured_emails, monkeypatch):
    from backend import main as main_module
    from backend.rate_limit import SlidingWindowRateLimiter

    monkeypatch.setattr(main_module, "_account_recovery_limiter", SlidingWindowRateLimiter(1, 60))
    register(client, "user@digitalmens.it")

    first = _resend(client, "user@digitalmens.it")
    assert first.status_code == 200
    second = _resend(client, "user@digitalmens.it")
    assert second.status_code == 429
