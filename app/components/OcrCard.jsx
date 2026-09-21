import { useState } from "react";
import { CheckIcon, ClipboardDocumentIcon, IdentificationIcon } from "@heroicons/react/24/outline";

export function OcrCard({ identifiers }) {
  const fields = [
    ["Modello", identifiers?.model_code],
    ["Matricola / seriale", identifiers?.serial_number],
    ["Asset tag", identifiers?.asset_tag],
  ].filter(([, value]) => Boolean(value));

  return (
    <section className="border-t border-app-border pt-8" aria-labelledby="ocr-title">
      <div className="flex items-center gap-2">
        <IdentificationIcon className="h-5 w-5 text-app-secondary" />
        <h3 id="ocr-title" className="font-display text-lg font-semibold text-app-text">Dati targhetta</h3>
      </div>
      {identifiers?.available ? (
        <div className="mt-5">
          {fields.length ? (
            <dl className="grid gap-px overflow-hidden rounded-xl border border-app-border bg-app-border sm:grid-cols-2 lg:grid-cols-3">
              {fields.map(([label, value]) => <IdentifierField key={label} label={label} value={value} />)}
            </dl>
          ) : null}
          {identifiers.visible_text?.length ? (
            <div className="mt-4 rounded-xl bg-app-raised p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-app-muted">Testo rilevato</p>
              <div className="mt-3 space-y-1 font-mono text-xs leading-5 text-app-secondary">
                {identifiers.visible_text.slice(0, 8).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
              </div>
            </div>
          ) : null}
          {!fields.length && !identifiers.visible_text?.length ? <p className="mt-3 text-sm text-app-muted">Nessun dato leggibile trovato sulla targhetta.</p> : null}
          {identifiers.notes ? <p className="mt-3 text-xs leading-5 text-app-muted">{identifiers.notes}</p> : null}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-app-muted">OCR non disponibile{identifiers?.error ? `: ${identifiers.error}` : "."}</p>
      )}
    </section>
  );
}

function IdentifierField({ label, value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // The value remains readable and selectable if clipboard access is denied.
    }
  }

  return (
    <div className="flex min-w-0 items-start justify-between gap-2 bg-app-surface p-4">
      <div className="min-w-0">
        <dt className="text-[11px] uppercase tracking-[0.1em] text-app-muted">{label}</dt>
        <dd className="mt-1 break-all font-mono text-sm font-medium text-app-text">{value}</dd>
      </div>
      <button type="button" onClick={() => void copy()} aria-label={`Copia ${label.toLowerCase()}`} className="touch-target grid shrink-0 place-items-center rounded-xl text-app-muted transition hover:bg-app-hover hover:text-app-text">
        {copied ? <CheckIcon className="h-4 w-4 text-app-accent" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
      </button>
    </div>
  );
}
