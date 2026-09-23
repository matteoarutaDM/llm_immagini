import "server-only";

import { config } from "./config";
import { query, queryOne } from "./db";

/**
 * Backoffice operators (ops.operators). Passwords are bcrypt hashes checked by
 * PostgreSQL itself with pgcrypto's crypt(), so no hashing library is needed
 * here and the hash never leaves the database.
 *
 * @typedef {{ id: string, email: string, name: string, role: import("../_lib/permissions").Role, requiresOtp: boolean }} Operator
 */

// bcrypt hash of a random string: compared when the email is unknown so the
// response time does not reveal which operator emails exist.
const DUMMY_HASH = "$2a$12$Z2hzPanzb1sfyy37kEpdteup.ywpxLjPdH2Gcfzg88bLPM82rv.cq";

const OPERATOR_FIELDS = `id::text AS id, email::text AS email, name, role::text AS role, requires_otp AS "requiresOtp"`;

/**
 * @returns {Promise<{ operator: Operator } | { error: "invalid" | "locked" }>}
 */
export async function authenticateOperator(email, password) {
  const record = await queryOne(
    `SELECT ${OPERATOR_FIELDS}, is_active, password_hash, failed_login_attempts, locked_until > now() AS locked
       FROM ops.operators WHERE email = $1`,
    [email.trim()],
  );
  const { matches } = await queryOne("SELECT crypt($1, $2) = $2 AS matches", [password, record?.password_hash ?? DUMMY_HASH]);

  if (!record || !record.is_active) return { error: "invalid" };
  if (record.locked) return { error: "locked" };
  if (!matches) {
    const attempts = record.failed_login_attempts + 1;
    await query(
      `UPDATE ops.operators
          SET failed_login_attempts = $2::int,
              locked_until = CASE WHEN $2::int >= $3::int THEN now() + make_interval(secs => $4::float8) ELSE locked_until END
        WHERE id = $1`,
      [record.id, attempts, config.operatorMaxFailedLogins, config.operatorLockoutMs / 1000],
    );
    return { error: "invalid" };
  }
  await query("UPDATE ops.operators SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1", [record.id]);
  const { is_active: _active, password_hash: _hash, failed_login_attempts: _attempts, locked: _locked, ...operator } = record;
  return { operator };
}

/** @returns {Promise<Operator | null>} */
export async function getOperatorById(id) {
  return queryOne(`SELECT ${OPERATOR_FIELDS} FROM ops.operators WHERE id = $1 AND is_active`, [id]);
}

export async function markOperatorLogin(id) {
  await query("UPDATE ops.operators SET last_login_at = now() WHERE id = $1", [id]);
}
