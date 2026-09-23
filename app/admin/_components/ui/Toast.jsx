"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";

const ToastContext = createContext(/** @type {((toast: { tone?: "success" | "error", message: string }) => void) | null} */ (null));

const DURATION_MS = 4500;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);

  const notify = useCallback(
    ({ tone = "success", message }) => {
      const id = (nextId.current += 1);
      setToasts((current) => [...current.slice(-3), { id, tone, message }]);
      window.setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[80] flex flex-col items-end gap-2 sm:left-auto sm:right-6 sm:w-96" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = toast.tone === "error" ? ExclamationCircleIcon : CheckCircleIcon;
          return (
            <div
              key={toast.id}
              role={toast.tone === "error" ? "alert" : "status"}
              className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-app-border-strong bg-app-raised px-4 py-3 text-sm text-app-text shadow-2xl shadow-black/50"
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${toast.tone === "error" ? "text-red-400" : "text-app-accent"}`} aria-hidden="true" />
              <p className="min-w-0 flex-1 leading-5">{toast.message}</p>
              <button type="button" onClick={() => dismiss(toast.id)} className="-mr-1 grid h-6 w-6 place-items-center rounded-md text-app-muted hover:text-app-text" aria-label="Chiudi notifica">
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast must be used inside <ToastProvider>");
  return notify;
}
