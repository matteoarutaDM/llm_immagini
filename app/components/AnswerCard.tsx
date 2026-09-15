import { CheckCircleIcon, InformationCircleIcon } from "@heroicons/react/24/outline";

import { formatScore } from "../lib/format";
import type { AskResult } from "../types";

export function AnswerCard({ result }: { result: AskResult }) {
  if (!result.recognized) {
    return (
      <div
        className="rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-900 shadow-lg shadow-sky-900/[0.05] dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
        role="status"
      >
        <div className="font-display flex items-center gap-2 font-semibold">
          <InformationCircleIcon className="h-5 w-5" />
          Immagine non riconosciuta
        </div>
        <p className="mt-2 text-sm">{result.reason ?? "La soglia di riconoscimento non è stata superata."}</p>
        <p className="mt-2 text-xs text-sky-800/80 dark:text-sky-300/80">
          Non è un errore: nessuna macchina della base di conoscenza ha superato la soglia di somiglianza con questa foto.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-lg shadow-neutral-900/[0.05] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-800 dark:text-emerald-400">
              <CheckCircleIcon className="h-5 w-5" />
              Oggetto riconosciuto
            </div>
            <h2 className="font-display mt-2 text-2xl font-semibold text-neutral-950 dark:text-neutral-50">{result.machine?.macchina}</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{result.machine?.tipo}</p>
          </div>
          <div className="rounded-xl border border-neutral-200 px-3 py-2 text-right dark:border-neutral-800">
            <div className="text-xs uppercase text-neutral-500 dark:text-neutral-400">Confidenza</div>
            <div className="font-display text-lg font-semibold text-neutral-950 dark:text-neutral-50">{formatScore(result.vision_score)}</div>
          </div>
        </div>
        <p className="mt-4 rounded-xl bg-neutral-50 p-3 text-sm leading-6 text-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-200">
          {result.recognition_summary?.status}
        </p>
      </div>

      <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-lg shadow-neutral-900/[0.05] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20">
        <h3 className="font-display text-lg font-semibold text-neutral-950 dark:text-neutral-50">Risposta</h3>
        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-neutral-800 dark:text-neutral-200">{result.answer}</div>
      </div>
    </div>
  );
}
