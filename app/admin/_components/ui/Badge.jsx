import { ANALYSIS_STATUS_LABELS, DOCUMENT_STATUS_LABELS, KNOWLEDGE_MODE_LABELS, USER_STATUS_LABELS } from "../../_lib/constants";

const TONES = {
  neutral: "bg-white/5 text-app-secondary ring-white/10",
  success: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20",
  warning: "bg-amber-500/10 text-amber-300 ring-amber-400/20",
  danger: "bg-red-500/10 text-red-300 ring-red-400/20",
  info: "bg-sky-500/10 text-sky-300 ring-sky-400/20",
};

/** @param {{ tone?: keyof TONES, dot?: boolean, pulse?: boolean, children: React.ReactNode }} props */
export function Badge({ tone = "neutral", dot = false, pulse = false, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {dot ? (
        <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? "animate-pulse motion-reduce:animate-none" : ""}`} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}

const ANALYSIS_TONES = { recognized: "success", not_recognized: "warning", failed: "danger" };

export function AnalysisStatusBadge({ status }) {
  return (
    <Badge tone={ANALYSIS_TONES[status]} dot>
      {ANALYSIS_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

const DOCUMENT_TONES = { pending: "info", indexed: "success", failed: "danger" };

export function DocumentStatusBadge({ status }) {
  return (
    <Badge tone={DOCUMENT_TONES[status]} dot pulse={status === "pending"}>
      {DOCUMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export function KnowledgeModeBadge({ mode }) {
  return <Badge tone={mode === "merged" ? "info" : "neutral"}>{KNOWLEDGE_MODE_LABELS[mode] ?? mode}</Badge>;
}

export function UserStatusBadge({ status }) {
  return (
    <Badge tone={status === "active" ? "success" : "danger"} dot>
      {USER_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}
