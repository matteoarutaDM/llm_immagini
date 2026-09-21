"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { CARD_CLASS, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "../components/authStyles";
import { BrandMark } from "../components/BrandMark";
import { PasswordInput } from "../components/PasswordInput";
import { authApi } from "../lib/api";

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-medium text-app-secondary">{label}</span>
      {children}
    </label>
  );
}

function Feedback({ error }) {
  if (!error) return null;
  return (
    <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200" role="alert">
      {error}
    </p>
  );
}

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Le due password non coincidono.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await authApi.resetPassword(token, password);
      if (!response.ok) {
        setError(response.data.detail ?? "Impossibile reimpostare la password.");
        return;
      }
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className={`${CARD_CLASS} space-y-4`}>
        <FormIntro title="Link non valido" description="Il link per reimpostare la password non contiene un token valido. Richiedine uno nuovo dalla pagina di accesso." />
        <a className={LINK_BUTTON_CLASS} href="/">
          Torna al login
        </a>
      </div>
    );
  }

  if (done) {
    return (
      <div className={`${CARD_CLASS} space-y-4`}>
        <FormIntro title="Password aggiornata" description="La tua password e' stata reimpostata correttamente. Ora puoi accedere con la nuova password." />
        <a className={PRIMARY_BUTTON_CLASS} href="/">
          Torna al login
        </a>
      </div>
    );
  }

  return (
    <form className={`${CARD_CLASS} space-y-4`} onSubmit={onSubmit}>
      <FormIntro title="Reimposta password" description="Scegli una nuova password per il tuo account." />
      <Field label="Nuova password">
        <PasswordInput
          value={password}
          onChange={setPassword}
          placeholder="Nuova password (almeno 8 caratteri)"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field label="Conferma nuova password">
        <PasswordInput
          value={confirmPassword}
          onChange={setConfirmPassword}
          placeholder="Conferma nuova password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Feedback error={error} />
      <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={submitting}>
        {submitting ? "Aggiornamento in corso..." : "Reimposta password"}
      </button>
    </form>
  );
}

function FormIntro({ title, description }) {
  return (
    <div className="mb-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-app-accent">Recupero accesso</p>
      <h1 className="font-display mt-3 text-3xl font-semibold text-app-text">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-app-secondary">{description}</p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="grid min-h-dvh place-items-center bg-app-bg px-4 py-8 text-app-text">
      <div className="w-full max-w-md">
        <div className="mb-9 flex items-center gap-3">
          <BrandMark size="md" />
          <div>
            <p className="font-display font-semibold">Assistente Macchine</p>
            <p className="text-xs text-app-muted">Industrial AI workspace</p>
          </div>
        </div>
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </main>
  );
}
