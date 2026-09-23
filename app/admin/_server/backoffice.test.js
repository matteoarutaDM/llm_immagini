// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { can } from "../_lib/permissions";

/**
 * Integration tests against a real PostgreSQL database
 * (assistente_backoffice_test, recreated from database/schema.sql + seed.sql).
 * Requires the local server used by the app (e.g. Postgres.app on :5432).
 */

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://postgres@localhost:5432/postgres";
const TEST_DB = "assistente_backoffice_test";
const readSql = (name) => readFileSync(fileURLToPath(new URL(`../../../database/${name}`, import.meta.url)), "utf8");

process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
process.env.SMTP_HOST = "";
process.env.DEBUG_EMAIL_TOKENS = "true";

let db;
let modules;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await db.query(readSql("schema.sql"));
  await db.query(readSql("seed.sql"));

  modules = {
    operators: await import("./operators"),
    otp: await import("./otp"),
    session: await import("./session"),
    users: await import("./services/users"),
    analyses: await import("./services/analyses"),
    dashboard: await import("./services/dashboard"),
    documents: await import("./services/documents"),
    http: await import("./http"),
  };
}, 60_000);

afterAll(async () => {
  await db?.end();
  await globalThis.__backofficeSingletons?.get("pg-pool")?.end();
});

beforeEach(async () => {
  await db.query(
    "TRUNCATE app.analyses, app.chats, app.users, app.companies, ops.audit_log, ops.login_attempts, ops.operator_sessions, ops.operator_otp_challenges RESTART IDENTITY CASCADE",
  );
  await db.query("UPDATE ops.operators SET failed_login_attempts = 0, locked_until = NULL");
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.BACKOFFICE_API_TOKEN;
});

const admin = async () => (await modules.operators.authenticateOperator("admin@backoffice.local", "Admin!2026")).operator;

async function insertUser(email = "tecnico@digitalmens.it") {
  const { rows } = await db.query("INSERT INTO app.users (email, password_hash) VALUES ($1, 'x') RETURNING id::text AS id", [email]);
  return rows[0].id;
}

async function expectDomainError(promise, status, code) {
  const error = await promise.then(() => null, (caught) => caught);
  expect(error).toBeInstanceOf(modules.http.DomainError);
  expect(error.status).toBe(status);
  if (code) expect(error.code).toBe(code);
}

describe("permissions", () => {
  it("keeps blocking and the audit log admin-only", () => {
    expect(can("support", "analyses:view")).toBe(true);
    expect(can("support", "users:block")).toBe(false);
    expect(can("support", "audit:view")).toBe(false);
    expect(can("admin", "users:block")).toBe(true);
    expect(can(undefined, "dashboard:view")).toBe(false);
  });
});

describe("operator authentication (bcrypt in PostgreSQL)", () => {
  it("accepts the right password and reports whether OTP is required", async () => {
    expect((await admin()).requiresOtp).toBe(true);
    const support = await modules.operators.authenticateOperator("SUPPORT@backoffice.local", "Support!2026");
    expect(support.operator).toMatchObject({ role: "support", requiresOtp: false });
  });

  it("gives the same answer for unknown email and wrong password, then locks the account", async () => {
    const { authenticateOperator } = modules.operators;
    expect(await authenticateOperator("nobody@backoffice.local", "x")).toEqual({ error: "invalid" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await authenticateOperator("admin@backoffice.local", "wrong")).toEqual({ error: "invalid" });
    }
    expect(await authenticateOperator("admin@backoffice.local", "Admin!2026")).toEqual({ error: "locked" });
  });
});

describe("OTP challenge", () => {
  const capturedCode = () =>
    console.info.mock.calls.map(([line]) => /OTP per .*: (\d{6})/.exec(line)?.[1]).filter(Boolean).at(-1);

  it("accepts the emailed code exactly once", async () => {
    const { challengeToken } = await modules.otp.startChallenge(await admin());
    const code = capturedCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(await modules.otp.verifyChallenge(challengeToken, code)).toMatchObject({ ok: true, operator: { email: "admin@backoffice.local" } });
    expect(await modules.otp.verifyChallenge(challengeToken, code)).toEqual({ ok: false, reason: "expired" });
  });

  it("burns the challenge after five wrong codes and enforces the resend cooldown", async () => {
    const { challengeToken } = await modules.otp.startChallenge(await admin());
    expect(await modules.otp.resendChallenge(challengeToken)).toMatchObject({ ok: false, reason: "cooldown" });
    for (let attempt = 1; attempt < 5; attempt += 1) {
      expect(await modules.otp.verifyChallenge(challengeToken, "000000")).toMatchObject({ reason: "invalid", attemptsLeft: 5 - attempt });
    }
    expect(await modules.otp.verifyChallenge(challengeToken, "000000")).toEqual({ ok: false, reason: "locked" });
    expect(await modules.otp.verifyChallenge(challengeToken, capturedCode())).toEqual({ ok: false, reason: "expired" });
  });
});

describe("sessions", () => {
  it("resolves a token until it is revoked", async () => {
    const { token } = await modules.session.createSession(await admin(), { ip: "127.0.0.1" });
    expect((await modules.session.resolveSession(token)).operator.email).toBe("admin@backoffice.local");
    await modules.session.destroySession(token);
    expect(await modules.session.resolveSession(token)).toBeNull();
    expect(await modules.session.resolveSession("forged")).toBeNull();
  });
});

