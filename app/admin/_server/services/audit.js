import "server-only";

import { query } from "../db";
import { like, limitOffset, toPage, where } from "../sql";

/** @param {{ q: string, page: number, pageSize: number }} params */
export async function listAuditLog({ q, page, pageSize }) {
  const { clause, params } = where([
    q && ["o.email::text ILIKE ? OR l.target_id = ? OR l.metadata->>'email' ILIKE ? OR l.reason ILIKE ?", like(q), q, like(q), like(q)],
  ]);
  const rows = await query(
    `SELECT l.id::text AS id, l.created_at AS "createdAt", l.action, l.target_type AS "targetType",
            l.target_id AS "targetId", l.reason, l.metadata, host(l.ip) AS ip,
            o.email::text AS "operatorEmail", o.name AS "operatorName",
            count(*) OVER () AS total
       FROM ops.audit_log l LEFT JOIN ops.operators o ON o.id = l.operator_id
       ${clause}
      ORDER BY l.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ...limitOffset({ page, pageSize })],
  );
  return toPage(rows, { page, pageSize });
}
