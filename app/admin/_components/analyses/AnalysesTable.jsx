"use client";

import Link from "next/link";

import { formatDuration, formatRelative } from "../../_lib/format";
import { UserCell } from "../users/UserCell";
import { AnalysisStatusBadge, KnowledgeModeBadge } from "../ui/Badge";
import { DataTable } from "../ui/DataTable";

/** Shared by the analyses page, the dashboard and the user history. `hideUser` drops the user column. */
export function AnalysesTable({ rows, loading, error, onRetry, hideUser = false, emptyTitle }) {
  const columns = [
    {
      key: "question",
      header: "Domanda",
      render: (analysis) => (
        <Link href={`/admin/analyses/${analysis.id}`} className="line-clamp-2 max-w-[340px] text-app-text hover:text-app-accent" title={analysis.question}>
          {analysis.question}
        </Link>
      ),
    },
    ...(hideUser
      ? []
      : [{ key: "user", header: "Utente", render: (a) => <UserCell id={a.userId} email={a.userEmail} showAvatar={false} />, className: "max-w-[220px]", hideBelow: "md" }]),
    { key: "machine", header: "Macchina", render: (a) => <span className="text-app-text">{a.machineName ?? "—"}</span>, hideBelow: "sm" },
    { key: "status", header: "Esito", render: (a) => <AnalysisStatusBadge status={a.status} /> },
    { key: "mode", header: "Conoscenza", render: (a) => <KnowledgeModeBadge mode={a.knowledgeMode} />, hideBelow: "xl" },
    { key: "duration", header: "Durata", render: (a) => <span className="whitespace-nowrap tabular-nums">{formatDuration(a.durationMs)}</span>, hideBelow: "lg" },
    { key: "created", header: "Quando", render: (a) => <span className="whitespace-nowrap text-xs">{formatRelative(a.createdAt)}</span>, hideBelow: "md" },
  ];
  return (
    <DataTable
      caption="Analisi"
      columns={columns}
      rows={rows}
      getRowKey={(analysis) => analysis.id}
      rowHref={(analysis) => `/admin/analyses/${analysis.id}`}
      loading={loading}
      error={error}
      onRetry={onRetry}
      emptyTitle={emptyTitle ?? "Nessuna analisi trovata"}
    />
  );
}
