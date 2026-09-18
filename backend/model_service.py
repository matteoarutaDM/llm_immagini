from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import sys
import threading
import hashlib
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F
from dotenv import load_dotenv
from openai import OpenAI
from PIL import Image
from ragmens_core import RagConfig, RagIndex, ShortTermMemory, VectorMemory, ltm_text
from transformers import AutoModel, AutoProcessor


ROOT_DIR = Path(__file__).resolve().parents[1]
CLI_DIR = ROOT_DIR / "CLI"

load_dotenv(ROOT_DIR / ".env")
load_dotenv(CLI_DIR / ".env")

PDF_DIR = Path(os.getenv("PDF_DIR", CLI_DIR / "pdf_immagini")).resolve()
REFERENCE_IMAGES_DIR = Path(os.getenv("REFERENCE_IMAGES_DIR", CLI_DIR / "reference_images")).resolve()
MACHINE_KB_PATH = Path(os.getenv("MACHINE_KB_PATH", CLI_DIR / "machine.json")).resolve()
INDEX_DIR = Path(os.getenv("INDEX_DIR", CLI_DIR / "index_no_finetuned")).resolve()
MEM_DIR = Path(os.getenv("MEM_DIR", CLI_DIR / "memory_no_finetuned")).resolve()
OUTPUT_DEBUG_DIR = Path(os.getenv("OUTPUT_DEBUG_DIR", CLI_DIR / "outputs_debug_no_finetuned")).resolve()
COMPANY_DATA_DIR = Path(os.getenv("COMPANY_DATA_DIR", ROOT_DIR / "data" / "companies")).resolve()

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
SIGLIP_MODEL = os.getenv("SIGLIP_MODEL", "google/siglip-base-patch16-224")
LLM_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://localhost:11434/v1")
LLM_MODEL = os.getenv("LLM_MODEL", "llama3.2")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "ollama")
OCR_BACKEND = os.getenv("OCR_BACKEND", "got")
GOT_OCR_MODEL = os.getenv("GOT_OCR_MODEL", "stepfun-ai/GOT-OCR-2.0-hf")
OCR_DEVICE = os.getenv("OCR_DEVICE", "cpu")
VISION_LLM_MODEL = os.getenv("VISION_LLM_MODEL", os.getenv("OCR_MODEL", LLM_MODEL))
VISION_LLM_BASE_URL = os.getenv("VISION_LLM_BASE_URL", LLM_BASE_URL)

TOP_K = int(os.getenv("TOP_K", "12"))
CONTEXT_MAX_CHARS = int(os.getenv("CONTEXT_MAX_CHARS", "16000"))
CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "1200"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "220"))
MIN_CHUNK_CHARS = int(os.getenv("MIN_CHUNK_CHARS", "50"))
IMAGE_RECOGNITION_THRESHOLD = float(os.getenv("IMAGE_RECOGNITION_THRESHOLD", "0.730"))
SESSION_ID = os.getenv("SESSION_ID", "web_image_rag_session")
FORCE_REBUILD_INDEX = os.getenv("FORCE_REBUILD_INDEX", "0") == "1"
HF_LOCAL_FILES_ONLY = os.getenv("HF_LOCAL_FILES_ONLY", "0") == "1"

DEVICE = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"


QA_PROMPT = """Sei un assistente tecnico per macchinari industriali.
Rispondi sempre in italiano.
Usa prima le informazioni dei manuali nel CONTEXT.
Se il CONTEXT non basta, dillo in modo chiaro e suggerisci cosa verificare nel manuale o sulla macchina.
Se la macchina e riconosciuta ma seriale o modello non sono leggibili, dillo esplicitamente: puoi rispondere sull'oggetto riconosciuto, ma non puoi confermare il modello esatto dalla targhetta.
Non inventare procedure, codici errore, limiti o componenti specifici non presenti nel CONTEXT.
Cita fonti, pagine e chunk quando disponibili.

MACCHINA RICONOSCIUTA:
{machine_info}

CONFIDENZA RICONOSCIMENTO IMMAGINE:
{vision_info}

DATI LETTI DALLA FOTO / TARGHETTA:
{image_identifiers}

MEMORIA BREVE:
{stm}

MEMORIA LUNGA RILEVANTE:
{ltm}

CONTEXT DAI MANUALI:
{context}

DOMANDA:
{question}

RISPOSTA:"""


