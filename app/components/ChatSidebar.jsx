import { useState } from "react";
import {
  ArrowRightOnRectangleIcon,
  BuildingOffice2Icon,
  ChevronDownIcon,
  ChatBubbleLeftRightIcon,
  DocumentTextIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

import { displayNameFromEmail, initialsFromEmail } from "../lib/format";
import { BrandMark } from "./BrandMark";
import { ChatActionDialog } from "./ChatActionDialog";

export function ChatSidebar({
  open,
  onClose,
  email,
  companyDomain,
  onLogout,
  chats,
  activeChat,
  onSelectChat,
  onDeleteChat,
  onRenameChat,
  renamingChatId,
  renameError,
  onCreateChat,
  creatingChat,
  deletingChatId,
  deleteError,
  documentCount,
  selectedDocumentCount,
  onOpenDocuments,
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [chatAction, setChatAction] = useState(null);

  return (
    <>
      {open ? (
        <button type="button" className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" aria-label="Chiudi navigazione" onClick={onClose} />
      ) : null}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(88vw,280px)] shrink-0 flex-col border-r border-app-border bg-app-surface transition-transform duration-200 lg:relative lg:z-auto lg:w-[280px] lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Navigazione principale"
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-app-border px-4">
          <BrandMark size="sm" />
          <div className="min-w-0">
            <p className="font-display truncate text-sm font-semibold text-app-text">Assistente Macchine</p>
            <p className="text-[11px] uppercase tracking-[0.16em] text-app-muted">Industrial AI</p>
          </div>
          <button type="button" onClick={onClose} className="touch-target ml-auto grid place-items-center rounded-xl text-app-secondary hover:bg-app-hover lg:hidden" aria-label="Chiudi navigazione">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
          <button
            type="button"
            onClick={() => onCreateChat("base")}
            disabled={creatingChat}
            className="touch-target flex w-full items-center justify-center gap-2 rounded-xl bg-app-accent px-4 text-sm font-semibold text-[#062114] shadow-[0_8px_30px_rgba(50,213,131,0.12)] transition hover:bg-app-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon className="h-4 w-4" />
            {creatingChat ? "Creazione..." : "Nuova chat"}
          </button>

          {companyDomain ? (
            <button
              type="button"
              onClick={() => onCreateChat("merged")}
              disabled={creatingChat}
              className="touch-target mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-app-border bg-app-raised px-4 text-sm font-medium text-app-secondary transition hover:border-app-border-strong hover:bg-app-hover hover:text-app-text disabled:opacity-50"
            >
              <BuildingOffice2Icon className="h-4 w-4" />
              + Azienda
            </button>
          ) : null}

          <div className="mt-7 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center justify-between px-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-app-muted">Chat recenti</p>
              <span className="text-xs text-app-muted">{chats.length}</span>
            </div>

            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {chats.length === 0 ? (
                <div className="px-2 py-8 text-center">
                  <ChatBubbleLeftRightIcon className="mx-auto h-6 w-6 text-app-muted" />
                  <p className="mt-2 text-xs leading-5 text-app-muted">Le tue analisi compariranno qui.</p>
                </div>
              ) : (
                chats.map((chat) => {
                  const isActive = chat.id === activeChat?.id;
                  const isDeleting = deletingChatId === chat.id;
                  return (
                    <div key={chat.id} className={`group flex items-center rounded-xl transition ${isActive ? "bg-app-accent-soft text-app-text" : "text-app-secondary hover:bg-app-hover hover:text-app-text"}`}>
                      <button type="button" aria-current={isActive ? "page" : undefined} onClick={() => onSelectChat(chat)} className="touch-target min-w-0 flex-1 truncate rounded-xl px-3 text-left text-sm">
                        {chat.title}
                      </button>
                      <div className="flex shrink-0 pr-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <button
                          type="button"
                          aria-label={`Rinomina chat ${chat.title}`}
                          disabled={renamingChatId !== null}
                          onClick={() => setChatAction({ type: "rename", chat })}
                          className="grid h-9 w-9 place-items-center rounded-lg text-app-muted hover:bg-app-raised hover:text-app-text disabled:opacity-40"
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Elimina chat ${chat.title}`}
                          disabled={deletingChatId !== null}
                          onClick={() => setChatAction({ type: "delete", chat })}
                          className="grid h-9 w-9 place-items-center rounded-lg text-app-muted hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40"
                        >
                          <TrashIcon className="h-4 w-4" />
                          <span className="sr-only">{isDeleting ? "Eliminazione in corso" : `Elimina ${chat.title}`}</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {deleteError || renameError ? <p className="px-2 pt-2 text-xs text-red-400" role="alert">{deleteError || renameError}</p> : null}
          </div>

          {companyDomain ? (
            <button type="button" onClick={onOpenDocuments} className="touch-target mt-4 flex w-full items-center gap-3 rounded-xl px-3 text-sm text-app-secondary transition hover:bg-app-hover hover:text-app-text">
              <DocumentTextIcon className="h-5 w-5" />
              <span>Documenti aziendali</span>
              <span className="ml-auto rounded-full bg-app-raised px-2 py-0.5 text-xs text-app-muted">{selectedDocumentCount}/{documentCount}</span>
            </button>
          ) : null}
        </div>

        <div className="relative border-t border-app-border p-3">
          {accountOpen ? (
            <div className="absolute bottom-[calc(100%+8px)] left-3 right-3 rounded-xl border border-app-border bg-app-raised p-2 shadow-2xl shadow-black/40">
              <p className="px-2 py-1 text-xs text-app-muted">Sessione autenticata</p>
              <button type="button" onClick={onLogout} className="touch-target flex w-full items-center gap-2 rounded-lg px-2 text-sm text-red-300 hover:bg-red-500/10">
                <ArrowRightOnRectangleIcon className="h-4 w-4" />
                Esci
              </button>
            </div>
          ) : null}
          <button type="button" onClick={() => setAccountOpen((current) => !current)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-app-hover" aria-expanded={accountOpen}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-app-accent-soft text-xs font-semibold text-app-accent ring-1 ring-inset ring-app-accent/20">
              {email ? initialsFromEmail(email) : "?"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-app-text">{email ? displayNameFromEmail(email) : "Account"}</span>
              <span className="block truncate text-xs text-app-muted">{email}</span>
            </span>
            <ChevronDownIcon className={`h-4 w-4 text-app-muted transition ${accountOpen ? "rotate-180" : ""}`} />
          </button>
        </div>
      </aside>
      <ChatActionDialog
        action={chatAction}
        onClose={() => setChatAction(null)}
        onConfirm={(value) => {
          if (!chatAction) return;
          if (chatAction.type === "rename") onRenameChat(chatAction.chat, value);
          else onDeleteChat(chatAction.chat);
          setChatAction(null);
        }}
      />
    </>
  );
}
