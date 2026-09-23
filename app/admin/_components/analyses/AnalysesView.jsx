"use client";

import { ArrowPathIcon } from "@heroicons/react/24/outline";

import { analysesApi } from "../../_lib/api";
import { ANALYSIS_STATUSES, ANALYSIS_STATUS_LABELS, KNOWLEDGE_MODES, KNOWLEDGE_MODE_LABELS } from "../../_lib/constants";
import { useQueryFilters } from "../../_hooks/useQueryFilters";
import { useResource } from "../../_hooks/useResource";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { FilterBar, FilterTabs, SearchInput, SelectFilter } from "../ui/Filters";
import { PageHeader } from "../ui/PageHeader";
import { Pagination } from "../ui/Pagination";
import { InlineError } from "../ui/States";
import { AnalysesTable } from "./AnalysesTable";

const DEFAULT_FILTERS = { q: "", status: "", knowledgeMode: "", machineId: "", page: "1" };
const MODE_OPTIONS = KNOWLEDGE_MODES.map((mode) => ({ value: mode, label: KNOWLEDGE_MODE_LABELS[mode] }));
const POLL_MS = 20_000;

export function AnalysesView() {
  const { filters, setFilters, key } = useQueryFilters(DEFAULT_FILTERS);
  const { data, error, loading, reload } = useResource((signal) => analysesApi.list(filters, signal), `analyses:${key}`, { pollMs: POLL_MS });
  const machines = useResource((signal) => analysesApi.machines(signal), "analyses:machines");
  const machineOptions = (machines.data?.machines ?? []).map((machine) => ({ value: machine.id, label: machine.name ?? machine.id }));

  const statusOptions = [
    { value: "", label: "Tutte", count: data?.facets.all },
    ...ANALYSIS_STATUSES.map((status) => ({ value: status, label: ANALYSIS_STATUS_LABELS[status], count: data?.facets.status[status] })),
  ];

  return (
    <>
      <PageHeader
        title="Analisi"
        description="Ogni foto + domanda inviata dagli utenti: riconoscimento, risposta e fonti"
        actions={
          <Button size="sm" icon={ArrowPathIcon} onClick={reload} loading={loading && Boolean(data)}>
            Aggiorna
          </Button>
        }
      />
      <div className="space-y-4">
        <InlineError error={data ? error : null} onRetry={reload} />
        <Card>
          <div className="border-b border-app-border px-4 pt-3">
            <FilterTabs value={filters.status} onChange={(status) => setFilters({ status })} options={statusOptions} />
          </div>
          <FilterBar>
            <SearchInput value={filters.q} onChange={(q) => setFilters({ q })} placeholder="Domanda, email, macchina o ID" label="Cerca analisi" />
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <SelectFilter label="Macchina" value={filters.machineId} onChange={(machineId) => setFilters({ machineId })} options={machineOptions} allLabel="Tutte" />
              <SelectFilter label="Conoscenza" value={filters.knowledgeMode} onChange={(knowledgeMode) => setFilters({ knowledgeMode })} options={MODE_OPTIONS} allLabel="Tutta" />
            </div>
          </FilterBar>
          <AnalysesTable rows={data?.items} loading={loading} error={error} onRetry={reload} />
          {data ? <Pagination {...data} onPageChange={(page) => setFilters({ page: String(page) })} /> : null}
        </Card>
      </div>
    </>
  );
}
