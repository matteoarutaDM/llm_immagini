import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "@heroicons/react/24/outline";

import { formatScore } from "../lib/format";
import type { Hit } from "../types";

type SourcesPanelProps = {
  hits?: Hit[];
  /** Filenames of documents uploaded by the user's own company, used only to
   * label which hits came from the company RAG vs. the general one. */
  companyDocumentFilenames: string[];
};

export function SourcesPanel({ hits, companyDocumentFilenames }: SourcesPanelProps) {
  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">Fonti recuperate</h3>
      <div className="mt-3 space-y-3">
        {hits?.map((hit, index) => (
          <SourceItem
            key={`${hit.source}-${hit.page}-${hit.chunk_index}-${index}`}
            hit={hit}
            isCompanySource={Boolean(hit.source && companyDocumentFilenames.includes(hit.source))}
          />
        ))}
      </div>
    </div>
  );
}

function SourceItem({ hit, isCompanySource }: { hit: Hit; isCompanySource: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="rounded-md bg-neutral-50 p-3 dark:bg-neutral-800/60">
      <button
        type="button"
        className="flex w-full flex-wrap items-center gap-2 text-left text-sm font-medium"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            isCompanySource
              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-300"
              : "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300"
          }`}
        >
          {isCompanySource ? "Documento aziendale" : "Manuale generale"}
        </span>
        <span className="text-neutral-900 dark:text-neutral-100">{hit.source}</span>
        <span className="text-neutral-500 dark:text-neutral-400">pagina {hit.page}</span>
        <span className="text-neutral-500 dark:text-neutral-400">chunk {hit.chunk_index}</span>
        <span className="ml-auto flex items-center gap-1 text-neutral-700 dark:text-neutral-300">
          {formatScore(hit.score)}
          {open ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
        </span>
      </button>
      {open && hit.text ? <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-400">{hit.text}</p> : null}
    </article>
  );
}
