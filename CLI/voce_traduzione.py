"""Riconoscimento vocale (Google Speech) + traduzione (Google Translate, fallback MyMemory).

Uso:
    python CLI/voce_traduzione.py                      # ascolta dal microfono, una frase
    python CLI/voce_traduzione.py --loop               # continua finché non dici "exit" / "esci"
    python CLI/voce_traduzione.py --file domanda.wav   # trascrive un file (wav/aiff/flac)
    python CLI/voce_traduzione.py --source en-US --target french

Attenzione: a differenza della dettatura del sito (Whisper in locale), qui audio e
testo vengono inviati ai servizi Google/MyMemory.

Dipendenze: pip install -r CLI/requirements-voce.txt
(per il microfono: brew install portaudio, poi pip install PyAudio)
"""

from __future__ import annotations

import argparse

import speech_recognition as sr
from deep_translator import GoogleTranslator, MyMemoryTranslator
from deep_translator.constants import MY_MEMORY_LANGUAGES_TO_CODES

# Lingua parlata, codice BCP-47: "it-IT", "en-US", "fr-FR", "es-ES", ...
LANGUAGE = "it-IT"
# Lingua di destinazione, per nome ("arabic", "english", ...) o codice ("ar").
TARGET_LANGUAGE = "arabic"
EXIT_WORDS = ("exit", "esci")


def recognize(recognizer: sr.Recognizer, audio: sr.AudioData, language: str) -> str:
    return recognizer.recognize_google(audio, language=language).lower()


def listen_microphone(recognizer: sr.Recognizer) -> sr.AudioData:
    with sr.Microphone() as source:
        print("Listening...")
        recognizer.adjust_for_ambient_noise(source, duration=0.7)
        return recognizer.listen(source)


def read_file(recognizer: sr.Recognizer, path: str) -> sr.AudioData:
    with sr.AudioFile(path) as source:
        return recognizer.record(source)


_google_available = True


def translate(value: str, target_language: str, source_language: str) -> str:
    global _google_available
    if _google_available:
        try:
            return GoogleTranslator(source="auto", target=target_language).translate(value)
        except Exception as error:
            # Se Google rifiuta una volta (di solito blocca l'IP), è inutile riprovare
            # a ogni frase: da qui in poi si usa solo MyMemory.
            _google_available = False
            print(f"Google Translate non disponibile ({type(error).__name__}), uso MyMemory da ora in poi.")
    # MyMemory vuole codici come "it-IT" / "ar-SA"; accetta anche i nomi in inglese.
    return MyMemoryTranslator(
        source=source_language,
        target=MY_MEMORY_LANGUAGES_TO_CODES.get(target_language, target_language),
    ).translate(value)


def process(recognizer: sr.Recognizer, audio: sr.AudioData, args: argparse.Namespace) -> str | None:
    """Trascrive e traduce un audio. Ritorna il testo riconosciuto (None se non capito)."""
    try:
        text = recognize(recognizer, audio, args.source)
    except sr.UnknownValueError:
        print("Could not understand audio")
        return None
    except sr.RequestError as e:
        print(f"API error: {e}")
        return None

    print("You said:", text)
    if any(word in text for word in EXIT_WORDS):
        return text

    try:
        print(f"Traduzione ({args.target}): {translate(text, args.target, args.source)}")
    except Exception as error:
        print(f"Errore durante la traduzione: {error}")
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=LANGUAGE, help=f"lingua parlata (default {LANGUAGE})")
    parser.add_argument("--target", default=TARGET_LANGUAGE, help=f"lingua di destinazione (default {TARGET_LANGUAGE})")
    parser.add_argument("--file", help="file audio da trascrivere invece del microfono")
    parser.add_argument("--loop", action="store_true", help='continua ad ascoltare finché non dici "exit"/"esci"')
    args = parser.parse_args()

    recognizer = sr.Recognizer()

    if args.file:
        process(recognizer, read_file(recognizer, args.file), args)
        return

    try:
        while True:
            text = process(recognizer, listen_microphone(recognizer), args)
            if not args.loop or (text and any(word in text for word in EXIT_WORDS)):
                if args.loop:
                    print("Exiting program...")
                break
    except KeyboardInterrupt:
        print("Program terminated")


if __name__ == "__main__":
    main()
