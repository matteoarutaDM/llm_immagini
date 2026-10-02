import { Skeleton } from "./States";

const ACCENTS = {
  accent: "text-app-accent bg-app-accent-soft",
  info: "text-sky-300 bg-sky-500/10",
  warning: "text-amber-300 bg-amber-500/10",
  danger: "text-red-300 bg-red-500/10",
};

/** KPI tile. `hint` is a short secondary line (trend, breakdown, unit). */
export function StatCard({ label, value, hint, icon: Icon, accent = "accent", loading = false }) {
  return (
    <div className="rounded-2xl border border-app-border bg-app-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-app-muted">{label}</p>
        {Icon ? (
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${ACCENTS[accent]}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-8 w-20" />
          <Skeleton className="mt-3 h-3 w-32" />
        </>
      ) : (
        <>
          <p className="font-display mt-1 text-3xl font-semibold tabular-nums text-app-text">{value}</p>
          {hint ? <p className="mt-2 text-xs text-app-muted">{hint}</p> : null}
        </>
      )}
    </div>
  );
}
