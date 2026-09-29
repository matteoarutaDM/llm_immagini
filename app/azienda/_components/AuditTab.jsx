import { useEffect, useState } from "react";

import { companyApi } from "../../lib/api";
import { ErrorNote, formatDate, GHOST_BUTTON, Loading, Section } from "./shared";

const ACTION_LABELS = {
  "employee.create": "Account creato",
  "employee.block": "Dipendente sospeso",
  "employee.unblock": "Dipendente riattivato",
  "employee.reset_password": "Nuova password temporanea",
  "document.upload": "Documento caricato",
  "document.archive": "Documento escluso dalla ricerca",
  "document.reindex": "Documento indicizzato",
  "document.delete": "Documento eliminato",
  "company.create": "Azienda creata",
  "company_admin.create": "Responsabile creato",
  "user.role_change": "Ruolo modificato",
  "user.block": "Account sospeso",
  "user.unblock": "Account riattivato",
  "user.reset_password": "Nuova password temporanea",
};

/** Read-only activity log of the admin's company. */
export function AuditTab({ token }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    void companyApi.audit(token, page).then((response) => {
      if (cancelled) return;
      if (response.ok) setData(response.data);
      else setError(response.data.detail ?? "Registro non disponibile.");
    });
    return () => {
      cancelled = true;
    };
  }, [token, page]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <Section title="Registro attività" description="Chi ha fatto cosa, quando e perché. Non modificabile.">
      {data.items.length === 0 ? (
        <p className="text-sm text-app-muted">Nessuna attività registrata.</p>
      ) : (
        <ol className="divide-y divide-app-border rounded-xl border border-app-border">
          {data.items.map((entry) => (
            <li key={entry.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[10rem_1fr]">
              <span className="text-xs text-app-muted">{formatDate(entry.created_at)}</span>
              <span>
                <span className="text-app-text">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                {entry.details.email || entry.details.filename ? (
                  <span className="text-app-secondary"> · {entry.details.full_name || entry.details.email || entry.details.filename}</span>
                ) : null}
                <span className="block text-xs text-app-muted">
                  {entry.actor ?? "—"}
                  {entry.reason ? ` · Motivo: ${entry.reason}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-app-muted">
          <button type="button" className={GHOST_BUTTON} disabled={page <= 1} onClick={() => setPage(page - 1)}>Precedenti</button>
          <span>Pagina {page} di {pages}</span>
          <button type="button" className={GHOST_BUTTON} disabled={page >= pages} onClick={() => setPage(page + 1)}>Successivi</button>
        </div>
      ) : null}
    </Section>
  );
}
