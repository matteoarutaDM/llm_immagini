import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">Informativa sulla privacy</h1>
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Testo segnaposto: sostituisci questa pagina con un&apos;informativa privacy reale (conforme al GDPR se applicabile)
          prima di andare in produzione.
        </p>
        <p className="text-sm leading-6 text-neutral-700">
          Conserviamo l&apos;indirizzo email, la password (in forma cifrata) e, per gli utenti aziendali, i documenti
          caricati, al solo scopo di fornire il servizio di assistenza tecnica. I documenti di un&apos;azienda non sono
          mai accessibili da altre aziende o da utenti senza account aziendale.
        </p>
        <Link className="text-sm text-emerald-800 underline" href="/">
          Torna alla home
        </Link>
      </div>
    </main>
  );
}
