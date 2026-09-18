import { useEffect, useState } from "react";

import { askApi } from "../lib/api";
import type { AskResult } from "../types";

const DEFAULT_QUESTION =
  "Riconosci l'oggetto, leggi seriale o modello se visibili, e dimmi cosa posso verificare per controllare se la pompa idraulica funziona correttamente.";

export function useAsk() {
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Revoke the object URL whenever it's replaced or the component unmounts,
  // so we never leak a blob: URL for an image the user is no longer viewing.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function onFileChange(file: File | null) {
    setImage(file);
    setResult(null);
    setError(null);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function submit(token: string | null, chatId: number | undefined, onAnswered: (question: string, answer: string) => void) {
    if (!image) {
      setError("Carica un'immagine prima di inviare.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await askApi.ask(token, image, question, chatId);
      if (!response.ok) {
        throw new Error(response.data.detail ?? "Richiesta non riuscita.");
      }
      setResult(response.data);
      if (chatId !== undefined && response.data.answer) {
        onAnswered(question.trim(), response.data.answer);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore inatteso.");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = Boolean(image && question.trim() && !loading);

  return { image, previewUrl, question, setQuestion, result, loading, error, canSubmit, onFileChange, submit };
}

export type UseAskResult = ReturnType<typeof useAsk>;
