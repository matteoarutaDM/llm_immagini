import "server-only";

import { DomainError } from "./http";

const BACKEND_ERRORS = {
  401: "Il backoffice non è autorizzato dal backend: controlla che BACKOFFICE_API_TOKEN sia uguale nei due .env.",
  503: "Il backend non ha BACKOFFICE_API_TOKEN configurato.",
};
// Validation outcomes the backend explains itself (bad input, missing row, duplicate...).
const PASS_THROUGH = { 400: "BAD_REQUEST", 404: "NOT_FOUND", 409: "CONFLICT" };

/**
 * Calls a FastAPI /internal endpoint (server to server, X-Internal-Token).
 * Account creation, roles and passwords live there because only the backend
 * hashes site passwords and owns the RAG files. Throws DomainError on failure.
 */
export async function callBackend(path, { method = "POST", body } = {}) {
  const token = (process.env.BACKOFFICE_API_TOKEN ?? "").trim();
  if (!token) throw new DomainError(503, "BACKEND_TOKEN_MISSING", "BACKOFFICE_API_TOKEN non configurato nel backoffice.");
  const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

  let response;
  try {
    response = await fetch(`${backendUrl}${path}`, {
      method,
      headers: { "X-Internal-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new DomainError(502, "BACKEND_UNREACHABLE", "Backend non raggiungibile: l'operazione non è stata eseguita.");
  }
  const data = await response.json().catch(() => ({}));
  if (response.ok) return data;
  if (PASS_THROUGH[response.status]) {
    throw new DomainError(response.status, PASS_THROUGH[response.status], data.detail ?? "Operazione non valida.");
  }
  throw new DomainError(502, "BACKEND_ERROR", BACKEND_ERRORS[response.status] ?? "Il backend non ha completato l'operazione.");
}