class MachineAssistant:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ready = False
        self._company_rags: dict[str, Any] = {}
        # One lock per company, so building/invalidating company A's index
        # never blocks a concurrent request for company B. `_company_locks_lock`
        # only guards creating a new per-company lock the first time it is
        # needed; it is never held while an index is actually being built.
        self._company_locks: dict[str, threading.Lock] = {}
        self._company_locks_lock = threading.Lock()
        # Short-term memory has no session concept of its own (ragmens_core's
        # ShortTermMemory is a single deque), so we keep one per memory_session_id
        # (chat + recognized machine) instead of sharing one buffer across every
        # chat and every user, which used to bleed conversations into each other.
        self._stm_by_session: dict[str, ShortTermMemory] = {}
        self._stm_lock = threading.Lock()

    def _stm_for(self, session_id: str) -> ShortTermMemory:
        with self._stm_lock:
            stm = self._stm_by_session.get(session_id)
            if stm is None:
                stm = ShortTermMemory(max_messages=10)
                self._stm_by_session[session_id] = stm
            return stm

    def _company_lock(self, company_domain: str) -> threading.Lock:
        with self._company_locks_lock:
            lock = self._company_locks.get(company_domain)
            if lock is None:
                lock = threading.Lock()
                self._company_locks[company_domain] = lock
            return lock

    def invalidate_company_rag(self, company_domain: str) -> None:
        with self._company_lock(company_domain):
            self._company_rags.pop(company_domain, None)

    def ensure_ready(self) -> None:
        with self._lock:
            if self._ready:
                return

            for directory in (INDEX_DIR, MEM_DIR, OUTPUT_DEBUG_DIR):
                directory.mkdir(parents=True, exist_ok=True)

            self.machines_list = json.loads(MACHINE_KB_PATH.read_text(encoding="utf-8"))
            self._normalize_reference_paths()
            self.machines = {machine["id"]: machine for machine in self.machines_list}
            self._validate_manuals()

            self.rag_config = RagConfig(
                base_dir=CLI_DIR,
                pdf_dir=PDF_DIR,
                index_dir=INDEX_DIR,
                mem_dir=MEM_DIR,
                output_debug_dir=OUTPUT_DEBUG_DIR,
                embedding_model=EMBEDDING_MODEL,
                top_k=TOP_K,
                context_max_chars=CONTEXT_MAX_CHARS,
                force_rebuild_index=FORCE_REBUILD_INDEX,
                chunk_size=CHUNK_SIZE,
                chunk_overlap=CHUNK_OVERLAP,
                min_chunk_chars=MIN_CHUNK_CHARS,
            )
            self.rag = RagIndex.prepare(self.rag_config)
            self.ltm = VectorMemory(
                embedder=self.rag.embedder,
                mem_dir=self.rag_config.mem_dir,
                corpus_signature=self.rag.corpus_signature,
            )

            self.siglip_model = AutoModel.from_pretrained(
                SIGLIP_MODEL,
                local_files_only=HF_LOCAL_FILES_ONLY,
            ).to(DEVICE)
            self.siglip_processor = AutoProcessor.from_pretrained(
                SIGLIP_MODEL,
                local_files_only=HF_LOCAL_FILES_ONLY,
            )
            self.siglip_model.eval()
            self.reference_embeddings = self._build_reference_embeddings()
            self._ready = True

    def _normalize_reference_paths(self) -> None:
        for machine in self.machines_list:
            normalized = []
            for image_path in machine.get("reference_images", []):
                path = Path(image_path)
                if path.is_absolute():
                    normalized.append(str(path))
                else:
                    normalized.append(str((CLI_DIR / path).resolve()))
            machine["reference_images"] = normalized

    def _validate_manuals(self) -> None:
        missing = []
        for machine in self.machines_list:
            for manual in machine.get("manuali", []):
                if not (PDF_DIR / manual).exists():
                    missing.append(str(PDF_DIR / manual))
        if missing:
            raise FileNotFoundError("Manuali non trovati:\n" + "\n".join(missing))

    @torch.no_grad()
    def _image_embedding(self, image_path: str | Path) -> torch.Tensor:
        image = Image.open(image_path).convert("RGB")
        inputs = self.siglip_processor(images=image, return_tensors="pt").to(DEVICE)
        outputs = self.siglip_model.get_image_features(**inputs)
        emb = outputs.pooler_output if hasattr(outputs, "pooler_output") else outputs
        emb = F.normalize(emb, dim=-1)
        return emb.squeeze(0).detach().cpu()

    def _build_reference_embeddings(self) -> dict[str, list[dict[str, Any]]]:
        embeddings: dict[str, list[dict[str, Any]]] = {}
        for machine in self.machines_list:
            refs = []
            for image_path in machine.get("reference_images", []):
                path = Path(image_path)
                if path.exists():
                    refs.append({"path": str(path), "embedding": self._image_embedding(path)})
            embeddings[machine["id"]] = refs
        return embeddings

    def identify_machine(self, image_path: str | Path) -> tuple[str, float, list[dict[str, Any]]]:
        query_emb = self._image_embedding(image_path)
        candidates = []

        for machine in self.machines_list:
            scored_refs = []
            for ref in self.reference_embeddings.get(machine["id"], []):
                score = F.cosine_similarity(query_emb, ref["embedding"], dim=0).item()
                scored_refs.append((score, ref["path"]))
            if scored_refs:
                best_score, best_ref_path = max(scored_refs, key=lambda item: item[0])
                candidates.append({
                    "machine_id": machine["id"],
                    "machine": machine,
                    "score": float(best_score),
                    "reference_image": best_ref_path,
                })

        if not candidates:
            raise ValueError("Nessuna reference image disponibile per il riconoscimento.")

        candidates.sort(key=lambda item: item["score"], reverse=True)
        best = candidates[0]
        if best["score"] < IMAGE_RECOGNITION_THRESHOLD:
            raise ValueError(
                f"Immagine non riconosciuta: score {best['score']:.3f} < {IMAGE_RECOGNITION_THRESHOLD:.2f}"
            )
        return best["machine_id"], best["score"], candidates

    def _company_rag(self, company_domain: str, document_ids: list[str] | None = None) -> tuple[Any, list[str]] | None:
        if not company_domain:
            return None
        company_key = hashlib.sha256(company_domain.encode("utf-8")).hexdigest()[:16]
        company_dir = COMPANY_DATA_DIR / company_key
        pdf_dir = company_dir / "pdfs"
        pdfs = sorted(pdf_dir.glob("*.pdf"))
        if not pdfs:
            return None
        # Guard the check-build-store sequence with a per-company lock so two
        # concurrent requests for the same company never trigger duplicate,
        # concurrent index rebuilds, while requests for different companies
        # can still build/read in parallel.
        with self._company_lock(company_domain):
            if company_domain not in self._company_rags:
                config = RagConfig(
                    base_dir=company_dir,
                    pdf_dir=pdf_dir,
                    index_dir=company_dir / "index",
                    mem_dir=company_dir / "memory",
                    output_debug_dir=company_dir / "debug",
                    embedding_model=EMBEDDING_MODEL,
                    top_k=TOP_K,
                    context_max_chars=CONTEXT_MAX_CHARS,
                    force_rebuild_index=False,
                    chunk_size=CHUNK_SIZE,
                    chunk_overlap=CHUNK_OVERLAP,
                    min_chunk_chars=MIN_CHUNK_CHARS,
                )
                self._company_rags[company_domain] = RagIndex.prepare(config)
            rag = self._company_rags[company_domain]
        allowed = document_ids or [path.name for path in pdfs]
        return rag, allowed

    def retrieve(
        self,
        query: str,
        machine_id: str | None,
        top_k: int,
        knowledge_mode: str = "base",
        company_domain: str | None = None,
        company_document_ids: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        machine = self.machines.get(machine_id or "")
        document_ids = list(machine.get("manuali", [])) if machine else None
        results = self.rag.retrieve(query, top_k=top_k, document_ids=document_ids)
        if knowledge_mode == "merged" and company_domain:
            company = self._company_rag(company_domain, company_document_ids)
            if company:
                company_rag, company_documents = company
                company_hits = company_rag.retrieve(query, top_k=top_k, document_ids=company_documents)
                results = sorted(results + company_hits, key=lambda item: item.get("score", 0), reverse=True)[:top_k]
        return results

    def build_context(self, results: list[dict[str, Any]]) -> str:
        return self.rag.build_context(results, max_chars=CONTEXT_MAX_CHARS)

    def call_llm(self, prompt: str) -> str:
        client = OpenAI(api_key=OPENAI_API_KEY, base_url=LLM_BASE_URL)
        response = client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        return (response.choices[0].message.content or "").strip()

    def got_ocr_text(self, image_path: str | Path) -> str:
        cmd = [
            sys.executable,
            str(CLI_DIR / "got_ocr_runner.py"),
            str(Path(image_path).resolve()),
            "--model",
            GOT_OCR_MODEL,
            "--device",
            OCR_DEVICE,
        ]
        if HF_LOCAL_FILES_ONLY:
            cmd.append("--local-files-only")
        completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
        stdout = completed.stdout.strip()
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"GOT-OCR output non JSON. stdout={stdout!r}; stderr={completed.stderr.strip()!r}") from exc
        if completed.returncode != 0 or not payload.get("ok"):
            raise RuntimeError(payload.get("error") or completed.stderr.strip() or "GOT-OCR fallito")
        return str(payload.get("text") or "").strip()

    def extract_image_identifiers(self, image_path: str | Path, machine: dict[str, Any]) -> dict[str, Any]:
        if OCR_BACKEND == "got":
            try:
                return parse_identifiers_from_ocr_text(self.got_ocr_text(image_path))
            except Exception as exc:
                return {"available": False, "backend": "got", "error": str(exc)}

        prompt = build_vision_prompt(machine)
        client = OpenAI(api_key=OPENAI_API_KEY, base_url=VISION_LLM_BASE_URL)
        try:
            response = client.chat.completions.create(
                model=VISION_LLM_MODEL,
                temperature=0,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": image_data_url(image_path)}},
                    ],
                }],
            )
        except Exception as exc:
            return {"available": False, "error": str(exc)}

        parsed = extract_json_object(response.choices[0].message.content or "")
        parsed["available"] = True
        return parsed

    def ask_machine(
        self,
        image_path: str | Path,
        question: str,
        top_k: int = TOP_K,
        knowledge_mode: str = "base",
        company_domain: str | None = None,
        company_document_ids: list[str] | None = None,
        chat_id: int | None = None,
    ) -> dict[str, Any]:
        self.ensure_ready()
        machine_id, vision_score, vision_candidates = self.identify_machine(image_path)
        machine = self.machines[machine_id]
        image_identifiers = self.extract_image_identifiers(image_path, machine)
        recognition_summary = identifier_summary(machine, vision_score, image_identifiers)

        identifier_text = " ".join(
            str(value)
            for key, value in image_identifiers.items()
            if key not in {"available", "error", "notes"} and value
        )
        rag_query = f"{machine['macchina']} {machine.get('tipo')} {identifier_text} {question}"
        hits = self.retrieve(
            rag_query,
            machine_id=machine_id,
            top_k=top_k,
            knowledge_mode=knowledge_mode,
            company_domain=company_domain,
            company_document_ids=company_document_ids,
        )
        context = self.build_context(hits)
        session_id = memory_session_id(chat_id, machine_id)
        stm = self._stm_for(session_id)
        memory_hits = self.ltm.search(session_id, question, top_k=4)
        prompt = build_prompt(
            question=question,
            context=context,
            machine=machine,
            vision_candidates=vision_candidates,
            memory_hits=memory_hits,
            image_identifiers=image_identifiers,
            stm=stm.text(max_chars=1200),
        )
        answer = self.call_llm(prompt)
        stm.add("user", f"[{machine['macchina']}] {question}")
        stm.add("assistant", answer)
        self.ltm.add_turn(session_id, question, answer)

        return {
            "recognized": True,
            "question": question,
            "machine_id": machine_id,
            "machine": public_machine(machine),
            "vision_score": vision_score,
            "vision_candidates": [public_candidate(item) for item in vision_candidates],
            "image_identifiers": image_identifiers,
            "recognition_summary": recognition_summary,
            "answer": answer,
            "hits": [public_hit(hit) for hit in hits],
        }


