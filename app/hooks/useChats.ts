import { useState } from "react";

import { chatsApi } from "../lib/api";
import type { Chat, ChatMessage } from "../types";

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [creatingChat, setCreatingChat] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  function hydrate(list: Chat[]) {
    setChats(list);
    setActiveChat(list[0] ?? null);
  }

  async function selectChat(token: string | null, chat: Chat | null) {
    setActiveChat(chat);
    if (!token || !chat) {
      setHistory([]);
      return;
    }
    const response = await chatsApi.messages(token, chat.id);
    if (response.ok) setHistory(response.data);
  }

  async function createChat(token: string | null, knowledgeMode: "base" | "merged", selectedDocuments: string[]) {
    if (!token || creatingChat) return;
    setCreatingChat(true);
    try {
      const title = knowledgeMode === "base" ? "Conoscenza base" : "Conoscenza aziendale";
      const response = await chatsApi.create(token, knowledgeMode, title, selectedDocuments);
      if (response.ok) {
        setChats((current) => [response.data, ...current]);
        setActiveChat(response.data);
        setHistory([]);
      }
    } finally {
      setCreatingChat(false);
    }
  }

  async function deleteChat(token: string | null, chat: Chat) {
    if (!token || deletingChatId !== null) return;
    setDeletingChatId(chat.id);
    setDeleteError(null);
    try {
      const response = await chatsApi.delete(token, chat.id);
      if (!response.ok) {
        setDeleteError(response.data.detail ?? "Non è stato possibile eliminare la chat.");
        return;
      }

      const remainingChats = chats.filter((item) => item.id !== chat.id);
      setChats(remainingChats);
      if (activeChat?.id === chat.id) {
        await selectChat(token, remainingChats[0] ?? null);
      }
    } finally {
      setDeletingChatId(null);
    }
  }

  async function renameChat(token: string | null, chat: Chat, newTitle: string) {
    if (!token || renamingChatId !== null) return;
    setRenamingChatId(chat.id);
    setRenameError(null);
    try {
      const response = await chatsApi.rename(token, chat.id, newTitle);
      if (!response.ok) {
        setRenameError(response.data.detail ?? "Non è stato possibile rinominare la chat.");
        return;
      }

      setChats((current) => current.map((c) => (c.id === chat.id ? { ...c, title: response.data.title ?? newTitle } : c)));
      if (activeChat?.id === chat.id) {
        setActiveChat((prev) => (prev ? { ...prev, title: response.data.title ?? newTitle } : prev));
      }
    } finally {
      setRenamingChatId(null);
    }
  }

  function appendExchange(question: string, answer: string) {
    setHistory((current) => [
      ...current,
      { id: Date.now(), role: "user", content: question },
      { id: Date.now() + 1, role: "assistant", content: answer },
    ]);
  }

  return {
    chats,
    activeChat,
    history,
    creatingChat,
    deletingChatId,
    deleteError,
    hydrate,
    selectChat,
    createChat,
    deleteChat,
    appendExchange,
    renamingChatId,
    renameError,
    renameChat,
  };
}

export type UseChatsResult = ReturnType<typeof useChats>;
