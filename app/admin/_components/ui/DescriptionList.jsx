/**
 * Key/value grid for detail pages.
 * @param {{ items: { label: string, value: React.ReactNode, mono?: boolean }[], columns?: 1 | 2 | 3 }} props
 */
export function DescriptionList({ items, columns = 2 }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3" }[columns];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${grid}`}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-app-muted">{item.label}</dt>
          <dd className={`mt-1 break-words text-sm text-app-text ${item.mono ? "font-mono text-xs" : ""}`}>{item.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
