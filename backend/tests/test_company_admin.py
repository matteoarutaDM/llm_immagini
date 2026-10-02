from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from backend import main as main_module
from backend.tests.helpers import auth_headers, create_account, login, signup

PDF_BYTES = b"%PDF-1.4\n%fake pdf content for tests\n%%EOF"
INTERNAL_TOKEN = "internal-test-token"


class FakeAssistant:
    def __init__(self) -> None:
        self.invalidated: list[str] = []
        self.indexed: list[str] = []

    def invalidate_company_rag(self, company_domain: str) -> None:
        self.invalidated.append(company_domain)

    def ensure_company_rag_ready(self, company_domain: str) -> None:
        self.indexed.append(company_domain)


@pytest.fixture
def fake_assistant(monkeypatch) -> FakeAssistant:
    fake = FakeAssistant()
    monkeypatch.setattr(main_module, "get_assistant", lambda: fake)
    return fake


@pytest.fixture
def boss(client) -> str:
    return signup(client, "boss@acme.it", role="company_admin")


def _create_employee(client, boss_token, email="worker@acme.it", full_name="Luca Bianchi"):
    return client.post(
        "/api/company/employees", headers=auth_headers(boss_token), data={"email": email, "full_name": full_name}
    )


def _upload(client, token, filename="manuale.pdf"):
    return client.post(
        "/api/company/documents",
        headers=auth_headers(token),
        files={"document": (filename, io.BytesIO(PDF_BYTES), "application/pdf")},
    )


def _audit_actions(db, company_domain="acme.it"):
    return [
        row["action"]
        for row in db.execute(
            "SELECT log.action FROM ops.audit_log AS log JOIN app.companies c ON c.id = log.company_id "
            "WHERE c.domain = %s ORDER BY log.id",
            (company_domain,),
        ).fetchall()
    ]


# ------------------------------------------------------------ access control


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/company/employees"),
        ("post", "/api/company/employees"),
        ("post", "/api/company/employees/1/status"),
        ("post", "/api/company/employees/1/reset-password"),
        ("get", "/api/company/dashboard"),
        ("get", "/api/company/audit"),
        ("post", "/api/company/documents"),
        ("post", "/api/company/documents/1/archive"),
        ("post", "/api/company/documents/1/reindex"),
        ("delete", "/api/company/documents/1"),
    ],
)
def test_employees_cannot_use_the_company_admin_area(client, method, path):
    token = signup(client, "worker@acme.it")
    response = getattr(client, method)(path, headers=auth_headers(token))
    assert response.status_code == 403


# ------------------------------------------------------------ employees


def test_company_admin_creates_an_employee_with_a_one_time_temporary_password(client, db, boss):
    response = _create_employee(client, boss)
    assert response.status_code == 200
    body = response.json()
    password = body["temporary_password"]
    assert len(password) >= 12
    assert body["employee"]["role"] == "employee"

    row = db.execute("SELECT * FROM app.users WHERE email = 'worker@acme.it'").fetchone()
    assert row["password_is_temporary"] is True
    assert row["terms_accepted_at"] is None
    assert password not in row["password_hash"]

    me = login(client, "worker@acme.it", password).json()
    assert me["company_domain"] == "acme.it"
    assert me["role"] == "employee"
    assert me["password_is_temporary"] is True
    assert me["terms_accepted"] is False
    assert _audit_actions(db) == ["employee.create"]


def test_employee_list_contains_only_the_admins_company(client, boss):
    _create_employee(client, boss)
    create_account("other@othercorp.it")
    employees = client.get("/api/company/employees", headers=auth_headers(boss)).json()
    assert sorted(item["email"] for item in employees) == ["boss@acme.it", "worker@acme.it"]


def test_duplicate_employee_email_is_rejected(client, boss):
    assert _create_employee(client, boss).status_code == 200
    assert _create_employee(client, boss).status_code == 409


