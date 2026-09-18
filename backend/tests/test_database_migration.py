from __future__ import annotations

import sqlite3

from backend import database as database_module


def _create_legacy_schema(db_path) -> None:
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


def test_migration_adds_auth_and_consent_columns_to_existing_users(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    _create_legacy_schema(db_path)
    monkeypatch.setattr(database_module, "DB_PATH", db_path)

    database_module.init_db()

    with database_module.connect() as connection:
        row = connection.execute(
            "SELECT token_version, failed_login_attempts, locked_until, terms_accepted_at "
            "FROM users WHERE email = ?",
            ("legacy-user@digitalmens.it",),
        ).fetchone()

    assert row["token_version"] == 0
    assert row["failed_login_attempts"] == 0
    assert row["locked_until"] is None
    assert row["terms_accepted_at"] == "2024-01-01T00:00:00+00:00"


def test_migration_is_idempotent(tmp_path, monkeypatch):
    db_path = tmp_path / "legacy.db"
    _create_legacy_schema(db_path)
    monkeypatch.setattr(database_module, "DB_PATH", db_path)

    database_module.init_db()
    database_module.init_db()
