import { useEffect } from "react";
import { CheckCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";

export function IndexNotification({ filename, onDismiss }) {
  useEffect(() => {
    if (!filename) return undefined;
    const timeout = window.setTimeout(onDismiss, 2500);
    return () => window.clearTimeout(timeout);
  }, [filename, onDismiss]);

  if (!filename) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[80] flex items-start gap-3 rounded-2xl border border-app-accent/20 bg-[#111a15] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.55)] sm:bottom-6 sm:left-auto sm:right-6 sm:w-full sm:max-w-sm"
      role="status"
      aria-live="polite"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-app-accent-soft text-app-accent">
        <CheckCircleIcon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium text-app-text">Documento indicizzato</p>
        <p className="mt-1 truncate text-xs text-app-secondary" title={filename}>{filename}</p>
      </div>
      <button type="button" onClick={onDismiss} className="touch-target -mr-2 -mt-2 grid shrink-0 place-items-center rounded-xl text-app-muted transition hover:bg-app-hover hover:text-app-text" aria-label="Chiudi notifica">
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
