import { FormEvent } from "react";
import {
  ArrowRightOnRectangleIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { PencilIcon } from "@heroicons/react/24/outline";

import type { Chat, CompanyDocument } from "../types";
import { displayNameFromEmail, initialsFromEmail } from "../lib/format";
import { DocumentUploader } from "./DocumentUploader";
import { ImageUploader } from "./ImageUploader";

type ChatSidebarProps = {
  email: string;
  companyDomain: string | null;
  onLogout: () => void;
  chats: Chat[];
  activeChat: Chat | null;
  onSelectChat: (chat: Chat | null) => void;
  onDeleteChat: (chat: Chat) => void;
  onCreateChat: (mode: "base" | "merged") => void;
  creatingChat: boolean;
  deletingChatId: number | null;
  deleteError: string | null;
  onRenameChat: (chat: Chat, title: string) => void;
  renamingChatId: number | null;
  renameError: string | null;
  documents: CompanyDocument[];
  selectedDocuments: string[];
  uploading: boolean;
  onToggleDocument: (filename: string, checked: boolean) => void;
  onUploadDocument: (file: File | null) => void;
  previewUrl: string | null;
  onImageChange: (file: File | null) => void;
  question: string;
  onQuestionChange: (value: string) => void;
  canSubmit: boolean;
  loading: boolean;
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function ChatSidebar({
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
  documents,
  selectedDocuments,
  uploading,
  onToggleDocument,
  onUploadDocument,
  previewUrl,
  onImageChange,
  question,
  onQuestionChange,
  canSubmit,
  loading,
  error,
  onSubmit,
}: ChatSidebarProps) {
  return (
    <form className="space-y-5 p-5" onSubmit={onSubmit}>
      <div className="space-y-3 rounded-2xl bg-neutral-50 p-3.5 text-sm dark:bg-neutral-800/60">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-sm font-semibold text-white shadow-sm shadow-emerald-950/20"
              aria-hidden="true"
            >
              {email ? initialsFromEmail(email) : "?"}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100" title={email}>
                  {email ? displayNameFromEmail(email) : "Account autenticato"}
                </p>
                {companyDomain ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                    {companyDomain}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{email}</p>
            </div>
          </div>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-800 transition hover:border-red-400 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/70"
            onClick={onLogout}
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            Esci
          </button>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Storico chat
          </p>
          {chats.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 px-3 py-4 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Nessuna chat creata. Usa i pulsanti qui sotto per iniziarne una.
            </p>
          ) : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-neutral-200 bg-white/60 p-1 dark:border-neutral-800 dark:bg-neutral-900/40">
              {chats.map((chat) => {
                const isActive = chat.id === activeChat?.id;
                const isDeleting = deletingChatId === chat.id;
                return (
                  <div
                    key={chat.id}
                    className={`flex items-center gap-1 rounded-lg pr-1 transition ${
                      isActive
                        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
                        : "text-neutral-800 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800/70"
                    }`}
                  >
                    <button
                      type="button"
                      aria-current={isActive ? "page" : undefined}
                      onClick={() => onSelectChat(chat)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm"
                    >
                      <span className="truncate">{chat.title}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        isActive
                          ? "bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-100"
                          : "bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300"
                        }`}
                      >
                        {chat.knowledge_mode === "base" ? "Base" : "Azienda"}
                      </span>
                    </button>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Rinomina chat ${chat.title}`}
                        title={`Rinomina ${chat.title}`}
                        disabled={renamingChatId !== null}
                        onClick={() => {
                          const newTitle = window.prompt(`Nuovo nome per la chat “${chat.title}”:`, chat.title);
                          if (newTitle !== null) {
                            onRenameChat(chat, newTitle.trim() || "Nuova chat");
                          }
                        }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-neutral-500 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800/70"
                      >
                        <PencilIcon className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Elimina chat ${chat.title}`}
                        title={`Elimina ${chat.title}`}
                        disabled={deletingChatId !== null}
                        onClick={() => {
                          if (window.confirm(`Eliminare definitivamente la chat “${chat.title}”?`)) onDeleteChat(chat);
                        }}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-neutral-500 transition hover:bg-red-100 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:text-neutral-400 dark:hover:bg-red-950/60 dark:hover:text-red-300"
                      >
                        <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">{isDeleting ? "Eliminazione in corso" : `Elimina ${chat.title}`}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {deleteError ? <p className="mt-2 text-xs text-red-700 dark:text-red-400" role="alert">{deleteError}</p> : null}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 transition hover:border-emerald-600 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
            disabled={creatingChat}
            onClick={() => onCreateChat("base")}
          >
            {creatingChat ? "Creazione..." : "Nuova chat"}
          </button>
          {companyDomain ? (
            <button
              type="button"
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800 transition hover:border-emerald-600 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:border-emerald-500 dark:hover:text-emerald-400"
              disabled={creatingChat}
              onClick={() => onCreateChat("merged")}
            >
              {creatingChat ? "Creazione..." : "+ Azienda"}
            </button>
          ) : null}
        </div>
        {companyDomain ? (
          <DocumentUploader
            documents={documents}
            selectedDocuments={selectedDocuments}
            uploading={uploading}
            onToggle={onToggleDocument}
            onUpload={onUploadDocument}
          />
        ) : null}
      </div>

      <ImageUploader previewUrl={previewUrl} onFileChange={onImageChange} />

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-neutral-800 dark:text-neutral-200">Domanda</span>
        <textarea
          className="min-h-36 w-full resize-y rounded-xl border border-neutral-300 bg-white px-3.5 py-2.5 text-sm leading-6 text-neutral-950 outline-none ring-emerald-600 transition focus:border-emerald-600 focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="font-display inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-emerald-600 to-emerald-700 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-emerald-950/20 transition hover:-translate-y-px hover:from-emerald-500 hover:to-emerald-600 hover:shadow-lg hover:shadow-emerald-950/30 active:translate-y-0 disabled:cursor-not-allowed disabled:translate-y-0 disabled:from-neutral-400 disabled:to-neutral-400 disabled:shadow-none"
      >
        <PaperAirplaneIcon className="h-5 w-5" />
        {loading ? "Elaborazione in corso..." : "Analizza e rispondi"}
      </button>

      {error ? (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </form>
  );
}
