import Link from "next/link";

import { BrandMark } from "../components/BrandMark";
import { CARD_CLASS, LINK_BUTTON_CLASS } from "../components/authStyles";

export default function TermsPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className={`${CARD_CLASS} max-w-2xl`}>
        <div className="flex items-center gap-3">
          <BrandMark size="md" />
          <h1 className="font-display text-2xl font-semibold text-neutral-950 dark:text-neutral-50">Termini di servizio</h1>
        </div>
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Testo segnaposto: sostituisci questa pagina con i termini di servizio reali prima di andare in produzione.
        </p>
        <p className="text-sm leading-6 text-neutral-700 dark:text-neutral-300">
          Utilizzando questa applicazione accetti di usarla in buona fede per la consultazione dei manuali tecnici e
          delle conoscenze aziendali a cui hai accesso in base al tuo account. Gli account aziendali sono responsabili
          dei documenti che caricano e della loro corretta gestione.
        </p>
        <Link className={`block ${LINK_BUTTON_CLASS}`} href="/">
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
