import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/outline";

import { formatNumber } from "../../_lib/format";
import { Button } from "./Button";

/** @param {{ page: number, totalPages: number, total: number, pageSize: number, onPageChange: (page: number) => void }} props */
export function Pagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-app-border px-4 py-3" aria-label="Paginazione">
      <p className="text-xs text-app-muted">
        {formatNumber(from)}–{formatNumber(to)} di {formatNumber(total)}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" icon={ChevronLeftIcon} disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Pagina precedente">
          <span className="hidden sm:inline">Precedente</span>
        </Button>
        <span className="text-xs tabular-nums text-app-secondary">
          {page} / {totalPages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Pagina successiva">
          <span className="hidden sm:inline">Successiva</span>
          <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
