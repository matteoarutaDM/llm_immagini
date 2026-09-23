"use client";

import Link from "next/link";

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
  if (entry.targetType === "document") {
    return (
      <span className="text-app-text">
        {entry.metadata?.filename ?? `Documento #${entry.targetId}`}
        {entry.metadata?.companyDomain ? <span className="block text-xs text-app-muted">{entry.metadata.companyDomain}</span> : null}
      </span>
    );
  }
  return <span>{`${entry.targetType} #${entry.targetId}`}</span>;
}

const COLUMNS = [
  { key: "when", header: "Quando", render: (e) => <span className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</span> },
  { key: "operator", header: "Operatore", render: (e) => <span className="text-app-text">{e.operatorEmail ?? "operatore rimosso"}</span>, hideBelow: "sm" },
  { key: "action", header: "Azione", render: (e) => <Badge tone={e.action === "user.unblock" ? "success" : "danger"}>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</Badge> },
  { key: "target", header: "Oggetto", render: (e) => <Target entry={e} /> },
  { key: "reason", header: "Motivo", render: (e) => <span className="line-clamp-2 max-w-[260px]">{e.reason ?? "—"}</span>, hideBelow: "lg" },
  { key: "ip", header: "IP", render: (e) => <span className="font-mono text-xs">{e.ip ?? "—"}</span>, hideBelow: "xl" },
];

/** Admin-only, append-only trail of operator actions. */
export function AuditView() {
  const { filters, setFilters, key } = useQueryFilters(DEFAULT_FILTERS);
  const { data, error, loading, reload } = useResource((signal) => auditApi.list(filters, signal), `audit:${key}`);
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
