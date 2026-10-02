# Backend FastAPI (riconoscimento immagini + RAG sui manuali), CPU.
# Build dalla radice del progetto:  docker build -f docker/backend.Dockerfile .

FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    # Cache dei modelli Hugging Face (SigLIP, GOT-OCR, embeddings): volume persistente.
    HF_HOME=/models

# git serve per installare ragmens-core dal repository GitHub.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# PyTorch in versione solo CPU (evita ~2 GB di librerie CUDA inutili nel container),
# poi il resto delle dipendenze: le versioni di torch/torchvision coincidono con requirements.txt.
COPY requirements.txt ./
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.2.2 torchvision==0.17.2 \
 && pip install -r requirements.txt

COPY backend ./backend
COPY database ./database
COPY CLI/got_ocr_runner.py CLI/machine.json ./CLI/
COPY CLI/reference_images ./CLI/reference_images

RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app --home /app app \
 && mkdir -p /models /app/data/companies /data/index /data/memory /data/debug \
 && chown -R app:app /models /app/data /data

USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"
# Un solo worker: i modelli restano caricati in memoria in quel processo.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
