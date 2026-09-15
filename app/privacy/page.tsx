import Link from "next/link";

import { BrandMark } from "../components/BrandMark";
import { CARD_CLASS, LINK_BUTTON_CLASS } from "../components/authStyles";

export default function PrivacyPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className={`${CARD_CLASS} max-w-2xl`}>
        <div className="flex items-center gap-3">
          <BrandMark size="md" />
          <h1 className="font-display text-2xl font-semibold text-neutral-950 dark:text-neutral-50">Informativa sulla privacy</h1>
        </div>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Testo segnaposto: sostituisci questa pagina con un&apos;informativa privacy reale (conforme al GDPR se applicabile)
          prima di andare in produzione.
        </p>
        <p className="text-sm leading-6 text-neutral-700 dark:text-neutral-300">
          Conserviamo l&apos;indirizzo email, la password (in forma cifrata) e, per gli utenti aziendali, i documenti
          caricati, al solo scopo di fornire il servizio di assistenza tecnica. I documenti di un&apos;azienda non sono
          mai accessibili da altre aziende o da utenti senza account aziendale.
        </p>
        <Link className={`block ${LINK_BUTTON_CLASS}`} href="/">
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
