const dateTimeFormatter = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const numberFormatter = new Intl.NumberFormat("it-IT");
const relativeFormatter = new Intl.RelativeTimeFormat("it-IT", { numeric: "auto" });

/** @param {string | null | undefined} iso */
export function formatDateTime(iso) {
  return iso ? dateTimeFormatter.format(new Date(iso)) : "—";
}

/** @param {string | null | undefined} iso */
export function formatTime(iso) {
  return iso ? timeFormatter.format(new Date(iso)) : "—";
}

/** @param {number | null | undefined} value */
export function formatNumber(value) {
  return typeof value === "number" ? numberFormatter.format(value) : "—";
}

/** @param {number | null | undefined} ms */
export function formatDuration(ms) {
  if (typeof ms !== "number") return "—";
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** @param {string | null | undefined} iso */
export function formatRelative(iso) {
  if (!iso) return "—";
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 60) return relativeFormatter.format(diffSeconds, "second");
  if (abs < 3600) return relativeFormatter.format(Math.round(diffSeconds / 60), "minute");
  if (abs < 86400) return relativeFormatter.format(Math.round(diffSeconds / 3600), "hour");
  return relativeFormatter.format(Math.round(diffSeconds / 86400), "day");
}

/** Shortens a UUID for dense tables while keeping it recognisable. */
export function shortId(id) {
  return typeof id === "string" && id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export function initials(name) {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";
}

/** "claudia.coppola@digitalmens.it" → "Claudia Coppola" (users have no name field). */
export function displayNameFromEmail(email) {
  const localPart = (email ?? "").split("@")[0] ?? "";
  if (!localPart) return email ?? "";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatBytes(value) {
  if (typeof value !== "number") return "—";
  if (value >= 1_048_576) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}

export function formatPercent(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "—";
}
