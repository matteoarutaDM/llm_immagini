import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

import { can } from "../_lib/permissions";
import { config } from "./config";
import { query, queryOne } from "./db";
import { errors } from "./http";

/**
 * Server-side sessions in ops.operator_sessions. The browser only holds a
 * random token in an httpOnly, SameSite=Strict cookie; the database keeps its
 * SHA-256. Logout sets revoked_at, which invalidates the token immediately.
 * The operator (and role) is re-read on every request, so disabling an
 * operator or changing a role takes effect at once.
 */

export const SESSION_COOKIE = "bo_session";

const digest = (token) => createHash("sha256").update(token).digest("hex");

/** @param {import("./operators").Operator} operator */
export async function createSession(operator, { ip = null, userAgent = null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + config.sessionTtlMs;
  await query(
    `INSERT INTO ops.operator_sessions (operator_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [operator.id, digest(token), ip, userAgent?.slice(0, 500) ?? null, new Date(expiresAt)],
  );
  return { token, expiresAt };
}

/** @returns {Promise<{ operator: import("./operators").Operator } | null>} */
export async function resolveSession(token) {
  if (!token) return null;
  const operator = await queryOne(
    `SELECT o.id::text AS id, o.email::text AS email, o.name, o.role::text AS role, o.requires_otp AS "requiresOtp"
       FROM ops.operator_sessions s
       JOIN ops.operators o ON o.id = s.operator_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND o.is_active`,
    [digest(token)],
  );
  return operator ? { operator } : null;
}

export async function destroySession(token) {
  if (token) await query("UPDATE ops.operator_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [digest(token)]);
}

const COOKIE_OPTIONS = { httpOnly: true, sameSite: "strict", path: "/" };

/** @param {import("next/server").NextResponse} response */
export function setSessionCookie(response, token, expiresAt) {
  response.cookies.set(SESSION_COOKIE, token, { ...COOKIE_OPTIONS, secure: config.isProduction, expires: new Date(expiresAt) });
}

/** @param {import("next/server").NextResponse} response */
export function clearSessionCookie(response) {
  response.cookies.set(SESSION_COOKIE, "", { ...COOKIE_OPTIONS, secure: config.isProduction, maxAge: 0 });
}

/** For Server Components / layouts. */
export async function getCurrentOperator() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return (await resolveSession(token))?.operator ?? null;
}

/**
 * Guard for Route Handlers. Returns either the operator or a ready-made
 * 401/403 response:
 *
 *   const auth = await requireOperator(request, "analyses:view");
 *   if (auth.response) return auth.response;
 *
 * @param {import("next/server").NextRequest} request
 * @param {import("../_lib/permissions").Permission} permission
 */
export async function requireOperator(request, permission) {
  const session = await resolveSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return { response: errors.unauthorized() };
  if (!can(session.operator.role, permission)) return { response: errors.forbidden() };
  return { operator: session.operator };
}
