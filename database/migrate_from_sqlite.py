"""Copia i dati del vecchio database SQLite (data/app.db) in PostgreSQL.

Uso (dalla radice del progetto):

    .venv/bin/python database/migrate_from_sqlite.py            # usa DATABASE_URL o il default locale
    .venv/bin/python database/migrate_from_sqlite.py --reset    # ricrea da zero gli schemi app/ops

Conserva gli ID originali (così i link e i riferimenti restano validi), poi
riallinea i contatori IDENTITY. Tutto avviene in un'unica transazione: se
qualcosa fallisce, PostgreSQL resta com'era. Il file SQLite non viene toccato.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

import psycopg

ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_SQLITE = ROOT_DIR / "data" / "app.db"
DEFAULT_DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres@localhost:5432/assistente")

TABLES_WITH_IDENTITY = (
    "app.companies",
    "app.users",
    "app.user_recovery_codes",
    "app.password_reset_tokens",
    "app.two_factor_email_codes",
    "app.company_documents",
    "app.chats",
    "app.messages",
)


def ts(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def load(sqlite_path: Path) -> dict[str, list[sqlite3.Row]]:
    source = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    tables = [
        "companies", "users", "user_recovery_codes", "password_reset_tokens",
        "two_factor_email_codes", "documents", "chats", "messages",
    ]
    data = {table: source.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() for table in tables}
    source.close()
    return data


def reset_schema(connection: psycopg.Connection) -> None:
    connection.execute("DROP SCHEMA IF EXISTS app CASCADE")
    connection.execute("DROP SCHEMA IF EXISTS ops CASCADE")
    script = (ROOT_DIR / "database" / "schema.sql").read_text(encoding="utf-8")
    # schema.sql has its own BEGIN/COMMIT; strip them to stay inside our transaction.
    script = script.replace("\nBEGIN;\n", "\n", 1).rsplit("COMMIT;", 1)[0]
    connection.execute(script)
    connection.execute((ROOT_DIR / "database" / "seed.sql").read_text(encoding="utf-8"))


def migrate(connection: psycopg.Connection, data: dict[str, list[sqlite3.Row]]) -> None:
    def insert(table: str, columns: list[str], rows: list[tuple]) -> None:
        if not rows:
            return
        placeholders = ", ".join(["%s"] * len(columns))
        connection.cursor().executemany(
            f"INSERT INTO {table} ({', '.join(columns)}) OVERRIDING SYSTEM VALUE VALUES ({placeholders})",
            rows,
        )

    insert("app.companies", ["id", "domain", "name", "created_at"],
           [(r["id"], r["domain"], r["name"], ts(r["created_at"])) for r in data["companies"]])

    insert(
        "app.users",
        ["id", "email", "password_hash", "company_id", "token_version", "failed_login_attempts", "locked_until",
         "terms_accepted_at", "two_factor_enabled", "two_factor_secret", "two_factor_pending_secret",
         "two_factor_confirmed_at", "created_at"],
        [
            (r["id"], r["email"], r["password_hash"], r["company_id"], r["token_version"], r["failed_login_attempts"],
             ts(r["locked_until"]), ts(r["terms_accepted_at"]), bool(r["two_factor_enabled"]), r["two_factor_secret"],
             r["two_factor_pending_secret"], ts(r["two_factor_confirmed_at"]), ts(r["created_at"]))
            for r in data["users"]
        ],
    )

    insert("app.user_recovery_codes", ["id", "user_id", "code_hash", "used_at", "created_at"],
           [(r["id"], r["user_id"], r["code_hash"], ts(r["used_at"]), ts(r["created_at"]))
            for r in data["user_recovery_codes"]])

    insert("app.password_reset_tokens", ["id", "user_id", "token_hash", "expires_at", "used_at", "created_at"],
           [(r["id"], r["user_id"], r["token_hash"], ts(r["expires_at"]), ts(r["used_at"]), ts(r["created_at"]))
            for r in data["password_reset_tokens"]])

    insert("app.two_factor_email_codes", ["id", "user_id", "purpose", "code_hash", "expires_at", "used_at", "created_at"],
           [(r["id"], r["user_id"], r["purpose"], r["code_hash"], ts(r["expires_at"]), ts(r["used_at"]),
             ts(r["created_at"])) for r in data["two_factor_email_codes"]])

    documents = []
    for r in data["documents"]:
        path = Path(r["path"])
        documents.append((
            r["id"], r["company_id"], r["filename"], r["path"],
            path.stat().st_size if path.exists() else None,
            r["status"], ts(r["created_at"]) if r["status"] == "indexed" else None, ts(r["created_at"]),
        ))
    insert("app.company_documents",
           ["id", "company_id", "filename", "storage_path", "size_bytes", "status", "indexed_at", "created_at"],
           documents)

    insert("app.chats", ["id", "user_id", "title", "knowledge_mode", "company_document_ids", "created_at", "updated_at"],
           [(r["id"], r["user_id"], r["title"], r["knowledge_mode"], json.loads(r["company_document_ids"] or "[]"),
             ts(r["created_at"]), ts(r["updated_at"])) for r in data["chats"]])

    insert("app.messages", ["id", "chat_id", "role", "content", "created_at"],
           [(r["id"], r["chat_id"], r["role"], r["content"], ts(r["created_at"])) for r in data["messages"]])

    for table in TABLES_WITH_IDENTITY:
        connection.execute(
            f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), coalesce((SELECT max(id) FROM {table}), 0) + 1, false)"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_SQLITE)
    parser.add_argument("--database-url", default=DEFAULT_DATABASE_URL)
    parser.add_argument("--reset", action="store_true", help="ricrea da zero gli schemi app e ops prima di copiare")
    args = parser.parse_args()

    if not args.sqlite.exists():
        print(f"File SQLite non trovato: {args.sqlite}", file=sys.stderr)
        return 1
    data = load(args.sqlite)

    with psycopg.connect(args.database_url) as connection:
        if args.reset:
            reset_schema(connection)
        existing = connection.execute("SELECT count(*) FROM app.users").fetchone()[0]
        if existing:
            print(f"app.users contiene già {existing} righe: usa --reset per ripartire da zero.", file=sys.stderr)
            return 1
        migrate(connection, data)
        print("Righe copiate:")
        for source_table, target in [
            ("companies", "app.companies"), ("users", "app.users"), ("user_recovery_codes", "app.user_recovery_codes"),
            ("password_reset_tokens", "app.password_reset_tokens"), ("two_factor_email_codes", "app.two_factor_email_codes"),
            ("documents", "app.company_documents"), ("chats", "app.chats"), ("messages", "app.messages"),
        ]:
            copied = connection.execute(f"SELECT count(*) FROM {target}").fetchone()[0]
            expected = len(data[source_table])
            status = "ok" if copied == expected else "DIVERSO"
            print(f"  {target:<30} {copied:>4} / {expected:<4} {status}")
            if copied != expected:
                raise SystemExit("Conteggi diversi: migrazione annullata (rollback).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
