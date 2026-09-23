import "server-only";

import { recordAudit } from "../audit";
import { query, queryOne, transaction } from "../db";
import { DomainError } from "../http";
import { isNumericId, like, limitOffset, toPage, where } from "../sql";
import { ANALYSIS_SUMMARY } from "./analyses";

const ACTIVITY_DAYS = 14;

const USER_SUMMARY = `
  u.id::text AS id, u.email::text AS email, c.domain::text AS "companyDomain", u.status::text AS status,
  u.two_factor_enabled AS "twoFactorEnabled", u.created_at AS "createdAt",
  u.last_login_at AS "lastLoginAt", u.last_active_at AS "lastActiveAt"`;

/**
 * @param {{ q: string, status: string | null, accountType: "company" | "personal" | null,
 *   twoFactor: "on" | "off" | null, page: number, pageSize: number }} params
 */
export async function listUsers({ q, status, accountType, twoFactor, page, pageSize }) {
  const { clause, params } = where([
    status && ["u.status = ?", status],
    accountType === "company" && ["u.company_id IS NOT NULL"],
    accountType === "personal" && ["u.company_id IS NULL"],
    twoFactor && ["u.two_factor_enabled = ?", twoFactor === "on"],
    q && ["u.email::text ILIKE ? OR c.domain::text ILIKE ? OR u.id::text = ?", like(q), like(q), q],
  ]);
  const rows = await query(
    `SELECT ${USER_SUMMARY},
            (SELECT count(*) FROM app.analyses a WHERE a.user_id = u.id) AS "analysesCount",
            count(*) OVER () AS total
       FROM app.users u LEFT JOIN app.companies c ON c.id = u.company_id
       ${clause}
      ORDER BY u.last_active_at DESC NULLS LAST, u.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ...limitOffset({ page, pageSize })],
  );
  return toPage(rows, { page, pageSize });
}

export async function getUserDetail(id) {
  if (!isNumericId(id)) throw new DomainError(404, "NOT_FOUND", "Utente non trovato.");
  const user = await queryOne(
    `SELECT ${USER_SUMMARY},
            u.status_reason AS "statusReason", u.status_changed_at AS "statusChangedAt",
            o.email::text AS "statusChangedBy", u.terms_accepted_at AS "termsAcceptedAt",
            u.failed_login_attempts AS "failedLoginAttempts", coalesce(u.locked_until > now(), false) AS "loginLocked"
       FROM app.users u
       LEFT JOIN app.companies c ON c.id = u.company_id
       LEFT JOIN ops.operators o ON o.id = u.status_changed_by
      WHERE u.id = $1`,
    [id],
  );
  if (!user) throw new DomainError(404, "NOT_FOUND", "Utente non trovato.");

  const [stats, activity, recentAnalyses, chats] = await Promise.all([
    queryOne(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE status = 'recognized') AS recognized,
              count(*) FILTER (WHERE status = 'not_recognized') AS "notRecognized",
              count(*) FILTER (WHERE status = 'failed') AS failed,
              round(avg(duration_ms)) AS "avgDurationMs",
              (SELECT count(*) FROM app.chats WHERE user_id = $1) AS chats,
              (SELECT count(*) FROM app.company_documents WHERE uploaded_by = $1) AS "documentsUploaded"
         FROM app.analyses WHERE user_id = $1`,
      [id],
    ),
    query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS date,
              count(a.id) FILTER (WHERE a.status = 'recognized') AS recognized,
              count(a.id) FILTER (WHERE a.status = 'not_recognized') AS not_recognized,
              count(a.id) FILTER (WHERE a.status = 'failed') AS failed
         FROM generate_series(current_date - ($2::int - 1), current_date, interval '1 day') AS day
         LEFT JOIN app.analyses a ON a.user_id = $1 AND a.created_at >= day AND a.created_at < day + interval '1 day'
        GROUP BY day ORDER BY day`,
      [id, ACTIVITY_DAYS],
    ),
    query(
      `SELECT ${ANALYSIS_SUMMARY} FROM app.analyses a JOIN app.users u ON u.id = a.user_id
        WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 15`,
      [id],
    ),
    query(
      `SELECT ch.id::text AS id, ch.title, ch.knowledge_mode::text AS "knowledgeMode", ch.updated_at AS "updatedAt",
              (SELECT count(*) FROM app.messages m WHERE m.chat_id = ch.id) AS messages
         FROM app.chats ch WHERE ch.user_id = $1 ORDER BY ch.updated_at DESC LIMIT 20`,
      [id],
    ),
  ]);

  return { user, stats, activity, recentAnalyses, chats };
}

/**
 * Blocks or re-enables an account. Blocking also bumps token_version, which
 * logs the user out of every device at once (the FastAPI backend rejects
 * tokens with an old version and refuses blocked accounts).
 */
export async function setUserStatus(id, status, reason, operator, ip) {
  if (!isNumericId(id)) throw new DomainError(404, "NOT_FOUND", "Utente non trovato.");
  if (status === "blocked" && !reason) throw new DomainError(400, "REASON_REQUIRED", "Indica il motivo del blocco.");

  await transaction(async (tx) => {
    const current = await tx.queryOne("SELECT email::text AS email, status::text AS status FROM app.users WHERE id = $1 FOR UPDATE", [id]);
    if (!current) throw new DomainError(404, "NOT_FOUND", "Utente non trovato.");
    if (current.status === status) throw new DomainError(409, "CONFLICT", "L'utente è già in questo stato.");

    await tx.query(
      `UPDATE app.users
          SET status = $2::app.user_status,
              status_reason = CASE WHEN $2::app.user_status = 'blocked' THEN $3::text END,
              status_changed_at = now(),
              status_changed_by = $4,
              token_version = token_version + CASE WHEN $2::app.user_status = 'blocked' THEN 1 ELSE 0 END
        WHERE id = $1`,
      [id, status, reason || null, operator.id],
    );
    await recordAudit(
      {
        operator,
        action: status === "blocked" ? "user.block" : "user.unblock",
        targetType: "user",
        targetId: id,
        reason,
        metadata: { email: current.email },
        ip,
      },
      tx,
    );
  });
  return getUserDetail(id);
}
