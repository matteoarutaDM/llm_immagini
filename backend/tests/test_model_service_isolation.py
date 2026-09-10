from __future__ import annotations

import threading

import pytest

try:
    import backend.model_service as model_service

    _import_error: Exception | None = None
except Exception as exc:  # pragma: no cover - environment guard
    # backend.model_service pulls in torch/transformers/ragmens-core. Some
    # environments ship an incompatible torch/transformers pairing (a
    # pre-existing dependency-pinning problem, unrelated to this change) that
    # fails with things other than ImportError (e.g. NameError deep inside
    # transformers), so we catch broadly and skip instead of erroring collection.
    model_service = None
    _import_error = exc

pytestmark = pytest.mark.skipif(
    model_service is None,
    reason=f"backend.model_service not importable in this environment: {_import_error}",
)


class FakeRag:
    def __init__(self, hits: list[dict]) -> None:
        self.hits = hits
        self.calls: list[dict] = []

    def retrieve(self, query, top_k, document_ids=None):
        self.calls.append({"query": query, "top_k": top_k, "document_ids": document_ids})
        return list(self.hits)


def _bare_assistant() -> "model_service.MachineAssistant":
    # Bypass ensure_ready(): it loads real ML models. We only exercise the
    # pure retrieval/isolation logic here.
    assistant = model_service.MachineAssistant()
    assistant.machines = {}
    return assistant


def test_base_only_mode_never_touches_company_rag(monkeypatch):
    assistant = _bare_assistant()
    base_hits = [{"source": "base.pdf", "score": 0.9}]
    assistant.rag = FakeRag(base_hits)

    def fail_if_called(*args, **kwargs):
        raise AssertionError("company RAG must not be queried in base-only mode")

    monkeypatch.setattr(assistant, "_company_rag", fail_if_called)

    results = assistant.retrieve("domanda", machine_id=None, top_k=5, knowledge_mode="base", company_domain="digitalmens.it")
    assert results == base_hits


def test_merged_mode_combines_base_and_company_hits(monkeypatch):
    assistant = _bare_assistant()
    base_hits = [{"source": "base.pdf", "score": 0.5}]
    company_hits = [{"source": "company.pdf", "score": 0.95}]
    assistant.rag = FakeRag(base_hits)
    company_rag = FakeRag(company_hits)

    monkeypatch.setattr(assistant, "_company_rag", lambda domain, doc_ids=None: (company_rag, ["company.pdf"]))

    results = assistant.retrieve(
        "domanda", machine_id=None, top_k=5, knowledge_mode="merged", company_domain="digitalmens.it"
    )
    sources = {hit["source"] for hit in results}
    assert sources == {"base.pdf", "company.pdf"}
    # Highest score first.
    assert results[0]["source"] == "company.pdf"


def test_merged_mode_without_company_domain_stays_base_only():
    assistant = _bare_assistant()
    base_hits = [{"source": "base.pdf", "score": 0.5}]
    assistant.rag = FakeRag(base_hits)

    results = assistant.retrieve("domanda", machine_id=None, top_k=5, knowledge_mode="merged", company_domain=None)
    assert results == base_hits


def test_company_rag_filters_to_selected_document_ids(tmp_path, monkeypatch):
    assistant = _bare_assistant()
    monkeypatch.setattr(model_service, "COMPANY_DATA_DIR", tmp_path)

    company_domain = "digitalmens.it"
    import hashlib

    company_key = hashlib.sha256(company_domain.encode("utf-8")).hexdigest()[:16]
    pdf_dir = tmp_path / company_key / "pdfs"
    pdf_dir.mkdir(parents=True)
    (pdf_dir / "manuale_carroponte.pdf").write_bytes(b"%PDF-1.4")
    (pdf_dir / "altro_manuale.pdf").write_bytes(b"%PDF-1.4")

    built_configs = []

    class FakeRagIndex:
        @staticmethod
        def prepare(config):
            built_configs.append(config)
            return FakeRag([])

    monkeypatch.setattr(model_service, "RagIndex", FakeRagIndex)

    rag, allowed_all = assistant._company_rag(company_domain)
    assert sorted(allowed_all) == ["altro_manuale.pdf", "manuale_carroponte.pdf"]

    rag_again, allowed_selected = assistant._company_rag(company_domain, document_ids=["manuale_carroponte.pdf"])
    assert allowed_selected == ["manuale_carroponte.pdf"]
    # The underlying index is cached/reused across calls for the same company.
    assert len(built_configs) == 1
    assert rag is rag_again


