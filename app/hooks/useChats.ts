import { useRef, useState } from "react";

import { chatsApi } from "../lib/api";
import type { AnalysisEntry, Chat, ChatMessage } from "../types";

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [analyses, setAnalyses] = useState<AnalysisEntry[]>([]);
  // The chat on screen, read after an await to drop responses for a chat the user left.
  const activeChatIdRef = useRef<number | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<number | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  function hydrate(list: Chat[]) {
    setChats(list);
    setActiveChat(list[0] ?? null);
    activeChatIdRef.current = list[0]?.id ?? null;
  }

  async function selectChat(token: string | null, chat: Chat | null) {
    setActiveChat(chat);
    activeChatIdRef.current = chat?.id ?? null;
    setAnalyses([]);
    if (!token || !chat) {
      setHistory([]);
      return;
    }
    const [messagesResponse, analysesResponse] = await Promise.all([
      chatsApi.messages(token, chat.id),
      // The history cards are an extra: if they fail, the chat still opens with its messages.
      chatsApi.analyses(token, chat.id).catch(() => null),
    ]);
    if (activeChatIdRef.current !== chat.id) return;
    if (messagesResponse.ok) setHistory(messagesResponse.data);
    if (analysesResponse?.ok) setAnalyses(analysesResponse.data);
  }

  /** Reloads the past searches of a chat, e.g. after a new one was made. */
  async function refreshAnalyses(token: string | null, chatId: number | undefined) {
    if (!token || chatId === undefined) return;
    const response = await chatsApi.analyses(token, chatId).catch(() => null);
    if (response?.ok && activeChatIdRef.current === chatId) setAnalyses(response.data);
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
        activeChatIdRef.current = response.data.id;
        setHistory([]);
        setAnalyses([]);
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
    // Append only the user's message here. The assistant's response
    // is displayed via `ask.result` (AnswerCard) to avoid duplicate
    // rendering of the LLM answer in both the history and the result card.
    setHistory((current) => [
      ...current,
      { id: Date.now(), role: "user", content: question },
    ]);
  }

  return {
    chats,
    activeChat,
    history,
    analyses,
    refreshAnalyses,
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
