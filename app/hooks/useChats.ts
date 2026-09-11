import { useState } from "react";

import { chatsApi } from "../lib/api";
import type { Chat, ChatMessage } from "../types";

export function useChats() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);

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
    if (!token) return;
    const title = knowledgeMode === "base" ? "Conoscenza base" : "Conoscenza aziendale";
    const response = await chatsApi.create(token, knowledgeMode, title, selectedDocuments);
    if (response.ok) {
      setChats((current) => [response.data, ...current]);
      setActiveChat(response.data);
    }
  }

  function appendExchange(question: string, answer: string) {
    setHistory((current) => [
      ...current,
      { id: Date.now(), role: "user", content: question },
      { id: Date.now() + 1, role: "assistant", content: answer },
    ]);
  }

  return { chats, activeChat, history, hydrate, selectChat, createChat, appendExchange };
}

export type UseChatsResult = ReturnType<typeof useChats>;
