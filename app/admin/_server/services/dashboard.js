import "server-only";

import { query, queryOne } from "../db";
import { ANALYSIS_SUMMARY } from "./analyses";

const THROUGHPUT_HOURS = 12;

export async function getDashboard() {
  const [kpis, throughput, topMachines, recentProblems] = await Promise.all([
    queryOne(
      `SELECT
         (SELECT count(*) FROM app.analyses WHERE created_at >= current_date) AS "analysesToday",
         (SELECT count(*) FROM app.analyses WHERE created_at >= current_date AND status = 'not_recognized') AS "notRecognizedToday",
         (SELECT count(*) FROM app.analyses WHERE created_at >= current_date AND status = 'failed') AS "failedToday",
         (SELECT count(*) FILTER (WHERE status = 'recognized')::float / nullif(count(*), 0)
            FROM app.analyses WHERE created_at >= now() - interval '24 hours') AS "recognitionRate24h",
         (SELECT round(avg(duration_ms)) FROM app.analyses
           WHERE created_at >= now() - interval '24 hours' AND status <> 'failed') AS "avgDurationMs24h",
         (SELECT count(DISTINCT user_id) FROM app.analyses WHERE created_at >= current_date) AS "activeUsersToday",
         (SELECT count(*) FROM app.users) AS "usersTotal",
         (SELECT count(*) FROM app.users WHERE status = 'blocked') AS "usersBlocked",
         (SELECT count(*) FROM app.company_documents WHERE status = 'failed') AS "documentsFailed",
         (SELECT count(*) FROM app.company_documents WHERE status = 'pending') AS "documentsPending"`,
    ),
    query(
      `SELECT hour,
              count(a.id) FILTER (WHERE a.status = 'recognized') AS recognized,
              count(a.id) FILTER (WHERE a.status = 'not_recognized') AS not_recognized,
              count(a.id) FILTER (WHERE a.status = 'failed') AS failed
         FROM generate_series(date_trunc('hour', now()) - make_interval(hours => $1 - 1), date_trunc('hour', now()), interval '1 hour') AS hour
         LEFT JOIN app.analyses a ON a.created_at >= hour AND a.created_at < hour + interval '1 hour'
        GROUP BY hour ORDER BY hour`,
      [THROUGHPUT_HOURS],
    ),
    query(
      `SELECT machine_id AS "machineId", max(machine_name) AS "machineName", count(*) AS analyses
         FROM app.analyses
        WHERE status = 'recognized' AND created_at >= now() - interval '7 days'
        GROUP BY machine_id ORDER BY analyses DESC LIMIT 6`,
    ),
    query(
      `SELECT ${ANALYSIS_SUMMARY}, a.reason, a.error_message AS "errorMessage"
         FROM app.analyses a JOIN app.users u ON u.id = a.user_id
        WHERE a.status <> 'recognized' AND a.created_at >= now() - interval '24 hours'
        ORDER BY a.created_at DESC LIMIT 6`,
    ),
  ]);
  return { generatedAt: new Date().toISOString(), kpis, throughput, topMachines, recentProblems };
}
