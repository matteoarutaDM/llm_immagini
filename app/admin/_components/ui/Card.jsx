export function Card({ className = "", children, ...props }) {
  return (
    <section className={`rounded-2xl border border-app-border bg-app-surface ${className}`} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-app-border px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-app-text">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-app-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function CardBody({ className = "", children }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}
