import type { ChatMessage } from "../types";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ history }: { history: ChatMessage[] }) {
  if (!history.length) return null;
  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">Storico chat</h2>
      <div className="mt-3 space-y-3">
        {history.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
      </div>
    </div>
  );
}
