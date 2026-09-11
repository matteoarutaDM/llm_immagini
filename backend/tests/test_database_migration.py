from __future__ import annotations

import sqlite3

from backend import database as database_module


def _create_legacy_schema(db_path) -> None:
    """Recreates the pre-verification schema this project shipped before
    email verification / session revocation existed, with one legacy user."""
    connection = sqlite3.connect(db_path)
    try:
        connection.executescript(
            """
            CREATE TABLE companies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                domain TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                company_id INTEGER REFERENCES companies(id),
                created_at TEXT NOT NULL
            );
            """
        )
        connection.execute(
            "INSERT INTO users(email, password_hash, company_id, created_at) VALUES (?, ?, NULL, ?)",
            ("legacy-user@digitalmens.it", "somehash$somehash", "2024-01-01T00:00:00+00:00"),
        )
        connection.commit()
    finally:
        connection.close()


def test_migration_marks_pre_existing_users_as_verified(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    _create_legacy_schema(db_path)

    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()

    connection = database_module.connect()
    try:
        row = connection.execute(
            "SELECT email_verified, token_version, failed_login_attempts, locked_until FROM users "
            "WHERE email = ?",
            ("legacy-user@digitalmens.it",),
        ).fetchone()
    finally:
        connection.close()

    assert row["email_verified"] == 1  # pre-existing accounts must not be locked out
    assert row["token_version"] == 0
    assert row["failed_login_attempts"] == 0
    assert row["locked_until"] is None


def test_migration_marks_leftover_pending_users_as_verified(tmp_path, monkeypatch):
    """Email verification no longer exists: an account left "pending" by the
    old mandatory-verification flow must be unblocked by the migration, not
    left stuck forever."""
    db_path = tmp_path / "legacy.db"
    _create_legacy_schema(db_path)

    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()  # first run: migrates + backfills the legacy user

    connection = database_module.connect()
    try:
        connection.execute(
            "INSERT INTO users(email, password_hash, company_id, email_verified, token_version, "
            "failed_login_attempts, created_at) VALUES (?, ?, NULL, 0, 0, 0, ?)",
            ("stuck-pending@digitalmens.it", "somehash$somehash", "2024-06-01T00:00:00+00:00"),
        )
        connection.commit()
    finally:
        connection.close()

    database_module.init_db()  # second run must unblock this account too

    connection = database_module.connect()
    try:
        row = connection.execute(
            "SELECT email_verified FROM users WHERE email = ?", ("stuck-pending@digitalmens.it",)
        ).fetchone()
    finally:
        connection.close()

    assert row["email_verified"] == 1


def test_migration_drops_the_unused_verification_tokens_table(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    _create_legacy_schema(db_path)

    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()
    database_module.init_db()  # must stay idempotent even once the table is already gone

    connection = database_module.connect()
    try:
        row = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'email_verification_tokens'"
        ).fetchone()
    finally:
        connection.close()

    assert row is None
