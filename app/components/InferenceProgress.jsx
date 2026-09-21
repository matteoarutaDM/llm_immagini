const PHASES = ["Riconoscimento", "OCR targhetta", "Ricerca documentazione", "Risposta tecnica"];

export function InferenceProgress() {
  return (
    <section className="mt-6 rounded-2xl border border-app-border bg-app-surface px-5 py-5" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-app-accent opacity-50 motion-reduce:animate-none" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-app-accent" />
        </span>
        <div>
          <p className="text-sm font-medium text-app-text">Analisi della macchina in corso</p>
          <p className="mt-0.5 text-xs text-app-muted">La prima richiesta può richiedere più tempo per caricare i modelli.</p>
        </div>
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-app-raised">
        <div className="h-full w-1/3 animate-[indeterminate_1.6s_ease-in-out_infinite] rounded-full bg-app-accent motion-reduce:animate-pulse" />
      </div>
      <p className="mt-4 text-[11px] uppercase tracking-[0.08em] text-app-muted">Il processo include: {PHASES.join(" · ")}</p>
    </section>
  );
}
