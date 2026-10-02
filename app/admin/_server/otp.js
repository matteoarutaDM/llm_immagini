import "server-only";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import { config } from "./config";
import { queryOne, transaction } from "./db";
import { sendEmail } from "./mailer";
import { getOperatorById } from "./operators";

/**
 * Second factor for operators with requires_otp (admins): after a correct
 * password a 6-digit code is emailed, bound to a short-lived, single-use
 * challenge stored in ops.operator_otp_challenges. Code and token are stored
 * as SHA-256 only, compared in constant time; the challenge is burnt after too
 * many wrong attempts.
 */

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export function maskEmail(email) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

async function deliverCode(operator, code) {
  const minutes = Math.round(config.otpTtlMs / 60_000);
  await sendEmail({
    to: operator.email,
    subject: "Codice di accesso al backoffice",
    text: `Il tuo codice di accesso è ${code}.\nScade tra ${minutes} minuti. Se non hai richiesto tu l'accesso, avvisa subito l'amministratore.`,
    debugSummary: `OTP per ${operator.email}: ${code} (valido ${minutes} min)`,
  });
}

function publicState(row) {
  return {
    expiresAt: new Date(row.expires_at).toISOString(),
    resendAvailableAt: new Date(new Date(row.last_sent_at).getTime() + config.otpResendCooldownMs).toISOString(),
    resendsLeft: config.otpMaxResends - row.resend_count,
  };
}

/** @param {import("./operators").Operator} operator */
export async function startChallenge(operator) {
  const token = randomBytes(32).toString("base64url");
  const code = newCode();
  // Deliver first: if the email cannot be sent, no dangling challenge is left.
  await deliverCode(operator, code);
  const row = await queryOne(
    `INSERT INTO ops.operator_otp_challenges (operator_id, token_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(secs => $4))
     RETURNING expires_at, last_sent_at, resend_count`,
    [operator.id, sha256(token), sha256(code), config.otpTtlMs / 1000],
  );
  return { challengeToken: token, maskedEmail: maskEmail(operator.email), ...publicState(row) };
}

/** Locks the live challenge row for the duration of the transaction. */
async function lockChallenge(tx, token) {
  if (typeof token !== "string" || !token) return null;
  return tx.queryOne(
    `SELECT id, operator_id::text AS operator_id, code_hash, attempts, resend_count, last_sent_at, expires_at
       FROM ops.operator_otp_challenges
      WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
      FOR UPDATE`,
    [sha256(token)],
  );
}

/**
 * @returns {Promise<{ ok: true, operator: import("./operators").Operator }
 *   | { ok: false, reason: "expired" | "invalid" | "locked", attemptsLeft?: number }>}
 */
export async function verifyChallenge(token, code) {
  const outcome = await transaction(async (tx) => {
    const challenge = await lockChallenge(tx, token);
    if (!challenge) return { ok: false, reason: "expired" };

    const normalized = typeof code === "string" ? code.replace(/\s+/g, "") : "";
    const valid =
      /^\d{6}$/.test(normalized) &&
      timingSafeEqual(Buffer.from(sha256(normalized), "hex"), Buffer.from(challenge.code_hash, "hex"));
    if (!valid) {
      const attempts = challenge.attempts + 1;
      const locked = attempts >= config.otpMaxAttempts;
      await tx.query(
        "UPDATE ops.operator_otp_challenges SET attempts = $2, consumed_at = CASE WHEN $3 THEN now() END WHERE id = $1",
        [challenge.id, attempts, locked],
      );
      return locked ? { ok: false, reason: "locked" } : { ok: false, reason: "invalid", attemptsLeft: config.otpMaxAttempts - attempts };
    }
    // Single use: a verified challenge can never be replayed.
    await tx.query("UPDATE ops.operator_otp_challenges SET consumed_at = now() WHERE id = $1", [challenge.id]);
    return { ok: true, operatorId: challenge.operator_id };
  });
  if (!outcome.ok) return outcome;
  const operator = await getOperatorById(outcome.operatorId);
  return operator ? { ok: true, operator } : { ok: false, reason: "expired" };
}

/**
 * @returns {Promise<{ ok: true, state: ReturnType<typeof publicState> }
 *   | { ok: false, reason: "expired" | "cooldown" | "exhausted", retryAfterMs?: number }>}
 */
export async function resendChallenge(token) {
  const code = newCode();
  const outcome = await transaction(async (tx) => {
    const challenge = await lockChallenge(tx, token);
    if (!challenge) return { ok: false, reason: "expired" };
    if (challenge.resend_count >= config.otpMaxResends) return { ok: false, reason: "exhausted" };
    const cooldownEndsAt = new Date(challenge.last_sent_at).getTime() + config.otpResendCooldownMs;
    if (Date.now() < cooldownEndsAt) return { ok: false, reason: "cooldown", retryAfterMs: cooldownEndsAt - Date.now() };

    const operator = await getOperatorById(challenge.operator_id);
    if (!operator) return { ok: false, reason: "expired" };
    await deliverCode(operator, code);
    const row = await tx.queryOne(
      `UPDATE ops.operator_otp_challenges
          SET code_hash = $2, attempts = 0, resend_count = resend_count + 1, last_sent_at = now(),
              expires_at = now() + make_interval(secs => $3)
        WHERE id = $1
        RETURNING expires_at, last_sent_at, resend_count`,
      [challenge.id, sha256(code), config.otpTtlMs / 1000],
    );
    return { ok: true, state: publicState(row) };
  });
  return outcome;
}
