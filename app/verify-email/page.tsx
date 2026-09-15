"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { CARD_CLASS, INPUT_CLASS, LINK_BUTTON_CLASS, PRIMARY_BUTTON_CLASS } from "../components/authStyles";
import { BrandMark } from "../components/BrandMark";

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
      <div className={CARD_CLASS}>
        <div className="flex items-center gap-3">
          <BrandMark size="md" />
          <div>
            <h1 className="font-display text-xl font-semibold text-neutral-950 dark:text-neutral-50">Verifica email</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Conferma il tuo account per accedere all&apos;assistente macchine.
            </p>
          </div>
        </div>

        {status === "ok" ? (
          <p className="text-sm text-emerald-800 dark:text-emerald-400" role="status">
            {message}
          </p>
        ) : status === "error" ? (
          <p className="text-sm text-red-700 dark:text-red-400" role="alert">
            {message}
          </p>
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
              className={INPUT_CLASS}
              type="text"
              placeholder="Token di verifica"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <button className={PRIMARY_BUTTON_CLASS} type="submit" disabled={status === "loading"}>
              {status === "loading" ? "Verifica in corso..." : "Conferma account"}
            </button>
          </form>
        ) : null}

        <Link className={`block ${LINK_BUTTON_CLASS}`} href="/">
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
