import { DocumentTextIcon } from "@heroicons/react/24/outline";

export function EmptyState() {
  return (
    <div className="rounded-lg border border-neutral-300 bg-white/80 p-8 text-center shadow-sm dark:border-neutral-700 dark:bg-neutral-900/80">
      <DocumentTextIcon className="mx-auto h-12 w-12 text-neutral-500" />
      <h2 className="mt-4 text-lg font-semibold text-neutral-950 dark:text-neutral-50">Risultato analisi</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        Il risultato mostrerà macchina riconosciuta, confidenza, dati OCR, risposta del modello e fonti RAG dai manuali.
      </p>
    </div>
  );
}
