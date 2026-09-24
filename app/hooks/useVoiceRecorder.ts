import { useEffect, useRef, useState } from "react";

import { speechApi } from "../lib/api";

/** Long recordings are cut here: a question never needs more, and it bounds the upload. */
const MAX_RECORDING_MS = 60_000;

/** Preferred containers, in order: Chrome/Firefox record webm, Safari only mp4. */
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export type VoiceStatus = "idle" | "recording" | "transcribing";

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Records the question from the microphone and has the backend transcribe it
 * (Whisper runs server-side, so the audio never goes to third parties).
 * The recognised text is handed to `onText`.
 */
export function useVoiceRecorder(token: string | null, onText: (text: string) => void) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  // Checked after mount: the microphone API only exists in the browser, and
  // only on HTTPS or localhost.
  useEffect(() => {
    setSupported(Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined");
  }, []);

  function releaseMicrophone() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  useEffect(
    () => () => {
      cancelledRef.current = true;
      recorderRef.current?.stop();
      releaseMicrophone();
    },
    [],
  );

  async function transcribe(audio: Blob) {
    if (cancelledRef.current) return;
    if (audio.size === 0) {
      setStatus("idle");
      setError("Nessun audio registrato.");
      return;
    }
    setStatus("transcribing");
    try {
      const response = await speechApi.transcribe(token, audio);
      if (!response.ok || !response.data.text) {
        throw new Error(response.data.detail ?? "Trascrizione non riuscita.");
      }
      onText(response.data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trascrizione non riuscita.");
    } finally {
      setStatus("idle");
    }
  }

  async function start() {
    if (status !== "idle") return;
    setError(null);
    cancelledRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(denied ? "Permesso microfono negato." : "Microfono non disponibile.");
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone();
      void transcribe(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    recorder.start();
    setStatus("recording");
    timeoutRef.current = setTimeout(stop, MAX_RECORDING_MS);
  }

  function stop() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  return { supported, status, error, start, stop };
}

export type UseVoiceRecorderResult = ReturnType<typeof useVoiceRecorder>;
