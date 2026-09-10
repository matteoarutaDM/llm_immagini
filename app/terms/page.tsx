import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Termini di servizio</h1>
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Testo segnaposto: sostituisci questa pagina con i termini di servizio reali prima di andare in produzione.
        </p>
        <p className="text-sm leading-6 text-neutral-700">
          Utilizzando questa applicazione accetti di usarla in buona fede per la consultazione dei manuali tecnici e
          delle conoscenze aziendali a cui hai accesso in base al tuo account. Gli account aziendali sono responsabili
          dei documenti che caricano e della loro corretta gestione.
        </p>
        <Link className="text-sm text-emerald-800 underline" href="/">
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
