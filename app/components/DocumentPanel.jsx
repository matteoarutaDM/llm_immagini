import { useEffect, useRef } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

export function DocumentPanel({ open, onClose, children }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousActiveElement = document.activeElement;
    closeButtonRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end sm:items-stretch" role="presentation">
      <button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-label="Chiudi documenti" onClick={onClose} />
      <aside
        className="relative flex h-[min(88dvh,760px)] w-full flex-col rounded-t-[20px] border border-app-border bg-app-surface shadow-2xl shadow-black/50 sm:h-full sm:max-w-md sm:rounded-none sm:rounded-l-[20px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="documents-title"
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-app-border-strong sm:hidden" aria-hidden="true" />
        <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-app-border px-5 py-3">
          <div>
            <h2 id="documents-title" className="font-display text-base font-semibold text-app-text">Documenti aziendali</h2>
            <p className="mt-0.5 text-xs text-app-muted">Fonti disponibili per le chat aziendali.</p>
          </div>
          <button ref={closeButtonRef} type="button" className="touch-target grid place-items-center rounded-xl text-app-secondary transition hover:bg-app-hover hover:text-app-text" onClick={onClose} aria-label="Chiudi pannello documenti">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
      </aside>
    </div>
  );
}
