import { CheckBadgeIcon, ClockIcon, DocumentMagnifyingGlassIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { formatDuration, formatNumber, formatPercent } from "../../_lib/format";
import { StatCard } from "../ui/StatCard";

export function KpiGrid({ kpis, loading }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Analisi oggi"
        value={formatNumber(kpis?.analysesToday)}
        hint={kpis ? `${formatNumber(kpis.activeUsersToday)} utenti attivi oggi` : null}
        icon={DocumentMagnifyingGlassIcon}
        accent="info"
        loading={loading}
      />
      <StatCard
        label="Tasso di riconoscimento (24h)"
        value={formatPercent(kpis?.recognitionRate24h)}
        hint={kpis ? `${formatNumber(kpis.notRecognizedToday)} non riconosciute oggi` : null}
        icon={CheckBadgeIcon}
        loading={loading}
      />
      <StatCard
        label="Errori oggi"
        value={formatNumber(kpis?.failedToday)}
        hint={kpis ? `${formatNumber(kpis.documentsFailed)} documenti non indicizzati` : null}
        icon={ExclamationTriangleIcon}
        accent={kpis?.failedToday ? "danger" : "warning"}
        loading={loading}
      />
      <StatCard
        label="Tempo medio di risposta (24h)"
        value={formatDuration(kpis?.avgDurationMs24h)}
        hint={kpis ? `${formatNumber(kpis.usersTotal)} utenti · ${formatNumber(kpis.usersBlocked)} bloccati` : null}
        icon={ClockIcon}
        loading={loading}
      />
    </div>
  );
}
