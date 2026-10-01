import { ChevronDownIcon } from "@heroicons/react/24/outline";

import { formatScore } from "../lib/format";
import { useLanguage } from "../lib/i18n";

export function CandidatesCard({ candidates }) {
  const { t } = useLanguage();
  if (!candidates?.length) return null;

  return (
    <details className="group border-t border-app-border pt-7">
      <summary className="touch-target flex cursor-pointer list-none items-center justify-between rounded-xl px-1 text-sm text-app-muted transition hover:text-app-secondary">
        <span>{t("Dettagli diagnostici · {count} candidati visivi", { count: candidates.length })}</span>
        <ChevronDownIcon className="h-4 w-4 transition group-open:rotate-180" />
      </summary>
      <div className="mt-3 space-y-1 rounded-xl bg-app-raised p-2">
        {candidates.map((candidate) => (
          <div key={candidate.machine_id} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
            <span className="text-app-secondary">{candidate.machine_name}</span>
            <span className="font-mono text-xs text-app-muted">{formatScore(candidate.score)}</span>
          </div>
        ))}
      </div>
    </details>
  );
}
