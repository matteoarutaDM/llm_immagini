import { useEffect, useRef, useState } from "react";

import { askApi } from "../lib/api";
import { getAnswerLanguage, type AnswerLanguage } from "../lib/answerLanguage";
import { tr, useLanguage } from "../lib/i18n";
import type { AskResult } from "../types";

export const DEFAULT_QUESTION =
  "Identifica l'oggetto nella foto. Se lo riconosci, spiega cosa indicano i manuali su funzionamento e controlli, citando le fonti. Se non lo riconosci, fermati.";

/** The default question as shown in each interface language. */
const DEFAULT_QUESTIONS: Record<AnswerLanguage, string> = {
  it: DEFAULT_QUESTION,
  en: "Identify the object in the photo. If you recognize it, explain what the manuals say about operation and checks, citing the sources. If you don't recognize it, stop.",
  es: "Identifica el objeto de la foto. Si lo reconoces, explica lo que indican los manuales sobre funcionamiento y controles, citando las fuentes. Si no lo reconoces, detente.",
  de: "Identifiziere das Objekt auf dem Foto. Wenn du es erkennst, erkläre, was die Handbücher zu Betrieb und Kontrollen sagen, und nenne die Quellen. Wenn du es nicht erkennst, hör auf.",
  fr: "Identifie l'objet sur la photo. Si tu le reconnais, explique ce que disent les manuels sur le fonctionnement et les contrôles, en citant les sources. Si tu ne le reconnais pas, arrête-toi.",
};

export function isDefaultQuestion(question: string) {
  return Object.values(DEFAULT_QUESTIONS).includes(question);
}

/** Results are kept per chat; requests made without a chat share this key. */
const NO_CHAT = "none";
const keyFor = (chatId: number | undefined) => (chatId === undefined ? NO_CHAT : String(chatId));

/**
 * Photo + question composer and analysis results, scoped to the active chat:
 * switching chat (or creating a new one) clears the composer, and coming back
 * to a chat shows the last answer it received in this session. A request that
 * is still running keeps its result for the chat that sent it.
 */
export function useAsk(activeChatId?: number) {
  const activeKey = keyFor(activeChatId);
  const { language } = useLanguage();
  const [image, setImage] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [question, setQuestion] = useState(DEFAULT_QUESTIONS[language]);
  const [resultsByChat, setResultsByChat] = useState<Record<string, AskResult>>({});
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeKeyRef = useRef(activeKey);

  // Revoke the object URL whenever it's replaced or the component unmounts,
  // so we never leak a blob: URL for an image the user is no longer viewing.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // A different chat starts from an empty composer.
  useEffect(() => {
    activeKeyRef.current = activeKey;
    setImage(null);
    setPreviewUrl(null);
    setQuestion(DEFAULT_QUESTIONS[getAnswerLanguage()]);
    setError(null);
  }, [activeKey]);

  // Changing language swaps the untouched default question for its translation.
  useEffect(() => {
    setQuestion((current) => (isDefaultQuestion(current) ? DEFAULT_QUESTIONS[language] : current));
  }, [language]);

  function onFileChange(file: File | null) {
    setImage(file);
    setError(null);
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
    // A new photo starts a new question: hide this chat's previous answer.
    setResultsByChat(({ [activeKey]: _previous, ...rest }) => rest);
  }

  async function submit(token: string | null, onAnswered: (question: string, answer: string) => void) {
    if (!image) {
      setError(tr("Carica un'immagine prima di inviare."));
      return;
    }

    const chatId = activeChatId;
    const key = activeKey;
    // The manuals are searched with an English-only embedding model on Italian text:
    // the default question is always sent in Italian so the search is not degraded.
    const sentQuestion = isDefaultQuestion(question) ? DEFAULT_QUESTION : question;
    const askedQuestion = sentQuestion.trim();
    setPendingKeys((current) => [...current, key]);
    setError(null);
    setResultsByChat(({ [key]: _previous, ...rest }) => rest);

    try {
      const response = await askApi.ask(token, image, sentQuestion, chatId, getAnswerLanguage());
      if (!response.ok) {
        throw new Error(response.data.detail ?? tr("Richiesta non riuscita."));
      }
      setResultsByChat((current) => ({ ...current, [key]: response.data }));
      // Only touch the visible history if the user is still on that chat;
      // otherwise it is reloaded from the server when they come back.
      if (chatId !== undefined && response.data.answer && activeKeyRef.current === key) {
        onAnswered(askedQuestion, response.data.answer);
      }
    } catch (err) {
      if (activeKeyRef.current === key) setError(err instanceof Error ? err.message : tr("Errore inatteso."));
    } finally {
      setPendingKeys((current) => current.filter((pending) => pending !== key));
    }
  }

  /** Adds dictated text to the question; the untouched default prompt is replaced instead. */
  function appendToQuestion(text: string) {
    setQuestion((current) =>
      !current.trim() || isDefaultQuestion(current) ? text : `${current.trimEnd()} ${text}`,
    );
  }

  /** Drops the cached answer of a deleted chat. */
  function forgetChat(chatId: number) {
    setResultsByChat(({ [String(chatId)]: _removed, ...rest }) => rest);
  }

  const result = resultsByChat[activeKey] ?? null;
  const loading = pendingKeys.includes(activeKey);
  const canSubmit = Boolean(image && question.trim() && !loading);

  return { image, previewUrl, question, setQuestion, appendToQuestion, result, loading, error, canSubmit, onFileChange, submit, forgetChat };
}

export type UseAskResult = ReturnType<typeof useAsk>;
