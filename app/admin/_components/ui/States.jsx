import { ExclamationTriangleIcon, InboxIcon } from "@heroicons/react/24/outline";

import { Button } from "./Button";

export function Skeleton({ className = "" }) {
  return <span className={`block animate-pulse rounded-md bg-white/[0.06] motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

export function EmptyState({ icon: Icon = InboxIcon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-app-border bg-app-raised text-app-muted">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium text-app-text">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs leading-5 text-app-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Error block with a retry button; `error` is an ApiError or any Error. */
export function ErrorState({ error, onRetry, title = "Impossibile caricare i dati" }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-red-500/20 bg-red-500/10 text-red-300">
        <ExclamationTriangleIcon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="mt-4 text-sm font-medium text-app-text">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-app-muted">{error?.message ?? "Si è verificato un errore imprevisto."}</p>
      {onRetry ? (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          Riprova
        </Button>
      ) : null}
    </div>
  );
}

/** Thin banner used when a background refresh fails but stale data is still shown. */
export function InlineError({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-200">
      <span>{error.message}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-semibold underline-offset-2 hover:underline">
          Riprova
        </button>
      ) : null}
    </div>
  );
}
