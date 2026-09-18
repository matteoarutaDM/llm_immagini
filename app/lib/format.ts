export function formatScore(score?: number): string {
  if (typeof score !== "number") {
    return "n/d";
  }
  return score.toFixed(3);
}

/** Turns "claudia.coppola@digitalmens.it" into "Claudia Coppola". */
export function displayNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  if (!localPart) return email;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function initialsFromEmail(email: string): string {
  const name = displayNameFromEmail(email);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return initials || email.charAt(0).toUpperCase() || "?";
}
