import "server-only";

import { query } from "./db";

/**
 * Append-only trail of operator actions (ops.audit_log) and access attempts
 * (ops.login_attempts). Pass `db` to write inside an existing transaction.
 */
export async function recordAudit({ operator, action, targetType, targetId, reason = null, metadata = {}, ip = null }, db = { query }) {
  await db.query(
    `INSERT INTO ops.audit_log (operator_id, action, target_type, target_id, reason, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [operator?.id ?? null, action, targetType, String(targetId), reason || null, metadata, ip],
  );
}

/** Never throws: a logging failure must not block (or unblock) a login. */
export async function recordLoginAttempt({ email, operatorId = null, ip = null, success, failureReason = null }) {
  try {
    await query(
      `INSERT INTO ops.login_attempts (email, operator_id, ip, success, failure_reason) VALUES ($1, $2, $3, $4, $5)`,
      [email, operatorId, ip, success, failureReason],
    );
  } catch (error) {
    console.error("[backoffice] impossibile registrare il tentativo di accesso", error);
  }
}
