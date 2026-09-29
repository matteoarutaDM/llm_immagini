import { useState } from "react";
import { KeyIcon, XMarkIcon } from "@heroicons/react/24/outline";

import { displayNameFromEmail } from "../lib/format";
import { PRIMARY_BUTTON_CLASS } from "./authStyles";
import { PasswordInput } from "./PasswordInput";

const ROLE_LABELS = { company_admin: "Responsabile dell'azienda", employee: "Dipendente" };

/** Account details and the optional password change (the owner decides whether to replace a temporary password). */
export function ProfilePanel({ profile, onChangePassword }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword !== confirmPassword) {
      setError("Le due password non coincidono.");
      return;
    }
    setSubmitting(true);
    const failure = await onChangePassword(currentPassword, newPassword);
    setSubmitting(false);
    if (failure) {
      setError(failure);
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setDone(true);
  }

  if (!profile) return null;
  const name = profile.full_name || (profile.email ? displayNameFromEmail(profile.email) : "");

  return (
    <div className="space-y-6">
      <dl className="space-y-3 rounded-xl border border-app-border bg-app-raised/45 p-4 text-sm">
        <Row label="Nome" value={name} />
        <Row label="Email" value={profile.email} />
        <Row label="Azienda" value={profile.company_name || profile.company_domain || "—"} />
        <Row label="Ruolo" value={ROLE_LABELS[profile.role] ?? "—"} />
      </dl>

      <form className="space-y-3" onSubmit={onSubmit}>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-medium text-app-text">
            <KeyIcon className="h-4 w-4 text-app-accent" />
            Cambia password
          </h3>
          <p className="mt-1 text-xs leading-5 text-app-muted">
            {profile.password_is_temporary
              ? "Stai usando la password temporanea che ti è stata consegnata. Puoi continuare a usarla o sceglierne una tua."
              : "Dopo il cambio le altre sessioni aperte vengono chiuse."}
          </p>
        </div>
        <PasswordInput value={currentPassword} onChange={setCurrentPassword} placeholder="Password attuale" autoComplete="current-password" required />
        <PasswordInput value={newPassword} onChange={setNewPassword} placeholder="Nuova password (almeno 8 caratteri)" autoComplete="new-password" required />
        <PasswordInput value={confirmPassword} onChange={setConfirmPassword} placeholder="Conferma nuova password" autoComplete="new-password" required />
        {error ? <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200" role="alert">{error}</p> : null}
        {done ? <p className="rounded-xl border border-app-accent/20 bg-app-accent-soft px-3 py-2.5 text-sm text-app-accent" role="status">Password aggiornata.</p> : null}
        <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={submitting}>
          {submitting ? "Salvataggio..." : "Salva nuova password"}
        </button>
      </form>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-app-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-app-text">{value}</dd>
    </div>
  );
}

/** Reminder only: keeping the temporary password is allowed. */
export function TemporaryPasswordNotice({ onOpenProfile, onDismiss }) {
  return (
    <div className="flex items-center gap-3 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-100 sm:px-6 lg:px-8" role="status">
      <KeyIcon className="h-4 w-4 shrink-0 text-amber-300" />
      <p className="min-w-0 flex-1">Stai usando la password temporanea ricevuta. Puoi cambiarla quando vuoi dal tuo profilo.</p>
      <button type="button" onClick={onOpenProfile} className="shrink-0 font-medium text-amber-200 hover:underline">Cambia password</button>
      <button type="button" onClick={onDismiss} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg hover:bg-amber-400/10" aria-label="Nascondi avviso">
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
