"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightOnRectangleIcon, Bars3Icon, ChevronDownIcon } from "@heroicons/react/24/outline";

import { ROLE_LABELS } from "../../_lib/permissions";
import { Avatar } from "../ui/Avatar";
import { Badge } from "../ui/Badge";
import { useLogout } from "./useLogout";
import { useOperator } from "./OperatorProvider";

export function Topbar({ onOpenMenu, menuOpen }) {
  const { operator } = useOperator();
  const { logout, pending } = useLogout();
  const [accountOpen, setAccountOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!accountOpen) return undefined;
    function onPointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setAccountOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") setAccountOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [accountOpen]);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-app-border bg-app-bg/85 px-4 backdrop-blur-xl sm:px-6">
      <button
        type="button"
        className="touch-target grid place-items-center rounded-xl text-app-secondary transition hover:bg-app-hover hover:text-app-text lg:hidden"
        onClick={onOpenMenu}
        aria-label="Apri menu"
        aria-controls="admin-sidebar"
        aria-expanded={menuOpen}
      >
        <Bars3Icon className="h-5 w-5" />
      </button>

      <span className="hidden items-center gap-2 text-xs text-app-muted sm:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-app-accent shadow-[0_0_10px_var(--accent)]" aria-hidden="true" />
        Ambiente operativo
      </span>

      <div ref={menuRef} className="relative ml-auto">
        <button
          type="button"
          onClick={() => setAccountOpen((current) => !current)}
          className="flex items-center gap-3 rounded-xl p-1.5 pr-2 text-left transition hover:bg-app-hover"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
        >
          <Avatar name={operator.name} />
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-[180px] truncate text-sm font-medium text-app-text">{operator.name}</span>
            <span className="block max-w-[180px] truncate text-xs text-app-muted">{operator.email}</span>
          </span>
          <ChevronDownIcon className={`h-4 w-4 text-app-muted transition ${accountOpen ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {accountOpen ? (
          <div role="menu" className="absolute right-0 top-[calc(100%+8px)] w-64 rounded-xl border border-app-border bg-app-raised p-2 shadow-2xl shadow-black/40">
            <div className="px-2 py-2">
              <p className="truncate text-sm font-medium text-app-text">{operator.name}</p>
              <p className="truncate text-xs text-app-muted">{operator.email}</p>
              <div className="mt-2">
                <Badge tone={operator.role === "admin" ? "success" : "info"}>{ROLE_LABELS[operator.role]}</Badge>
              </div>
            </div>
            <div className="my-1 border-t border-app-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => void logout()}
              disabled={pending}
              className="touch-target flex w-full items-center gap-2 rounded-lg px-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-60"
            >
              <ArrowRightOnRectangleIcon className="h-4 w-4" aria-hidden="true" />
              {pending ? "Uscita in corso…" : "Esci"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
