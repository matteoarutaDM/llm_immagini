import { useEffect, useState } from "react";

import { companyApi } from "../../lib/api";
import { displayNameFromEmail } from "../../lib/format";
import { ErrorNote, formatDate, Loading, Section } from "./shared";

const PERIODS = [7, 30, 90];

/** Company statistics only: counts and rates, never the text of questions or answers. */
export function DashboardTab({ token }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void companyApi.dashboard(token, days).then((response) => {
      if (cancelled) return;
      if (response.ok) setData(response.data);
      else setError(response.data.detail ?? "Statistiche non disponibili.");
    });
    return () => {
      cancelled = true;
    };
  }, [token, days]);

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data) return <Loading />;

  const { analyses, employees, documents } = data;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Periodo">
        {PERIODS.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setDays(value)}
            aria-pressed={days === value}
            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
              days === value
                ? "border-app-accent/40 bg-app-accent-soft text-app-accent"
                : "border-app-border text-app-secondary hover:text-app-text"
            }`}
          >
            Ultimi {value} giorni
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Analisi" value={analyses.total} note={`${analyses.with_company_documents} con documenti aziendali`} />
        <Stat
          label="Macchine riconosciute"
          value={analyses.recognition_rate === null ? "—" : `${Math.round(analyses.recognition_rate * 100)}%`}
          note={`${analyses.recognized} su ${analyses.total}`}
        />
        <Stat
          label="Dipendenti attivi nel periodo"
          value={employees.active_in_period}
          note={`${employees.active} attivi, ${employees.blocked} sospesi`}
        />
        <Stat
          label="Documenti indicizzati"
          value={documents.indexed}
          note={`${documents.archived} esclusi dalla ricerca${documents.failed ? `, ${documents.failed} con errori` : ""}`}
        />
      </div>

      <Section title="Analisi al giorno" description={`Ultimi ${data.days} giorni. Passa sopra una barra per i dettagli.`}>
        <DailyChart daily={data.daily} />
      </Section>

      <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <Section title="Macchine più analizzate">
          {data.top_machines.length ? (
            <ol className="divide-y divide-app-border rounded-xl border border-app-border">
              {data.top_machines.map((item) => (
                <li key={item.machine_name} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span className="truncate text-app-text">{item.machine_name}</span>
                  <span className="tabular-nums text-app-secondary">{item.analyses}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-app-muted">Nessuna macchina riconosciuta nel periodo.</p>
          )}
        </Section>

        <Section title="Attività per dipendente" description="Solo conteggi: il contenuto delle domande non è visibile.">
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="px-4 py-2.5 font-medium">Persona</th>
                  <th className="px-4 py-2.5 text-right font-medium">Analisi</th>
                  <th className="px-4 py-2.5 text-right font-medium">Riconosciute</th>
                  <th className="px-4 py-2.5 font-medium">Ultima analisi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {data.per_employee.map((person) => (
                  <tr key={person.id}>
                    <td className="px-4 py-2.5">
                      <span className="block text-app-text">{person.full_name || displayNameFromEmail(person.email)}</span>
                      <span className="block text-xs text-app-muted">{person.email}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{person.analyses}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-app-secondary">{person.recognized}</td>
                    <td className="px-4 py-2.5 text-xs text-app-secondary">{formatDate(person.last_analysis_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="rounded-xl border border-app-border bg-app-surface p-4">
      <p className="text-xs text-app-muted">{label}</p>
      <p className="font-display mt-2 text-3xl font-semibold tabular-nums text-app-text">{value}</p>
      {note ? <p className="mt-1 text-xs text-app-secondary">{note}</p> : null}
    </div>
  );
}

/**
 * One series (analyses per day), so no legend: the section title names it.
 * Hovering a day shows its numbers (recognized ones included); a visually
 * hidden table carries the same data for screen readers.
 */
function DailyChart({ daily }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(1, ...daily.map((day) => day.total));
  const active = hovered === null ? null : daily[hovered];

  return (
    <div className="rounded-xl border border-app-border bg-app-surface p-4">
      <div className="mb-2 flex h-5 items-center justify-between text-xs">
        <span className="text-app-muted">max {max}</span>
        <span className="text-app-secondary" aria-live="polite">
          {active ? `${formatDay(active.day)}: ${active.total} analisi, ${active.recognized} riconosciute` : ""}
        </span>
      </div>
      <div className="flex h-40 items-end gap-[2px] border-b border-app-border-strong" aria-hidden="true">
        {daily.map((day, index) => {
          const height = (day.total / max) * 100;
          return (
            <div
              key={day.day}
              className="group flex h-full min-w-0 flex-1 cursor-default items-end"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className={`w-full rounded-t-[4px] transition-opacity ${hovered !== null && hovered !== index ? "opacity-50" : ""}`}
                style={{ height: `${height}%`, minHeight: day.total ? 2 : 0, background: "var(--chart-series)" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-app-muted">
        <span>{formatDay(daily[0]?.day)}</span>
        <span>{formatDay(daily[daily.length - 1]?.day)}</span>
      </div>
      <table className="sr-only">
        <caption>Analisi al giorno</caption>
        <thead>
          <tr><th>Giorno</th><th>Analisi</th><th>Riconosciute</th></tr>
        </thead>
        <tbody>
          {daily.map((day) => (
            <tr key={day.day}><td>{formatDay(day.day)}</td><td>{day.total}</td><td>{day.recognized}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatDay(isoDay) {
  if (!isoDay) return "";
  const [, month, day] = isoDay.split("-");
  return `${day}/${month}`;
}
