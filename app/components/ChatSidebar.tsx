import { FormEvent } from "react";
import { ArrowRightOnRectangleIcon, ExclamationTriangleIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";

import type { Chat, CompanyDocument } from "../types";
import { DocumentUploader } from "./DocumentUploader";
import { ImageUploader } from "./ImageUploader";

type ChatSidebarProps = {
  email: string;
  companyDomain: string | null;
  onLogout: () => void;
  chats: Chat[];
  activeChat: Chat | null;
  onSelectChat: (chat: Chat | null) => void;
  onCreateChat: (mode: "base" | "merged") => void;
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
  onCreateChat,
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
      <div className="space-y-2 rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-800/60">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-neutral-900 dark:text-neutral-100">{email || "Account autenticato"}</span>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-red-300 hover:bg-red-50 hover:text-red-800 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            onClick={onLogout}
          >
            <ArrowRightOnRectangleIcon className="h-4 w-4" />
            Esci
          </button>
        </div>
        <label className="sr-only" htmlFor="chat-select">
          Chat
        </label>
        <select
          id="chat-select"
          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-2 text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
          value={activeChat?.id ?? ""}
          onChange={(event) => onSelectChat(chats.find((chat) => chat.id === Number(event.target.value)) ?? null)}
        >
          <option value="">Seleziona una chat</option>
          {chats.map((chat) => (
            <option key={chat.id} value={chat.id}>
              {chat.title} ({chat.knowledge_mode})
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-neutral-300 px-2 py-1 text-neutral-800 dark:border-neutral-700 dark:text-neutral-200"
            onClick={() => onCreateChat("base")}
          >
            + Base
          </button>
          {companyDomain ? (
            <button
              type="button"
              className="rounded border border-neutral-300 px-2 py-1 text-neutral-800 dark:border-neutral-700 dark:text-neutral-200"
              onClick={() => onCreateChat("merged")}
            >
              + Azienda
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
          className="min-h-36 w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 text-neutral-950 outline-none ring-emerald-700 transition focus:ring-2 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-50"
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
        />
      </label>

      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
      >
        <PaperAirplaneIcon className="h-5 w-5" />
        {loading ? "Elaborazione in corso..." : "Analizza e rispondi"}
      </button>

      {error ? (
        <div
          role="alert"
          className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </form>
  );
}
