import "server-only";

import { DOCUMENT_STATUSES } from "../../_lib/constants";
import { recordAudit } from "../audit";
import { query, queryOne } from "../db";
import { DomainError } from "../http";
import { isNumericId, like, limitOffset, toPage, where } from "../sql";

/** @param {{ q: string, status: string | null, page: number, pageSize: number }} params */
export async function listDocuments({ q, status, page, pageSize }) {
  const base = [q && ["d.filename ILIKE ? OR c.domain::text ILIKE ?", like(q), like(q)]];
  const { clause, params } = where([...base, status && ["d.status = ?", status]]);
  const rows = await query(
    `SELECT d.id::text AS id, d.filename, d.status::text AS status, d.size_bytes AS "sizeBytes",
            d.created_at AS "createdAt", d.indexed_at AS "indexedAt", c.domain::text AS "companyDomain",
            u.id::text AS "uploadedById", u.email::text AS "uploadedByEmail",
            count(*) OVER () AS total
       FROM app.company_documents d
       JOIN app.companies c ON c.id = d.company_id
       LEFT JOIN app.users u ON u.id = d.uploaded_by
       ${clause}
      ORDER BY d.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ...limitOffset({ page, pageSize })],
  );

  const facetFilter = where(base);
  const facetRows = await query(
    `SELECT d.status::text AS status, count(*) AS count
       FROM app.company_documents d JOIN app.companies c ON c.id = d.company_id
       ${facetFilter.clause} GROUP BY d.status`,
    facetFilter.params,
  );
  const counts = Object.fromEntries(DOCUMENT_STATUSES.map((value) => [value, 0]));
  for (const row of facetRows) counts[row.status] = row.count;

  return { ...toPage(rows, { page, pageSize }), facets: { status: counts, all: Object.values(counts).reduce((a, b) => a + b, 0) } };
}

const BACKEND_ERRORS = {
  401: "Il backoffice non è autorizzato dal backend: controlla che BACKOFFICE_API_TOKEN sia uguale nei due .env.",
  503: "Il backend non ha BACKOFFICE_API_TOKEN configurato: impossibile eliminare documenti.",
};

/**
 * Deletes a company document through the FastAPI backend, which owns the
 * file on disk and the in-memory RAG index of the company (the next question
 * rebuilds it without this PDF). The operator action is written to the audit log.
 */
export async function deleteDocument(id, reason, operator, ip) {
  if (!isNumericId(id)) throw new DomainError(404, "NOT_FOUND", "Documento non trovato.");
  if (!reason) throw new DomainError(400, "REASON_REQUIRED", "Indica il motivo dell'eliminazione.");
  const token = (process.env.BACKOFFICE_API_TOKEN ?? "").trim();
  if (!token) throw new DomainError(503, "BACKEND_TOKEN_MISSING", BACKEND_ERRORS[503]);

  const document = await queryOne(
    `SELECT d.filename, c.domain::text AS "companyDomain"
       FROM app.company_documents d JOIN app.companies c ON c.id = d.company_id WHERE d.id = $1`,
    [id],
  );
  if (!document) throw new DomainError(404, "NOT_FOUND", "Documento non trovato.");

  const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
  let response;
  try {
    response = await fetch(`${backendUrl}/internal/company-documents/${id}`, {
      method: "DELETE",
      headers: { "X-Internal-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new DomainError(502, "BACKEND_UNREACHABLE", "Backend non raggiungibile: il documento non è stato eliminato.");
  }
  if (response.status === 404) throw new DomainError(404, "NOT_FOUND", "Documento già eliminato.");
  if (!response.ok) {
    throw new DomainError(502, "BACKEND_ERROR", BACKEND_ERRORS[response.status] ?? "Il backend non ha eliminato il documento.");
  }

  await recordAudit({
    operator,
    action: "document.delete",
    targetType: "document",
    targetId: id,
    reason,
    metadata: { filename: document.filename, companyDomain: document.companyDomain },
    ip,
  });
  return { deleted: true };
}
