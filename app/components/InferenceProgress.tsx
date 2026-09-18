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
      className="rounded-2xl border border-neutral-200/70 bg-white p-8 shadow-lg shadow-neutral-900/[0.05] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20"
      role="status"
      aria-live="polite"
    >
      {/* Indeterminate: the backend doesn't report real progress, so this never claims a percentage. */}
      <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-emerald-500 to-emerald-700 motion-reduce:animate-none" />
      </div>
      <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">{PHASES[phaseIndex]}</p>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
        La prima richiesta può richiedere più tempo per il caricamento dei modelli.
      </p>
    </div>
  );
}
