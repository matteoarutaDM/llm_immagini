import "server-only";

import { query, queryOne } from "../db";
import { isNumericId } from "../sql";
import { ANALYSIS_SUMMARY } from "./analyses";

const THROUGHPUT_HOURS = 12;

/**
 * KPIs of the whole platform, or of one company when `companyId` is set
 * (analyses and users are scoped through app.users.company_id).
 * @param {{ companyId?: string | null }} [scope]
 */
export async function getDashboard({ companyId = null } = {}) {
  const company = companyId && isNumericId(companyId) ? companyId : null;
  // $1 = company id or NULL (= every company). Analyses belong to a company through their user.
  const inCompany = "($1::bigint IS NULL OR u.company_id = $1::bigint)";
  const analyses = `app.analyses a JOIN app.users u ON u.id = a.user_id WHERE ${inCompany}`;
  const [kpis, throughput, topMachines, recentProblems] = await Promise.all([
    queryOne(
      `SELECT
         (SELECT count(*) FROM ${analyses} AND a.created_at >= current_date) AS "analysesToday",
         (SELECT count(*) FROM ${analyses} AND a.created_at >= current_date AND a.status = 'not_recognized') AS "notRecognizedToday",
         (SELECT count(*) FROM ${analyses} AND a.created_at >= current_date AND a.status = 'failed') AS "failedToday",
         (SELECT count(*) FILTER (WHERE a.status = 'recognized')::float / nullif(count(*), 0)
            FROM ${analyses} AND a.created_at >= now() - interval '24 hours') AS "recognitionRate24h",
         (SELECT round(avg(a.duration_ms)) FROM ${analyses}
             AND a.created_at >= now() - interval '24 hours' AND a.status <> 'failed') AS "avgDurationMs24h",
         (SELECT count(DISTINCT a.user_id) FROM ${analyses} AND a.created_at >= current_date) AS "activeUsersToday",
         (SELECT count(*) FROM app.users u WHERE ${inCompany}) AS "usersTotal",
         (SELECT count(*) FROM app.users u WHERE ${inCompany} AND u.status = 'blocked') AS "usersBlocked",
         (SELECT count(*) FROM app.company_documents d WHERE ($1::bigint IS NULL OR d.company_id = $1::bigint) AND d.status = 'failed') AS "documentsFailed",
         (SELECT count(*) FROM app.company_documents d WHERE ($1::bigint IS NULL OR d.company_id = $1::bigint) AND d.status = 'pending') AS "documentsPending"`,
      [company],
    ),
    query(
      `SELECT hour,
              count(scoped.id) FILTER (WHERE scoped.status = 'recognized') AS recognized,
              count(scoped.id) FILTER (WHERE scoped.status = 'not_recognized') AS not_recognized,
              count(scoped.id) FILTER (WHERE scoped.status = 'failed') AS failed
         FROM generate_series(date_trunc('hour', now()) - make_interval(hours => $2 - 1), date_trunc('hour', now()), interval '1 hour') AS hour
         LEFT JOIN (SELECT a.id, a.status, a.created_at FROM ${analyses}) AS scoped
                ON scoped.created_at >= hour AND scoped.created_at < hour + interval '1 hour'
        GROUP BY hour ORDER BY hour`,
      [company, THROUGHPUT_HOURS],
    ),
    query(
      `SELECT a.machine_id AS "machineId", max(a.machine_name) AS "machineName", count(*) AS analyses
         FROM ${analyses} AND a.status = 'recognized' AND a.created_at >= now() - interval '7 days'
        GROUP BY a.machine_id ORDER BY analyses DESC LIMIT 6`,
      [company],
    ),
    query(
      `SELECT ${ANALYSIS_SUMMARY}, a.reason, a.error_message AS "errorMessage"
         FROM ${analyses} AND a.status <> 'recognized' AND a.created_at >= now() - interval '24 hours'
        ORDER BY a.created_at DESC LIMIT 6`,
      [company],
    ),
  ]);
  return { generatedAt: new Date().toISOString(), kpis, throughput, topMachines, recentProblems };
}
