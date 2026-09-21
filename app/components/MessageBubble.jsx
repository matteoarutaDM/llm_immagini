import { CpuChipIcon, UserIcon } from "@heroicons/react/24/outline";

export function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const Icon = isUser ? UserIcon : CpuChipIcon;
  return (
    <article className="flex items-start gap-3">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${isUser ? "bg-app-raised text-app-secondary" : "bg-app-accent-soft text-app-accent"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 pt-1">
        <p className="text-xs font-medium text-app-muted">{isUser ? "Tu" : "Assistente"}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-app-secondary">{message.content}</p>
      </div>
    </article>
  );
}