describe("user blocking", () => {
  it("requires a reason, logs the user out everywhere and writes the audit log", async () => {
    const id = await insertUser();
    const operator = await admin();
    await expectDomainError(modules.users.setUserStatus(id, "blocked", "", operator, null), 400, "REASON_REQUIRED");

    const detail = await modules.users.setUserStatus(id, "blocked", "uso improprio", operator, "10.0.0.1");
    expect(detail.user).toMatchObject({ status: "blocked", statusReason: "uso improprio", statusChangedBy: "admin@backoffice.local" });

    const { rows } = await db.query("SELECT token_version FROM app.users WHERE id = $1", [id]);
    expect(rows[0].token_version).toBe(1);
    const audit = await db.query("SELECT action, target_id, reason, host(ip) AS ip FROM ops.audit_log");
    expect(audit.rows).toEqual([{ action: "user.block", target_id: id, reason: "uso improprio", ip: "10.0.0.1" }]);

    await expectDomainError(modules.users.setUserStatus(id, "blocked", "di nuovo", operator, null), 409);
    expect((await modules.users.setUserStatus(id, "active", "", operator, null)).user.status).toBe("active");
  });

  it("refuses direct changes to the audit log", async () => {
    await db.query("INSERT INTO ops.audit_log (action, target_type, target_id) VALUES ('user.block', 'user', '1')");
    await expect(db.query("DELETE FROM ops.audit_log")).rejects.toThrow(/append-only/);
  });
});

describe("analyses and dashboard", () => {
  it("lists analyses with status facets, search and a detail view", async () => {
    const userId = await insertUser();
    await db.query(
      `INSERT INTO app.analyses (user_id, knowledge_mode, question, status, machine_id, machine_name, error_message, duration_ms) VALUES
         ($1, 'base', 'Come si cambia il filtro?', 'recognized', 'gru', 'Gru portuale', NULL, 1200),
         ($1, 'base', 'Allarme rosso sul display', 'not_recognized', NULL, NULL, NULL, 900),
         ($1, 'merged', 'Perché non parte?', 'failed', NULL, NULL, 'RuntimeError: GPU', 50)`,
      [userId],
    );
    const page = await modules.analyses.listAnalyses({ q: "", status: null, knowledgeMode: null, machineId: null, userId: null, page: 1, pageSize: 20 });
    expect(page.total).toBe(3);
    expect(page.facets.status).toEqual({ recognized: 1, not_recognized: 1, failed: 1 });

    const filtered = await modules.analyses.listAnalyses({ q: "filtro", status: null, knowledgeMode: null, machineId: null, userId: null, page: 1, pageSize: 20 });
    expect(filtered.items.map((item) => item.machineName)).toEqual(["Gru portuale"]);

    const failed = await modules.analyses.listAnalyses({ q: "", status: "failed", knowledgeMode: null, machineId: null, userId: null, page: 1, pageSize: 20 });
    const detail = await modules.analyses.getAnalysisDetail(failed.items[0].id);
    expect(detail).toMatchObject({ status: "failed", errorMessage: "RuntimeError: GPU", userEmail: "tecnico@digitalmens.it" });
    await expectDomainError(modules.analyses.getAnalysisDetail("not-a-uuid"), 404);

    const dashboard = await modules.dashboard.getDashboard();
    expect(dashboard.kpis).toMatchObject({ analysesToday: 3, failedToday: 1, notRecognizedToday: 1, activeUsersToday: 1 });
    expect(dashboard.throughput).toHaveLength(12);
    expect(dashboard.recentProblems).toHaveLength(2);
  });
});

describe("document deletion", () => {
  async function insertDocument() {
    const { rows } = await db.query("INSERT INTO app.companies (domain, name) VALUES ('digitalmens.it', 'digitalmens.it') RETURNING id");
    const doc = await db.query(
      "INSERT INTO app.company_documents (company_id, filename, storage_path) VALUES ($1, 'Manuale gru.pdf', '/tmp/x.pdf') RETURNING id::text AS id",
      [rows[0].id],
    );
    return doc.rows[0].id;
  }

  it("asks the backend with the internal token and writes the audit log", async () => {
    const id = await insertDocument();
    process.env.BACKOFFICE_API_TOKEN = "secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await modules.documents.deleteDocument(id, "manuale obsoleto", await admin(), "10.0.0.2");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://127.0.0.1:8000/internal/company-documents/${id}`);
    expect(init).toMatchObject({ method: "DELETE", headers: { "X-Internal-Token": "secret" } });
    const audit = await db.query("SELECT action, target_type, reason, metadata FROM ops.audit_log");
    expect(audit.rows).toEqual([
      { action: "document.delete", target_type: "document", reason: "manuale obsoleto", metadata: { filename: "Manuale gru.pdf", companyDomain: "digitalmens.it" } },
    ]);
  });

  it("requires a reason and a configured token, and audits nothing when the backend refuses", async () => {
    const id = await insertDocument();
    const operator = await admin();
    await expectDomainError(modules.documents.deleteDocument(id, "", operator, null), 400, "REASON_REQUIRED");
    await expectDomainError(modules.documents.deleteDocument(id, "x", operator, null), 503, "BACKEND_TOKEN_MISSING");

    process.env.BACKOFFICE_API_TOKEN = "wrong";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expectDomainError(modules.documents.deleteDocument(id, "x", operator, null), 502, "BACKEND_ERROR");
    expect((await db.query("SELECT count(*)::int AS n FROM ops.audit_log")).rows[0].n).toBe(0);
  });
});
