"use client";

import { useRouter } from "next/navigation";

import { EmptyState, ErrorState, Skeleton } from "./States";

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  "2xl": "hidden 2xl:table-cell",
};

/**
 * Generic data table with loading skeleton, error + retry and empty states.
 * Rows are clickable when `rowHref` is given; the link column (`primary`)
 * keeps a real anchor so keyboard and middle-click navigation still work.
 *
 * @typedef {{ key: string, header: string, render: (row: any) => React.ReactNode, className?: string, hideBelow?: keyof HIDE_BELOW }} Column
 * @param {{ columns: Column[], rows: any[] | undefined, getRowKey: (row: any) => string, loading?: boolean, error?: Error | null,
 *   onRetry?: () => void, rowHref?: (row: any) => string, emptyTitle?: string, emptyDescription?: string, skeletonRows?: number, caption: string }} props
 */
export function DataTable({
  columns,
  rows,
  getRowKey,
  loading = false,
  error = null,
  onRetry,
  rowHref,
  emptyTitle = "Nessun risultato",
  emptyDescription = "Prova a modificare i filtri o la ricerca.",
  skeletonRows = 8,
  caption,
}) {
  const router = useRouter();

  if (error && !rows?.length) return <ErrorState error={error} onRetry={onRetry} />;
  if (!loading && rows && rows.length === 0) return <EmptyState title={emptyTitle} description={emptyDescription} />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm sm:min-w-[640px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-app-border text-[11px] uppercase tracking-[0.08em] text-app-muted">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={`whitespace-nowrap px-4 py-3 font-semibold ${HIDE_BELOW[column.hideBelow] ?? ""} ${column.className ?? ""}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={loading && rows?.length ? "opacity-60 transition-opacity" : ""}>
          {loading && !rows?.length
            ? Array.from({ length: skeletonRows }, (_, index) => (
                <tr key={index} className="border-b border-app-border last:border-0">
                  {columns.map((column) => (
                    <td key={column.key} className={`px-4 py-3.5 ${HIDE_BELOW[column.hideBelow] ?? ""}`}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => {
                const href = rowHref?.(row);
                return (
                  <tr
                    key={getRowKey(row)}
                    onClick={href ? (event) => {
                      // Let inner controls handle their own clicks; dialogs opened from a
                      // row bubble through the React tree and must not navigate either.
                      if (event.target.closest("a, button, input, textarea, select, label, [role='dialog']")) return;
                      router.push(href);
                    } : undefined}
                    className={`border-b border-app-border last:border-0 ${href ? "cursor-pointer transition hover:bg-white/[0.025]" : ""}`}
                  >
                    {columns.map((column) => (
                      <td key={column.key} className={`px-4 py-3 align-middle text-app-secondary ${HIDE_BELOW[column.hideBelow] ?? ""} ${column.className ?? ""}`}>
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
    </div>
  );
}
