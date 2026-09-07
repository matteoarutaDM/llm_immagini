"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState(searchParams.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setMessage(null);
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
      <div className="w-full max-w-md space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Reimposta password</h1>
          <p className="mt-1 text-sm text-neutral-600">Scegli una nuova password per il tuo account.</p>
        </div>

        {status === "ok" ? (
          <p className="text-sm text-emerald-800">{message}</p>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit}>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
              type="text"
              placeholder="Token di reset"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
              type="password"
              placeholder="Nuova password (almeno 8 caratteri)"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {status === "error" ? <p className="text-sm text-red-700">{message}</p> : null}
            <button
              className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
              type="submit"
              disabled={status === "loading"}
            >
              {status === "loading" ? "Aggiornamento in corso..." : "Reimposta password"}
            </button>
          </form>
        )}

        <Link className="block text-sm text-emerald-800 underline" href="/">
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
