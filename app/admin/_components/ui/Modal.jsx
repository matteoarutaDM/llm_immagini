"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/24/outline";

const SIZES = { md: "sm:max-w-md", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal: bottom sheet on mobile, centred dialog from `sm`.
 * Handles Escape, focus trap, initial focus and focus restoration.
 */
export function Modal({ open, onClose, title, description, size = "md", children, footer }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const panel = panelRef.current;
    const frame = window.requestAnimationFrame(() => {
      const preferred = panel?.querySelector("[data-autofocus]") ?? panel?.querySelector(FOCUSABLE);
      preferred?.focus();
    });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  // Portal to <body> so the dialog escapes table cells and overflow containers.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-black/75 backdrop-blur-sm" aria-label="Chiudi" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`relative flex max-h-[92dvh] w-full flex-col rounded-t-[20px] border border-app-border-strong bg-app-surface shadow-[0_30px_100px_rgba(0,0,0,0.65)] sm:rounded-[20px] ${SIZES[size]}`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-app-border px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-base font-semibold text-app-text">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm leading-6 text-app-secondary">
                {description}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="touch-target -mr-2 -mt-1 grid shrink-0 place-items-center rounded-xl text-app-muted hover:bg-app-hover hover:text-app-text" aria-label="Chiudi finestra">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-app-border px-5 py-4 sm:flex-row sm:justify-end">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
