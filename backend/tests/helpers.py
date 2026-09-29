from __future__ import annotations

from fastapi.testclient import TestClient

DEFAULT_PASSWORD = "SuperSecret123"


def create_account(
    email: str,
    password: str = DEFAULT_PASSWORD,
    *,
    role: str = "employee",
    terms_accepted: bool = True,
    full_name: str | None = None,
) -> int:
    """Creates a user straight in the database, as a company admin or the super
    admin would (there is no self-registration). A non-public email domain puts
    the user in the company of that domain, created if needed, so tests keep
    their "two users of acme.it share documents" meaning."""
    from backend.database import connect, hash_password
    from backend.public_email_domains import is_public_domain

    email = email.strip().lower()
    domain = email.split("@", 1)[1]
    with connect() as connection:
        company_id = None
        if not is_public_domain(domain):
            connection.execute(
                "INSERT INTO companies(domain, name) VALUES (%s, %s) ON CONFLICT (domain) DO NOTHING", (domain, domain)
            )
            company_id = connection.execute("SELECT id FROM companies WHERE domain = %s", (domain,)).fetchone()["id"]
        return connection.execute(
            "INSERT INTO users(email, password_hash, company_id, role, full_name, terms_accepted_at) "
            "VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) RETURNING id",
            (email, hash_password(password), company_id, role, full_name, terms_accepted),
        ).fetchone()["id"]


def register_user(client: TestClient, email: str, password: str = DEFAULT_PASSWORD, role: str = "employee") -> int:
    return create_account(email, password, role=role)


def login(client: TestClient, email: str, password: str = DEFAULT_PASSWORD):
    return client.post("/api/auth/login", data={"email": email, "password": password})


def signup(client: TestClient, email: str, password: str = DEFAULT_PASSWORD, role: str = "employee") -> str:
    """Creates the account and returns the bearer token of its first login."""
    create_account(email, password, role=role)
    response = login(client, email, password)
    assert response.status_code == 200, response.text
    return response.json()["token"]


def auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def capture_two_factor_emails(monkeypatch) -> dict[tuple[str, str], str]:
    """Intercepts email_service.send_two_factor_code_email so tests can read
    the plaintext code that would have been emailed out, instead of needing a
    real mailbox. Keyed by (email, purpose) -> code (latest wins)."""
    from backend import main as main_module

    captured: dict[tuple[str, str], str] = {}

    def fake_send(to_email: str, code: str, purpose: str, ttl_minutes: int) -> None:
        captured[(to_email, purpose)] = code

    monkeypatch.setattr(main_module.email_service, "send_two_factor_code_email", fake_send)
    return captured


def enable_two_factor(client: TestClient, token: str, email: str, captured: dict) -> list[str]:
    """Runs the full setup->confirm flow for an already-authenticated user
    using the code captured via capture_two_factor_emails(). Returns the
    recovery codes issued on confirmation."""
    setup_response = client.post("/api/auth/2fa/setup", headers=auth_headers(token))
    assert setup_response.status_code == 200, setup_response.text
    code = captured[(email, "enable")]

    confirm_response = client.post(
        "/api/auth/2fa/confirm", headers=auth_headers(token), data={"code": code}
    )
    assert confirm_response.status_code == 200, confirm_response.text
    return confirm_response.json()["recovery_codes"]
