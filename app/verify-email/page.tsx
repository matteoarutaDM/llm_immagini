"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const tokenFromLink = searchParams.get("token") ?? "";
  const [token, setToken] = useState(tokenFromLink);
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function confirm(tokenToUse: string) {
    setStatus("loading");
    setMessage(null);
    const body = new FormData();
    body.append("token", tokenToUse);
    const response = await fetch("/api/backend/auth/verify-email", { method: "POST", body });
    const payload = (await response.json()) as { message?: string; detail?: string };
    if (!response.ok) {
      setStatus("error");
      setMessage(payload.detail ?? "Verifica non riuscita.");
      return;
    }
    setStatus("ok");
    setMessage(payload.message ?? "Email confermata. Ora puoi accedere.");
  }

  useEffect(() => {
    if (tokenFromLink) void confirm(tokenFromLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenFromLink]);

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Verifica email</h1>
          <p className="mt-1 text-sm text-neutral-600">Conferma il tuo account per accedere all&apos;assistente macchine.</p>
        </div>

        {status === "ok" ? (
          <p className="text-sm text-emerald-800">{message}</p>
        ) : status === "error" ? (
          <p className="text-sm text-red-700">{message}</p>
        ) : null}

        {status !== "ok" ? (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void confirm(token);
            }}
          >
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
              type="text"
              placeholder="Token di verifica"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <button
              className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
              type="submit"
              disabled={status === "loading"}
            >
              {status === "loading" ? "Verifica in corso..." : "Conferma account"}
            </button>
          </form>
        ) : null}

        <Link className="block text-sm text-emerald-800 underline" href="/">
          Torna alla home
        </Link>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}
