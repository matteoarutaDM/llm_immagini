export function formatScore(score?: number): string {
  if (typeof score !== "number") {
    return "n/d";
  }
  return score.toFixed(3);
}
