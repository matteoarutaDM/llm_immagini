"""GOT-OCR-2.0 kept resident in the backend process.

The original pipeline ran CLI/got_ocr_runner.py as a subprocess for every
question, so each request paid a fresh Python start, the torch/transformers
imports and the full model load from disk before reading a single character.
Here the model is loaded once (lazily, thread-safe) and reused.

OCR_IN_PROCESS=0 restores the subprocess runner.
OCR_CACHE_SIZE: how many recent photos keep their OCR text in memory (0 = off).
The cache key is the SHA-256 of the image bytes, so only the exact same photo
hits it (typically: several questions about the same photo in one chat). It
lives in this process's memory only and is never written to disk.
"""
from __future__ import annotations

import hashlib
import logging
import os
import threading
from collections import OrderedDict
from pathlib import Path

from backend import perf

logger = logging.getLogger("backend.ocr")

GOT_OCR_MODEL = os.getenv("GOT_OCR_MODEL", "stepfun-ai/GOT-OCR-2.0-hf")
OCR_DEVICE = os.getenv("OCR_DEVICE", "cpu")
OCR_MAX_NEW_TOKENS = int(os.getenv("OCR_MAX_NEW_TOKENS", "512"))
OCR_CACHE_SIZE = int(os.getenv("OCR_CACHE_SIZE", "32"))
HF_LOCAL_FILES_ONLY = os.getenv("HF_LOCAL_FILES_ONLY", "0") == "1"


def build_rmsnorm_class():
    """Same signature and math as torch.nn.RMSNorm (torch >= 2.4).

    transformers 4.54 references nn.RMSNorm while initialising GOT-OCR, but the
    pinned torch 2.2.2 does not have it. CLI/got_ocr_runner.py patches it inside
    its own subprocess; in the backend process the stand-in is visible to every
    library, so it mirrors the real class instead of a simplified one."""
    import torch
    from torch import nn

    class RMSNorm(nn.Module):
        def __init__(self, normalized_shape, eps=None, elementwise_affine=True, device=None, dtype=None):
            super().__init__()
            if isinstance(normalized_shape, int):
                normalized_shape = (normalized_shape,)
            self.normalized_shape = tuple(normalized_shape)
            self.eps = eps
            self.elementwise_affine = elementwise_affine
            if elementwise_affine:
                self.weight = nn.Parameter(torch.ones(self.normalized_shape, device=device, dtype=dtype))
            else:
                self.register_parameter("weight", None)

        def forward(self, x):
            dims = tuple(range(-len(self.normalized_shape), 0))
            eps = self.eps if self.eps is not None else torch.finfo(x.dtype).eps
            out = x * torch.rsqrt(x.pow(2).mean(dims, keepdim=True) + eps)
            return out * self.weight if self.weight is not None else out

    return RMSNorm


def ensure_torch_rmsnorm() -> None:
    from torch import nn

    if not hasattr(nn, "RMSNorm"):
        nn.RMSNorm = build_rmsnorm_class()


class GotOcr:
    def __init__(self, cache_size: int = OCR_CACHE_SIZE) -> None:
        self._model = None
        self._processor = None
        self._load_lock = threading.Lock()
        # One inference at a time: parallel generate() calls on CPU only fight
        # over the same cores and multiply peak memory.
        self._run_lock = threading.Lock()
        self._cache: OrderedDict[str, str] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._cache_size = cache_size

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self):
        with self._load_lock:
            if self._model is None:
                import torch

                ensure_torch_rmsnorm()
                from transformers import AutoModelForImageTextToText, AutoProcessor

                with perf.stage("ocr.model_load"):
                    logger.info("Loading GOT-OCR model %s on %s", GOT_OCR_MODEL, OCR_DEVICE)
                    processor = AutoProcessor.from_pretrained(
                        GOT_OCR_MODEL, local_files_only=HF_LOCAL_FILES_ONLY, trust_remote_code=True
                    )
                    model = AutoModelForImageTextToText.from_pretrained(
                        GOT_OCR_MODEL, local_files_only=HF_LOCAL_FILES_ONLY, trust_remote_code=True
                    ).to(OCR_DEVICE)
                    model.eval()
                self._torch = torch
                self._processor, self._model = processor, model
            return self._model, self._processor

    def read_text(self, image_path: str | Path) -> str:
        data = Path(image_path).read_bytes()
        key = hashlib.sha256(data).hexdigest()
        cached = self._cache_get(key)
        perf.metric("ocr_cache_hit", cached is not None)
        if cached is not None:
            return cached
        text = self._infer(image_path)
        self._cache_put(key, text)
        return text

    def warm_up(self) -> None:
        """Loads the model and runs one throw-away inference: the first generate()
        of a process is several times slower than the next ones (measured ~187 s
        vs ~22 s on CPU), so it is better paid at startup than by a user."""
        from PIL import Image

        self._generate(Image.new("RGB", (256, 256), "white"))

    def _infer(self, image_path: str | Path) -> str:
        from PIL import Image

        with Image.open(image_path) as image:
            return self._generate(image.convert("RGB"))

    def _generate(self, image) -> str:
        model, processor = self.load()
        with self._run_lock, perf.stage("ocr.inference"):
            inputs = processor(image, return_tensors="pt").to(OCR_DEVICE)
            with self._torch.no_grad():
                generated_ids = model.generate(
                    **inputs,
                    do_sample=False,
                    tokenizer=processor.tokenizer,
                    stop_strings="<|im_end|>",
                    max_new_tokens=OCR_MAX_NEW_TOKENS,
                )
            prompt_length = inputs["input_ids"].shape[1]
            text = processor.decode(
                generated_ids[0, prompt_length:], skip_special_tokens=True, clean_up_tokenization_spaces=False
            ).strip()
        perf.metric("ocr_generated_tokens", int(generated_ids.shape[1] - prompt_length))
        return text

    def _cache_get(self, key: str) -> str | None:
        if self._cache_size <= 0:
            return None
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        return None

    def _cache_put(self, key: str, text: str) -> None:
        if self._cache_size <= 0:
            return
        with self._cache_lock:
            self._cache[key] = text
            self._cache.move_to_end(key)
            while len(self._cache) > self._cache_size:
                self._cache.popitem(last=False)


got_ocr = GotOcr()
