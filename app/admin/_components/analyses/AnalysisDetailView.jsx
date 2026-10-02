"use client";

import Link from "next/link";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import { analysesApi } from "../../_lib/api";
import { formatBytes, formatDateTime, formatDuration } from "../../_lib/format";
import { useResource } from "../../_hooks/useResource";
import { UserCell } from "../users/UserCell";
import { AnalysisStatusBadge, KnowledgeModeBadge } from "../ui/Badge";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { DescriptionList } from "../ui/DescriptionList";
import { PageHeader } from "../ui/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";

const BACK = { href: "/admin/analyses", label: "Analisi" };
const score = (value) => (typeof value === "number" ? value.toFixed(3) : "—");

function Outcome({ analysis }) {
  if (analysis.status === "failed") {
    return (
      <Card className="border-red-500/25">
        <CardHeader title={<span className="flex items-center gap-2 text-red-200"><ExclamationTriangleIcon className="h-4 w-4" aria-hidden="true" />Errore interno</span>} description="L’utente ha ricevuto un messaggio generico; il dettaglio è visibile solo qui." />
        <pre className="overflow-auto bg-black/40 px-5 py-4 font-mono text-xs leading-5 text-red-100/90 whitespace-pre-wrap">{analysis.errorMessage}</pre>
      </Card>
    );
  }
  if (analysis.status === "not_recognized") {
    return (
      <Card className="border-amber-500/25">
        <CardHeader title={<span className="text-amber-200">Macchina non riconosciuta</span>} description="Motivo restituito all’utente" />
        <CardBody><p className="text-sm text-app-text">{analysis.reason ?? "—"}</p></CardBody>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Risposta" />
      <CardBody>
        <p className="whitespace-pre-wrap text-sm leading-6 text-app-text">{analysis.answer || "Nessuna risposta generata."}</p>
      </CardBody>
    </Card>
  );
}

function Sources({ sources }) {
  return (
    <Card>
      <CardHeader title="Fonti consultate" description={`${sources.length} passaggi dai manuali`} />
      {sources.length === 0 ? (
        <EmptyState title="Nessuna fonte" />
      ) : (
        <ol className="divide-y divide-app-border">
          {sources.map((source, index) => (
            <li key={`${source.source}-${source.page}-${index}`} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-app-text">{source.source ?? "—"}</span>
                <span className="text-xs text-app-muted">pagina {source.page ?? "n/d"} · score {score(source.score)}</span>
              </div>
              {source.excerpt ? <p className="mt-1 line-clamp-3 text-xs leading-5 text-app-secondary">{source.excerpt}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Recognition({ analysis }) {
  return (
    <Card>
      <CardHeader title="Riconoscimento" />
      <CardBody className="space-y-5">
        <DescriptionList
          columns={1}
          items={[
            { label: "Macchina", value: analysis.machineName ?? "—" },
            { label: "Tipo", value: analysis.machineType ?? "—" },
            { label: "Punteggio visione", value: score(analysis.visionScore) },
            { label: "Modello esatto", value: analysis.exactModelIdentified == null ? "—" : analysis.exactModelIdentified ? "Sì" : "No" },
            { label: "Codice modello", value: analysis.modelCode, mono: true },
            { label: "Matricola", value: analysis.serialNumber, mono: true },
            { label: "Asset tag", value: analysis.assetTag, mono: true },
          ]}
        />
        {analysis.visionCandidates.length ? (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-app-muted">Candidati</p>
            <ul className="mt-2 space-y-1.5 text-sm">
              {analysis.visionCandidates.map((candidate) => (
                <li key={candidate.machine_id} className="flex justify-between gap-3">
                  <span className="text-app-secondary">{candidate.machine_name ?? candidate.machine_id}</span>
                  <span className="tabular-nums text-app-muted">{score(candidate.score)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function AnalysisDetailView({ analysisId }) {
  const { data, error, loading, reload } = useResource((signal) => analysesApi.get(analysisId, signal), `analysis:${analysisId}`);
  const analysis = data?.analysis;

  if (!analysis) {
    return (
      <>
        <PageHeader title="Dettaglio analisi" back={BACK} />
        {error ? (
          <Card><ErrorState error={error} onRetry={reload} title={error.status === 404 ? "Analisi non trovata" : undefined} /></Card>
        ) : (
          <div className="space-y-4" aria-busy={loading}>
            <Skeleton className="h-32 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <PageHeader
        back={BACK}
        title={<span className="line-clamp-3">{analysis.question}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <AnalysisStatusBadge status={analysis.status} />
            <KnowledgeModeBadge mode={analysis.knowledgeMode} />
            <span className="text-xs text-app-muted">{formatDateTime(analysis.createdAt)}</span>
          </span>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Outcome analysis={analysis} />
          {analysis.status === "recognized" ? <Sources sources={analysis.sources} /> : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Richiesta" />
            <CardBody>
              <DescriptionList
                columns={1}
                items={[
                  { label: "Utente", value: <UserCell id={analysis.userId} email={analysis.userEmail} /> },
                  { label: "Azienda", value: analysis.companyDomain ?? "Account personale" },
                  {
                    label: "Chat",
                    value: analysis.chatId ? analysis.chatTitle ?? `#${analysis.chatId}` : "Nessuna (richiesta singola)",
                  },
                  { label: "Durata", value: formatDuration(analysis.durationMs) },
                  {
                    label: "Immagine",
                    value: analysis.imageFilename
                      ? `${analysis.imageFilename} · ${analysis.imageContentType ?? ""} · ${formatBytes(analysis.imageSizeBytes)}`
                      : "—",
                  },
                  { label: "ID analisi", value: analysis.id, mono: true },
                ]}
              />
              <p className="mt-4 text-xs text-app-muted">
                La foto non viene conservata dopo l’analisi.{" "}
                <Link href={`/admin/analyses?q=${encodeURIComponent(analysis.userEmail)}`} className="text-app-secondary underline-offset-2 hover:underline">
                  Altre analisi di questo utente
                </Link>
              </p>
            </CardBody>
          </Card>
          {analysis.status !== "failed" ? <Recognition analysis={analysis} /> : null}
        </div>
      </div>
    </>
  );
}
