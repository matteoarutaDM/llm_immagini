"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BuildingOffice2Icon } from "@heroicons/react/24/outline";

import { companiesApi } from "../../_lib/api";

const STORAGE_KEY = "bo-company-scope";
const CompanyScopeContext = createContext(null);

function readStored() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * Backoffice-wide company filter: pick a company once and dashboard, analyses,
 * users, documents and activity log all show only that company. The choice is
 * a per-browser convenience (localStorage); the server applies the filter.
 */
export function CompanyScopeProvider({ children }) {
  const [companyId, setCompanyIdState] = useState(null);
  const [companies, setCompanies] = useState([]);

  const reloadCompanies = useCallback(async () => {
    try {
      const page = await companiesApi.list({ pageSize: 100 });
      setCompanies(page.items);
      return page.items;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const stored = readStored();
    void reloadCompanies().then((items) => {
      // A company deleted since the last visit falls back to "every company".
      if (stored && items?.some((item) => item.id === stored)) setCompanyIdState(stored);
    });
  }, [reloadCompanies]);

  const setCompanyId = useCallback((id) => {
    setCompanyIdState(id || null);
    try {
      if (id) window.localStorage.setItem(STORAGE_KEY, id);
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Private mode or blocked storage: the filter still works for this visit.
    }
  }, []);

  const value = useMemo(
    () => ({
      companyId,
      company: companies.find((item) => item.id === companyId) ?? null,
      companies,
      setCompanyId,
      reloadCompanies,
    }),
    [companyId, companies, setCompanyId, reloadCompanies],
  );
  return <CompanyScopeContext.Provider value={value}>{children}</CompanyScopeContext.Provider>;
}

export function useCompanyScope() {
  const scope = useContext(CompanyScopeContext);
  if (!scope) throw new Error("useCompanyScope must be used inside <CompanyScopeProvider>");
  return scope;
}

export function CompanySelector() {
  const { companyId, companies, setCompanyId } = useCompanyScope();
  return (
    <label className="flex min-w-0 items-center gap-2 rounded-xl border border-app-border bg-app-surface px-2.5 text-xs text-app-secondary focus-within:border-app-accent/50">
      <BuildingOffice2Icon className="h-4 w-4 shrink-0 text-app-muted" aria-hidden="true" />
      <span className="sr-only">Filtra per azienda</span>
      <select
        value={companyId ?? ""}
        onChange={(event) => setCompanyId(event.target.value || null)}
        className={`h-9 min-w-0 max-w-[14rem] bg-transparent text-sm outline-none ${companyId ? "font-medium text-app-accent" : "text-app-text"}`}
      >
        <option value="">Tutte le aziende</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name} ({company.domain})
          </option>
        ))}
      </select>
    </label>
  );
}