def test_blocking_an_employee_ends_their_sessions_and_needs_a_reason(client, db, boss):
    employee = _create_employee(client, boss).json()
    employee_token = login(client, "worker@acme.it", employee["temporary_password"]).json()["token"]
    employee_id = employee["employee"]["id"]

    no_reason = client.post(
        f"/api/company/employees/{employee_id}/status", headers=auth_headers(boss), data={"status": "blocked"}
    )
    assert no_reason.status_code == 400

    blocked = client.post(
        f"/api/company/employees/{employee_id}/status",
        headers=auth_headers(boss),
        data={"status": "blocked", "reason": "Fine contratto"},
    )
    assert blocked.status_code == 200
    assert client.get("/api/auth/me", headers=auth_headers(employee_token)).status_code == 401
    assert login(client, "worker@acme.it", employee["temporary_password"]).status_code == 403

    again = client.post(
        f"/api/company/employees/{employee_id}/status",
        headers=auth_headers(boss),
        data={"status": "blocked", "reason": "Fine contratto"},
    )
    assert again.status_code == 409

    unblocked = client.post(
        f"/api/company/employees/{employee_id}/status", headers=auth_headers(boss), data={"status": "active"}
    )
    assert unblocked.status_code == 200
    assert login(client, "worker@acme.it", employee["temporary_password"]).status_code == 200
    assert _audit_actions(db) == ["employee.create", "employee.block", "employee.unblock"]
    reason = db.execute("SELECT reason FROM ops.audit_log WHERE action = 'employee.block'").fetchone()["reason"]
    assert reason == "Fine contratto"


def test_company_admin_cannot_manage_other_companies_admins_or_themselves(client, db, boss):
    outsider_id = create_account("worker@othercorp.it")
    other_admin_id = create_account("second.boss@acme.it", role="company_admin")
    own_id = db.execute("SELECT id FROM app.users WHERE email = 'boss@acme.it'").fetchone()["id"]

    for employee_id, expected in ((outsider_id, 404), (other_admin_id, 403), (own_id, 403)):
        status = client.post(
            f"/api/company/employees/{employee_id}/status",
            headers=auth_headers(boss),
            data={"status": "blocked", "reason": "prova"},
        )
        reset = client.post(f"/api/company/employees/{employee_id}/reset-password", headers=auth_headers(boss))
        assert (status.status_code, reset.status_code) == (expected, expected)


def test_reset_password_replaces_the_old_one_with_a_new_temporary_password(client, db, boss):
    employee = _create_employee(client, boss).json()
    old_password = employee["temporary_password"]
    reset = client.post(
        f"/api/company/employees/{employee['employee']['id']}/reset-password", headers=auth_headers(boss)
    ).json()

    assert reset["temporary_password"] != old_password
    assert login(client, "worker@acme.it", old_password).status_code == 401
    assert login(client, "worker@acme.it", reset["temporary_password"]).status_code == 200
    assert _audit_actions(db)[-1] == "employee.reset_password"


# ------------------------------------------------------------ password change (optional, from the profile)


def test_employee_may_keep_the_temporary_password_or_change_it(client, db, boss):
    password = _create_employee(client, boss).json()["temporary_password"]
    token = login(client, "worker@acme.it", password).json()["token"]
    client.post("/api/auth/accept-terms", headers=auth_headers(token))

    # Keeping it is allowed: the site works with the temporary password.
    assert client.get("/api/chats", headers=auth_headers(token)).status_code == 200

    wrong = client.post(
        "/api/auth/change-password",
        headers=auth_headers(token),
        data={"current_password": "wrong-password", "new_password": "MyOwnPassword1"},
    )
    assert wrong.status_code == 401

    changed = client.post(
        "/api/auth/change-password",
        headers=auth_headers(token),
        data={"current_password": password, "new_password": "MyOwnPassword1"},
    )
    assert changed.status_code == 200
    new_token = changed.json()["token"]
    assert client.get("/api/auth/me", headers=auth_headers(token)).status_code == 401  # other sessions revoked
    me = client.get("/api/auth/me", headers=auth_headers(new_token)).json()
    assert me["password_is_temporary"] is False
    assert login(client, "worker@acme.it", "MyOwnPassword1").status_code == 200


def test_new_password_must_be_valid_and_different(client):
    token = signup(client, "worker@acme.it")
    short = client.post(
        "/api/auth/change-password",
        headers=auth_headers(token),
        data={"current_password": "SuperSecret123", "new_password": "short"},
    )
    same = client.post(
        "/api/auth/change-password",
        headers=auth_headers(token),
        data={"current_password": "SuperSecret123", "new_password": "SuperSecret123"},
    )
    assert short.status_code == 400
    assert same.status_code == 400


