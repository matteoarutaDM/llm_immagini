"use client";

import { useEffect, useState } from "react";
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { SEARCH_MAX_LENGTH } from "../../_lib/constants";
import { useDebouncedValue } from "../../_hooks/useDebouncedValue";

const FIELD_CLASS =
  "h-10 rounded-xl border border-app-border-strong bg-app-raised text-sm text-app-text outline-none transition hover:border-white/20 focus:border-app-accent/60 focus:ring-4 focus:ring-app-accent/10";

/** Horizontal filter row that wraps on small screens. */
export function FilterBar({ children }) {
  return <div className="flex flex-col gap-2 border-b border-app-border p-4 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

/**
 * Search box with local state and debounced propagation, so typing does not
 * fire one request per keystroke. Syncs back when the URL value changes.
 */
export function SearchInput({ value, onChange, placeholder, label = "Cerca" }) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebouncedValue(draft, 350);

  // Adopt external changes (back button, reset) without clobbering the draft
  // the operator is still typing (e.g. a trailing space).
  useEffect(() => {
    setDraft((current) => (current.trim() === value ? current : value));
  }, [value]);
  useEffect(() => {
    if (debounced.trim() !== value) onChange(debounced.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <label className="relative block min-w-0 sm:w-80">
      <span className="sr-only">{label}</span>
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-app-muted" aria-hidden="true" />
      <input
        type="search"
        value={draft}
        maxLength={SEARCH_MAX_LENGTH}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        className={`${FIELD_CLASS} w-full pl-9 pr-9 placeholder:text-app-muted [&::-webkit-search-cancel-button]:hidden`}
      />
      {draft ? (
        <button
          type="button"
          onClick={() => setDraft("")}
          className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-app-muted hover:bg-app-hover hover:text-app-text"
          aria-label="Cancella ricerca"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      ) : null}
    </label>
  );
}

/** @param {{ label: string, value: string, onChange: (value: string) => void, options: { value: string, label: string }[], allLabel?: string }} props */
export function SelectFilter({ label, value, onChange, options, allLabel = "Tutti" }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${FIELD_CLASS} w-full px-3 pr-8 sm:w-auto`}>
        <option value="">
          {label}: {allLabel}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Segmented status toggles with counters (horizontally scrollable on mobile). */
export function FilterTabs({ value, onChange, options }) {
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtra per stato">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition ${
              active ? "bg-app-accent-soft text-app-accent" : "text-app-secondary hover:bg-app-hover hover:text-app-text"
            }`}
          >
            {option.label}
            {typeof option.count === "number" ? (
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] tabular-nums ${active ? "bg-app-accent/15" : "bg-white/5 text-app-muted"}`}>
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
