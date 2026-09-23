import "server-only";

import { ANALYSIS_STATUSES } from "../../_lib/constants";
import { query, queryOne } from "../db";
import { DomainError } from "../http";
import { isNumericId, isUuid, like, limitOffset, toPage, where } from "../sql";

/** Columns shown in lists (dashboard, analyses page, user history). */
export const ANALYSIS_SUMMARY = `
  a.id, a.created_at AS "createdAt", a.status::text AS status, a.knowledge_mode::text AS "knowledgeMode",
  a.question, a.machine_id AS "machineId", a.machine_name AS "machineName", a.vision_score AS "visionScore",
  a.duration_ms AS "durationMs", u.id::text AS "userId", u.email::text AS "userEmail"`;

function filters({ q, status, knowledgeMode, machineId, userId }) {
  return [
    status && ["a.status = ?", status],
    knowledgeMode && ["a.knowledge_mode = ?", knowledgeMode],
    machineId && ["a.machine_id = ?", machineId],
    userId && isNumericId(userId) && ["a.user_id = ?", userId],
    q && [
      "a.question ILIKE ? OR u.email::text ILIKE ? OR a.machine_name ILIKE ? OR a.id::text = ?",
      like(q), like(q), like(q), q,
    ],
  ];
}

/**
 * @param {{ q: string, status: string | null, knowledgeMode: string | null, machineId: string | null,
 *   userId: string | null, page: number, pageSize: number }} params
 */
export async function listAnalyses({ page, pageSize, ...criteria }) {
  const { clause, params } = where(filters(criteria));
  const rows = await query(
    `SELECT ${ANALYSIS_SUMMARY}, count(*) OVER () AS total
       FROM app.analyses a JOIN app.users u ON u.id = a.user_id
       ${clause}
      ORDER BY a.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ...limitOffset({ page, pageSize })],
  );

  // Facets ignore the status filter so each tab shows what it would contain.
  const facetFilter = where(filters({ ...criteria, status: null }));
  const facetRows = await query(
    `SELECT a.status::text AS status, count(*) AS count
       FROM app.analyses a JOIN app.users u ON u.id = a.user_id
       ${facetFilter.clause}
      GROUP BY a.status`,
    facetFilter.params,
  );
  const status = Object.fromEntries(ANALYSIS_STATUSES.map((value) => [value, 0]));
  for (const row of facetRows) status[row.status] = row.count;

  return { ...toPage(rows, { page, pageSize }), facets: { status, all: Object.values(status).reduce((a, b) => a + b, 0) } };
}

export async function getAnalysisDetail(id) {
  if (!isUuid(id)) throw new DomainError(404, "NOT_FOUND", "Analisi non trovata.");
  const analysis = await queryOne(
    `SELECT ${ANALYSIS_SUMMARY},
            a.machine_type AS "machineType", a.exact_model_identified AS "exactModelIdentified",
            a.model_code AS "modelCode", a.serial_number AS "serialNumber", a.asset_tag AS "assetTag",
            a.vision_candidates AS "visionCandidates", a.answer, a.sources, a.reason,
            a.error_message AS "errorMessage", a.image_filename AS "imageFilename",
            a.image_content_type AS "imageContentType", a.image_size_bytes AS "imageSizeBytes",
            a.chat_id::text AS "chatId", ch.title AS "chatTitle", c.domain::text AS "companyDomain"
       FROM app.analyses a
       JOIN app.users u ON u.id = a.user_id
       LEFT JOIN app.companies c ON c.id = u.company_id
       LEFT JOIN app.chats ch ON ch.id = a.chat_id
      WHERE a.id = $1`,
    [id],
  );
  if (!analysis) throw new DomainError(404, "NOT_FOUND", "Analisi non trovata.");
  return analysis;
}

/** Machines seen so far, for the filter dropdown. */
export async function listRecognizedMachines() {
  return query(
    `SELECT machine_id AS id, max(machine_name) AS name, count(*) AS count
       FROM app.analyses WHERE machine_id IS NOT NULL
      GROUP BY machine_id ORDER BY max(machine_name)`,
  );
}
