"""Benchmark of the /api/ask pipeline (recognition, OCR, RAG, Ollama, citations)
without HTTP, login or database.

Non-destructive: the conversation memory is copied to a temporary directory,
so the real memory.jsonl / memory.faiss are never written. The first request
of the process is "cold" (models loaded from disk), the following are "warm".

In Docker (the backend image does not contain scripts/ nor the test photos):
    docker cp CLI/immagini_test/carroponte_portuale_test1.jpg assistente-macchine-backend-1:/tmp/
    docker exec -i assistente-macchine-backend-1 python - /tmp/carroponte_portuale_test1.jpg < scripts/benchmark_ask.py

Locally (Windows: .venv\\Scripts\\python.exe):
    .venv/bin/python scripts/benchmark_ask.py CLI/immagini_test/carroponte_portuale_test1.jpg

Options: -q "domanda" (repeatable), --repeat N, --json out.json, --preload
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import statistics
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] if "__file__" in globals() else Path.cwd()
for candidate in (ROOT, Path.cwd(), Path("/app")):
    if (candidate / "backend").is_dir() and str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

DEFAULT_QUESTIONS = [
    "Come si esegue la manutenzione ordinaria?",
    "Quali controlli bisogna fare prima dell'avviamento?",
]
# Shown first, in this order; any other stage/metric follows.
STAGES = [
    "model_load_ms", "recognition_ms", "recognition.image_decode_ms", "recognition.siglip_ms",
    "ocr_ms", "ocr.model_load_ms", "ocr.inference_ms", "ocr.parse_ms", "ocr_cache_hit",
    "retrieval_ms", "retrieval.base_ms", "retrieval.company_ms",
    "prompt_build_ms", "ollama_ms", "citation_validation_ms", "memory_save_ms", "other_ms", "total_ms",
]


def isolate_memory() -> Path:
    """Points MEM_DIR to a temporary copy before backend.model_service is imported."""
    source = Path(os.getenv("MEM_DIR") or (ROOT / "CLI" / "memory_no_finetuned"))
    target = Path(tempfile.mkdtemp(prefix="bench-memory-"))
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    os.environ["MEM_DIR"] = str(target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("images", nargs="+", type=Path)
    parser.add_argument("-q", "--question", action="append", dest="questions")
    parser.add_argument("--repeat", type=int, default=1, help="how many times to repeat the whole image×question grid")
    parser.add_argument("--json", type=Path, help="save every run's breakdown here")
    parser.add_argument("--preload", action="store_true", help="load and warm up the models first, as PRELOAD_MODELS=1 does at startup")
    args = parser.parse_args()

    memory_dir = isolate_memory()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("backend.ollama").setLevel(logging.INFO)

    from backend import perf
    from backend.model_service import assistant

    runs = []
    questions = args.questions or DEFAULT_QUESTIONS
    if args.preload:
        import time

        from backend import model_service

        started = time.perf_counter()
        assistant.ensure_ready()
        if model_service.OCR_BACKEND == "got" and model_service.OCR_IN_PROCESS:
            from backend.ocr_service import got_ocr

            got_ocr.warm_up()
        print(f"Preload (at startup, in background): {time.perf_counter() - started:.1f}s")
    try:
        for _ in range(args.repeat):
            for image in args.images:
                for question in questions:
                    profile = perf.start("benchmark")
                    outcome = "ok"
                    try:
                        result = assistant.ask_machine(image_path=image, question=question)
                        outcome = "verified" if not result["answer"].startswith("Oggetto riconosciuto, ma") else "fallback"
                    except ValueError as exc:  # machine not recognized: pipeline stops early
                        outcome = f"not_recognized ({exc})"
                    run = {
                        "kind": "cold" if not runs else "warm",
                        "image": image.name,
                        "question": question[:40],
                        "outcome": outcome,
                        **profile.summary(),
                    }
                    runs.append(run)
                    print_run(len(runs), run)
    finally:
        shutil.rmtree(memory_dir, ignore_errors=True)

    print_summary(runs)
    if args.json:
        args.json.write_text(json.dumps(runs, indent=2, ensure_ascii=False))
        print(f"\nSaved {len(runs)} runs to {args.json}")
    return 0


def print_run(number: int, run: dict) -> None:
    print(f"\n#{number} {run['kind'].upper()}  {run['image']}  «{run['question']}»  → {run['outcome']}")
    keys = [key for key in STAGES if key in run] + [
        key for key in run if key not in STAGES and key not in {"kind", "image", "question", "outcome"}
    ]
    for key in keys:
        value = run[key]
        suffix = f"{value / 1000:8.2f} s" if key.endswith("_ms") and isinstance(value, (int, float)) else f"{value}"
        print(f"  {key:<30} {suffix}")


def print_summary(runs: list[dict]) -> None:
    warm = [run for run in runs if run["kind"] == "warm"]
    print("\n" + "=" * 60)
    print(f"Cold request: total {runs[0]['total_ms'] / 1000:.1f}s")
    if warm:
        print(f"Warm requests ({len(warm)}): median total {statistics.median(r['total_ms'] for r in warm) / 1000:.1f}s")
        print("Warm breakdown (median):")
        for key in STAGES[:-1]:
            values = [r[key] for r in warm if isinstance(r.get(key), (int, float)) and not isinstance(r.get(key), bool)]
            if values:
                print(f"  {key:<30} {statistics.median(values) / 1000:8.2f} s")


if __name__ == "__main__":
    raise SystemExit(main())
