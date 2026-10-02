import { INPUT_CLASS } from "../../../components/authStyles";

/** Labelled input reusing the app-wide auth input style. */
export function Field({ label, id, hint, className = "", ...inputProps }) {
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-app-secondary">
        {label}
      </label>
      <input id={id} className={`${INPUT_CLASS} mt-1.5 ${className}`} {...inputProps} />
      {hint ? <p className="mt-1.5 text-xs text-app-muted">{hint}</p> : null}
    </div>
  );
}

export function FormAlert({ tone = "error", children }) {
  if (!children) return null;
  const styles = tone === "error" ? "border-red-500/20 bg-red-500/10 text-red-200" : "border-app-accent/20 bg-app-accent-soft text-emerald-200";
  return (
    <p role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-3.5 py-2.5 text-sm ${styles}`}>
      {children}
    </p>
  );
}
