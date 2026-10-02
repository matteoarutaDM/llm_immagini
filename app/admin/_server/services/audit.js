import "server-only";

import { query } from "../db";
import { isNumericId, like, limitOffset, toPage, where } from "../sql";

/**
 * Everything in the activity log: backoffice operators and company admins
 * acting on the site (actor_user_id). `companyId` narrows it to one company.
 * @param {{ q: string, companyId?: string | null, page: number, pageSize: number }} params
 */
export async function listAuditLog({ q, companyId = null, page, pageSize }) {
  const { clause, params } = where([
    q && [
      "o.email::text ILIKE ? OR actor.email::text ILIKE ? OR l.target_id = ? OR l.metadata->>'email' ILIKE ? OR l.reason ILIKE ?",
      like(q), like(q), q, like(q), like(q),
    ],
    companyId && isNumericId(companyId) && ["l.company_id = ?", companyId],
  ]);
  const rows = await query(
    `SELECT l.id::text AS id, l.created_at AS "createdAt", l.action, l.target_type AS "targetType",
            l.target_id AS "targetId", l.reason, l.metadata, host(l.ip) AS ip,
            o.email::text AS "operatorEmail", o.name AS "operatorName",
            actor.email::text AS "actorUserEmail", actor.full_name AS "actorUserName",
            c.name AS "companyName",
            count(*) OVER () AS total
       FROM ops.audit_log l
       LEFT JOIN ops.operators o ON o.id = l.operator_id
       LEFT JOIN app.users actor ON actor.id = l.actor_user_id
       LEFT JOIN app.companies c ON c.id = l.company_id
       ${clause}
      ORDER BY l.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ...limitOffset({ page, pageSize })],
  );
  return toPage(rows, { page, pageSize });
}
