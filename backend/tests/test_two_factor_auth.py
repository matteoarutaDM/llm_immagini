from __future__ import annotations

from backend import main as main_module
from backend.tests.helpers import (
    DEFAULT_PASSWORD,
    auth_headers,
    capture_two_factor_emails,
    enable_two_factor,
    login,
    signup,
)

EMAIL = "user@digitalmens.it"


def test_login_without_2fa_returns_normal_token(client):
    token = signup(client, EMAIL)
    response = login(client, EMAIL)
    assert response.status_code == 200
    assert response.json()["token"]
    assert "requires_2fa" not in response.json()
    assert token


def test_setup_sends_a_code_by_email_and_does_not_enable_immediately(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)

    response = client.post("/api/auth/2fa/setup", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json() == {"sent": True, "email": EMAIL}
    assert (EMAIL, "enable") in captured
    assert len(captured[(EMAIL, "enable")]) == 6
    assert captured[(EMAIL, "enable")].isdigit()

    status_response = client.get("/api/auth/2fa/status", headers=auth_headers(token))
    assert status_response.json()["enabled"] is False

    # A fresh login must still return a normal token, not a 2FA challenge.
    login_response = login(client, EMAIL)
    assert login_response.status_code == 200
    assert login_response.json()["token"]


def test_confirm_with_valid_code_enables_2fa(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    client.post("/api/auth/2fa/setup", headers=auth_headers(token))

    confirm_response = client.post(
        "/api/auth/2fa/confirm", headers=auth_headers(token), data={"code": captured[(EMAIL, "enable")]}
    )
    assert confirm_response.status_code == 200
    recovery_codes = confirm_response.json()["recovery_codes"]
    assert len(recovery_codes) == 10
    assert len(set(recovery_codes)) == 10

    status_response = client.get("/api/auth/2fa/status", headers=auth_headers(token))
    assert status_response.json() == {"enabled": True, "recovery_codes_remaining": 10}


def test_confirm_with_invalid_code_does_not_enable(client, monkeypatch):
    capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    client.post("/api/auth/2fa/setup", headers=auth_headers(token))

    response = client.post("/api/auth/2fa/confirm", headers=auth_headers(token), data={"code": "000000"})
    assert response.status_code == 400

    status_response = client.get("/api/auth/2fa/status", headers=auth_headers(token))
    assert status_response.json()["enabled"] is False


def test_setup_code_is_single_use(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    client.post("/api/auth/2fa/setup", headers=auth_headers(token))
    code = captured[(EMAIL, "enable")]

    first = client.post("/api/auth/2fa/confirm", headers=auth_headers(token), data={"code": code})
    assert first.status_code == 200

    # Re-running setup+confirm with the same (now consumed) code must fail.
    token2 = signup(client, "another@digitalmens.it")
    client.post("/api/auth/2fa/setup", headers=auth_headers(token2))
    reuse = client.post("/api/auth/2fa/confirm", headers=auth_headers(token2), data={"code": code})
    assert reuse.status_code == 400


def test_login_with_2fa_returns_challenge_and_emails_a_code(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)

    response = login(client, EMAIL)
    assert response.status_code == 200
    body = response.json()
    assert body["requires_2fa"] is True
    assert body["challenge_token"]
    assert "token" not in body
    assert (EMAIL, "login") in captured


def test_challenge_token_cannot_be_used_as_bearer_token(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)
    challenge_token = login(client, EMAIL).json()["challenge_token"]

    response = client.get("/api/auth/me", headers=auth_headers(challenge_token))
    assert response.status_code == 401


def test_verify_with_valid_email_code_returns_normal_token(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)
    challenge_token = login(client, EMAIL).json()["challenge_token"]

    response = client.post(
        "/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": captured[(EMAIL, "login")]}
    )
    assert response.status_code == 200
    new_token = response.json()["token"]
    assert new_token

    me_response = client.get("/api/auth/me", headers=auth_headers(new_token))
    assert me_response.status_code == 200
    assert me_response.json()["email"] == EMAIL


def test_verify_with_invalid_code_rejected(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)
    challenge_token = login(client, EMAIL).json()["challenge_token"]

    response = client.post(
        "/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": "000000"}
    )
    assert response.status_code == 401


def test_verify_with_expired_challenge_rejected(client, monkeypatch):
    from backend import database as database_module

    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)

    monkeypatch.setattr(database_module, "TWO_FA_CHALLENGE_TTL_SECONDS", -10)
    login_response = login(client, EMAIL)
    challenge_token = login_response.json()["challenge_token"]

    response = client.post(
        "/api/auth/2fa/verify",
        data={"challenge_token": challenge_token, "code": captured[(EMAIL, "login")]},
    )
    assert response.status_code == 401


