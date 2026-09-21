import { useEffect, useRef, useState } from "react";
import { ChatBubbleLeftRightIcon, ExclamationTriangleIcon, XMarkIcon } from "@heroicons/react/24/outline";

export function ChatActionDialog({ action, onClose, onConfirm }) {
  const [title, setTitle] = useState("");
  const inputRef = useRef(null);
  const cancelButtonRef = useRef(null);

  useEffect(() => {
    if (!action) return undefined;
    const previousFocus = document.activeElement;
    setTitle(action.chat.title);

    const frame = window.requestAnimationFrame(() => {
      if (action.type === "rename") {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        cancelButtonRef.current?.focus();
      }
    });

    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [action, onClose]);

  if (!action) return null;

  const isRename = action.type === "rename";
  const resolvedTitle = title.trim() || "Nuova chat";

  function submit(event) {
    event.preventDefault();
    onConfirm(isRename ? resolvedTitle : undefined);
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-end p-0 sm:place-items-center sm:p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/75 backdrop-blur-sm"
        aria-label="Chiudi finestra"
        onClick={onClose}
      />
      <form
        className="relative w-full rounded-t-[20px] border border-app-border-strong bg-app-surface p-5 shadow-[0_30px_100px_rgba(0,0,0,0.65)] sm:max-w-md sm:rounded-[20px] sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-dialog-title"
        aria-describedby="chat-dialog-description"
        onSubmit={submit}
      >
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${isRename ? "bg-app-accent-soft text-app-accent" : "bg-red-500/10 text-red-300"}`}>
            {isRename ? <ChatBubbleLeftRightIcon className="h-5 w-5" /> : <ExclamationTriangleIcon className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="chat-dialog-title" className="font-display text-lg font-semibold text-app-text">
              {isRename ? "Rinomina chat" : "Elimina chat"}
            </h2>
            <p id="chat-dialog-description" className="mt-1 text-sm leading-6 text-app-secondary">
              {isRename
                ? "Scegli un nome breve e riconoscibile per questa conversazione."
                : <>La chat <strong className="font-medium text-app-text">“{action.chat.title}”</strong> e tutti i suoi messaggi verranno eliminati definitivamente.</>}
            </p>
          </div>
          <button type="button" onClick={onClose} className="touch-target -mr-2 -mt-2 grid shrink-0 place-items-center rounded-xl text-app-muted transition hover:bg-app-hover hover:text-app-text" aria-label="Chiudi finestra">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {isRename ? (
          <label className="mt-5 block">
            <span className="mb-2 block text-xs font-medium text-app-secondary">Nome della chat</span>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              className="touch-target w-full rounded-xl border border-app-border-strong bg-app-raised px-3.5 text-sm text-app-text outline-none transition placeholder:text-app-muted focus:border-app-accent/60 focus:ring-4 focus:ring-app-accent/10"
              placeholder="Nome della chat"
            />
          </label>
        ) : (
          <div className="mt-5 rounded-xl border border-red-500/15 bg-red-500/[0.06] px-4 py-3 text-xs leading-5 text-red-200/80">
            Questa operazione non può essere annullata.
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            className="touch-target rounded-xl border border-app-border-strong px-4 text-sm font-medium text-app-secondary transition hover:bg-app-hover hover:text-app-text"
          >
            Annulla
          </button>
          <button
            type="submit"
            className={`touch-target rounded-xl px-4 text-sm font-semibold transition active:scale-[0.99] ${isRename ? "bg-app-accent text-[#062114] hover:bg-app-accent-bright" : "bg-red-500 text-white hover:bg-red-400"}`}
          >
            {isRename ? "Salva nome" : "Elimina definitivamente"}
          </button>
        </div>
      </form>
    </div>
  );
}
