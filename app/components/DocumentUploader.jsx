import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentIcon,
  TrashIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

const STATUS = {
  indexed: { label: "Indicizzato", icon: CheckCircleIcon, className: "text-app-accent" },
  pending: { label: "In elaborazione", icon: ClockIcon, className: "text-amber-300" },
  failed: { label: "Non indicizzato", icon: XCircleIcon, className: "text-red-300" },
};

export function DocumentUploader({
  documents,
  selectedDocuments,
  uploading,
  deletingId,
  deleteError,
  onToggle,
  onUpload,
  onDelete,
}) {
  return (
    <div className="flex min-h-full flex-col">
      <div className="rounded-xl border border-app-border bg-app-raised/45 p-4">
        <p className="text-sm font-medium text-app-text">Selezione per la prossima chat</p>
        <p className="mt-1 text-xs leading-5 text-app-muted">
          La casella include il PDF nella conoscenza aziendale. Il cestino elimina invece il file definitivamente.
        </p>
      </div>

      <div className="mt-5 space-y-2">
        {documents.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-app-border-strong px-5 py-10 text-center">
            <DocumentIcon className="mx-auto h-7 w-7 text-app-muted" />
            <p className="mt-3 text-sm font-medium text-app-secondary">Nessun documento aziendale</p>
            <p className="mt-1 text-xs leading-5 text-app-muted">Carica un PDF tecnico per renderlo disponibile nelle nuove chat aziendali.</p>
          </div>
        ) : (
          documents.map((document) => {
            const isDeleting = deletingId === document.id;
            const status = STATUS[document.status ?? "indexed"];
            const StatusIcon = status.icon;
            return (
              <article key={document.id} className="rounded-xl border border-app-border bg-app-raised p-3 transition hover:border-app-border-strong">
                <div className="flex items-start gap-3">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      aria-label={`Includi ${document.filename} nella prossima chat aziendale`}
                      checked={selectedDocuments.includes(document.filename)}
                      onChange={(event) => onToggle(document.filename, event.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm leading-5 text-app-text">{document.filename}</span>
                      <span className={`mt-1.5 flex items-center gap-1.5 text-[11px] ${status.className}`}>
                        <StatusIcon className="h-3.5 w-3.5" />
                        {status.label}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Rimuovi ${document.filename} dalla memoria RAG`}
                    disabled={isDeleting}
                    onClick={() => {
                      if (window.confirm(`Rimuovere definitivamente "${document.filename}" dalla memoria RAG?`)) onDelete(document);
                    }}
                    className="touch-target grid shrink-0 place-items-center rounded-xl text-app-muted transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {deleteError ? <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">{deleteError}</p> : null}

      <label className="touch-target mt-5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-app-border-strong bg-app-raised px-4 text-sm font-medium text-app-secondary transition hover:border-app-accent/40 hover:bg-app-accent-soft hover:text-app-accent">
        <ArrowUpTrayIcon className="h-4 w-4" />
        {uploading ? "Caricamento e indicizzazione..." : "Carica un nuovo PDF"}
        <input
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={(event) => onUpload(event.target.files?.[0] ?? null)}
          className="sr-only"
          aria-label="Carica documento PDF aziendale"
        />
      </label>
      {uploading ? <p className="mt-2 text-center text-xs text-app-muted">Il pannello può restare aperto durante l’indicizzazione.</p> : null}
    </div>
  );
}
