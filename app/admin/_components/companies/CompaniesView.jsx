"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, UserPlusIcon } from "@heroicons/react/24/outline";

import { companiesApi } from "../../_lib/api";
import { formatNumber, formatRelative } from "../../_lib/format";
import { useQueryFilters } from "../../_hooks/useQueryFilters";
import { useResource } from "../../_hooks/useResource";
import { useCompanyScope } from "../shell/CompanyScope";
import { useOperator } from "../shell/OperatorProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DataTable } from "../ui/DataTable";
import { FilterBar, SearchInput } from "../ui/Filters";
import { Modal } from "../ui/Modal";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";
import { useToast } from "../ui/Toast";
import { TemporaryPasswordModal } from "./TemporaryPasswordModal";

const DEFAULT_FILTERS = { q: "", page: "1" };
const INPUT = "h-10 w-full rounded-xl border border-app-border-strong bg-app-raised px-3 text-sm text-app-text outline-none focus:border-app-accent/60";

const COLUMNS = [
  {
    key: "company",
    header: "Azienda",
    render: (company) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-app-text">{company.name}</p>
        <p className="truncate text-xs text-app-muted">{company.domain}</p>
      </div>
    ),
  },
  { key: "people", header: "Persone", render: (company) => <span className="tabular-nums">{formatNumber(company.people)}</span> },
  {
    key: "admins",
    header: "Responsabili",
    render: (company) =>
      company.admins ? <span className="tabular-nums">{company.admins}</span> : <span className="text-amber-300">Nessuno</span>,
  },
  { key: "documents", header: "Documenti", render: (company) => <span className="tabular-nums">{formatNumber(company.indexedDocuments)}</span>, hideBelow: "md" },
  { key: "analyses", header: "Analisi 30 gg", render: (company) => <span className="tabular-nums">{formatNumber(company.analyses30d)}</span>, hideBelow: "sm" },
  { key: "created", header: "Creata", render: (company) => <span className="whitespace-nowrap text-xs">{formatRelative(company.createdAt)}</span>, hideBelow: "lg" },
];

export function CompaniesView() {
  const { can } = useOperator();
  const { filters, setFilters, key } = useQueryFilters(DEFAULT_FILTERS);
  const { data, error, loading, reload } = useResource((signal) => companiesApi.list(filters, signal), `companies:${key}`);
  const [creating, setCreating] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [credentials, setCredentials] = useState(null); // { email, password, next? }
  const router = useRouter();

  function closeCredentials() {
    const next = credentials?.next;
    setCredentials(null);
    if (next) router.push(next);
  }

  return (
    <>
      <PageHeader
        title="Aziende"
        description="Aziende clienti, i loro responsabili e l'attività"
        actions={
          can("companies:manage") ? (
            <>
              <Button icon={UserPlusIcon} onClick={() => setCreatingAdmin(true)}>Nuovo responsabile</Button>
              <Button variant="primary" icon={PlusIcon} onClick={() => setCreating(true)}>Nuova azienda</Button>
            </>
          ) : null
        }
      />
      <Card>
        <FilterBar>
          <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Nome o dominio" label="Cerca aziende" />
        </FilterBar>
        <DataTable
          caption="Elenco aziende"
          columns={COLUMNS}
          rows={data?.items}
          getRowKey={(company) => company.id}
          rowHref={(company) => `/admin/companies/${company.id}`}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="Nessuna azienda"
        />
        {data ? <Pagination {...data} onPageChange={(page) => setFilters({ page: String(page) })} /> : null}
      </Card>
      <CreateCompanyModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={({ company, credentials: created }) => {
          setCreating(false);
          reload();
          if (created) setCredentials({ ...created, next: `/admin/companies/${company.id}` });
          else router.push(`/admin/companies/${company.id}`);
        }}
      />
      <CreateAdminModal
        open={creatingAdmin}
        onClose={() => setCreatingAdmin(false)}
        onCreated={(created) => {
          setCreatingAdmin(false);
          setCredentials(created);
          reload();
        }}
      />
      <TemporaryPasswordModal credentials={credentials} onClose={closeCredentials} />
    </>
  );
}

function CreateCompanyModal({ open, onClose, onCreated }) {
  const notify = useToast();
  const { reloadCompanies } = useCompanyScope();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError(null);
    let company;
    try {
      company = await companiesApi.create({ name, domain });
    } catch (apiError) {
      setError(apiError.message);
      setPending(false);
      return;
    }
    void reloadCompanies();
    let credentials = null;
    if (adminEmail.trim()) {
      try {
        const result = await companiesApi.createAccount(company.id, { email: adminEmail, fullName: adminName, role: "company_admin" });
        credentials = { email: result.user.email, password: result.temporaryPassword };
      } catch (apiError) {
        // The company exists: report the admin problem and let the operator retry from the company page.
        notify({ tone: "error", message: `Azienda creata, ma il responsabile no: ${apiError.message}` });
      }
    }
    notify({ message: `Azienda ${company.name} creata.` });
    setName("");
    setDomain("");
    setAdminEmail("");
    setAdminName("");
    setPending(false);
    onCreated({ company, credentials });
  }

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title="Nuova azienda"
      description="Il dominio identifica l'azienda e la cartella dei suoi documenti."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Annulla</Button>
          <Button variant="primary" type="submit" form="create-company" loading={pending}>Crea azienda</Button>
        </>
      }
    >
      <form id="create-company" className="space-y-3" onSubmit={submit}>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Nome</span>
          <input data-autofocus className={`${INPUT} mt-1`} value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme S.p.A." required />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Dominio</span>
          <input className={`${INPUT} mt-1`} value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="acme.it" required />
        </label>
        <fieldset className="space-y-3 rounded-xl border border-app-border p-3">
          <legend className="px-1 text-xs font-medium text-app-secondary">Responsabile (facoltativo, puoi aggiungerlo dopo)</legend>
          <input type="email" className={INPUT} value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} placeholder="Email del responsabile" />
          <input className={INPUT} value={adminName} onChange={(event) => setAdminName(event.target.value)} placeholder="Nome e cognome" />
        </fieldset>
        {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}

/** New company admin for an existing company, chosen from the list. */
function CreateAdminModal({ open, onClose, onCreated }) {
  const { companies, companyId: scopedCompany } = useCompanyScope();
  const [companyId, setCompanyId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const selected = companyId || scopedCompany || "";

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await companiesApi.createAccount(selected, { email, fullName, role: "company_admin" });
      setEmail("");
      setFullName("");
      onCreated({ email: result.user.email, password: result.temporaryPassword });
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={pending ? () => {} : onClose}
      title="Nuovo responsabile"
      description="Il responsabile potrà registrare i dipendenti, gestire i documenti e vedere le statistiche della sua azienda."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Annulla</Button>
          <Button variant="primary" type="submit" form="create-admin" loading={pending} disabled={!selected}>Crea responsabile</Button>
        </>
      }
    >
      <form id="create-admin" className="space-y-3" onSubmit={submit}>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Azienda</span>
          <select data-autofocus className={`${INPUT} mt-1`} value={selected} onChange={(event) => setCompanyId(event.target.value)} required>
            <option value="" disabled>Scegli l&apos;azienda</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>{company.name} ({company.domain})</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Email</span>
          <input type="email" className={`${INPUT} mt-1`} value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Nome e cognome</span>
          <input className={`${INPUT} mt-1`} value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
