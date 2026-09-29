"use client";

import { useState } from "react";
import { FunnelIcon, KeyIcon, UserPlusIcon } from "@heroicons/react/24/outline";

import { companiesApi, usersApi } from "../../_lib/api";
import { USER_ROLE_LABELS } from "../../_lib/constants";
import { displayNameFromEmail, formatNumber, formatRelative } from "../../_lib/format";
import { useResource } from "../../_hooks/useResource";
import { useCompanyScope } from "../shell/CompanyScope";
import { useOperator } from "../shell/OperatorProvider";
import { Badge, UserStatusBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DataTable } from "../ui/DataTable";
import { Modal } from "../ui/Modal";
import { PageHeader } from "../ui/PageHeader";
import { ErrorState } from "../ui/States";
import { useToast } from "../ui/Toast";
import { TemporaryPasswordModal } from "./TemporaryPasswordModal";

const INPUT = "h-10 w-full rounded-xl border border-app-border-strong bg-app-raised px-3 text-sm text-app-text outline-none focus:border-app-accent/60";

export function CompanyDetailView({ companyId }) {
  const { can } = useOperator();
  const notify = useToast();
  const { data, error, loading, reload } = useResource((signal) => companiesApi.get(companyId, signal), `company:${companyId}`);
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState(null); // { email, password }
  const [pendingAction, setPendingAction] = useState(null); // { type: "role" | "password", account }
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState(null);
  const canManage = can("companies:manage");
  const scope = useCompanyScope();

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading || !data) return <p className="py-12 text-center text-sm text-app-muted">Caricamento...</p>;

  async function runAction() {
    if (!pendingAction) return;
    const { type, account } = pendingAction;
    setActionPending(true);
    setActionError(null);
    try {
      if (type === "role") {
        const role = account.role === "company_admin" ? "employee" : "company_admin";
        await usersApi.setRole(account.id, role);
        notify({ message: role === "company_admin" ? `${account.email} ora è responsabile.` : `${account.email} ora è dipendente.` });
      } else {
        const result = await usersApi.resetPassword(account.id);
        setCredentials({ email: result.email, password: result.temporaryPassword });
      }
      setPendingAction(null);
      reload();
    } catch (apiError) {
      setActionError(apiError.message);
    } finally {
      setActionPending(false);
    }
  }

  const columns = [
    {
      key: "person",
      header: "Persona",
      render: (account) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-app-text">{account.fullName || displayNameFromEmail(account.email)}</p>
          <p className="truncate text-xs text-app-muted">{account.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Ruolo",
      render: (account) => (
        <Badge tone={account.role === "company_admin" ? "success" : "neutral"}>{USER_ROLE_LABELS[account.role] ?? account.role}</Badge>
      ),
    },
    { key: "status", header: "Stato", render: (account) => <UserStatusBadge status={account.status} />, hideBelow: "sm" },
    {
      key: "onboarding",
      header: "Primo accesso",
      render: (account) => (
        <span className="text-xs">
          {account.termsAccepted ? "Completato" : <span className="text-amber-300">Da fare</span>}
          {account.passwordIsTemporary ? <span className="block text-app-muted">password temporanea</span> : null}
        </span>
      ),
      hideBelow: "md",
    },
    { key: "analyses", header: "Analisi", render: (account) => <span className="tabular-nums">{formatNumber(account.analyses)}</span>, hideBelow: "lg" },
    { key: "login", header: "Ultimo accesso", render: (account) => <span className="whitespace-nowrap text-xs">{formatRelative(account.lastLoginAt)}</span>, hideBelow: "lg" },
    ...(canManage
      ? [
          {
            key: "actions",
            header: <span className="sr-only">Azioni</span>,
            render: (account) => (
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" icon={KeyIcon} onClick={() => { setActionError(null); setPendingAction({ type: "password", account }); }}>
                  Nuova password
                </Button>
                <Button size="sm" onClick={() => { setActionError(null); setPendingAction({ type: "role", account }); }}>
                  {account.role === "company_admin" ? "Rendi dipendente" : "Nomina responsabile"}
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={data.name}
        description={`${data.domain} · ${data.accounts.length} persone · ${data.documents.indexed} documenti indicizzati`}
        back={{ href: "/admin/companies", label: "Aziende" }}
        actions={
          <>
            <Button
              icon={FunnelIcon}
              variant={scope.companyId === data.id ? "primary" : "secondary"}
              onClick={() => scope.setCompanyId(scope.companyId === data.id ? null : data.id)}
            >
              {scope.companyId === data.id ? "Filtro attivo: togli" : "Mostra solo questa azienda"}
            </Button>
            {canManage ? <Button variant="primary" icon={UserPlusIcon} onClick={() => setCreating(true)}>Nuovo account</Button> : null}
          </>
        }
      />
      {!data.accounts.some((account) => account.role === "company_admin") ? (
        <p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          L&apos;azienda non ha ancora un responsabile: crealo con «Nuovo account» per permettergli di registrare i dipendenti.
        </p>
      ) : null}
      <Card>
        <CardHeader title="Account" description="Il responsabile crea i dipendenti dal sito; da qui puoi creare, promuovere o reimpostare qualsiasi account." />
        <DataTable
          caption={`Account di ${data.name}`}
          columns={columns}
          rows={data.accounts}
          getRowKey={(account) => account.id}
          rowHref={(account) => `/admin/users/${account.id}`}
          emptyTitle="Nessun account"
        />
      </Card>

      <CreateAccountModal
        open={creating}
        companyId={companyId}
        hasAdmin={data.accounts.some((account) => account.role === "company_admin")}
        onClose={() => setCreating(false)}
        onCreated={(result) => {
          setCreating(false);
          setCredentials({ email: result.user.email, password: result.temporaryPassword });
          reload();
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={
          pendingAction?.type === "password"
            ? `Nuova password per ${pendingAction.account.email}?`
            : pendingAction?.account.role === "company_admin"
              ? `Revocare il ruolo di responsabile a ${pendingAction?.account.email}?`
              : `Nominare ${pendingAction?.account.email} responsabile?`
        }
        description={
          pendingAction?.type === "password"
            ? "La password attuale smette di funzionare e tutte le sessioni dell'account vengono chiuse."
            : "Il responsabile crea i dipendenti, gestisce i documenti e vede le statistiche dell'azienda."
        }
        confirmLabel={pendingAction?.type === "password" ? "Genera password" : "Conferma"}
        pending={actionPending}
        error={actionError}
        onConfirm={() => void runAction()}
        onClose={() => setPendingAction(null)}
      />
      <TemporaryPasswordModal credentials={credentials} onClose={() => setCredentials(null)} />
    </>
  );
}

function CreateAccountModal({ open, companyId, hasAdmin, onClose, onCreated }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState(hasAdmin ? "employee" : "company_admin");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await companiesApi.createAccount(companyId, { email, fullName, role });
      setEmail("");
      setFullName("");
      onCreated(result);
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
      title="Nuovo account"
      description="L'account riceve una password temporanea da consegnare alla persona."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Annulla</Button>
          <Button variant="primary" type="submit" form="create-account" loading={pending}>Crea account</Button>
        </>
      }
    >
      <form id="create-account" className="space-y-3" onSubmit={submit}>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Email</span>
          <input data-autofocus type="email" className={`${INPUT} mt-1`} value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Nome e cognome</span>
          <input className={`${INPUT} mt-1`} value={fullName} onChange={(event) => setFullName(event.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-app-secondary">Ruolo</span>
          <select className={`${INPUT} mt-1`} value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="company_admin">Responsabile</option>
            <option value="employee">Dipendente</option>
          </select>
        </label>
        {error ? <p className="text-sm text-red-300" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
