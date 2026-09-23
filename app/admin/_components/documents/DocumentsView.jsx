"use client";

import { documentsApi } from "../../_lib/api";
import { DOCUMENT_STATUSES, DOCUMENT_STATUS_LABELS } from "../../_lib/constants";
import { formatBytes, formatDateTime } from "../../_lib/format";
import { useQueryFilters } from "../../_hooks/useQueryFilters";
import { useResource } from "../../_hooks/useResource";
import { UserCell } from "../users/UserCell";
import { DeleteDocumentButton } from "./DeleteDocumentButton";
import { DocumentStatusBadge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { DataTable } from "../ui/DataTable";
import { FilterBar, FilterTabs, SearchInput } from "../ui/Filters";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";

const DEFAULT_FILTERS = { q: "", status: "", page: "1" };

const BASE_COLUMNS = [
  { key: "filename", header: "Documento", render: (d) => <span className="line-clamp-1 max-w-[320px] font-medium text-app-text" title={d.filename}>{d.filename}</span> },
  { key: "company", header: "Azienda", render: (d) => d.companyDomain, hideBelow: "sm" },
  { key: "status", header: "Stato", render: (d) => <DocumentStatusBadge status={d.status} /> },
  { key: "size", header: "Dimensione", render: (d) => <span className="tabular-nums">{formatBytes(d.sizeBytes)}</span>, hideBelow: "lg" },
  { key: "uploadedBy", header: "Caricato da", render: (d) => <UserCell id={d.uploadedById} email={d.uploadedByEmail} showAvatar={false} />, hideBelow: "md" },
  { key: "created", header: "Caricato il", render: (d) => <span className="whitespace-nowrap text-xs">{formatDateTime(d.createdAt)}</span>, hideBelow: "md" },
];

export function DocumentsView() {
  const { filters, setFilters, key } = useQueryFilters(DEFAULT_FILTERS);
  const { data, error, loading, reload } = useResource((signal) => documentsApi.list(filters, signal), `documents:${key}`);
  const columns = [
    ...BASE_COLUMNS,
    { key: "actions", header: "", render: (d) => <DeleteDocumentButton document={d} onDeleted={reload} />, className: "w-px text-right" },
  ];
  const statusOptions = [
    { value: "", label: "Tutti", count: data?.facets.all },
    ...DOCUMENT_STATUSES.map((status) => ({ value: status, label: DOCUMENT_STATUS_LABELS[status], count: data?.facets.status[status] })),
  ];

  return (
    <>
      <PageHeader title="Documenti aziendali" description="Manuali caricati dalle aziende e stato dell’indicizzazione" />
      <Card>
        <div className="border-b border-app-border px-4 pt-3">
          <FilterTabs value={filters.status} onChange={(status) => setFilters({ status })} options={statusOptions} />
        </div>
        <FilterBar>
          <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Nome file o dominio azienda" label="Cerca documenti" />
        </FilterBar>
        <DataTable
          caption="Documenti aziendali"
          columns={columns}
          rows={data?.items}
          getRowKey={(d) => d.id}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="Nessun documento"
        />
        {data ? <Pagination {...data} onPageChange={(page) => setFilters({ page: String(page) })} /> : null}
      </Card>
    </>
  );
}
