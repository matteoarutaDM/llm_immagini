import { useState } from "react";
import { CheckIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";

import type { AskResult } from "../types";

type Identifiers = NonNullable<AskResult["image_identifiers"]>;

export function OcrCard({ identifiers }: { identifiers?: Identifiers }) {
  return (
    <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-lg shadow-neutral-900/[0.05] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20">
      <h3 className="font-display text-lg font-semibold text-neutral-950 dark:text-neutral-50">OCR targhetta</h3>
      {identifiers?.available ? (
        <div className="mt-3 space-y-2 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            <IdentifierField label="Modello" value={identifiers.model_code} />
            <IdentifierField label="Seriale/codice letto" value={identifiers.serial_number} />
            <IdentifierField label="Asset tag" value={identifiers.asset_tag} />
          </div>
          {identifiers.visible_text?.length ? (
            identifiers.visible_text.slice(0, 8).map((line, index) => (
              <div key={`${line}-${index}`} className="rounded-xl bg-neutral-50 px-3 py-2 font-mono text-xs dark:bg-neutral-800/60 dark:text-neutral-200">
                {line}
              </div>
            ))
          ) : (
            <p className="text-neutral-600 dark:text-neutral-400">Nessun testo classificabile trovato.</p>
          )}
          {identifiers.notes ? <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-500">{identifiers.notes}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">
          OCR non disponibile: {identifiers?.error ?? "nessun dettaglio ricevuto"}.
        </p>
      )}
    </div>
  );
}

function IdentifierField({ label, value }: { label: string; value?: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; silently ignore, the
      // value is still readable and selectable on screen.
    }
  }

  return (
    <div className="flex items-start justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60">
      <div>
        <div className="text-xs uppercase text-neutral-500 dark:text-neutral-400">{label}</div>
        <div className="mt-1 font-mono font-semibold text-neutral-900 dark:text-neutral-100">{value || "n/d"}</div>
      </div>
      {value ? (
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copia ${label.toLowerCase()}`}
          className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
        >
          {copied ? <CheckIcon className="h-4 w-4 text-emerald-700 dark:text-emerald-400" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
        </button>
      ) : null}
    </div>
  );
}
