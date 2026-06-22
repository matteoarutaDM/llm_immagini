from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.model_service import assistant


app = FastAPI(title="LLM YOLO Machine Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/ask")
def ask(
    question: Annotated[str, Form()],
    image: Annotated[UploadFile, File()],
    top_k: Annotated[int, Form()] = 12,
) -> dict:
    if not question.strip():
        raise HTTPException(status_code=400, detail="La domanda e obbligatoria.")
    if not image.content_type or not image.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Carica un file immagine valido.")

    suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(prefix="machine-upload-", suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(image.file, tmp)
        image_path = Path(tmp.name)

    try:
        return assistant.ask_machine(image_path=image_path, question=question.strip(), top_k=top_k)
    except ValueError as exc:
        return {"recognized": False, "reason": str(exc), "question": question}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        image_path.unlink(missing_ok=True)
