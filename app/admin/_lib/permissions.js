/**
 * Role-based access control shared by server (enforcement) and client
 * (hiding actions the operator cannot perform). The server is always the
 * source of truth: the client check is only a UX affordance.
 *
 * @typedef {"admin" | "support"} Role
 * @typedef {keyof typeof PERMISSIONS} Permission
 */

export const ROLES = /** @type {const} */ ({ ADMIN: "admin", SUPPORT: "support" });

export const ROLE_LABELS = { admin: "Admin", support: "Supporto" };

export const PERMISSIONS = /** @type {const} */ ({
  "dashboard:view": ["admin", "support"],
  "analyses:view": ["admin", "support"],
  "users:view": ["admin", "support"],
  "users:block": ["admin"],
  "documents:view": ["admin", "support"],
  "documents:delete": ["admin"],
  "audit:view": ["admin"],
});

/**
 * @param {Role | undefined | null} role
 * @param {Permission} permission
 */
export function can(role, permission) {
  if (!role) return false;
  const allowed = /** @type {readonly string[] | undefined} */ (PERMISSIONS[permission]);
  return Boolean(allowed?.includes(role));
}
