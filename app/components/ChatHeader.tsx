import { CpuChipIcon } from "@heroicons/react/24/outline";

export function ChatHeader() {
  return (
    <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-emerald-700 text-white">
          <CpuChipIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-neutral-950 dark:text-neutral-50">Assistente macchine</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Immagine, riconoscimento, manuali, risposta tecnica.</p>
        </div>
      </div>
    </div>
  );
}
