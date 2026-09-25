import { useState } from "react";
import { ChevronDownIcon, ClockIcon, DocumentTextIcon, PhotoIcon } from "@heroicons/react/24/outline";

import { DEFAULT_QUESTION } from "../hooks/useAsk";
import { ListenButton } from "./ListenButton";

/** From here the recognition is shown as solid (green); below it, as uncertain (amber). */
const HIGH_CONFIDENCE = 0.85;

const MAX_SOURCES = 6;

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date, now = new Date()) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return "Oggi";
  if (dayKey(date) === dayKey(yesterday)) return "Ieri";
  return date.toLocaleDateString("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Entries arrive newest first: consecutive entries of the same day form a group. */
function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const date = new Date(entry.created_at);
    const key = dayKey(date);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.entries.push(entry);
    else groups.push({ key, label: dayLabel(date), entries: [entry] });
  }
  return groups;
}

/** Past searches of the chat as cards: photo, machine, confidence and answer, expandable. */
export function AnalysisHistory({ entries, token }) {
  if (!entries.length) return null;
  return (
    <section className="mt-12 pb-10" aria-labelledby="history-title">
      <div className="flex items-center gap-2">
        <ClockIcon className="h-5 w-5 text-app-secondary" />
        <h2 id="history-title" className="font-display text-lg font-semibold text-app-text">
          Ricerche precedenti
        </h2>
        <span className="rounded-full bg-app-raised px-2.5 py-1 text-xs text-app-muted">{entries.length}</span>
      </div>

      {groupByDay(entries).map((group) => (
        <div key={group.key} className="mt-6">
          <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
            {group.label}
            <span className="h-px flex-1 bg-app-border" />
          </p>
          <ol className="mt-3 space-y-3">
            {group.entries.map((entry) => (
              <li key={entry.id} className="animate-history-enter">
                <HistoryCard entry={entry} token={token} />
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function HistoryCard({ entry, token }) {
  const [open, setOpen] = useState(false);
  const recognized = entry.status === "recognized";
  const text = entry.answer || entry.reason || "Nessuna risposta disponibile.";
  const question = entry.question === DEFAULT_QUESTION ? "Analisi generale della foto" : entry.question;
  const time = new Date(entry.created_at).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const bodyId = `history-${entry.id}`;

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-app-surface/80 transition ${
        open ? "border-app-border-strong" : "border-app-border hover:border-app-border-strong hover:bg-app-surface"
      } ${recognized ? "" : "opacity-80"}`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-start gap-4 p-3 text-left sm:p-4"
      >
        <Thumbnail src={entry.thumbnail} recognized={recognized} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-3">
            <span className="font-display truncate text-base font-semibold text-app-text">
              {entry.machine_name ?? (entry.status === "failed" ? "Analisi non riuscita" : "Macchina non riconosciuta")}
            </span>
            <time dateTime={entry.created_at} className="shrink-0 pt-0.5 text-xs tabular-nums text-app-muted">
              {time}
            </time>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-app-muted">
            <StatusBadge entry={entry} />
            {entry.machine_type ? <span>{entry.machine_type}</span> : null}
          </span>
          <span className={`mt-2 block text-sm text-app-secondary ${open ? "" : "line-clamp-1"}`}>“{question}”</span>
          {open ? null : <span className="mt-1 line-clamp-2 block text-sm leading-6 text-app-muted">{text}</span>}
        </span>
        <ChevronDownIcon className={`mt-1 h-4 w-4 shrink-0 text-app-muted transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div id={bodyId} className="border-t border-app-border px-4 pb-5 pt-4 sm:px-5">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">
              {entry.answer ? "Risposta" : "Esito"}
            </p>
            {entry.answer ? <ListenButton key={entry.answer} text={entry.answer} token={token} className="ml-auto" /> : null}
          </div>
          <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-[#d5dad7]">{text}</p>
          <Sources sources={entry.sources} />
        </div>
      ) : null}
    </article>
  );
}

function Thumbnail({ src, recognized }) {
  const box = "h-16 w-16 shrink-0 rounded-xl sm:h-20 sm:w-20";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- small data URL, next/image adds nothing here
    return <img src={src} alt="" className={`${box} border border-app-border object-cover`} />;
  }
  return (
    <span className={`${box} grid place-items-center ${recognized ? "bg-app-accent-soft text-app-accent" : "bg-app-raised text-app-muted"}`}>
      <PhotoIcon className="h-6 w-6" />
    </span>
  );
}

function StatusBadge({ entry }) {
  if (entry.status === "failed") return <Badge dot="bg-[var(--danger)]" label="Errore" />;
  if (entry.status !== "recognized") return <Badge dot="bg-[var(--info)]" label="Non riconosciuta" />;
  const score = entry.vision_score;
  if (typeof score !== "number") return <Badge dot="bg-app-accent" label="Riconosciuta" />;
  return (
    <Badge
      dot={score >= HIGH_CONFIDENCE ? "bg-app-accent shadow-[0_0_8px_var(--accent)]" : "bg-[var(--warning)]"}
      label={`Confidenza ${Math.round(score * 100)}%`}
    />
  );
}

function Badge({ dot, label }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-app-secondary">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function Sources({ sources }) {
  const unique = [];
  for (const source of sources ?? []) {
    if (!source.source) continue;
    if (unique.some((item) => item.source === source.source && item.page === source.page)) continue;
    unique.push(source);
  }
  if (!unique.length) return null;
  return (
    <ul className="mt-5 flex flex-wrap gap-2" aria-label="Fonti consultate">
      {unique.slice(0, MAX_SOURCES).map((source) => (
        <li
          key={`${source.source}-${source.page}`}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-app-border bg-app-raised px-2.5 py-1 text-xs text-app-secondary"
        >
          <DocumentTextIcon className="h-3.5 w-3.5 shrink-0 text-app-muted" />
          <span className="truncate">{source.source}</span>
          {source.page !== null && source.page !== undefined ? <span className="shrink-0 text-app-muted">p. {source.page}</span> : null}
        </li>
      ))}
      {unique.length > MAX_SOURCES ? (
        <li className="rounded-full px-2.5 py-1 text-xs text-app-muted">+{unique.length - MAX_SOURCES}</li>
      ) : null}
    </ul>
  );
}
