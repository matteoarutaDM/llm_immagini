import { formatScore } from "../lib/format";
import type { Candidate } from "../types";

export function CandidatesCard({ candidates }: { candidates?: Candidate[] }) {
  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">Candidati visione</h3>
      <div className="mt-3 space-y-2">
        {candidates?.map((candidate) => (
          <div
            key={candidate.machine_id}
            className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-800/60"
          >
            <span className="text-neutral-800 dark:text-neutral-200">{candidate.machine_name}</span>
            <span className="font-semibold text-neutral-950 dark:text-neutral-50">{formatScore(candidate.score)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
