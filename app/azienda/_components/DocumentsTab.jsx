import { useCallback, useEffect, useState } from "react";
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";

import { documentsApi } from "../../lib/api";
import { DANGER_BUTTON, ErrorNote, formatDate, GHOST_BUTTON, Loading, Section } from "./shared";

const STATUS = {
  indexed: { label: "Indicizzato", className: "text-app-accent" },
  pending: { label: "In elaborazione", className: "text-amber-300" },
  failed: { label: "Indicizzazione fallita", className: "text-red-300" },
  archived: { label: "Escluso dalla ricerca", className: "text-app-muted" },
};

function formatSize(bytes) {
  if (!bytes) return "—";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Company documents: upload (indexed right away), remove from the RAG while
 * keeping the file, put back into the RAG, delete for good.
 */
export function DocumentsTab({ token }) {
  const [documents, setDocuments] = useState(null);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const response = await documentsApi.list(token);
    if (response.ok) setDocuments(response.data);
    else setError(response.data.detail ?? "Elenco documenti non disponibile.");
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(documentId, action, failure) {
    setError(null);
    setBusyId(documentId);
    const response = await action();
    setBusyId(null);
    if (!response.ok) setError(response.data.detail ?? failure);
    await load();
  }

  async function onUpload(file) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const response = await documentsApi.upload(token, file);
    setUploading(false);
    if (!response.ok) setError(response.data.detail ?? "Caricamento non riuscito.");
    else if (response.data.status === "failed") setError(`"${file.name}" è stato caricato ma l'indicizzazione non è riuscita: puoi riprovare.`);
    await load();
  }

  return (
    <div className="space-y-6">
      <Section
        title="Documenti dell'azienda"
        description="Solo i documenti indicizzati vengono usati dall'assistente nelle chat aziendali."
        action={
          <label className={`flex cursor-pointer items-center gap-2 rounded-xl border border-app-border-strong px-3 py-2 text-xs font-medium text-app-secondary transition hover:border-app-accent/40 hover:text-app-accent ${uploading ? "pointer-events-none opacity-60" : ""}`}>
            <ArrowUpTrayIcon className="h-4 w-4" />
            {uploading ? "Caricamento e indicizzazione..." : "Carica PDF"}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              aria-label="Carica documento PDF aziendale"
              disabled={uploading}
              onChange={(event) => {
                void onUpload(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
        }
      >
        <ErrorNote>{error}</ErrorNote>
        {documents === null ? (
          <Loading />
        ) : documents.length === 0 ? (
          <p className="rounded-xl border border-dashed border-app-border-strong px-5 py-10 text-center text-sm text-app-muted">
            Nessun documento. Carica un PDF tecnico per renderlo disponibile ai dipendenti.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="px-4 py-2.5 font-medium">Documento</th>
                  <th className="px-4 py-2.5 font-medium">Stato</th>
                  <th className="px-4 py-2.5 font-medium">Caricato</th>
                  <th className="px-4 py-2.5 font-medium"><span className="sr-only">Azioni</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {documents.map((document) => {
                  const status = STATUS[document.status ?? "indexed"] ?? STATUS.indexed;
                  const busy = busyId === document.id;
                  return (
                    <tr key={document.id}>
                      <td className="px-4 py-3">
                        <span className="block break-words text-app-text">{document.filename}</span>
                        <span className="block text-xs text-app-muted">{formatSize(document.size_bytes)}</span>
                      </td>
                      <td className={`px-4 py-3 text-xs ${status.className}`}>{status.label}</td>
                      <td className="px-4 py-3 text-xs text-app-secondary">
                        {formatDate(document.created_at)}
                        {document.uploaded_by ? <span className="block text-app-muted">{document.uploaded_by}</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {document.status === "indexed" || document.status === "pending" ? (
                            <button
                              type="button"
                              className={GHOST_BUTTON}
                              disabled={busy}
                              onClick={() => void run(document.id, () => documentsApi.archive(token, document.id), "Operazione non riuscita.")}
                            >
                              Escludi dalla ricerca
                            </button>
                          ) : (
                            <button
                              type="button"
                              className={GHOST_BUTTON}
                              disabled={busy}
                              onClick={() => void run(document.id, () => documentsApi.reindex(token, document.id), "Indicizzazione non riuscita.")}
                            >
                              {busy ? "Indicizzazione..." : "Indicizza"}
                            </button>
                          )}
                          <button
                            type="button"
                            className={DANGER_BUTTON}
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm(`Eliminare definitivamente "${document.filename}"? Il file non potrà essere recuperato.`)) {
                                void run(document.id, () => documentsApi.delete(token, document.id), "Eliminazione non riuscita.");
                              }
                            }}
                          >
                            Elimina
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
