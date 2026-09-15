"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { CARD_CLASS, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "../components/authStyles";
import { BrandMark } from "../components/BrandMark";
import { PasswordInput } from "../components/PasswordInput";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Le due password non coincidono.");
      return;
    }
    setStatus("loading");
    const body = new FormData();
    body.append("token", token);
    body.append("password", password);
    const response = await fetch("/api/backend/auth/reset-password", { method: "POST", body });
    const payload = (await response.json()) as { message?: string; detail?: string };
    if (!response.ok) {
      setStatus("error");
      setMessage(payload.detail ?? "Reset non riuscito.");
      return;
    }
    setStatus("ok");
    setMessage(payload.message ?? "Password aggiornata. Ora puoi accedere con la nuova password.");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className={CARD_CLASS}>
        <div className="flex items-center gap-3">
          <BrandMark size="md" />
          <div>
            <h1 className="font-display text-xl font-semibold text-neutral-950 dark:text-neutral-50">Reimposta password</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Scegli una nuova password per il tuo account.</p>
          </div>
        </div>

        {status === "ok" ? (
          <p className="text-sm text-emerald-800 dark:text-emerald-400" role="status">
            {message}
          </p>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit}>
            <input
              className={INPUT_CLASS}
              type="text"
              placeholder="Token di reset"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Nuova password (almeno 8 caratteri)"
              autoComplete="new-password"
              required
            />
            <PasswordInput
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Conferma nuova password"
              autoComplete="new-password"
              required
            />
            {status === "error" ? (
              <p className="text-sm text-red-700 dark:text-red-400" role="alert">
                {message}
              </p>
            ) : null}
            <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Aggiornamento in corso..." : "Reimposta password"}
            </button>
          </form>
        )}

        <Link className={`block ${LINK_BUTTON_CLASS}`} href="/">
          Torna alla home
        </Link>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
