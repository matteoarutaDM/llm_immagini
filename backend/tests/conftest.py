from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg
import pytest
from psycopg import sql

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Tests run against their own PostgreSQL database, never the real one. These
# must be set before `backend.database` / `backend.main` are imported anywhere
# (including by pytest collection of other test modules), since they are read
# once at module import time.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@localhost:5432/assistente_test")
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ.setdefault("AUTH_SECRET", "test-secret-not-for-production")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")


def _recreate_test_database() -> None:
    """Drops and recreates the test database so every run starts from the
    current database/schema.sql."""
    conninfo = psycopg.conninfo.conninfo_to_dict(TEST_DATABASE_URL)
    db_name = conninfo.pop("dbname")
    if not db_name.endswith("_test"):
        raise RuntimeError(f"Refusing to recreate '{db_name}': test database names must end with _test")
    admin_url = psycopg.conninfo.make_conninfo(**{**conninfo, "dbname": "postgres"})
    with psycopg.connect(admin_url, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(db_name)))
        connection.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(db_name)))


_recreate_test_database()

from fastapi.testclient import TestClient  # noqa: E402

from backend import database as database_module  # noqa: E402
from backend import main as main_module  # noqa: E402  (applies the schema via init_db())

# Everything a test can create; operators from seed.sql are kept.
_PER_TEST_TABLES = (
    "app.analyses, app.messages, app.chats, app.company_documents, app.two_factor_email_codes, "
    "app.password_reset_tokens, app.user_recovery_codes, app.users, app.companies, "
    "ops.audit_log, ops.login_attempts, ops.operator_otp_challenges, ops.operator_sessions"
)


@pytest.fixture(autouse=True)
def isolated_backend_state(tmp_path, monkeypatch):
    """Give every test empty tables and its own company-documents directory,
    and reset all in-process singletons (rate limiters, lazily-loaded
    assistant) so tests never leak state into each other or into the real
    project's data/ directory on disk."""
    with database_module.connect() as connection:
        connection.execute(f"TRUNCATE {_PER_TEST_TABLES} RESTART IDENTITY CASCADE")

    company_data_dir = tmp_path / "companies"
    monkeypatch.setattr(main_module, "COMPANY_DATA_DIR", company_data_dir)

    main_module._login_limiter.clear()
    main_module._register_limiter.clear()
    main_module._ask_limiter.clear()
    main_module._transcribe_limiter.clear()
    main_module._2fa_verify_limiter.clear()
    main_module._2fa_recovery_limiter.clear()
    main_module._2fa_send_limiter.clear()
    main_module._forgot_password_ip_limiter.clear()
    main_module._forgot_password_email_limiter.clear()
    monkeypatch.setattr(main_module, "_assistant", None)
    monkeypatch.setattr(main_module, "_transcriber", None)

    yield


@pytest.fixture
def db():
    """Direct database access for assertions on persisted rows."""
    with database_module.connect() as connection:
        yield connection


@pytest.fixture
def client() -> TestClient:
    return TestClient(main_module.app)


def pytest_sessionfinish(session, exitstatus):
    database_module.close_pool()
