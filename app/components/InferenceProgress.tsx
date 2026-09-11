import { useEffect, useState } from "react";

const PHASES = [
  "Riconoscimento della macchina nell'immagine...",
  "Lettura di seriale e modello dalla targhetta...",
  "Ricerca dei passaggi rilevanti nei manuali...",
  "Generazione della risposta...",
];

export function InferenceProgress() {
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % PHASES.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div
      className="rounded-lg border border-neutral-300 bg-white p-8 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
      role="status"
      aria-live="polite"
    >
      {/* Indeterminate: the backend doesn't report real progress, so this never claims a percentage. */}
      <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-700 motion-reduce:animate-none" />
      </div>
      <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">{PHASES[phaseIndex]}</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
        La prima richiesta può richiedere più tempo per il caricamento dei modelli.
      </p>
    </div>
  );
}