# ------------------------------------------------------------ documents


def test_employees_only_see_indexed_documents_the_admin_sees_all(client, db, boss, fake_assistant):
    indexed = _upload(client, boss, "attivo.pdf").json()
    archived = _upload(client, boss, "vecchio.pdf").json()
    client.post(f"/api/company/documents/{archived['id']}/archive", headers=auth_headers(boss))
    employee_token = signup(client, "worker@acme.it")

    admin_view = client.get("/api/company/documents", headers=auth_headers(boss)).json()
    employee_view = client.get("/api/company/documents", headers=auth_headers(employee_token)).json()

    assert {item["filename"]: item["status"] for item in admin_view} == {"attivo.pdf": "indexed", "vecchio.pdf": "archived"}
    assert [item["filename"] for item in employee_view] == ["attivo.pdf"]
    assert indexed["status"] == "indexed"


def test_archive_removes_the_file_from_the_rag_folder_and_reindex_puts_it_back(client, db, boss, fake_assistant):
    document = _upload(client, boss).json()
    stored = Path(db.execute("SELECT storage_path FROM app.company_documents").fetchone()["storage_path"])
    assert stored.parent.name == "pdfs" and stored.exists()

    archived = client.post(f"/api/company/documents/{document['id']}/archive", headers=auth_headers(boss))
    assert archived.status_code == 200 and archived.json()["status"] == "archived"
    moved = Path(db.execute("SELECT storage_path FROM app.company_documents").fetchone()["storage_path"])
    assert moved.parent.name == "archive" and moved.exists() and not stored.exists()
    assert fake_assistant.invalidated[-1] == "acme.it"
    assert client.post(f"/api/company/documents/{document['id']}/archive", headers=auth_headers(boss)).status_code == 409

    reindexed = client.post(f"/api/company/documents/{document['id']}/reindex", headers=auth_headers(boss))
    assert reindexed.status_code == 200 and reindexed.json()["status"] == "indexed"
    restored = Path(db.execute("SELECT storage_path FROM app.company_documents").fetchone()["storage_path"])
    assert restored == stored and restored.exists()
    assert client.post(f"/api/company/documents/{document['id']}/reindex", headers=auth_headers(boss)).status_code == 409

    client.delete(f"/api/company/documents/{document['id']}", headers=auth_headers(boss))
    assert not restored.exists()
    assert db.execute("SELECT count(*) FROM app.company_documents").fetchone()["count"] == 0
    assert _audit_actions(db) == ["document.upload", "document.archive", "document.reindex", "document.delete"]


def test_documents_of_another_company_are_not_found(client, boss, fake_assistant):
    other_boss = signup(client, "boss@othercorp.it", role="company_admin")
    document = _upload(client, other_boss).json()
    for method, path in (
        ("post", f"/api/company/documents/{document['id']}/archive"),
        ("post", f"/api/company/documents/{document['id']}/reindex"),
        ("delete", f"/api/company/documents/{document['id']}"),
    ):
        assert getattr(client, method)(path, headers=auth_headers(boss)).status_code == 404


def test_archiving_does_not_mark_the_document_indexed_on_the_next_upload(client, db, boss, fake_assistant):
    old = _upload(client, boss, "vecchio.pdf").json()
    client.post(f"/api/company/documents/{old['id']}/archive", headers=auth_headers(boss))
    _upload(client, boss, "nuovo.pdf")
    statuses = {row["filename"]: row["status"] for row in db.execute("SELECT filename, status FROM app.company_documents")}
    assert statuses == {"vecchio.pdf": "archived", "nuovo.pdf": "indexed"}


# ------------------------------------------------------------ dashboard and activity log


def _insert_analysis(db, email, status="recognized", question="Domanda riservata del dipendente", machine="Gru"):
    user_id = db.execute("SELECT id FROM app.users WHERE email = %s", (email,)).fetchone()["id"]
    db.execute(
        "INSERT INTO app.analyses(user_id, knowledge_mode, question, status, machine_id, machine_name, error_message, "
        "duration_ms) VALUES (%s, 'base', %s, %s, %s, %s, %s, 1000)",
        (user_id, question, status, "gru" if status == "recognized" else None,
         machine if status == "recognized" else None, "errore" if status == "failed" else None),
    )
    db.commit()  # visible to the request's own connection


