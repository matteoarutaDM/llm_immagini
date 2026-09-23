"use client";

import { ArrowPathIcon } from "@heroicons/react/24/outline";

import { dashboardApi } from "../../_lib/api";
import { formatTime } from "../../_lib/format";
import { useResource } from "../../_hooks/useResource";
import { Button } from "../ui/Button";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { StackedBarList, StackedColumnChart } from "../ui/charts";
import { PageHeader } from "../ui/PageHeader";
import { EmptyState, ErrorState, InlineError, Skeleton } from "../ui/States";
import { KpiGrid } from "./KpiGrid";
import { RecentProblems } from "./RecentProblems";

const POLL_MS = 30_000;

const THROUGHPUT_SERIES = [
  { key: "recognized", label: "Riconosciute" },
  { key: "not_recognized", label: "Non riconosciute" },
  { key: "failed", label: "Errori" },
];
const MACHINE_SERIES = [{ key: "analyses", label: "Analisi" }];

const hourLabel = (iso) => `${new Date(iso).getHours()}:00`;

export function DashboardView() {
  const { data, error, loading, reload } = useResource((signal) => dashboardApi.get(signal), "dashboard", { pollMs: POLL_MS });

  if (error && !data) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <ErrorState error={error} onRetry={reload} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={data ? `Aggiornamento automatico ogni ${POLL_MS / 1000}s · ultimo alle ${formatTime(data.generatedAt)}` : "Stato del servizio di riconoscimento"}
        actions={
          <Button size="sm" icon={ArrowPathIcon} onClick={reload} loading={loading && Boolean(data)}>
            Aggiorna
          </Button>
        }
      />
      <div className="space-y-6">
        <InlineError error={data ? error : null} onRetry={reload} />
        <KpiGrid kpis={data?.kpis} loading={!data} />

        <div className="grid gap-6 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <CardHeader title="Analisi per ora" description="Ultime 12 ore, per esito" />
            <CardBody>
              {data ? (
                <StackedColumnChart data={data.throughput} series={THROUGHPUT_SERIES} labelKey="hour" formatLabel={hourLabel} caption="Analisi per ora ed esito" />
              ) : (
                <Skeleton className="h-52" />
              )}
            </CardBody>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader title="Macchine più analizzate" description="Riconoscimenti negli ultimi 7 giorni" />
            <CardBody>
              {!data ? (
                <Skeleton className="h-52" />
              ) : data.topMachines.length ? (
                <StackedBarList
                  data={data.topMachines}
                  series={MACHINE_SERIES}
                  labelKey="machineName"
                  labelHeader="Macchina"
                  formatLabel={(name) => name ?? "—"}
                  caption="Analisi per macchina, ultimi 7 giorni"
                />
              ) : (
                <EmptyState title="Nessun riconoscimento negli ultimi 7 giorni" />
              )}
            </CardBody>
          </Card>
        </div>

        {data ? <RecentProblems items={data.recentProblems} /> : <Skeleton className="h-64 rounded-2xl" />}
      </div>
    </>
  );
}
