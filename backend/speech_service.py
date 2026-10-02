from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger("backend.speech_service")

# faster-whisper runs fully inside the backend container: the audio never
# leaves the server. The model is downloaded on first use into HF_HOME
# (the persistent /models volume in Docker).
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE = os.getenv("WHISPER_LANGUAGE", "it")
WHISPER_CPU_THREADS = int(os.getenv("WHISPER_CPU_THREADS", "0"))


class SpeechTranscriber:
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def _get_model(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel

                logger.info("Loading Whisper model %s (%s, %s)", WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE_TYPE)
                self._model = WhisperModel(
                    WHISPER_MODEL,
                    device=WHISPER_DEVICE,
                    compute_type=WHISPER_COMPUTE_TYPE,
                    cpu_threads=WHISPER_CPU_THREADS,
                )
            return self._model

    def transcribe(self, audio_path: Path) -> str:
        model = self._get_model()
        segments, _info = model.transcribe(
            str(audio_path),
            language=WHISPER_LANGUAGE or None,
            beam_size=5,
            # Skips silence at the start/end of the recording, which otherwise
            # makes Whisper hallucinate filler text.
            vad_filter=True,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()


transcriber = SpeechTranscriber()
