import Link from "next/link";
import { ChevronLeftIcon } from "@heroicons/react/24/outline";

/** Page title block; `back` renders a breadcrumb-style return link. */
export function PageHeader({ title, description, actions, back }) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-app-muted transition hover:text-app-text">
            <ChevronLeftIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {back.label}
          </Link>
        ) : null}
        <h1 className="font-display break-words text-xl font-semibold text-app-text sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-app-secondary">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
