"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { XMarkIcon } from "@heroicons/react/24/outline";

import { BrandMark } from "../../../components/BrandMark";
import { NAV_ITEMS, isActive } from "./nav";
import { useOperator } from "./OperatorProvider";

/** Static column on desktop, off-canvas drawer below `lg`. */
export function Sidebar({ open, onClose }) {
  const pathname = usePathname();
  const { can } = useOperator();
  const items = NAV_ITEMS.filter((item) => can(item.permission));

  return (
    <>
      {open ? (
        <button type="button" tabIndex={-1} className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" aria-label="Chiudi menu" onClick={onClose} />
      ) : null}
      <aside
        id="admin-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(86vw,260px)] shrink-0 flex-col border-r border-app-border bg-app-surface transition-transform duration-200 lg:relative lg:z-auto lg:w-[248px] lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Navigazione backoffice"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-app-border px-4">
          <BrandMark size="sm" />
          <div className="min-w-0">
            <p className="font-display truncate text-sm font-semibold text-app-text">Central Ops</p>
            <p className="text-[11px] uppercase tracking-[0.16em] text-app-muted">Backoffice</p>
          </div>
          <button type="button" onClick={onClose} className="touch-target ml-auto grid place-items-center rounded-xl text-app-secondary hover:bg-app-hover lg:hidden" aria-label="Chiudi menu">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">Operazioni</p>
          <ul className="space-y-1">
            {items.map((item) => {
              const active = isActive(item, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={`touch-target flex items-center gap-3 rounded-xl px-3 text-sm transition ${
                      active ? "bg-app-accent-soft font-medium text-app-text" : "text-app-secondary hover:bg-app-hover hover:text-app-text"
                    }`}
                  >
                    <Icon className={`h-5 w-5 ${active ? "text-app-accent" : ""}`} aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-app-border px-4 py-3">
          <Link href="/" className="text-xs text-app-muted transition hover:text-app-text">
            ← Torna all’app
          </Link>
        </div>
      </aside>
    </>
  );
}
