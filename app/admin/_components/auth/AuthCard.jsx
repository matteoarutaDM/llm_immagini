import { BrandMark } from "../../../components/BrandMark";

export function AuthCard({ title, description, children, footer }) {
  return (
    <div className="relative w-full max-w-md">
      <div className="mb-6 flex items-center gap-3">
        <BrandMark size="md" />
        <div>
          <p className="font-display text-sm font-semibold text-app-text">Central Ops</p>
          <p className="text-[11px] uppercase tracking-[0.16em] text-app-muted">Backoffice riservato</p>
        </div>
      </div>
      <section className="rounded-[20px] border border-app-border-strong bg-app-surface p-6 shadow-[0_30px_100px_rgba(0,0,0,0.45)] sm:p-8">
        <h1 className="font-display text-xl font-semibold text-app-text">{title}</h1>
        {description ? <p className="mt-1.5 text-sm leading-6 text-app-secondary">{description}</p> : null}
        <div className="mt-6">{children}</div>
      </section>
      {footer ? <div className="mt-4 text-center text-xs text-app-muted">{footer}</div> : null}
    </div>
  );
}
