import "server-only";
import { isIP } from "node:net";
import { NextResponse } from "next/server";

import { PAGE_SIZE_DEFAULT, PAGE_SIZE_MAX, SEARCH_MAX_LENGTH } from "../_lib/constants";

const NO_STORE = { "Cache-Control": "no-store" };

/** @param {unknown} data @param {number} [status] */
export function json(data, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

/** Uniform error body consumed by `ApiError` in the client API layer. */
export function apiError(status, code, message, headers = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { ...NO_STORE, ...headers } });
}

export const errors = {
  unauthorized: () => apiError(401, "UNAUTHORIZED", "Sessione scaduta o non valida."),
  forbidden: () => apiError(403, "FORBIDDEN", "Il tuo ruolo non consente questa operazione."),
  notFound: (what = "Risorsa") => apiError(404, "NOT_FOUND", `${what} non trovata.`),
  badRequest: (message = "Richiesta non valida.") => apiError(400, "BAD_REQUEST", message),
  conflict: (message) => apiError(409, "CONFLICT", message),
  tooManyRequests: (retryAfterMs) =>
    apiError(429, "RATE_LIMITED", "Troppi tentativi. Riprova tra qualche minuto.", {
      "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
    }),
};

/**
 * CSRF defence for state-changing requests: the session cookie is SameSite=Strict,
 * and on top of that we require the custom header set by the API layer and a
 * same-host Origin when the browser sends one.
 *
 * @param {import("next/server").NextRequest} request
 * @returns {NextResponse | null} an error response, or null when the request is acceptable
 */
export function checkMutationOrigin(request) {
  if (request.headers.get("x-requested-with") !== "backoffice") {
    return apiError(403, "CSRF", "Richiesta non autorizzata.");
  }
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== request.headers.get("host")) return apiError(403, "CSRF", "Origine non consentita.");
  }
  return null;
}

/** Parses a JSON body defensively: always returns a plain object. */
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

/**
 * Client IP for rate limiting and audit. Only trust X-Forwarded-For behind a
 * proxy you control. Returns null when the value is not a valid IP (the audit
 * columns are of type inet).
 */
export function clientIp(request) {
  const candidate = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "";
  return isIP(candidate) ? candidate : null;
}

/** @param {URLSearchParams} params */
export function parsePagination(params) {
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const requested = Number.parseInt(params.get("pageSize") ?? String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT;
  return { page, pageSize: Math.min(PAGE_SIZE_MAX, Math.max(1, requested)) };
}

/** Normalised free-text search term (trimmed, lower-cased, length-capped). */
export function parseSearch(value) {
  return (value ?? "").trim().slice(0, SEARCH_MAX_LENGTH).toLowerCase();
}

/** Returns the value only when it belongs to the whitelist. */
export function parseEnum(value, allowed) {
  return value && allowed.includes(value) ? value : null;
}

/** Free-text reason attached to audit-relevant actions. */
export function parseReason(value) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

/** Expected, user-facing failure raised by services (maps to a 4xx). */
export class DomainError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Wraps a Route Handler: DomainErrors become their 4xx response, anything else
 * is logged server-side and answered with a generic 500 so internals (stack
 * traces, SQL, upstream URLs) never reach the browser.
 */
export function withErrorHandling(handler) {
  return async (request, context) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof DomainError) return apiError(error.status, error.code, error.message);
      console.error("[backoffice] unhandled route error", error);
      return apiError(500, "INTERNAL", "Errore interno del server.");
    }
  };
}
