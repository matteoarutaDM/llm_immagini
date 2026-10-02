import "server-only";

import { recordAudit } from "../audit";
import { callBackend } from "../backend";
import { query, queryOne } from "../db";
import { DomainError } from "../http";
import { isNumericId, like, limitOffset, toPage, where } from "../sql";

const ROLES = ["employee", "company_admin"];

/**
 * Companies with their size and recent activity. Only the super admin
 * backoffice sees this list: company admins see their own company on the site.
 * @param {{ q: string, page: number, pageSize: number }} params
 */
export async function listCompanies({ q, page, pageSize }) {
  const { clause, params } = where([q && ["c.name ILIKE ? OR c.domain::text ILIKE ?", like(q), like(q)]]);
  const rows = await query(
    `SELECT c.id::text AS id, c.name, c.domain::text AS domain, c.created_at AS "createdAt",
            (SELECT count(*)::int FROM app.users u WHERE u.company_id = c.id) AS "people",
            (SELECT count(*)::int FROM app.users u WHERE u.company_id = c.id AND u.role = 'company_admin') AS "admins",
            (SELECT count(*)::int FROM app.company_documents d WHERE d.company_id = c.id AND d.status = 'indexed') AS "indexedDocuments",
            (SELECT count(*)::int FROM app.analyses a JOIN app.users u ON u.id = a.user_id
              WHERE u.company_id = c.id AND a.created_at >= now() - interval '30 days') AS "analyses30d",
            count(*) OVER () AS total
       FROM app.companies c
       ${clause}
      ORDER BY c.name
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, ...limitOffset({ page, pageSize })],
  );
  return toPage(rows, { page, pageSize });
}

export async function getCompanyDetail(id) {
  if (!isNumericId(id)) throw new DomainError(404, "NOT_FOUND", "Azienda non trovata.");
  const company = await queryOne(
    `SELECT id::text AS id, name, domain::text AS domain, created_at AS "createdAt" FROM app.companies WHERE id = $1`,
    [id],
  );
  if (!company) throw new DomainError(404, "NOT_FOUND", "Azienda non trovata.");
  const accounts = await query(
    `SELECT u.id::text AS id, u.email::text AS email, u.full_name AS "fullName", u.role::text AS role,
            u.status::text AS status, u.password_is_temporary AS "passwordIsTemporary",
            u.terms_accepted_at IS NOT NULL AS "termsAccepted", u.last_login_at AS "lastLoginAt",
            u.created_at AS "createdAt",
            (SELECT count(*)::int FROM app.analyses a WHERE a.user_id = u.id) AS analyses
       FROM app.users u WHERE u.company_id = $1
      ORDER BY u.role DESC, u.created_at`,
    [id],
  );
  const documents = await queryOne(
    `SELECT count(*) FILTER (WHERE status = 'indexed')::int AS indexed,
            count(*) FILTER (WHERE status = 'archived')::int AS archived,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM app.company_documents WHERE company_id = $1`,
    [id],
  );
  return { ...company, accounts, documents };
}

export async function createCompany({ name, domain }, operator, ip) {
  if (!name?.trim() || !domain?.trim()) throw new DomainError(400, "BAD_REQUEST", "Nome e dominio sono obbligatori.");
  const company = await callBackend("/internal/companies", {
    body: { name: name.trim(), domain: domain.trim(), operator_id: Number(operator.id) },
  });
  await recordAudit({
    operator,
    action: "company.create",
    targetType: "company",
    targetId: company.id,
    metadata: { name: company.name, domain: company.domain },
    ip,
    companyId: company.id,
  });
  return company;
}

/** New company admin or employee; returns the one-time temporary password. */
export async function createCompanyAccount(companyId, { email, fullName, role }, operator, ip) {
  if (!isNumericId(companyId)) throw new DomainError(404, "NOT_FOUND", "Azienda non trovata.");
  if (!ROLES.includes(role)) throw new DomainError(400, "BAD_REQUEST", "Ruolo non valido.");
  if (!email?.trim()) throw new DomainError(400, "BAD_REQUEST", "L'email è obbligatoria.");
  const result = await callBackend(`/internal/companies/${companyId}/accounts?role=${role}`, {
    body: { email: email.trim(), full_name: fullName?.trim() || null, operator_id: Number(operator.id) },
  });
  await recordAudit({
    operator,
    action: role === "company_admin" ? "company_admin.create" : "employee.create",
    targetType: "user",
    targetId: result.user.id,
    metadata: { email: result.user.email, full_name: result.user.full_name, role },
    ip,
    companyId,
  });
  return { user: result.user, temporaryPassword: result.temporary_password };
}

/** Promote an employee to company admin, or back. */
export async function setUserRole(userId, role, operator, ip) {
  if (!isNumericId(userId)) throw new DomainError(404, "NOT_FOUND", "Utente non trovato.");
  if (!ROLES.includes(role)) throw new DomainError(400, "BAD_REQUEST", "Ruolo non valido.");
  const result = await callBackend(`/internal/users/${userId}/role`, { body: { role } });
  await recordAudit({
    operator,
    action: "user.role_change",
    targetType: "user",
    targetId: userId,
    metadata: { email: result.email, role, previous_role: result.previous_role },
    ip,
    companyId: result.company_id,
  });
  return result;
}

/** New temporary password for any site account; every session of the account ends. */
export async function resetUserPassword(userId, operator, ip) {
  if (!isNumericId(userId)) throw new DomainError(404, "NOT_FOUND", "Utente non trovato.");
  const result = await callBackend(`/internal/users/${userId}/reset-password`);
  await recordAudit({
    operator,
    action: "user.reset_password",
    targetType: "user",
    targetId: userId,
    metadata: { email: result.email },
    ip,
    companyId: result.company_id,
  });
  return { email: result.email, temporaryPassword: result.temporary_password };
}
