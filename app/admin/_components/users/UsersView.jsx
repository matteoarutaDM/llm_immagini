"use client";

import { usersApi } from "../../_lib/api";
import { USER_STATUSES, USER_STATUS_LABELS } from "../../_lib/constants";
import { displayNameFromEmail, formatNumber, formatRelative } from "../../_lib/format";
import { useQueryFilters } from "../../_hooks/useQueryFilters";
import { useResource } from "../../_hooks/useResource";
import { Avatar } from "../ui/Avatar";
import { Badge, UserStatusBadge } from "../ui/Badge";
import { Card } from "../ui/Card";
import { DataTable } from "../ui/DataTable";
import { FilterBar, SearchInput, SelectFilter } from "../ui/Filters";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";

const DEFAULT_FILTERS = { q: "", status: "", accountType: "", twoFactor: "", page: "1" };
const STATUS_OPTIONS = USER_STATUSES.map((status) => ({ value: status, label: USER_STATUS_LABELS[status] }));
const ACCOUNT_OPTIONS = [
  { value: "company", label: "Aziendale" },
  { value: "personal", label: "Personale" },
];
const TWO_FACTOR_OPTIONS = [
  { value: "on", label: "Attiva" },
  { value: "off", label: "Non attiva" },
];

const COLUMNS = [
  {
    key: "user",
    header: "Utente",
    render: (user) => (
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={displayNameFromEmail(user.email)} />
        <div className="min-w-0">
          <p className="truncate font-medium text-app-text">{displayNameFromEmail(user.email)}</p>
          <p className="truncate text-xs text-app-muted">{user.email}</p>
        </div>
      </div>
    ),
  },
  { key: "company", header: "Azienda", render: (user) => user.companyDomain ?? <span className="text-app-muted">Personale</span>, hideBelow: "md" },
  { key: "status", header: "Stato", render: (user) => <UserStatusBadge status={user.status} /> },
  { key: "2fa", header: "2FA", render: (user) => <Badge tone={user.twoFactorEnabled ? "success" : "neutral"}>{user.twoFactorEnabled ? "Attiva" : "No"}</Badge>, hideBelow: "lg" },
  { key: "analyses", header: "Analisi", render: (user) => <span className="tabular-nums">{formatNumber(user.analysesCount)}</span>, hideBelow: "sm" },
  { key: "lastActive", header: "Ultima attività", render: (user) => <span className="whitespace-nowrap text-xs">{formatRelative(user.lastActiveAt ?? user.lastLoginAt)}</span>, hideBelow: "md" },
  { key: "created", header: "Registrato", render: (user) => <span className="whitespace-nowrap text-xs">{formatRelative(user.createdAt)}</span>, hideBelow: "xl" },
];

export function UsersView() {
  const { filters, setFilters, key } = useQueryFilters(DEFAULT_FILTERS);
  const { data, error, loading, reload } = useResource((signal) => usersApi.list(filters, signal), `users:${key}`);

  return (
    <>
      <PageHeader title="Utenti" description="Account registrati sul sito, aziende e stato di abilitazione" />
      <Card>
        <FilterBar>
          <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Email, dominio o ID utente" label="Cerca utenti" />
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <SelectFilter label="Stato" value={filters.status} onChange={(status) => setFilters({ status })} options={STATUS_OPTIONS} />
            <SelectFilter label="Account" value={filters.accountType} onChange={(accountType) => setFilters({ accountType })} options={ACCOUNT_OPTIONS} />
            <SelectFilter label="2FA" value={filters.twoFactor} onChange={(twoFactor) => setFilters({ twoFactor })} options={TWO_FACTOR_OPTIONS} />
          </div>
        </FilterBar>
        <DataTable
          caption="Elenco utenti"
          columns={COLUMNS}
          rows={data?.items}
          getRowKey={(user) => user.id}
          rowHref={(user) => `/admin/users/${user.id}`}
          loading={loading}
          error={error}
          onRetry={reload}
          emptyTitle="Nessun utente trovato"
        />
        {data ? <Pagination {...data} onPageChange={(page) => setFilters({ page: String(page) })} /> : null}
      </Card>
    </>
  );
}
