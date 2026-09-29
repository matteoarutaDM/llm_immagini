import { useState } from "react";
import { ClipboardDocumentIcon, KeyIcon } from "@heroicons/react/24/outline";

export const INPUT = "w-full rounded-xl border border-app-border-strong bg-app-raised px-3.5 py-2.5 text-sm text-app-text outline-none transition placeholder:text-app-muted focus:border-app-accent/60 focus:ring-4 focus:ring-app-accent/10";
export const BUTTON = "rounded-xl bg-app-accent px-4 py-2.5 text-sm font-semibold text-[#062114] transition hover:bg-app-accent-bright disabled:cursor-not-allowed disabled:bg-app-raised disabled:text-app-muted";
export const GHOST_BUTTON = "rounded-lg border border-app-border px-2.5 py-1.5 text-xs text-app-secondary transition hover:border-app-border-strong hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40";
export const DANGER_BUTTON = "rounded-lg border border-red-500/20 px-2.5 py-1.5 text-xs text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40";

export function Section({ title, description, action, children }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-base font-semibold text-app-text">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-app-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Loading() {
  return <p className="py-12 text-center text-sm text-app-muted">Caricamento...</p>;
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200" role="alert">{children}</p>;
}

export function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

/**
 * A temporary password is returned by the backend only once and never stored
 * in clear: show it with a copy button and a clear warning.
 */
export function PasswordReveal({ email, password, onClose }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-app-accent/30 bg-app-accent-soft p-4" role="status">
      <p className="flex items-center gap-2 text-sm font-medium text-app-text">
        <KeyIcon className="h-4 w-4 text-app-accent" />
        Password temporanea per {email}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-app-bg px-3 py-2 font-mono text-base tracking-wider text-app-text">{password}</code>
        <button
          type="button"
          className={GHOST_BUTTON}
          onClick={() => {
            void navigator.clipboard?.writeText(password).then(() => setCopied(true));
          }}
        >
          <span className="flex items-center gap-1.5">
            <ClipboardDocumentIcon className="h-4 w-4" />
            {copied ? "Copiata" : "Copia"}
          </span>
        </button>
      </div>
      <p className="mt-3 text-xs leading-5 text-app-secondary">
        Consegnala alla persona in modo riservato: non sarà più visibile dopo aver chiuso questo avviso.
        Potrà tenerla o cambiarla dal suo profilo.
      </p>
      <button type="button" onClick={onClose} className="mt-3 text-xs font-medium text-app-accent hover:underline">Ho preso nota, chiudi</button>
    </div>
  );
}
