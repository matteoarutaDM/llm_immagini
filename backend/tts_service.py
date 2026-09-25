from __future__ import annotations

import io
import logging
import os
import threading
import wave

logger = logging.getLogger("backend.tts_service")

# Piper runs fully inside the backend: the answer text never leaves the server.
# The voice is downloaded on first use from the rhasspy/piper-voices repository
# into HF_HOME (the persistent /models volume in Docker).
PIPER_VOICE = os.getenv("PIPER_VOICE", "it_IT-paola-medium")
PIPER_VOICE_REPO = os.getenv("PIPER_VOICE_REPO", "rhasspy/piper-voices")
# 1.0 is Piper's natural pace; a little above 1 is slower and easier to follow.
PIPER_LENGTH_SCALE = float(os.getenv("PIPER_LENGTH_SCALE", "1.05"))
HF_LOCAL_FILES_ONLY = os.getenv("HF_LOCAL_FILES_ONLY", "0") == "1"


def _voice_repo_path(voice: str) -> str:
    """it_IT-paola-medium -> it/it_IT/paola/medium/it_IT-paola-medium.onnx"""
    locale, name, quality = voice.split("-", 2)
    return f"{locale.split('_')[0]}/{locale}/{name}/{quality}/{voice}.onnx"


class SpeechSynthesizer:
    def __init__(self) -> None:
        self._voice = None
        self._lock = threading.Lock()

    def _get_voice(self):
        with self._lock:
            if self._voice is None:
                from huggingface_hub import hf_hub_download
                from piper import PiperVoice

                filename = _voice_repo_path(PIPER_VOICE)
                logger.info("Loading Piper voice %s", PIPER_VOICE)
                model_path = hf_hub_download(PIPER_VOICE_REPO, filename, local_files_only=HF_LOCAL_FILES_ONLY)
                config_path = hf_hub_download(PIPER_VOICE_REPO, f"{filename}.json", local_files_only=HF_LOCAL_FILES_ONLY)
                self._voice = PiperVoice.load(model_path, config_path=config_path)
            return self._voice

    def synthesize(self, text: str) -> bytes:
        from piper import SynthesisConfig

        voice = self._get_voice()
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wav_file:
            voice.synthesize_wav(text, wav_file, syn_config=SynthesisConfig(length_scale=PIPER_LENGTH_SCALE))
        return buffer.getvalue()


synthesizer = SpeechSynthesizer()
