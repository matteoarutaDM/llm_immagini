import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ history }: { history: ChatMessage[] }) {
  if (!history.length) return null;
  return (
    <div className="rounded-2xl border border-neutral-200/70 bg-white p-5 shadow-lg shadow-neutral-900/[0.05] dark:border-neutral-800 dark:bg-neutral-900 dark:shadow-black/20">
      <h2 className="font-display text-lg font-semibold text-neutral-950 dark:text-neutral-50">Storico chat</h2>
      <div className="mt-3 space-y-3">
        {history.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
