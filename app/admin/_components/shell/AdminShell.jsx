"use client";

import { useState } from "react";

import { ToastProvider } from "../ui/Toast";
import { OperatorProvider } from "./OperatorProvider";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

/**
 * Backoffice frame. `relative` + fixed height keep every absolutely positioned
 * descendant (e.g. sr-only inputs) inside the scroll area, so the document
 * itself never scrolls.
 */
export function AdminShell({ operator, children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <OperatorProvider operator={operator}>
      <ToastProvider>
        <div className="relative flex h-dvh overflow-hidden bg-app-bg text-app-text">
          <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Topbar menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
            <main id="admin-main" className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
            </main>
          </div>
        </div>
      </ToastProvider>
    </OperatorProvider>
  );
}
