import { MessageBubble } from "./MessageBubble";

export function MessageList({ history }) {
  if (!history.length) return null;
  return (
    <section className="mb-8" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="sr-only">Conversazione</h2>
      <div className="space-y-5">
        {history.map((message) => <MessageBubble key={message.id} message={message} />)}
      </div>
    </section>
  );
}
