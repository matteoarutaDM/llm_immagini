import { useCallback, useEffect, useState } from "react";
import { UserPlusIcon } from "@heroicons/react/24/outline";

import { companyApi } from "../../lib/api";
import { displayNameFromEmail } from "../../lib/format";
import { BUTTON, DANGER_BUTTON, ErrorNote, formatDate, GHOST_BUTTON, INPUT, Loading, PasswordReveal, Section } from "./shared";

export function EmployeesTab({ token }) {
  const [employees, setEmployees] = useState(null);
  const [error, setError] = useState(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [revealed, setRevealed] = useState(null); // { email, password }

  const load = useCallback(async () => {
    const response = await companyApi.employees(token);
    if (response.ok) setEmployees(response.data);
    else setError(response.data.detail ?? "Elenco dipendenti non disponibile.");
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event) {
    event.preventDefault();
    setError(null);
    setCreating(true);
    const response = await companyApi.createEmployee(token, email.trim(), fullName.trim());
    setCreating(false);
    if (!response.ok || !response.data.temporary_password) {
      setError(response.data.detail ?? "Creazione non riuscita.");
      return;
    }
    setRevealed({ email: response.data.employee?.email ?? email, password: response.data.temporary_password });
    setEmail("");
    setFullName("");
    await load();
  }

  async function onToggleStatus(employee) {
    setError(null);
    let reason = "";
    if (employee.status === "active") {
      reason = window.prompt(`Motivo della sospensione di ${employee.email}:`) ?? "";
      if (!reason.trim()) return;
    }
    setBusyId(employee.id);
    const response = await companyApi.setEmployeeStatus(
      token, employee.id, employee.status === "active" ? "blocked" : "active", reason.trim(),
    );
    setBusyId(null);
    if (!response.ok) setError(response.data.detail ?? "Operazione non riuscita.");
    await load();
  }

  async function onResetPassword(employee) {
    if (!window.confirm(`Generare una nuova password temporanea per ${employee.email}? Quella attuale smetterà di funzionare.`)) return;
    setError(null);
    setBusyId(employee.id);
    const response = await companyApi.resetEmployeePassword(token, employee.id);
    setBusyId(null);
    if (!response.ok || !response.data.temporary_password) {
      setError(response.data.detail ?? "Operazione non riuscita.");
      return;
    }
    setRevealed({ email: employee.email, password: response.data.temporary_password });
    await load();
  }

  return (
    <div className="space-y-8">
      <Section title="Nuovo dipendente" description="L'account riceve una password temporanea, che la persona potrà cambiare dal suo profilo.">
        <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={onCreate}>
          <input className={INPUT} type="email" placeholder="Email di lavoro" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <input className={INPUT} type="text" placeholder="Nome e cognome" value={fullName} onChange={(event) => setFullName(event.target.value)} />
          <button className={BUTTON} type="submit" disabled={creating}>
            <span className="flex items-center justify-center gap-2">
              <UserPlusIcon className="h-4 w-4" />
              {creating ? "Creazione..." : "Crea account"}
            </span>
          </button>
        </form>
      </Section>

      {revealed ? <PasswordReveal email={revealed.email} password={revealed.password} onClose={() => setRevealed(null)} /> : null}
      <ErrorNote>{error}</ErrorNote>

      <Section title="Persone dell'azienda">
        {employees === null ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="px-4 py-2.5 font-medium">Persona</th>
                  <th className="px-4 py-2.5 font-medium">Stato</th>
                  <th className="px-4 py-2.5 text-right font-medium">Analisi</th>
                  <th className="px-4 py-2.5 font-medium">Ultimo accesso</th>
                  <th className="px-4 py-2.5 font-medium"><span className="sr-only">Azioni</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {employees.map((employee) => {
                  const isAdmin = employee.role === "company_admin";
                  const busy = busyId === employee.id;
                  return (
                    <tr key={employee.id}>
                      <td className="px-4 py-3">
                        <span className="block text-app-text">{employee.full_name || displayNameFromEmail(employee.email)}</span>
                        <span className="block text-xs text-app-muted">{employee.email}</span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isAdmin ? <span className="text-app-accent">Responsabile</span> : null}
                        {!isAdmin && employee.status === "blocked" ? (
                          <span className="text-red-300" title={employee.status_reason ?? undefined}>Sospeso</span>
                        ) : null}
                        {!isAdmin && employee.status === "active" ? <span className="text-app-secondary">Attivo</span> : null}
                        {employee.password_is_temporary ? <span className="block text-amber-300">Password temporanea</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{employee.analyses_count}</td>
                      <td className="px-4 py-3 text-xs text-app-secondary">{formatDate(employee.last_login_at)}</td>
                      <td className="px-4 py-3">
                        {isAdmin ? null : (
                          <div className="flex justify-end gap-2">
                            <button type="button" className={GHOST_BUTTON} disabled={busy} onClick={() => void onResetPassword(employee)}>
                              Nuova password
                            </button>
                            <button
                              type="button"
                              className={employee.status === "active" ? DANGER_BUTTON : GHOST_BUTTON}
                              disabled={busy}
                              onClick={() => void onToggleStatus(employee)}
                            >
                              {employee.status === "active" ? "Sospendi" : "Riattiva"}
                            </button>
                          </div>
                        )}
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