def test_verify_with_expired_code_rejected(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)

    monkeypatch.setattr(main_module, "TWO_FA_EMAIL_CODE_TTL_SECONDS", -10)
    challenge_token = login(client, EMAIL).json()["challenge_token"]
    code = captured[(EMAIL, "login")]

    response = client.post("/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": code})
    assert response.status_code == 401


def test_resend_issues_a_new_code_and_invalidates_the_old_one(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)
    challenge_token = login(client, EMAIL).json()["challenge_token"]
    old_code = captured[(EMAIL, "login")]

    resend_response = client.post("/api/auth/2fa/resend", data={"challenge_token": challenge_token})
    assert resend_response.status_code == 200
    new_code = captured[(EMAIL, "login")]
    assert new_code != old_code

    old_attempt = client.post("/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": old_code})
    assert old_attempt.status_code == 401

    new_attempt = client.post("/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": new_code})
    assert new_attempt.status_code == 200


def test_recovery_with_valid_code_returns_token(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    codes = enable_two_factor(client, token, EMAIL, captured)
    challenge_token = login(client, EMAIL).json()["challenge_token"]

    response = client.post(
        "/api/auth/2fa/recovery", data={"challenge_token": challenge_token, "recovery_code": codes[0]}
    )
    assert response.status_code == 200
    assert response.json()["token"]


def test_recovery_code_is_single_use(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    codes = enable_two_factor(client, token, EMAIL, captured)

    challenge_token_1 = login(client, EMAIL).json()["challenge_token"]
    first_use = client.post(
        "/api/auth/2fa/recovery", data={"challenge_token": challenge_token_1, "recovery_code": codes[0]}
    )
    assert first_use.status_code == 200

    challenge_token_2 = login(client, EMAIL).json()["challenge_token"]
    second_use = client.post(
        "/api/auth/2fa/recovery", data={"challenge_token": challenge_token_2, "recovery_code": codes[0]}
    )
    assert second_use.status_code == 401


def test_disable_2fa(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    codes = enable_two_factor(client, token, EMAIL, captured)

    request_code_response = client.post(
        "/api/auth/2fa/disable/request-code", headers=auth_headers(token), data={"password": DEFAULT_PASSWORD}
    )
    assert request_code_response.status_code == 200
    disable_code = captured[(EMAIL, "disable")]

    response = client.post(
        "/api/auth/2fa/disable",
        headers=auth_headers(token),
        data={"password": DEFAULT_PASSWORD, "code": disable_code},
    )
    assert response.status_code == 200
    assert response.json() == {"disabled": True}

    # token_version was bumped: the token used to disable is itself now stale.
    me_response = client.get("/api/auth/me", headers=auth_headers(token))
    assert me_response.status_code == 401

    # A fresh login no longer challenges for 2FA.
    login_response = login(client, EMAIL)
    assert login_response.status_code == 200
    assert login_response.json()["token"]

    new_token = login_response.json()["token"]
    status_response = client.get("/api/auth/2fa/status", headers=auth_headers(new_token))
    assert status_response.json() == {"enabled": False, "recovery_codes_remaining": 0}
    assert codes  # sanity: codes were actually issued before disabling


def test_disable_2fa_via_recovery_code(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    codes = enable_two_factor(client, token, EMAIL, captured)

    response = client.post(
        "/api/auth/2fa/disable",
        headers=auth_headers(token),
        data={"password": DEFAULT_PASSWORD, "recovery_code": codes[0]},
    )
    assert response.status_code == 200
    assert response.json() == {"disabled": True}


def test_disable_2fa_requires_correct_password(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)

    response = client.post(
        "/api/auth/2fa/disable/request-code",
        headers=auth_headers(token),
        data={"password": "wrong-password"},
    )
    assert response.status_code == 401
    assert client.get("/api/auth/2fa/status", headers=auth_headers(token)).json()["enabled"] is True


def test_regenerate_recovery_codes(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    old_codes = enable_two_factor(client, token, EMAIL, captured)

    request_code_response = client.post(
        "/api/auth/2fa/recovery-codes/regenerate/request-code",
        headers=auth_headers(token),
        data={"password": DEFAULT_PASSWORD},
    )
    assert request_code_response.status_code == 200
    regen_code = captured[(EMAIL, "regenerate")]

    response = client.post(
        "/api/auth/2fa/recovery-codes/regenerate",
        headers=auth_headers(token),
        data={"password": DEFAULT_PASSWORD, "code": regen_code},
    )
    assert response.status_code == 200
    new_codes = response.json()["recovery_codes"]
    assert len(new_codes) == 10
    assert set(new_codes).isdisjoint(old_codes)

    # An old code no longer works after regeneration.
    challenge_token = login(client, EMAIL).json()["challenge_token"]
    old_code_response = client.post(
        "/api/auth/2fa/recovery", data={"challenge_token": challenge_token, "recovery_code": old_codes[0]}
    )
    assert old_code_response.status_code == 401

    # A new code does.
    challenge_token_2 = login(client, EMAIL).json()["challenge_token"]
    new_code_response = client.post(
        "/api/auth/2fa/recovery", data={"challenge_token": challenge_token_2, "recovery_code": new_codes[0]}
    )
    assert new_code_response.status_code == 200


def test_2fa_verify_rate_limited(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    enable_two_factor(client, token, EMAIL, captured)
    monkeypatch.setattr(main_module, "RATE_LIMIT_2FA_MAX", 3)
    main_module._2fa_verify_limiter.max_requests = 3

    challenge_token = login(client, EMAIL).json()["challenge_token"]
    for _ in range(3):
        response = client.post(
            "/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": "000000"}
        )
        assert response.status_code == 401

    limited_response = client.post(
        "/api/auth/2fa/verify", data={"challenge_token": challenge_token, "code": captured[(EMAIL, "login")]}
    )
    assert limited_response.status_code == 429


def test_2fa_recovery_rate_limited(client, monkeypatch):
    captured = capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    codes = enable_two_factor(client, token, EMAIL, captured)
    monkeypatch.setattr(main_module, "RATE_LIMIT_2FA_MAX", 3)
    main_module._2fa_recovery_limiter.max_requests = 3

    challenge_token = login(client, EMAIL).json()["challenge_token"]
    for _ in range(3):
        response = client.post(
            "/api/auth/2fa/recovery",
            data={"challenge_token": challenge_token, "recovery_code": "WRONG-CODE"},
        )
        assert response.status_code == 401

    limited_response = client.post(
        "/api/auth/2fa/recovery", data={"challenge_token": challenge_token, "recovery_code": codes[0]}
    )
    assert limited_response.status_code == 429


def test_2fa_send_rate_limited(client, monkeypatch):
    capture_two_factor_emails(monkeypatch)
    token = signup(client, EMAIL)
    monkeypatch.setattr(main_module, "RATE_LIMIT_2FA_SEND_MAX", 2)
    main_module._2fa_send_limiter.max_requests = 2

    for _ in range(2):
        response = client.post("/api/auth/2fa/setup", headers=auth_headers(token))
        assert response.status_code == 200

    limited_response = client.post("/api/auth/2fa/setup", headers=auth_headers(token))
    assert limited_response.status_code == 429
