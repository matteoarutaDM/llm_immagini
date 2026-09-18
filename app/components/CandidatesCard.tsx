import { formatScore } from "../lib/format";
import type { Candidate } from "../types";

export function CandidatesCard({ candidates }: { candidates?: Candidate[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-lg shadow-neutral-900/[0.05] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20">
      <h3 className="font-display text-lg font-semibold text-neutral-950 dark:text-neutral-50">Candidati visione</h3>
      <div className="mt-3 space-y-2">
        {candidates?.map((candidate) => (
          <div
            key={candidate.machine_id}
            className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-800/60"
          >
            <span className="text-neutral-800 dark:text-neutral-200">{candidate.machine_name}</span>
            <span className="font-semibold text-neutral-950 dark:text-neutral-50">{formatScore(candidate.score)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
