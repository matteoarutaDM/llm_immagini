import { CheckCircleIcon, InformationCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";

import { ListenButton } from "./ListenButton";

function confidenceLabel(score) {
  return typeof score === "number" ? `${Math.round(score * 100)}%` : "n/d";
}

export function AnswerCard({ result, token }) {
  if (!result.recognized) {
    return (
      <section className="rounded-[20px] border border-sky-400/20 bg-sky-400/[0.06] px-5 py-6 sm:px-7" role="status">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-400/10 text-sky-300">
            <InformationCircleIcon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold text-app-text">Macchina non riconosciuta</h2>
            <p className="mt-2 text-sm leading-6 text-app-secondary">{result.reason ?? "La soglia di riconoscimento non è stata superata."}</p>
            <p className="mt-3 text-xs leading-5 text-app-muted">Prova una foto più nitida, ben illuminata e con la macchina interamente visibile.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <article>
      <header className="flex flex-col gap-5 border-b border-app-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-app-accent">
            <CheckCircleIcon className="h-4 w-4" />
            Macchina riconosciuta
          </div>
          <h2 className="font-display mt-3 text-2xl font-semibold leading-tight text-app-text sm:text-3xl">{result.machine?.macchina}</h2>
          {result.machine?.tipo ? <p className="mt-2 text-sm text-app-secondary">{result.machine.tipo}</p> : null}
          {result.recognition_summary?.status ? <p className="mt-3 max-w-2xl text-sm leading-6 text-app-muted">{result.recognition_summary.status}</p> : null}
        </div>
        <div className="shrink-0 sm:text-right">
          <p className="text-[11px] uppercase tracking-[0.14em] text-app-muted">Confidenza</p>
          <p className="font-display mt-1 text-2xl font-semibold text-app-text">{confidenceLabel(result.vision_score)}</p>
        </div>
      </header>

      <section className="pt-8" aria-labelledby="technical-answer-title">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-5 w-5 text-app-accent" />
          <h3 id="technical-answer-title" className="font-display text-lg font-semibold text-app-text">Risposta tecnica</h3>
          {/* Keyed by the answer: a new answer remounts the button and stops the old reading. */}
          {result.answer ? <ListenButton key={result.answer} text={result.answer} token={token} className="ml-auto" /> : null}
        </div>
        <div className="mt-5 max-w-3xl whitespace-pre-wrap text-[15px] leading-7 text-[#d5dad7] sm:text-base sm:leading-8">
          {result.answer || "Nessuna risposta disponibile."}
        </div>
      </section>
    </article>
  );
}
