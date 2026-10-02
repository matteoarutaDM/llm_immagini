"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AuthCard } from "./AuthCard";
import { CredentialsForm } from "./CredentialsForm";
import { OtpForm } from "./OtpForm";

const REASON_MESSAGES = {
  expired: "La sessione è scaduta. Accedi di nuovo per continuare.",
  forbidden: "Il tuo ruolo non consente di accedere a quella sezione. Accedi con un account autorizzato.",
  logout: "Sei uscito correttamente.",
};

/** Only same-app backoffice paths are accepted, preventing open redirects. */
function safeNextPath(value) {
  if (!value || !value.startsWith("/admin") || value.startsWith("//") || value.startsWith("/admin/login")) return "/admin";
  return value;
}

export function LoginFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [challenge, setChallenge] = useState(null);
  const [notice, setNotice] = useState(REASON_MESSAGES[searchParams.get("reason")] ?? null);

  function enterConsole() {
    router.replace(safeNextPath(searchParams.get("next")));
    router.refresh();
  }

  if (challenge) {
    return (
      <AuthCard
        title="Verifica in due passaggi"
        description={`Inserisci il codice a 6 cifre inviato a ${challenge.maskedEmail}.`}
        footer="Ambiente mock: il codice è stampato nel log del server."
      >
        <OtpForm
          challenge={challenge}
          onVerified={enterConsole}
          onRestart={(message) => {
            setChallenge(null);
            setNotice(message);
          }}
        />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Accesso operatori"
      description="Area riservata al team operativo. Tutti gli accessi vengono registrati."
      footer="Problemi di accesso? Contatta l’amministratore di sistema."
    >
      <CredentialsForm
        notice={notice}
        onSignedIn={enterConsole}
        onChallenge={(nextChallenge) => {
          setNotice(null);
          setChallenge(nextChallenge);
        }}
      />
    </AuthCard>
  );
}
