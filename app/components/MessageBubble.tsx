import type { ChatMessage } from "../types";

export function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`rounded-md p-3 text-sm leading-6 ${
        isUser ? "bg-emerald-50 dark:bg-emerald-950/30" : "bg-neutral-50 dark:bg-neutral-800/60"
      }`}
    >
      <strong className="text-neutral-900 dark:text-neutral-100">{isUser ? "Tu" : "Assistente"}:</strong>{" "}
      <span className="text-neutral-800 dark:text-neutral-200">{message.content}</span>
    </div>
  );
}
