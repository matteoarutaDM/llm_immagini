import { useLanguage } from "../lib/i18n";
import { MessageBubble } from "./MessageBubble";

export function MessageList({ history }) {
  const { t } = useLanguage();
  if (!history.length) return null;
  return (
    <section className="mt-10 pb-6" aria-labelledby="conversation-title">
      <h2 id="conversation-title" className="sr-only">{t("Conversazione")}</h2>
      <div className="space-y-5">
        {history.map((message) => <MessageBubble key={message.id} message={message} />)}
      </div>
    </section>
  );
}
