"""LLM fallback on Modal: Llama 3.1 8B Instruct served by vLLM on a serverless GPU.

Inference only. RAG, OCR, manuals, prompts and citation checks stay in the
backend: this app receives the already-built messages and returns the text.
The backend calls it only when the company RTX 5090 is unreachable
(backend/llm_service.py), through vLLM's OpenAI-compatible API:

    POST https://<workspace>--assistente-llm-fallback-serve.modal.run/v1/chat/completions
    Authorization: Bearer <VLLM_API_KEY>

Cost model: min_containers=0, so no GPU runs while nobody uses the fallback.
A container stays warm for MODAL_SCALEDOWN_SECONDS after the last request,
then scales to zero; the next request pays a cold start (GPU + model load).

Setup (see README, section "LLM fallback: RTX 5090 -> Modal"):
    pip install modal && modal setup
    modal secret create assistente-llm-fallback HF_TOKEN=hf_... VLLM_API_KEY=<random>
    modal deploy deploy/modal_app.py

Deploy-time settings (environment of the machine running `modal deploy`):
    MODAL_MODEL               default meta-llama/Llama-3.1-8B-Instruct (gated: accept the licence on Hugging Face)
    MODAL_GPU                 default L4 (24 GB)
    MODAL_MAX_MODEL_LEN       default 8192, same context as OLLAMA_NUM_CTX
    MODAL_SCALEDOWN_SECONDS   default 300: how long a container stays warm after the last request
    MODAL_MAX_CONTAINERS      default 1: hard cap on parallel GPUs
    MODAL_ENFORCE_EAGER       default 1: skip CUDA graph capture, shorter cold start, a bit slower generation
"""
from __future__ import annotations

import os
import subprocess

import modal

APP_NAME = "assistente-llm-fallback"
SECRET_NAME = "assistente-llm-fallback"  # HF_TOKEN + VLLM_API_KEY
VLLM_VERSION = "0.30.0"
PORT = 8000

# Read on the deploy machine, then baked into the image environment so the
# container sees exactly the same values.
CONFIG = {
    "SERVED_MODEL": os.environ.get("MODAL_MODEL", "meta-llama/Llama-3.1-8B-Instruct"),
    "MAX_MODEL_LEN": os.environ.get("MODAL_MAX_MODEL_LEN", "8192"),
    "ENFORCE_EAGER": os.environ.get("MODAL_ENFORCE_EAGER", "1"),
    # The FlashInfer sampler JIT-compiles CUDA kernels at startup and needs
    # nvcc, which debian_slim lacks: without this vLLM crashes during warm-up.
    "VLLM_USE_FLASHINFER_SAMPLER": "0",
}
GPU = os.environ.get("MODAL_GPU", "L4")
SCALEDOWN_SECONDS = int(os.environ.get("MODAL_SCALEDOWN_SECONDS", "300"))
MAX_CONTAINERS = int(os.environ.get("MODAL_MAX_CONTAINERS", "1"))

image = modal.Image.debian_slim(python_version="3.12").uv_pip_install(f"vllm=={VLLM_VERSION}").env(CONFIG)

# Model weights and vLLM compilation cache survive between cold starts, so the
# model is downloaded from Hugging Face only once.
hf_cache = modal.Volume.from_name("assistente-llm-hf-cache", create_if_missing=True)
vllm_cache = modal.Volume.from_name("assistente-llm-vllm-cache", create_if_missing=True)

app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=GPU,
    secrets=[modal.Secret.from_name(SECRET_NAME)],
    volumes={"/root/.cache/huggingface": hf_cache, "/root/.cache/vllm": vllm_cache},
    min_containers=0,  # scale to zero: never an always-on GPU
    max_containers=MAX_CONTAINERS,
    scaledown_window=SCALEDOWN_SECONDS,
    timeout=15 * 60,
)
@modal.concurrent(max_inputs=8)  # vLLM batches concurrent requests on one GPU
@modal.web_server(port=PORT, startup_timeout=15 * 60)
def serve() -> None:
    # vLLM reads VLLM_API_KEY from the environment and then rejects any /v1
    # request without `Authorization: Bearer <key>`. Refuse to start without
    # it rather than expose an open endpoint.
    if not os.environ.get("VLLM_API_KEY"):
        raise RuntimeError(f"VLLM_API_KEY missing from the Modal secret {SECRET_NAME!r}")
    model = os.environ["SERVED_MODEL"]
    cmd = [
        "vllm", "serve", model,
        "--served-model-name", model,
        "--host", "0.0.0.0",
        "--port", str(PORT),
        "--max-model-len", os.environ["MAX_MODEL_LEN"],
        # No --enable-log-requests: vLLM 0.30 does not log prompts by default,
        # and prompts contain company documents.
    ]
    if os.environ.get("ENFORCE_EAGER") == "1":
        cmd.append("--enforce-eager")
    subprocess.Popen(cmd)
