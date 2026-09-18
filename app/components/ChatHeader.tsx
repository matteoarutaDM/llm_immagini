import { BrandMark } from "./BrandMark";

export function ChatHeader() {
  return (
    <div className="border-b border-neutral-200/70 px-5 py-4 dark:border-neutral-800">
      <div className="flex items-center gap-3">
        <BrandMark size="md" />
        <div>
          <h1 className="font-display text-xl font-semibold text-neutral-950 dark:text-neutral-50">Assistente macchine</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Immagine, riconoscimento, manuali, risposta tecnica.</p>
        </div>
      </div>
    </div>
  );
}
