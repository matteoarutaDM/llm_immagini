"use client";

import { useEffect } from "react";
import Link from "next/link";

import { useCompanyScope } from "../shell/CompanyScope";
import { auditApi } from "../../_lib/api";
import { AUDIT_ACTION_LABELS } from "../../_lib/constants";
import { formatDateTime } from "../../_lib/format";
import { useQueryFilters } from "../../_hooks/useQueryFilters";
import { useResource } from "../../_hooks/useResource";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { DataTable } from "../ui/DataTable";
import { FilterBar, SearchInput } from "../ui/Filters";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";

const DEFAULT_FILTERS = { q: "", page: "1" };

function Target({ entry }) {
  if (entry.targetType === "user") {
    return (
      <Link href={`/admin/users/${entry.targetId}`} className="text-app-text hover:text-app-accent">
        {entry.metadata?.email ?? `Utente #${entry.targetId}`}
      </Link>
    );
  }
  if (entry.targetType === "company") {
    return (
      <Link href={`/admin/companies/${entry.targetId}`} className="text-app-text hover:text-app-accent">
        {entry.metadata?.name ?? `Azienda #${entry.targetId}`}
      </Link>
    );
  }
  if (entry.targetType === "document" || entry.targetType === "company_document") {
    return (
      <span className="text-app-text">
        {entry.metadata?.filename ?? `Documento #${entry.targetId}`}
        {entry.metadata?.companyDomain ? <span className="block text-xs text-app-muted">{entry.metadata.companyDomain}</span> : null}
      </span>
    );
  }
  return <span>{`${entry.targetType} #${entry.targetId}`}</span>;
}

// Red for actions that remove or restrict something, green for the ones that grant or restore.
const ACTION_TONES = {
  "user.block": "danger",
  "employee.block": "danger",
  "document.delete": "danger",
  "document.archive": "warning",
  "user.unblock": "success",
  "employee.unblock": "success",
  "document.reindex": "success",
  "company.create": "success",
  "company_admin.create": "success",
  "employee.create": "success",
};

/** Backoffice operator, or the company admin who acted from the site. */
function Actor({ entry }) {
  if (entry.operatorEmail) return <span className="text-app-text">{entry.operatorEmail}</span>;
  if (entry.actorUserEmail) {
    return (
      <span className="text-app-text">
        {entry.actorUserName || entry.actorUserEmail}
        <span className="block text-xs text-app-muted">responsabile, dal sito</span>
      </span>
    );
  }
  return <span className="text-app-muted">account rimosso</span>;
}

const COLUMNS = [
  { key: "when", header: "Quando", render: (e) => <span className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</span> },
  { key: "operator", header: "Chi", render: (e) => <Actor entry={e} />, hideBelow: "sm" },
  { key: "company", header: "Azienda", render: (e) => e.companyName ?? <span className="text-app-muted">—</span>, hideBelow: "md" },
  { key: "action", header: "Azione", render: (e) => <Badge tone={ACTION_TONES[e.action] ?? "neutral"}>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</Badge> },
  { key: "target", header: "Oggetto", render: (e) => <Target entry={e} /> },
  { key: "reason", header: "Motivo", render: (e) => <span className="line-clamp-2 max-w-[260px]">{e.reason ?? "—"}</span>, hideBelow: "lg" },
  { key: "ip", header: "IP", render: (e) => <span className="font-mono text-xs">{e.ip ?? "—"}</span>, hideBelow: "xl" },
];

/** Admin-only, append-only trail of operator actions. */
export function AuditView() {
  const { filters, setFilters, key } = useQueryFilters(DEFAULT_FILTERS);
  const { companyId } = useCompanyScope();
  // A new company starts from the first page of results.
  useEffect(() => {
    if (filters.page && filters.page !== "1") setFilters({ page: "1" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);
  const { data, error, loading, reload } = useResource((signal) => auditApi.list({ ...filters, company: companyId }, signal), `audit:${key}:${companyId ?? "all"}`);
  return (
    <>
      <PageHeader title="Registro attività" description="Azioni degli operatori su account e documenti, non modificabile" />
      <Card>
        <FilterBar>
          <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Operatore, utente o motivo" label="Cerca nel registro" />
        </FilterBar>
        <DataTable
          caption="Registro attività operatori"
          columns={COLUMNS}
          rows={data?.items}
          getRowKey={(e) => e.id}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="Nessuna attività registrata"
          emptyDescription="Blocchi, riabilitazioni ed eliminazioni di documenti compariranno qui."
        />
        {data ? <Pagination {...data} onPageChange={(page) => setFilters({ page: String(page) })} /> : null}
      </Card>
    </>
  );
}
