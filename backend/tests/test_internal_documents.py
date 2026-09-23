from __future__ import annotations

from backend import main as main_module

TOKEN = "test-backoffice-token"


class RecordingAssistant:
    def __init__(self) -> None:
        self.invalidated: list[str] = []

    def invalidate_company_rag(self, company_domain: str) -> None:
        self.invalidated.append(company_domain)


def _insert_document(db, tmp_path) -> tuple[int, object]:
    pdf = tmp_path / "manuale.pdf"
    pdf.write_bytes(b"%PDF-1.4 test")
    company_id = db.execute(
        "INSERT INTO companies(domain, name) VALUES ('digitalmens.it', 'digitalmens.it') RETURNING id"
    ).fetchone()["id"]
    document_id = db.execute(
        "INSERT INTO company_documents(company_id, filename, storage_path, status) "
        "VALUES (%s, 'Manuale gru.pdf', %s, 'indexed') RETURNING id",
        (company_id, str(pdf)),
    ).fetchone()["id"]
    db.commit()
    return document_id, pdf


def test_internal_endpoints_are_disabled_without_a_configured_token(client, monkeypatch):
    monkeypatch.setattr(main_module, "BACKOFFICE_API_TOKEN", "")
    response = client.delete("/internal/company-documents/1", headers={"X-Internal-Token": "anything"})
    assert response.status_code == 503


def test_internal_delete_rejects_missing_or_wrong_token(client, monkeypatch):
    monkeypatch.setattr(main_module, "BACKOFFICE_API_TOKEN", TOKEN)
    assert client.delete("/internal/company-documents/1").status_code == 401
    assert client.delete("/internal/company-documents/1", headers={"X-Internal-Token": "wrong"}).status_code == 401


def test_internal_delete_removes_row_file_and_cached_index(client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "BACKOFFICE_API_TOKEN", TOKEN)
    assistant = RecordingAssistant()
    monkeypatch.setattr(main_module, "_assistant", assistant)
    document_id, pdf = _insert_document(db, tmp_path)

    response = client.delete(f"/internal/company-documents/{document_id}", headers={"X-Internal-Token": TOKEN})

    assert response.status_code == 200
    assert response.json() == {"deleted": True, "filename": "Manuale gru.pdf", "company_domain": "digitalmens.it"}
    assert not pdf.exists()
    assert assistant.invalidated == ["digitalmens.it"]
    assert db.execute("SELECT count(*) AS n FROM company_documents").fetchone()["n"] == 0

    again = client.delete(f"/internal/company-documents/{document_id}", headers={"X-Internal-Token": TOKEN})
    assert again.status_code == 404


def test_public_proxy_path_cannot_reach_internal_endpoints(client, monkeypatch):
    monkeypatch.setattr(main_module, "BACKOFFICE_API_TOKEN", TOKEN)
    # The Next.js proxy maps /api/backend/<path> to /api/<path>: /api/internal does not exist.
    response = client.delete("/api/internal/company-documents/1", headers={"X-Internal-Token": TOKEN})
    assert response.status_code in (404, 405)
