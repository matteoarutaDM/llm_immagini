"use client";

import { ChatBubbleLeftRightIcon, CheckCircleIcon, DocumentMagnifyingGlassIcon, XCircleIcon } from "@heroicons/react/24/outline";

import { usersApi } from "../../_lib/api";
import { displayNameFromEmail, formatDateTime, formatDuration, formatNumber, formatRelative } from "../../_lib/format";
import { useResource } from "../../_hooks/useResource";
import { AnalysesTable } from "../analyses/AnalysesTable";
import { Avatar } from "../ui/Avatar";
import { Badge, KnowledgeModeBadge, UserStatusBadge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { StackedColumnChart } from "../ui/charts";
import { DescriptionList } from "../ui/DescriptionList";
import { PageHeader } from "../ui/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "../ui/States";
import { StatCard } from "../ui/StatCard";
import { UserStatusControl } from "./UserStatusControl";

const BACK = { href: "/admin/users", label: "Utenti" };
const ACTIVITY_SERIES = [
  { key: "recognized", label: "Riconosciute" },
  { key: "not_recognized", label: "Non riconosciute" },
  { key: "failed", label: "Errori" },
];
const dayLabel = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" });

function ProfileCard({ user, stats }) {
  return (
    <Card>
      <CardHeader title="Profilo" />
      <CardBody>
        <DescriptionList
          items={[
            { label: "ID", value: user.id, mono: true },
            { label: "Email", value: user.email },
            { label: "Azienda", value: user.companyDomain ?? "Account personale" },
            { label: "Verifica in due passaggi", value: user.twoFactorEnabled ? "Attiva" : "Non attiva" },
            { label: "Registrato il", value: formatDateTime(user.createdAt) },
            { label: "Termini accettati", value: formatDateTime(user.termsAcceptedAt) },
            { label: "Ultimo accesso", value: formatDateTime(user.lastLoginAt) },
            { label: "Ultima attività", value: formatDateTime(user.lastActiveAt) },
            { label: "Documenti caricati", value: formatNumber(stats.documentsUploaded) },
            {
              label: "Accesso",
              value: user.loginLocked
                ? "Bloccato temporaneamente (troppi tentativi)"
                : `${formatNumber(user.failedLoginAttempts)} tentativi falliti recenti`,
            },
            ...(user.statusChangedAt
              ? [
                  { label: "Stato modificato", value: `${formatDateTime(user.statusChangedAt)} · ${user.statusChangedBy ?? "operatore rimosso"}` },
                  ...(user.statusReason ? [{ label: "Motivo blocco", value: user.statusReason }] : []),
                ]
              : []),
          ]}
        />
      </CardBody>
    </Card>
  );
}

function ChatsCard({ chats, total }) {
  return (
    <Card>
      <CardHeader title="Chat" description={`${formatNumber(total)} chat in totale`} />
      {chats.length === 0 ? (
        <EmptyState icon={ChatBubbleLeftRightIcon} title="Nessuna chat" />
      ) : (
        <ul className="divide-y divide-app-border">
          {chats.map((chat) => (
            <li key={chat.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
              <span className="min-w-0 truncate text-sm text-app-text">{chat.title}</span>
              <span className="flex items-center gap-3 text-xs text-app-muted">
                <KnowledgeModeBadge mode={chat.knowledgeMode} />
                <span>{formatNumber(chat.messages)} messaggi</span>
                <span>{formatRelative(chat.updatedAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function UserDetailView({ userId }) {
  const { data, error, loading, reload } = useResource((signal) => usersApi.get(userId, signal), `user:${userId}`);

  if (!data) {
    return (
      <>
        <PageHeader title="Dettaglio utente" back={BACK} />
        {error ? (
          <Card><ErrorState error={error} onRetry={reload} title={error.status === 404 ? "Utente non trovato" : undefined} /></Card>
        ) : (
          <div className="space-y-4" aria-busy={loading}>
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        )}
      </>
    );
  }

  const { user, stats, activity, recentAnalyses, chats } = data;
  const name = displayNameFromEmail(user.email);

  return (
    <>
      <PageHeader
        back={BACK}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={name} size="md" />
            <span className="min-w-0 break-words">{name}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <UserStatusBadge status={user.status} />
            {user.twoFactorEnabled ? <Badge tone="success">2FA</Badge> : null}
            <span className="text-app-muted">{user.email}</span>
          </span>
        }
        // Blocking bumps token_version server-side, so refetch everything.
        actions={<UserStatusControl user={{ ...user, name }} onChanged={reload} />}
      />

      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Analisi totali" value={formatNumber(stats.total)} hint={`Durata media ${formatDuration(stats.avgDurationMs)}`} icon={DocumentMagnifyingGlassIcon} accent="info" />
          <StatCard label="Riconosciute" value={formatNumber(stats.recognized)} icon={CheckCircleIcon} />
          <StatCard label="Non riconosciute / errori" value={`${formatNumber(stats.notRecognized)} / ${formatNumber(stats.failed)}`} icon={XCircleIcon} accent="warning" />
          <StatCard label="Chat" value={formatNumber(stats.chats)} icon={ChatBubbleLeftRightIcon} accent="info" />
        </div>

        <div className="grid gap-6 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <ProfileCard user={user} stats={stats} />
          </div>
          <div className="space-y-6 xl:col-span-3">
            <Card>
              <CardHeader title="Attività" description="Analisi al giorno, ultimi 14 giorni" />
              <CardBody>
                <StackedColumnChart data={activity} series={ACTIVITY_SERIES} labelKey="date" formatLabel={dayLabel} caption="Analisi per giorno" height={140} />
              </CardBody>
            </Card>
            <ChatsCard chats={chats} total={stats.chats} />
          </div>
        </div>

        <Card>
          <CardHeader
            title="Analisi recenti"
            description="Ultime 15"
            actions={<Button size="sm" variant="ghost" href={`/admin/analyses?q=${encodeURIComponent(user.email)}`}>Vedi tutte</Button>}
          />
          <AnalysesTable rows={recentAnalyses} hideUser emptyTitle="Nessuna analisi per questo utente" />
        </Card>
      </div>
    </>
  );
}
