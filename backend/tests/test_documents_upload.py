from __future__ import annotations

import io

from backend import main as main_module
from backend.tests.helpers import auth_headers, signup

PDF_BYTES = b"%PDF-1.4\n%fake pdf content for tests\n%%EOF"


class FakeAssistant:
    def __init__(self, *, fail_indexing: bool = False) -> None:
        self.invalidated: list[str] = []
        self.indexed: list[str] = []
        self.fail_indexing = fail_indexing

    def invalidate_company_rag(self, company_domain: str) -> None:
        self.invalidated.append(company_domain)

    def ensure_company_rag_ready(self, company_domain: str) -> None:
        if self.fail_indexing:
            raise RuntimeError("indexing failed")
        self.indexed.append(company_domain)


def _fake_assistant(monkeypatch, *, fail_indexing: bool = False) -> FakeAssistant:
    fake = FakeAssistant(fail_indexing=fail_indexing)
    monkeypatch.setattr(main_module, "get_assistant", lambda: fake)
    return fake


def _upload(client, token, filename="manuale.pdf", content=PDF_BYTES, content_type="application/pdf"):
    return client.post(
        "/api/company/documents",
        headers=auth_headers(token),
        files={"document": (filename, io.BytesIO(content), content_type)},
    )


def test_user_without_company_cannot_upload(client):
    token = signup(client, "solo@gmail.com")
    response = _upload(client, token)
    assert response.status_code == 403


def test_company_user_can_upload_valid_pdf(client, monkeypatch):
    fake = _fake_assistant(monkeypatch)
    token = signup(client, "user@digitalmens.it")
    response = _upload(client, token)
    assert response.status_code == 200
    assert response.json()["filename"] == "manuale.pdf"
    assert response.json()["status"] == "indexed"
    assert fake.invalidated == ["digitalmens.it"]
    assert fake.indexed == ["digitalmens.it"]

    docs = client.get("/api/company/documents", headers=auth_headers(token)).json()
    assert docs[0]["status"] == "indexed"


def test_upload_marks_document_failed_when_indexing_raises(client, monkeypatch):
    _fake_assistant(monkeypatch, fail_indexing=True)
    token = signup(client, "user@digitalmens.it")
    response = _upload(client, token)
    assert response.status_code == 200
    assert response.json()["status"] == "failed"

    docs = client.get("/api/company/documents", headers=auth_headers(token)).json()
    assert docs[0]["status"] == "failed"


def test_upload_rejects_wrong_content_type(client, monkeypatch):
    _fake_assistant(monkeypatch)
    token = signup(client, "user@digitalmens.it")
    response = _upload(client, token, content_type="text/plain")
    assert response.status_code == 400


def test_upload_rejects_file_without_pdf_magic_bytes(client, monkeypatch):
    _fake_assistant(monkeypatch)
    token = signup(client, "user@digitalmens.it")
    response = _upload(client, token, content=b"not really a pdf but claims to be")
    assert response.status_code == 400


def test_upload_rejects_oversized_file(client, monkeypatch):
    _fake_assistant(monkeypatch)
    monkeypatch.setattr(main_module, "MAX_UPLOAD_BYTES", 100)
    token = signup(client, "user@digitalmens.it")
    oversized = PDF_BYTES + b"0" * 1000
    response = _upload(client, token, content=oversized)
    assert response.status_code == 413


def test_two_uploads_with_same_original_filename_do_not_collide(client, monkeypatch):
    _fake_assistant(monkeypatch)
    token = signup(client, "user@digitalmens.it")
    first = _upload(client, token, content=PDF_BYTES + b"\nfirst")
    second = _upload(client, token, content=PDF_BYTES + b"\nsecond")
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] != second.json()["id"]

    docs = client.get("/api/company/documents", headers=auth_headers(token)).json()
    assert len(docs) == 2  # both persisted; neither overwrote the other on disk


def test_delete_document_removes_it_and_invalidates_rag(client, monkeypatch):
    fake = _fake_assistant(monkeypatch)
    token = signup(client, "user@digitalmens.it")
    uploaded = _upload(client, token).json()
    fake.invalidated.clear()

    response = client.delete(f"/api/company/documents/{uploaded['id']}", headers=auth_headers(token))
    assert response.status_code == 200
    assert fake.invalidated == ["digitalmens.it"]

    docs = client.get("/api/company/documents", headers=auth_headers(token)).json()
    assert docs == []


def test_delete_document_from_another_company_is_not_found(client, monkeypatch):
    _fake_assistant(monkeypatch)
    token_a = signup(client, "user@digitalmens.it")
    token_b = signup(client, "user@othercorp.it")
    uploaded = _upload(client, token_a).json()

    response = client.delete(f"/api/company/documents/{uploaded['id']}", headers=auth_headers(token_b))
    assert response.status_code == 404

    # Document must still exist for company A.
    docs = client.get("/api/company/documents", headers=auth_headers(token_a)).json()
    assert len(docs) == 1
