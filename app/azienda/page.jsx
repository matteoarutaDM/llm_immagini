"use client";

import { useEffect, useState } from "react";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";

import { BrandMark } from "../components/BrandMark";
import { useAuth } from "../hooks/useAuth";
import { authApi } from "../lib/api";
import { AuditTab } from "./_components/AuditTab";
import { DashboardTab } from "./_components/DashboardTab";
import { DocumentsTab } from "./_components/DocumentsTab";
import { EmployeesTab } from "./_components/EmployeesTab";

const SECTIONS = [
  { id: "panoramica", label: "Panoramica" },
  { id: "dipendenti", label: "Dipendenti" },
  { id: "documenti", label: "Documenti" },
  { id: "registro", label: "Registro attività" },
];

/**
 * Company admin area: employees, documents, statistics and activity log of
 * the admin's own company. The backend derives the company from the account,
 * so this page can never show another company's data.
 */
export default function CompanyAdminPage() {
  const auth = useAuth();
  const [state, setState] = useState("loading"); // loading | ready | forbidden | signed-out
  const [section, setSection] = useState("panoramica");

  useEffect(() => {
    // Read here rather than with useSearchParams, so the page needs no Suspense boundary.
    const requested = new URLSearchParams(window.location.search).get("sezione");
    if (SECTIONS.some((item) => item.id === requested)) setSection(requested);

    const token = auth.restoreSession();
    if (!token) {
      setState("signed-out");
      return;
    }
    void authApi.me(token).then((response) => {
      if (!response.ok) {
        auth.clearSession();
        setState("signed-out");
        return;
      }
      auth.hydrateProfile(response.data);
      const allowed = response.data.role === "company_admin" && response.data.terms_accepted !== false;
      setState(allowed ? "ready" : "forbidden");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openSection(id) {
    setSection(id);
    window.history.replaceState(null, "", `/azienda?sezione=${id}`);
  }

  if (state === "loading") {
    return <Shell><p className="py-24 text-center text-sm text-app-muted">Caricamento...</p></Shell>;
  }
  if (state !== "ready") {
    return (
      <Shell>
        <div className="mx-auto max-w-md py-24 text-center">
          <h1 className="font-display text-2xl font-semibold text-app-text">
            {state === "signed-out" ? "Accedi per continuare" : "Area riservata"}
          </h1>
          <p className="mt-3 text-sm leading-6 text-app-secondary">
            {state === "signed-out"
              ? "La sessione non è attiva."
              : "Questa sezione è disponibile solo per il responsabile dell'azienda."}
          </p>
          <a href="/" className="mt-6 inline-block text-sm font-medium text-app-accent hover:underline">Vai all'assistente</a>
        </div>
      </Shell>
    );
  }

  return (
    <Shell companyName={auth.profile?.company_name} email={auth.profile?.email}>
      <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-app-border pb-px" aria-label="Sezioni">
        {SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => openSection(item.id)}
            aria-current={section === item.id ? "page" : undefined}
            className={`touch-target shrink-0 border-b-2 px-3 text-sm transition ${
              section === item.id
                ? "border-app-accent font-medium text-app-text"
                : "border-transparent text-app-secondary hover:text-app-text"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="py-6">
        {section === "panoramica" ? <DashboardTab token={auth.token} /> : null}
        {section === "dipendenti" ? <EmployeesTab token={auth.token} /> : null}
        {section === "documenti" ? <DocumentsTab token={auth.token} /> : null}
        {section === "registro" ? <AuditTab token={auth.token} /> : null}
      </div>
    </Shell>
  );
}

function Shell({ companyName, email, children }) {
  return (
    <main className="min-h-dvh bg-app-bg text-app-text">
      <header className="border-b border-app-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <BrandMark size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">Gestione azienda{companyName ? ` · ${companyName}` : ""}</p>
            {email ? <p className="truncate text-xs text-app-muted">{email}</p> : null}
          </div>
          <a href="/" className="ml-auto flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium text-app-secondary transition hover:bg-app-hover hover:text-app-text">
            <ArrowLeftIcon className="h-4 w-4" />
            Assistente
          </a>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:px-8">{children}</div>
    </main>
  );
}