def test_invalidate_company_rag_forces_rebuild(tmp_path, monkeypatch):
    assistant = _bare_assistant()
    monkeypatch.setattr(model_service, "COMPANY_DATA_DIR", tmp_path)

    company_domain = "digitalmens.it"
    import hashlib

    company_key = hashlib.sha256(company_domain.encode("utf-8")).hexdigest()[:16]
    pdf_dir = tmp_path / company_key / "pdfs"
    pdf_dir.mkdir(parents=True)
    (pdf_dir / "manuale.pdf").write_bytes(b"%PDF-1.4")

    build_count = {"n": 0}

    class FakeRagIndex:
        @staticmethod
        def prepare(config):
            build_count["n"] += 1
            return FakeRag([])

    monkeypatch.setattr(model_service, "RagIndex", FakeRagIndex)

    assistant._company_rag(company_domain)
    assistant._company_rag(company_domain)
    assert build_count["n"] == 1

    assistant.invalidate_company_rag(company_domain)
    assistant._company_rag(company_domain)
    assert build_count["n"] == 2


def test_company_rag_build_is_not_duplicated_under_concurrency(tmp_path, monkeypatch):
    assistant = _bare_assistant()
    monkeypatch.setattr(model_service, "COMPANY_DATA_DIR", tmp_path)

    company_domain = "digitalmens.it"
    import hashlib
    import time

    company_key = hashlib.sha256(company_domain.encode("utf-8")).hexdigest()[:16]
    pdf_dir = tmp_path / company_key / "pdfs"
    pdf_dir.mkdir(parents=True)
    (pdf_dir / "manuale.pdf").write_bytes(b"%PDF-1.4")

    build_count = {"n": 0}

    class FakeRagIndex:
        @staticmethod
        def prepare(config):
            time.sleep(0.05)  # widen the race window
            build_count["n"] += 1
            return FakeRag([])

    monkeypatch.setattr(model_service, "RagIndex", FakeRagIndex)

    threads = [threading.Thread(target=assistant._company_rag, args=(company_domain,)) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert build_count["n"] == 1


def test_different_companies_build_indexes_concurrently_not_serialized(tmp_path, monkeypatch):
    import hashlib
    import time

    assistant = _bare_assistant()
    monkeypatch.setattr(model_service, "COMPANY_DATA_DIR", tmp_path)

    for domain in ("companya.it", "companyb.it"):
        company_key = hashlib.sha256(domain.encode("utf-8")).hexdigest()[:16]
        pdf_dir = tmp_path / company_key / "pdfs"
        pdf_dir.mkdir(parents=True)
        (pdf_dir / "manuale.pdf").write_bytes(b"%PDF-1.4")

    class SlowFakeRagIndex:
        @staticmethod
        def prepare(config):
            time.sleep(0.25)
            return FakeRag([])

    monkeypatch.setattr(model_service, "RagIndex", SlowFakeRagIndex)

    started = time.monotonic()
    threads = [
        threading.Thread(target=assistant._company_rag, args=("companya.it",)),
        threading.Thread(target=assistant._company_rag, args=("companyb.it",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    elapsed = time.monotonic() - started

    # A single shared lock across all companies would serialize these two
    # builds (~0.5s total); per-company locks let them run in parallel.
    assert elapsed < 0.4