def first_regex_group(patterns: list[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            return match.group(1).strip(" :#-_")
    return None


def normalize_identifier_code(value: str | None) -> str | None:
    if not value:
        return None
    normalized = re.sub(r"\s+", "", value.strip().upper())
    return normalized.strip(" :#-_") or None


def looks_like_identifier_code(value: str) -> bool:
    normalized = normalize_identifier_code(value) or ""
    if len(normalized) < 5:
        return False
    return bool(re.search(r"[A-Z]", normalized) and re.search(r"\d", normalized))


def first_unlabeled_identifier(text: str) -> str | None:
    for line in [line.strip() for line in text.splitlines() if line.strip()]:
        candidate = re.sub(r"[^A-Z0-9./_ -]", " ", line.upper()).strip()
        if looks_like_identifier_code(candidate):
            return normalize_identifier_code(candidate)
    return first_regex_group([
        r"\b([A-Z]{1,}[A-Z0-9]*\d(?:[\s./_-]*[A-Z0-9]+){1,})\b",
        r"\b([A-Z0-9]{4,}[-_/][A-Z0-9]{2,})\b",
    ], text.upper())


def extract_code_candidates(text: str) -> set[str]:
    candidates = set()
    for raw in re.findall(r"\b[A-Z0-9][A-Z0-9._/-]{3,}[A-Z0-9]\b", text.upper()):
        code = normalize_identifier_code(raw)
        if not code or len(code) < 5 or len(code) > 24:
            continue
        if not re.search(r"[A-Z]", code) or not re.search(r"\d", code):
            continue
        if re.fullmatch(r"\d{4,}", code) or re.fullmatch(r"\d{4}[-./]?\d{1,2}[-./]?[A-Z0-9]{1,4}", code):
            continue
        if code.endswith(("PDF", "JPG", "JPEG", "PNG", "TXT")):
            continue
        candidates.add(code)
    return candidates


_KNOWN_MODEL_CODES_CACHE: set[str] | None = None


def known_model_codes_from_project() -> set[str]:
    global _KNOWN_MODEL_CODES_CACHE
    if _KNOWN_MODEL_CODES_CACHE is not None:
        return _KNOWN_MODEL_CODES_CACHE

    texts = []
    if MACHINE_KB_PATH.exists():
        machine_data = json.loads(MACHINE_KB_PATH.read_text(encoding="utf-8"))
        texts.append(json.dumps(machine_data, ensure_ascii=False))
    index_meta_path = INDEX_DIR / "index_meta.json"
    if index_meta_path.exists():
        texts.append(index_meta_path.read_text(encoding="utf-8"))
    if OUTPUT_DEBUG_DIR.exists():
        for path in OUTPUT_DEBUG_DIR.glob("*_all_pages.txt"):
            texts.append(path.name)
            texts.append(path.read_text(encoding="utf-8", errors="ignore"))

    codes = set()
    for text in texts:
        codes.update(extract_code_candidates(text))
    _KNOWN_MODEL_CODES_CACHE = codes
    return codes


def code_overlap_score(ocr_code: str, known_code: str) -> float:
    if known_code in ocr_code:
        return 1.0
    if ocr_code in known_code:
        return 0.95
    ratio = SequenceMatcher(None, ocr_code, known_code).ratio()
    ocr_grams = {ocr_code[i:i + 3] for i in range(max(0, len(ocr_code) - 2))}
    known_grams = {known_code[i:i + 3] for i in range(max(0, len(known_code) - 2))}
    gram_score = len(ocr_grams & known_grams) / max(1, len(known_grams))
    return max(ratio, gram_score)


def extract_model_from_project_references(value: str | None) -> str | None:
    normalized = normalize_identifier_code(value)
    if not normalized:
        return None
    scored = []
    for code in known_model_codes_from_project():
        if code == normalized:
            continue
        score = code_overlap_score(normalized, code)
        if score >= 0.82:
            scored.append((score, len(code), code))
    if not scored:
        return None
    scored.sort(reverse=True)
    return scored[0][2]


def parse_identifiers_from_ocr_text(text: str) -> dict[str, Any]:
    serial = normalize_identifier_code(first_regex_group([
        r"(?:serial\s*(?:no\.?|number)?|s/?n|matricola|n\.?\s*serie)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{3,})",
    ], text))
    model = normalize_identifier_code(first_regex_group([
        r"(?:model\s*(?:no\.?|number)?|modello|type|tipo)\s*[:#-]?\s*([A-Z0-9][A-Z0-9./_-]{2,})",
    ], text))
    asset_tag = None
    if not serial and not model:
        serial = first_unlabeled_identifier(text)
    if not model:
        model = extract_model_from_project_references(serial) or extract_model_from_project_references(text)
    if not serial and not model:
        asset_tag = first_unlabeled_identifier(text)

    visible_text = [line.strip() for line in text.splitlines() if line.strip()]
    return {
        "available": True,
        "manufacturer": None,
        "model_code": model,
        "serial_number": serial,
        "asset_tag": asset_tag,
        "visible_text": visible_text,
        "raw_text": text,
        "confidence": None,
        "notes": "Estratto con OCR; serial_number normalizzato dal testo OCR. model_code dedotto per sovrapposizione con codici presenti in machine.json, index_meta e testi debug dei manuali.",
    }


def identifier_summary(machine: dict[str, Any], vision_score: float, image_identifiers: dict[str, Any]) -> dict[str, Any]:
    serial_number = image_identifiers.get("serial_number")
    model_code = image_identifiers.get("model_code")
    asset_tag = image_identifiers.get("asset_tag")
    ocr_available = bool(image_identifiers.get("available"))

    if model_code and serial_number:
        status = f"Oggetto riconosciuto: {machine['macchina']}. Modello letto: {model_code}. Seriale letto: {serial_number}."
        exact_model_identified = True
    elif model_code:
        status = f"Oggetto riconosciuto: {machine['macchina']}. Modello letto: {model_code}. Seriale non trovato o non leggibile."
        exact_model_identified = True
    elif serial_number:
        status = f"Oggetto riconosciuto: {machine['macchina']}. Seriale letto: {serial_number}. Modello non trovato o non leggibile."
        exact_model_identified = False
    elif asset_tag:
        status = f"Oggetto riconosciuto: {machine['macchina']}. Ho letto il codice {asset_tag}, ma non posso confermare se sia seriale o modello."
        exact_model_identified = False
    elif ocr_available:
        status = f"Oggetto riconosciuto: {machine['macchina']}, ma non ho trovato seriale o codice modello leggibile nella foto."
        exact_model_identified = False
    else:
        status = f"Oggetto riconosciuto: {machine['macchina']}, ma l'OCR non e disponibile o ha fallito."
        exact_model_identified = False

    return {
        "object_name": machine["macchina"],
        "machine_type": machine.get("tipo"),
        "vision_score": vision_score,
        "model_code": model_code,
        "serial_number": serial_number,
        "asset_tag": asset_tag,
        "exact_model_identified": exact_model_identified,
        "status": status,
    }


def build_vision_prompt(machine: dict[str, Any]) -> str:
    machine_hint = json.dumps({k: machine.get(k) for k in ["id", "macchina", "tipo", "manuali"]}, ensure_ascii=False)
    return f"""Leggi la foto come OCR tecnico industriale.
Devi estrarre solo testo visibile: targhetta, serial number, model number, part number, marca, codici macchina.
Non inventare nulla. Se un dato non e leggibile, usa null.
Contesto macchina possibile: {machine_hint}

Rispondi solo con JSON valido in questo schema:
{{
  "manufacturer": string|null,
  "model_code": string|null,
  "serial_number": string|null,
  "asset_tag": string|null,
  "visible_text": [string],
  "confidence": number,
  "notes": string|null
}}"""


def image_data_url(image_path: str | Path) -> str:
    path = Path(image_path)
    mime = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def extract_json_object(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, flags=re.S)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
    return {"raw_response": text}


def build_prompt(
    question: str,
    context: str,
    machine: dict[str, Any],
    vision_candidates: list[dict[str, Any]],
    memory_hits: list[dict[str, Any]],
    image_identifiers: dict[str, Any],
    stm: str,
) -> str:
    machine_info = json.dumps({k: machine[k] for k in ["id", "macchina", "tipo", "manuali"]}, ensure_ascii=False, indent=2)
    vision_info = "\n".join(
        f"- {item['machine']['macchina']} ({item['machine_id']}): {item['score']:.3f}; reference: {Path(item['reference_image']).name}"
        for item in vision_candidates
    )
    return QA_PROMPT.format(
        machine_info=machine_info,
        vision_info=vision_info,
        image_identifiers=json.dumps(image_identifiers or {}, ensure_ascii=False, indent=2),
        stm=stm,
        ltm=ltm_text(memory_hits),
        context=context,
        question=question,
    )


def memory_session_id(chat_id: int | None, machine_id: str | None = None) -> str:
    chat_scope = f"chat{chat_id}" if chat_id is not None else "nochat"
    return f"{SESSION_ID}:{chat_scope}:{machine_id or 'all'}"


def public_machine(machine: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": machine.get("id"),
        "macchina": machine.get("macchina"),
        "tipo": machine.get("tipo"),
        "manuali": machine.get("manuali", []),
    }


def public_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "machine_id": candidate["machine_id"],
        "machine_name": candidate["machine"]["macchina"],
        "score": candidate["score"],
        "reference_image": Path(candidate["reference_image"]).name,
    }


def public_hit(hit: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": hit.get("source"),
        "page": hit.get("page"),
        "chunk_index": hit.get("chunk_index"),
        "score": hit.get("score"),
        "text": hit.get("text", "")[:700],
    }


assistant = MachineAssistant()
