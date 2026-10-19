from __future__ import annotations

import io
import logging

from backend import main as main_module
from backend import perf
from backend.ocr_service import GotOcr
from backend.tests.helpers import auth_headers, signup
from backend.tests.test_ask_endpoint import TINY_PNG, FakeAssistant

def test_stage_and_metric_are_noops_outside_a_profiled_request():
    perf._current.set(None)
    with perf.stage("anything"):
        pass
    perf.metric("rag_chunks", 3)
    assert perf.current() is None


def test_profile_sums_top_level_stages_and_keeps_sub_stages_apart():
    profile = perf.start("test")
    perf.add("ocr", 300)
    perf.add("ocr.inference", 250)  # already inside "ocr": must not be counted twice
    perf.add("llm", 100)
    perf.metric("rag_chunks", 8)
    summary = profile.summary()
    assert summary["ocr_ms"] == 300 and summary["ocr.inference_ms"] == 250 and summary["llm_ms"] == 100
    assert summary["rag_chunks"] == 8
    assert summary["other_ms"] == max(0, summary["total_ms"] - 400)
    perf._current.set(None)


def test_ocr_cache_reuses_text_for_the_same_photo_only(tmp_path, monkeypatch):
    ocr = GotOcr(cache_size=2)
    calls = []
    monkeypatch.setattr(ocr, "_infer", lambda path: calls.append(path) or f"text of {path.name}")
    photo_a, photo_b = tmp_path / "a.jpg", tmp_path / "b.jpg"
    photo_a.write_bytes(b"photo-a")
    photo_b.write_bytes(b"photo-b")

    assert ocr.read_text(photo_a) == "text of a.jpg"
    assert ocr.read_text(photo_a) == "text of a.jpg"
    assert ocr.read_text(photo_b) == "text of b.jpg"
    assert calls == [photo_a, photo_b]


def test_ocr_cache_can_be_disabled(tmp_path, monkeypatch):
    ocr = GotOcr(cache_size=0)
    calls = []
    monkeypatch.setattr(ocr, "_infer", lambda path: calls.append(path) or "text")
    photo = tmp_path / "a.jpg"
    photo.write_bytes(b"photo")
    ocr.read_text(photo)
    ocr.read_text(photo)
    assert len(calls) == 2


def test_ask_logs_one_perf_line_with_request_id_and_no_question(client, monkeypatch, caplog):
    monkeypatch.setattr(main_module, "get_assistant", lambda: FakeAssistant())
    token = signup(client, "user@digitalmens.it")
    secret_question = "Domanda riservata con dati aziendali"

    with caplog.at_level(logging.INFO, logger="backend.perf"):
        response = client.post(
            "/api/ask",
            headers={**auth_headers(token), "X-Request-ID": "req-123"},
            data={"question": secret_question},
            files={"image": ("machine.png", io.BytesIO(TINY_PNG), "image/png")},
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "req-123"
    lines = [record.getMessage() for record in caplog.records if record.name == "backend.perf"]
    assert len(lines) == 1
    line = lines[0]
    assert line.startswith("PERF /api/ask rid=req-123 ")
    for field in ("total_ms=", "upload_auth_ms=", "thumbnail_ms=", "db_save_ms=", "status=200"):
        assert field in line
    assert secret_question not in line


def test_rmsnorm_stand_in_matches_the_reference_formula():
    import pytest

    torch = pytest.importorskip("torch")
    from backend.ocr_service import build_rmsnorm_class

    RMSNorm = build_rmsnorm_class()
    norm = RMSNorm(4, eps=1e-6)
    x = torch.tensor([[1.0, 2.0, 3.0, 4.0]])
    expected = x / torch.sqrt((x ** 2).mean(-1, keepdim=True) + 1e-6)
    assert torch.allclose(norm(x), expected)
    assert RMSNorm((4,), elementwise_affine=False).weight is None


def test_preload_failure_is_logged_not_raised(monkeypatch, caplog):
    def broken():
        raise RuntimeError("model files missing")

    monkeypatch.setattr(main_module, "get_assistant", broken)
    with caplog.at_level(logging.ERROR, logger="backend.main"):
        main_module._preload_models()
    assert "Model preload failed" in caplog.text
