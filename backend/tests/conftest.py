from __future__ import annotations

import os
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# These must be set before `backend.database` / `backend.main` are imported
# anywhere (including by pytest collection of other test modules), since they
# are read once at module import time.
_import_time_db_dir = tempfile.mkdtemp(prefix="llm-immagini-test-import-")
os.environ.setdefault("DATABASE_PATH", str(Path(_import_time_db_dir) / "import-time.db"))
os.environ.setdefault("AUTH_SECRET", "test-secret-not-for-production")
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")

from fastapi.testclient import TestClient  # noqa: E402

from backend import database as database_module  # noqa: E402
from backend import main as main_module  # noqa: E402


@pytest.fixture(autouse=True)
def isolated_backend_state(tmp_path, monkeypatch):
    """Give every test a brand-new SQLite file and its own company-documents
    directory, and reset all in-process singletons (rate limiters,
    lazily-loaded assistant) so tests never leak state into each other or
    into the real project's data/ directory on disk."""
    db_path = tmp_path / f"test-{uuid.uuid4().hex}.db"
    monkeypatch.setattr(database_module, "DB_PATH", db_path)
    database_module.init_db()

    company_data_dir = tmp_path / "companies"
    monkeypatch.setattr(main_module, "COMPANY_DATA_DIR", company_data_dir)

    main_module._login_limiter.clear()
    main_module._register_limiter.clear()
    main_module._ask_limiter.clear()
    monkeypatch.setattr(main_module, "_assistant", None)

    yield db_path


@pytest.fixture
def client() -> TestClient:
    return TestClient(main_module.app)
