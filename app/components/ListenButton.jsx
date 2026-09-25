import { ArrowPathIcon, SpeakerWaveIcon, StopIcon } from "@heroicons/react/24/outline";

import { useReadAloud } from "../hooks/useReadAloud";

/** Reads a text aloud with the backend's voice; mount it with `key={text}` so a new text stops the old reading. */
export function ListenButton({ text, token, className = "" }) {
  const reader = useReadAloud(token);
  const active = reader.status !== "idle";
  const loading = reader.status === "loading";
  const label = active ? "Interrompi lettura" : "Ascolta la risposta";
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {reader.error ? (
        <p role="alert" className="text-xs text-red-300">
          {reader.error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={active ? reader.stop : () => void reader.play(text)}
        aria-pressed={active}
        aria-label={label}
        title={label}
        className={`touch-target inline-flex items-center gap-2 rounded-xl px-3 text-sm font-medium transition ${
          active ? "bg-app-accent/15 text-app-accent hover:bg-app-accent/25" : "text-app-secondary hover:bg-app-hover hover:text-app-text"
        }`}
      >
        {loading ? <ArrowPathIcon className="h-4 w-4 animate-spin" /> : active ? <StopIcon className="h-4 w-4" /> : <SpeakerWaveIcon className="h-4 w-4" />}
        {loading ? "Preparo..." : active ? "Stop" : "Ascolta"}
      </button>
    </div>
  );
}
