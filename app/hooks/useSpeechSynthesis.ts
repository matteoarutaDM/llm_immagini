import { useEffect, useRef, useState } from "react";

const LANG = "it-IT";

/**
 * Picks an Italian voice, preferring those installed on the device: remote
 * voices (e.g. Chrome's "Google italiano") send the text to a third party.
 */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const italian = voices.filter((voice) => voice.lang.replace("_", "-").toLowerCase().startsWith("it"));
  return italian.find((voice) => voice.localService) ?? italian[0];
}

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

/** Reads a text aloud with the browser's speech synthesis (Web Speech API). */
export function useSpeechSynthesis() {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Checked after mount: speechSynthesis only exists in the browser.
  useEffect(() => {
    const available = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
    setSupported(available);
    if (!available) return;
    // Some browsers load the voice list asynchronously: asking once warms it up.
    window.speechSynthesis.getVoices();
    return () => {
      if (utteranceRef.current) window.speechSynthesis.cancel();
      utteranceRef.current = null;
    };
  }, []);

  function stop() {
    utteranceRef.current = null;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }

  function speak(text: string) {
    const speakable = toSpeakableText(text);
    if (!speakable) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(speakable);
    utterance.lang = LANG;
    const voice = pickVoice(window.speechSynthesis.getVoices());
    if (voice) utterance.voice = voice;
    const finish = () => {
      // Ignore events from an utterance that was already replaced or stopped.
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      setSpeaking(false);
    };
    utterance.onend = finish;
    utterance.onerror = finish;

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }

  return { supported, speaking, speak, stop };
}
