import "server-only";
import pg from "pg";

import { singleton } from "./memory";

/**
 * Shared PostgreSQL pool (same database as the FastAPI backend). Tables are
 * always schema-qualified (app.*, ops.*) in backoffice queries.
 */

// Return bigint COUNT()/SUM() values as JS numbers (our counts never approach 2^53).
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number.parseFloat(value));

const pool = () =>
  singleton(
    "pg-pool",
    () =>
      new pg.Pool({
        connectionString: process.env.DATABASE_URL ?? "postgresql://postgres@localhost:5432/assistente",
        max: Number(process.env.BACKOFFICE_DB_POOL_MAX ?? 5),
        idleTimeoutMillis: 30_000,
        application_name: "backoffice",
      }),
  );

/**
 * @param {string} text parametrised SQL ($1, $2, ...)
 * @param {unknown[]} [params]
 */
export async function query(text, params = []) {
  const result = await pool().query(text, params);
  return result.rows;
}

export async function queryOne(text, params = []) {
  const rows = await query(text, params);
  return rows[0] ?? null;
}

/** Runs `work(client)` inside a transaction; rolls back if it throws. */
export async function transaction(work) {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await work({
      query: async (text, params = []) => (await client.query(text, params)).rows,
      queryOne: async (text, params = []) => (await client.query(text, params)).rows[0] ?? null,
    });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
