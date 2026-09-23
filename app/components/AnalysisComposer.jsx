import { useState } from "react";
import {
  ArrowPathIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  PaperAirplaneIcon,
  PhotoIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

export function AnalysisComposer({
  previewUrl,
  onImageChange,
  question,
  onQuestionChange,
  selectedDocumentCount,
  hasCompanyAccess,
  onOpenDocuments,
  canSubmit,
  loading,
  error,
  onSubmit,
}) {
  const [dragActive, setDragActive] = useState(false);

  function onDrop(event) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onImageChange(file);
  }

  return (
    <form className="mt-6 sm:mt-8" onSubmit={onSubmit}>
      <div className="relative overflow-hidden rounded-[20px] border border-app-border-strong bg-app-surface shadow-[0_24px_80px_rgba(0,0,0,0.3)] transition focus-within:border-app-accent/50 focus-within:shadow-[0_24px_80px_rgba(0,0,0,0.4),0_0_0_3px_rgba(50,213,131,0.07)]">
        <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(event) => onImageChange(event.target.files?.[0] ?? null)} id="machine-image" />

        {previewUrl ? (
          <div className="relative border-b border-app-border bg-black/25 p-3 sm:p-4">
            <img src={previewUrl} alt="Anteprima immagine caricata" className="h-52 w-full rounded-xl object-contain sm:h-64" />
            <div className="absolute right-5 top-5 flex gap-2">
              <label htmlFor="machine-image" className="touch-target grid cursor-pointer place-items-center rounded-xl border border-white/10 bg-black/65 text-white backdrop-blur transition hover:bg-black/80" aria-label="Sostituisci immagine">
                <ArrowPathIcon className="h-5 w-5" />
              </label>
              <button type="button" onClick={() => onImageChange(null)} className="touch-target grid place-items-center rounded-xl border border-white/10 bg-black/65 text-white backdrop-blur transition hover:bg-red-500/80" aria-label="Rimuovi immagine">
                <TrashIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        ) : (
          <label
            htmlFor="machine-image"
            className={`m-3 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-5 py-6 text-center transition sm:m-4 sm:min-h-52 sm:py-8 [@media(max-height:760px)]:sm:min-h-40 [@media(max-height:760px)]:sm:py-5 ${dragActive ? "border-app-accent bg-app-accent-soft" : "border-app-border-strong bg-app-raised/40 hover:border-app-accent/60 hover:bg-app-accent-soft"}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <span className="grid h-12 w-12 place-items-center rounded-2xl border border-app-border bg-app-surface text-app-accent shadow-lg shadow-black/20">
              <PhotoIcon className="h-6 w-6" />
            </span>
            <span className="mt-4 text-sm font-medium text-app-text">Trascina una foto della macchina</span>
            <span className="mt-1 text-xs text-app-muted">oppure tocca per usare fotocamera o galleria</span>
            <span className="mt-4 rounded-lg bg-app-accent-soft px-3 py-2 text-xs font-semibold text-app-accent">Scegli immagine</span>
          </label>
        )}

        <div className="px-4 pt-1 sm:px-5">
          <label htmlFor="machine-question" className="sr-only">Domanda tecnica</label>
          <textarea
            id="machine-question"
            className="min-h-28 w-full resize-y bg-transparent py-4 text-base leading-7 text-app-text outline-none placeholder:text-app-muted sm:min-h-32"
            value={question}
            onChange={(event) => onQuestionChange(event.target.value)}
            placeholder="Chiedi qualcosa sulla macchina..."
          />
        </div>

        <div className="flex flex-col gap-3 border-t border-app-border px-3 py-3 sm:flex-row sm:items-center sm:px-4">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <label htmlFor="machine-image" className="touch-target inline-flex cursor-pointer items-center gap-2 rounded-xl px-3 text-sm font-medium text-app-secondary transition hover:bg-app-hover hover:text-app-text">
              <ArrowUpTrayIcon className="h-4 w-4" />
              {previewUrl ? "Cambia foto" : "Foto"}
            </label>
            {hasCompanyAccess ? (
              <button type="button" onClick={onOpenDocuments} className="touch-target inline-flex min-w-0 items-center gap-2 rounded-xl px-3 text-sm font-medium text-app-secondary transition hover:bg-app-hover hover:text-app-text">
                <DocumentTextIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">PDF: {selectedDocumentCount}</span>
              </button>
            ) : null}
          </div>
          <button type="submit" disabled={!canSubmit} className="touch-target inline-flex w-full items-center justify-center gap-2 rounded-xl bg-app-accent px-5 text-sm font-semibold text-[#062114] transition hover:bg-app-accent-bright active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-app-raised disabled:text-app-muted sm:w-auto">
            <PaperAirplaneIcon className="h-4 w-4" />
            {loading ? "Analisi in corso..." : "Analizza e rispondi"}
          </button>
        </div>
      </div>

      {error ? (
        <div role="alert" className="mt-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <strong className="font-medium">Analisi non completata.</strong> {error}
        </div>
      ) : null}
    </form>
  );
}
