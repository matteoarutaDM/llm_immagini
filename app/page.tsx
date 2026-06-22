"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";

type Hit = {
  source?: string;
  page?: number;
  chunk_index?: number;
  score?: number;
  text?: string;
};

type Candidate = {
  machine_id: string;
  machine_name: string;
  score: number;
  reference_image: string;
};

type AskResult = {
  recognized: boolean;
  reason?: string;
  machine?: {
    id: string;
    macchina: string;
    tipo?: string;
    manuali?: string[];
  };
  vision_score?: number;
  vision_candidates?: Candidate[];
  recognition_summary?: {
    status: string;
    exact_model_identified: boolean;
    model_code?: string | null;
    serial_number?: string | null;
    asset_tag?: string | null;
  };
  image_identifiers?: {
    available?: boolean;
    error?: string;
    visible_text?: string[];
    raw_text?: string;
  };
  answer?: string;
  hits?: Hit[];
  detail?: string;
};

export default function Home() {
  const [image, setImage] = useState<File | null>(null);
  const [question, setQuestion] = useState(
    "Riconosci l'oggetto, leggi seriale o modello se visibili, e dimmi cosa posso verificare per controllare se la pompa idraulica funziona correttamente.",
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => Boolean(image && question.trim() && !loading), [image, question, loading]);

  function onFileChange(file: File | null) {
    setImage(file);
    setResult(null);
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image) {
      setError("Carica un'immagine prima di inviare.");
      return;
    }

    const formData = new FormData();
    formData.append("image", image);
    formData.append("question", question);

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as AskResult;
      if (!response.ok) {
        throw new Error(payload.detail ?? "Richiesta non riuscita.");
      }
      setResult(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore inatteso.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-5 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[420px_1fr]">
        <section className="rounded-lg border border-neutral-300 bg-white/90 shadow-sm">
          <div className="border-b border-neutral-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-emerald-700 text-white">
                <CpuChipIcon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Assistente macchine</h1>
                <p className="text-sm text-neutral-600">Immagine, riconoscimento, manuali, risposta tecnica.</p>
              </div>
            </div>
          </div>

          <form className="space-y-5 p-5" onSubmit={onSubmit}>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-800">Immagine macchina</span>
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                id="machine-image"
              />
              <span className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-400 bg-neutral-50 px-4 py-6 text-center transition hover:border-emerald-700 hover:bg-emerald-50">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Anteprima immagine caricata"
                    className="max-h-64 w-full rounded-md object-contain"
                  />
                ) : (
                  <>
                    <PhotoIcon className="h-10 w-10 text-neutral-500" />
                    <span className="mt-3 text-sm font-medium">Seleziona o trascina una foto</span>
                    <span className="mt-1 text-xs text-neutral-500">JPG, PNG, WEBP</span>
                  </>
                )}
              </span>
              <label
                htmlFor="machine-image"
                className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                Carica immagine
              </label>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-800">Domanda</span>
              <textarea
                className="min-h-36 w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 outline-none ring-emerald-700 transition focus:ring-2"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              <PaperAirplaneIcon className="h-5 w-5" />
              {loading ? "Elaborazione in corso..." : "Analizza e rispondi"}
            </button>

            {error ? (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </form>
        </section>

        <section className="space-y-5">
          {!result && !loading ? (
            <div className="rounded-lg border border-neutral-300 bg-white/80 p-8 text-center shadow-sm">
              <DocumentTextIcon className="mx-auto h-12 w-12 text-neutral-500" />
              <h2 className="mt-4 text-lg font-semibold">Risultato analisi</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600">
                Il risultato mostrerà macchina riconosciuta, confidenza, dati OCR, risposta del modello e fonti RAG dai
                manuali.
              </p>
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-neutral-300 bg-white p-8 shadow-sm">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-700" />
              </div>
              <p className="mt-4 text-sm text-neutral-700">
                Caricamento modelli e generazione risposta. La prima richiesta può richiedere più tempo.
              </p>
            </div>
          ) : null}

          {result ? <ResultView result={result} /> : null}
        </section>
      </div>
    </main>
  );
}

function ResultView({ result }: { result: AskResult }) {
  if (!result.recognized) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900 shadow-sm">
        <div className="flex items-center gap-2 font-semibold">
          <ExclamationTriangleIcon className="h-5 w-5" />
          Immagine non riconosciuta
        </div>
        <p className="mt-2 text-sm">{result.reason ?? "La soglia di riconoscimento non è stata superata."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <CheckCircleIcon className="h-5 w-5" />
              Oggetto riconosciuto
            </div>
            <h2 className="mt-2 text-2xl font-semibold">{result.machine?.macchina}</h2>
            <p className="mt-1 text-sm text-neutral-600">{result.machine?.tipo}</p>
          </div>
          <div className="rounded-md border border-neutral-300 px-3 py-2 text-right">
            <div className="text-xs uppercase text-neutral-500">Confidenza</div>
            <div className="text-lg font-semibold">{formatScore(result.vision_score)}</div>
          </div>
        </div>
        <p className="mt-4 rounded-md bg-neutral-50 p-3 text-sm leading-6 text-neutral-800">
          {result.recognition_summary?.status}
        </p>
      </div>

      <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Risposta</h3>
        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-neutral-800">{result.answer}</div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">OCR targhetta</h3>
          {result.image_identifiers?.available ? (
            <div className="mt-3 space-y-2 text-sm">
              {result.image_identifiers.visible_text?.length ? (
                result.image_identifiers.visible_text.slice(0, 8).map((line, index) => (
                  <div key={`${line}-${index}`} className="rounded-md bg-neutral-50 px-3 py-2">
                    {line}
                  </div>
                ))
              ) : (
                <p className="text-neutral-600">Nessun testo classificabile trovato.</p>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">
              OCR non disponibile: {result.image_identifiers?.error ?? "nessun dettaglio ricevuto"}.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Candidati visione</h3>
          <div className="mt-3 space-y-2">
            {result.vision_candidates?.map((candidate) => (
              <div
                key={candidate.machine_id}
                className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2 text-sm"
              >
                <span>{candidate.machine_name}</span>
                <span className="font-semibold">{formatScore(candidate.score)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Fonti recuperate</h3>
        <div className="mt-3 space-y-3">
          {result.hits?.map((hit, index) => (
            <article key={`${hit.source}-${hit.page}-${hit.chunk_index}-${index}`} className="rounded-md bg-neutral-50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{hit.source}</span>
                <span className="text-neutral-500">pagina {hit.page}</span>
                <span className="text-neutral-500">chunk {hit.chunk_index}</span>
                <span className="ml-auto text-neutral-700">{formatScore(hit.score)}</span>
              </div>
              {hit.text ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-600">{hit.text}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatScore(score?: number) {
  if (typeof score !== "number") {
    return "n/d";
  }
  return score.toFixed(3);
}
