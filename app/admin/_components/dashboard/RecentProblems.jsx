import Link from "next/link";
import { CheckCircleIcon } from "@heroicons/react/24/outline";

import { formatRelative } from "../../_lib/format";
import { AnalysisStatusBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { EmptyState } from "../ui/States";

/** Last analyses that were not recognized or failed (24h). */
export function RecentProblems({ items }) {
  return (
    <Card>
      <CardHeader
        title="Da verificare"
        description="Analisi non riconosciute o in errore nelle ultime 24 ore"
        actions={<Button size="sm" variant="ghost" href="/admin/analyses?status=failed">Vedi errori</Button>}
      />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircleIcon} title="Nessun problema nelle ultime 24 ore" />
      ) : (
        <ul className="divide-y divide-app-border">
          {items.map((analysis) => (
            <li key={analysis.id}>
              <Link href={`/admin/analyses/${analysis.id}`} className="flex flex-col gap-1 px-5 py-3 transition hover:bg-white/[0.025] sm:flex-row sm:items-center sm:gap-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-app-text">{analysis.question}</span>
                  <span className="block truncate text-xs text-app-muted">{analysis.reason ?? analysis.errorMessage ?? "—"}</span>
                </span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-app-muted">
                  <span className="max-w-[180px] truncate">{analysis.userEmail}</span>
                  <AnalysisStatusBadge status={analysis.status} />
                  <span>{formatRelative(analysis.createdAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
