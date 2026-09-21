import { useState } from "react";
import { ChevronDownIcon, DocumentTextIcon } from "@heroicons/react/24/outline";

import { formatScore } from "../lib/format";

export function SourcesPanel({ hits, companyDocumentFilenames }) {
  return (
    <section className="border-t border-app-border pt-8" aria-labelledby="sources-title">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <DocumentTextIcon className="h-5 w-5 text-app-secondary" />
          <h3 id="sources-title" className="font-display text-lg font-semibold text-app-text">Fonti consultate</h3>
        </div>
        {hits?.length ? <span className="rounded-full bg-app-raised px-2.5 py-1 text-xs text-app-muted">{hits.length}</span> : null}
      </div>
      {hits?.length ? (
        <div className="mt-5 divide-y divide-app-border overflow-hidden rounded-xl border border-app-border">
          {hits.map((hit, index) => (
            <SourceItem key={`${hit.source}-${hit.page}-${hit.chunk_index}-${index}`} hit={hit} index={index} isCompanySource={Boolean(hit.source && companyDocumentFilenames.includes(hit.source))} />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-app-muted">Nessuna fonte documentale disponibile per questa risposta.</p>
      )}
    </section>
  );
}

function SourceItem({ hit, isCompanySource, index }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="bg-app-surface">
      <button type="button" className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-app-hover" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-app-raised text-app-secondary">
          <DocumentTextIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-app-text">{hit.source || `Fonte ${index + 1}`}</span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-app-muted">
            {isCompanySource ? <span className="text-app-accent">Documento aziendale</span> : <span>Manuale generale</span>}
            {hit.page !== undefined ? <span>Pagina {hit.page}</span> : null}
            {hit.chunk_index !== undefined ? <span>Passaggio {hit.chunk_index}</span> : null}
            {hit.score !== undefined ? <span>Rilevanza {formatScore(hit.score)}</span> : null}
          </span>
        </span>
        <ChevronDownIcon className={`h-4 w-4 shrink-0 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && hit.text ? <p className="border-t border-app-border bg-app-raised/50 px-4 py-4 text-sm leading-6 text-app-secondary">{hit.text}</p> : null}
    </article>
  );
}