def test_dashboard_shows_company_statistics_but_never_questions(client, db, boss):
    create_account("worker@acme.it")
    create_account("worker@othercorp.it")
    _insert_analysis(db, "worker@acme.it")
    _insert_analysis(db, "worker@acme.it", status="not_recognized")
    _insert_analysis(db, "worker@othercorp.it", question="Domanda di un'altra azienda")

    response = client.get("/api/company/dashboard", headers=auth_headers(boss))
    assert response.status_code == 200
    body = response.json()
    assert body["employees"]["total"] == 2
    assert body["analyses"]["total"] == 2
    assert body["analyses"]["recognized"] == 1
    assert body["analyses"]["recognition_rate"] == 0.5
    assert body["top_machines"] == [{"machine_name": "Gru", "analyses": 1}]
    assert len(body["daily"]) == 30 and sum(day["total"] for day in body["daily"]) == 2
    worker = next(item for item in body["per_employee"] if item["email"] == "worker@acme.it")
    assert worker["analyses"] == 2

    text = json.dumps(body)
    assert "Domanda riservata" not in text and "altra azienda" not in text
    assert "question" not in text and "answer" not in text


def test_activity_log_contains_only_the_admins_company(client, db, boss, fake_assistant):
    _create_employee(client, boss)
    other_boss = signup(client, "boss@othercorp.it", role="company_admin")
    _create_employee(client, other_boss, email="worker@othercorp.it")

    log = client.get("/api/company/audit", headers=auth_headers(boss)).json()
    assert log["total"] == 1
    entry = log["items"][0]
    assert entry["action"] == "employee.create"
    assert entry["actor"] == "boss@acme.it"
    assert entry["details"] == {"email": "worker@acme.it", "full_name": "Luca Bianchi"}


# ------------------------------------------------------------ super admin (backoffice → /internal)


def _internal(client, method, path, **kwargs):
    return getattr(client, method)(path, headers={"X-Internal-Token": INTERNAL_TOKEN}, **kwargs)


@pytest.fixture
def internal(monkeypatch):
    monkeypatch.setattr(main_module, "BACKOFFICE_API_TOKEN", INTERNAL_TOKEN)


def test_super_admin_creates_a_company_and_its_admin(client, db, internal):
    company = _internal(client, "post", "/internal/companies", json={"name": "Acme S.p.A.", "domain": "@ACME.it"})
    assert company.status_code == 200
    company_id = company.json()["id"]
    assert company.json()["domain"] == "acme.it"
    assert _internal(client, "post", "/internal/companies", json={"name": "Copia", "domain": "acme.it"}).status_code == 409
    assert _internal(client, "post", "/internal/companies", json={"name": "X", "domain": "not a domain"}).status_code == 400

    created = _internal(
        client, "post", f"/internal/companies/{company_id}/accounts",
        json={"email": "boss@acme.it", "full_name": "Mario Rossi", "operator_id": None},
    ).json()
    assert created["user"]["role"] == "company_admin"
    me = login(client, "boss@acme.it", created["temporary_password"]).json()
    assert me["role"] == "company_admin" and me["company_name"] == "Acme S.p.A."


def test_super_admin_can_promote_demote_and_reset_passwords(client, db, internal):
    user_id = create_account("worker@acme.it")
    promoted = _internal(client, "post", f"/internal/users/{user_id}/role", json={"role": "company_admin"})
    assert promoted.status_code == 200 and promoted.json()["previous_role"] == "employee"
    assert _internal(client, "post", f"/internal/users/{user_id}/role", json={"role": "company_admin"}).status_code == 409

    loner = create_account("solo@gmail.com")
    assert _internal(client, "post", f"/internal/users/{loner}/role", json={"role": "company_admin"}).status_code == 409

    reset = _internal(client, "post", f"/internal/users/{user_id}/reset-password").json()
    assert login(client, "worker@acme.it", reset["temporary_password"]).json()["password_is_temporary"] is True


def test_internal_account_endpoints_require_the_token(client, internal):
    assert client.post("/internal/companies", json={"name": "A", "domain": "a.it"}).status_code == 401
    assert client.post("/internal/users/1/reset-password", headers={"X-Internal-Token": "wrong"}).status_code == 401
