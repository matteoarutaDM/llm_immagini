/**
 * Client-side API layer for the backoffice. Every call goes to the same-origin
 * BFF routes under /api/admin, which own the session cookie (httpOnly) and
 * talk to the real backend. Components never call fetch directly.
 *
 * Error contract: the server answers `{ error: { code, message } }` with a
 * non-2xx status. 401 (session missing/expired) and 403 (role no longer
 * allowed) send the operator back to the login page.
 */

const BASE = "/api/admin";

export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} [code]
   */
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? "UNKNOWN";
  }
}

const DEFAULT_MESSAGES = {
  0: "Connessione al server non riuscita. Controlla la rete e riprova.",
  400: "Richiesta non valida.",
  404: "Risorsa non trovata.",
  409: "Operazione non consentita nello stato attuale.",
  429: "Troppe richieste. Attendi qualche secondo e riprova.",
  500: "Errore interno del server.",
};

/** @param {"expired" | "forbidden"} reason */
function redirectToLogin(reason) {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({ reason });
  if (next.startsWith("/admin") && !next.startsWith("/admin/login")) params.set("next", next);
  window.location.assign(`/admin/login?${params}`);
}

/** Drops empty values so URLs stay clean and cacheable. */
function toQueryString(query) {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown, query?: Record<string, unknown>, signal?: AbortSignal, authRedirect?: boolean }} [options]
 */
async function request(path, { method = "GET", body, query, signal, authRedirect = true } = {}) {
  let response;
  try {
    response = await fetch(`${BASE}${path}${toQueryString(query)}`, {
      method,
      signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        // Custom header: cross-site forms cannot set it, so mutations carrying
        // it are known to come from this app (defence in depth with SameSite).
        "X-Requested-With": "backoffice",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(DEFAULT_MESSAGES[0], 0, "NETWORK_ERROR");
  }

  const data = await response.json().catch(() => null);

  if (authRedirect && (response.status === 401 || response.status === 403)) {
    redirectToLogin(response.status === 401 ? "expired" : "forbidden");
  }
  if (!response.ok) {
    const message = data?.error?.message ?? DEFAULT_MESSAGES[response.status] ?? DEFAULT_MESSAGES[500];
    throw new ApiError(message, response.status, data?.error?.code);
  }
  return data;
}

export const authApi = {
  /** @param {string} email @param {string} password */
  login: (email, password) =>
    request("/auth/login", { method: "POST", body: { email, password }, authRedirect: false }),
  /** @param {string} challengeToken @param {string} code */
  verifyOtp: (challengeToken, code) =>
    request("/auth/otp/verify", { method: "POST", body: { challengeToken, code }, authRedirect: false }),
  /** @param {string} challengeToken */
  resendOtp: (challengeToken) =>
    request("/auth/otp/resend", { method: "POST", body: { challengeToken }, authRedirect: false }),
  logout: () => request("/auth/logout", { method: "POST", authRedirect: false }),
  me: (signal) => request("/auth/me", { signal }),
};

export const dashboardApi = {
  get: (signal) => request("/dashboard", { signal }),
};

export const usersApi = {
  list: (query, signal) => request("/users", { query, signal }),
  get: (id, signal) => request(`/users/${encodeURIComponent(id)}`, { signal }),
  /** @param {string} id @param {"active" | "blocked"} status @param {string} [reason] */
  setStatus: (id, status, reason) =>
    request(`/users/${encodeURIComponent(id)}`, { method: "PATCH", body: { status, reason } }),
};

export const analysesApi = {
  list: (query, signal) => request("/analyses", { query, signal }),
  get: (id, signal) => request(`/analyses/${encodeURIComponent(id)}`, { signal }),
  machines: (signal) => request("/analyses/machines", { signal }),
};

export const documentsApi = {
  list: (query, signal) => request("/documents", { query, signal }),
  /** @param {string} id @param {string} reason */
  remove: (id, reason) => request(`/documents/${encodeURIComponent(id)}`, { method: "DELETE", body: { reason } }),
};

export const auditApi = {
  list: (query, signal) => request("/audit", { query, signal }),
};
