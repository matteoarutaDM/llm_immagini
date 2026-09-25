import { useEffect, useRef, useState } from "react";

import { speechApi } from "../lib/api";

/** Short chunks: the first one comes back fast, the next is prepared while it plays. */
const MAX_CHUNK_CHARS = 400;

/** An empty WAV, played inside the click so Safari lets us play the real audio later. */
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export type ReadAloudStatus = "idle" | "loading" | "playing";

/** Drops the markdown the LLM sometimes emits, so the voice doesn't read symbols aloud. */
export function toSpeakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/\s+\n/g, "\n")
    .trim();
}

/** Splits the text on paragraphs and sentences into chunks of at most `max` characters. */
export function splitForSpeech(text: string, max = MAX_CHUNK_CHARS): string[] {
  const pieces = text
    .split(/\n+/)
    .flatMap((paragraph) => paragraph.split(/(?<=[.!?;:])\s+/))
    .flatMap((sentence) => {
      // A sentence longer than a chunk is cut on word boundaries.
      const parts: string[] = [];
      let current = "";
      for (const word of sentence.split(/\s+/)) {
        if (current && current.length + word.length + 1 > max) {
          parts.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      return current ? [...parts, current] : parts;
    })
    .map((piece) => piece.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  for (const piece of pieces) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + piece.length + 1 <= max) chunks[chunks.length - 1] = `${last} ${piece}`;
    else chunks.push(piece);
  }
  return chunks;
}

/**
 * Reads a text aloud with the backend's voice (Piper runs server-side, so the
 * text never goes to third parties). The text is sent a few sentences at a
 * time: playback starts after the first chunk and the next one is fetched
 * while the current one plays.
 */
export function useReadAloud(token: string | null) {
  const [status, setStatus] = useState<ReadAloudStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sessionRef = useRef(0);
  const urlsRef = useRef<string[]>([]);
  // Settles the chunk that is playing when the reading is stopped.
  const interruptRef = useRef<(() => void) | null>(null);

  function release() {
    interruptRef.current?.();
    interruptRef.current = null;
    audioRef.current?.pause();
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  }

  useEffect(
    () => () => {
      sessionRef.current += 1;
      release();
    },
    [],
  );

  async function fetchChunk(text: string): Promise<string> {
    const response = await speechApi.speak(token, text);
    if (!response.ok) throw new Error(response.detail ?? "Lettura non riuscita.");
    const url = URL.createObjectURL(response.audio);
    urlsRef.current.push(url);
    return url;
  }

  function playChunk(audio: HTMLAudioElement, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      interruptRef.current = resolve;
      audio.onended = () => resolve();
      // Only this chunk's errors count, not a late one from the SILENT_WAV unlock.
      audio.onerror = () => {
        if (audio.src === url) reject(new Error("Riproduzione non riuscita."));
      };
      audio.src = url;
      audio.play().catch(reject);
    });
  }

  async function play(text: string) {
    const chunks = splitForSpeech(toSpeakableText(text));
    if (chunks.length === 0) return;
    stop();
    const session = sessionRef.current;

    // Created and started inside the click, before any await (see SILENT_WAV).
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.src = SILENT_WAV;
    audio.play()?.catch(() => {});

    setError(null);
    setStatus("loading");
    try {
      let next = fetchChunk(chunks[0]);
      for (let index = 0; index < chunks.length; index += 1) {
        const url = await next;
        if (session !== sessionRef.current) return;
        if (index + 1 < chunks.length) {
          next = fetchChunk(chunks[index + 1]);
          // Awaited on the next iteration; this only silences a rejection after a stop.
          next.catch(() => {});
        }
        setStatus("playing");
        await playChunk(audio, url);
        if (session !== sessionRef.current) return;
      }
    } catch (err) {
      if (session === sessionRef.current) setError(err instanceof Error ? err.message : "Lettura non riuscita.");
    } finally {
      if (session === sessionRef.current) {
        release();
        setStatus("idle");
      }
    }
  }

  function stop() {
    sessionRef.current += 1;
    release();
    setStatus("idle");
  }

  return { status, error, play, stop };
}
