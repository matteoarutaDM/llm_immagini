import { DocumentTextIcon } from "@heroicons/react/24/outline";

export function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-10 text-center dark:border-neutral-700 dark:bg-neutral-900/40">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        <DocumentTextIcon className="h-7 w-7" />
      </div>
      <h2 className="font-display mt-4 text-lg font-semibold text-neutral-950 dark:text-neutral-50">Risultato analisi</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600 dark:text-neutral-400">
        Il risultato mostrerà macchina riconosciuta, confidenza, dati OCR, risposta del modello e fonti RAG dai manuali.
      </p>
    </div>
  );
}
