import { CpuChipIcon } from "@heroicons/react/24/outline";

export function EmptyState() {
  return (
    <section className="pt-3 text-center sm:pt-6">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-app-border bg-app-surface text-app-accent shadow-[0_16px_50px_rgba(0,0,0,0.25)]">
        <CpuChipIcon className="h-7 w-7" />
      </div>
      <h1 className="font-display mt-5 text-2xl font-semibold text-app-text sm:text-[28px]">Analizza un macchinario</h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-app-secondary sm:text-[15px]">
        Carica una fotografia e fai una domanda tecnica. L’assistente riconoscerà la macchina e consulterà la documentazione disponibile.
      </p>
    </section>
  );
}
