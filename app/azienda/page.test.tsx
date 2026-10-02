import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import CompanyAdminPage from "./page";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const ADMIN = {
  email: "boss@acme.it",
  full_name: "Mario Rossi",
  role: "company_admin",
  company_domain: "acme.it",
  company_name: "Acme",
  terms_accepted: true,
};

const DASHBOARD = {
  days: 30,
  employees: { total: 2, active: 2, blocked: 0, active_in_period: 1, temporary_passwords: 1 },
  documents: { indexed: 1, archived: 1, pending: 0, failed: 0 },
  analyses: {
    total: 4, recognized: 3, not_recognized: 1, failed: 0, with_company_documents: 2,
    avg_duration_ms: 20000, recognition_rate: 0.75,
  },
  daily: [
    { day: "2026-09-28", total: 1, recognized: 1 },
    { day: "2026-09-29", total: 3, recognized: 2 },
  ],
  top_machines: [{ machine_name: "Gru semovente", analyses: 3 }],
  per_employee: [
    { id: 2, email: "worker@acme.it", full_name: "Luca Bianchi", role: "employee", status: "active",
      analyses: 4, recognized: 3, last_analysis_at: "2026-09-29T08:00:00Z", last_active_at: null },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem("assistant-token", "admin-token");
  window.history.replaceState(null, "", "/azienda");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("gestione azienda", () => {
  it("è riservata al responsabile: un dipendente vede solo l'avviso", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...ADMIN, role: "employee" })));
    render(<CompanyAdminPage />);
    expect(await screen.findByText("Area riservata")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dipendenti" })).not.toBeInTheDocument();
  });

  it("mostra le statistiche dell'azienda nella panoramica", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/auth/me")) return jsonResponse(ADMIN);
        if (url.includes("/company/dashboard")) return jsonResponse(DASHBOARD);
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    render(<CompanyAdminPage />);

    expect(await screen.findByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Gestione azienda · Acme")).toBeInTheDocument();
    expect(screen.getByText("Gru semovente")).toBeInTheDocument();
    expect(screen.getByText("Luca Bianchi")).toBeInTheDocument();
    expect(screen.getByText(/il contenuto delle domande non è visibile/)).toBeInTheDocument();
  });

  it("crea un dipendente e mostra una sola volta la password temporanea", async () => {
    let employees = [
      { id: 1, email: "boss@acme.it", full_name: "Mario Rossi", role: "company_admin", status: "active",
        status_reason: null, password_is_temporary: false, two_factor_enabled: false, last_login_at: null,
        last_active_at: null, created_at: "2026-09-01T00:00:00Z", analyses_count: 0 },
    ];
    let createBody: FormData | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/auth/me")) return jsonResponse(ADMIN);
        if (url.endsWith("/company/employees") && init?.method === "POST") {
          createBody = init.body as FormData;
          const employee = { ...employees[0], id: 2, email: "worker@acme.it", full_name: "Luca Bianchi",
            role: "employee", password_is_temporary: true };
          employees = [...employees, employee];
          return jsonResponse({ employee, temporary_password: "Temp4Worker9x" });
        }
        if (url.endsWith("/company/employees")) return jsonResponse(employees);
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    window.history.replaceState(null, "", "/azienda?sezione=dipendenti");
    const user = userEvent.setup();
    render(<CompanyAdminPage />);

    await user.type(await screen.findByPlaceholderText("Email di lavoro"), "worker@acme.it");
    await user.type(screen.getByPlaceholderText("Nome e cognome"), "Luca Bianchi");
    await user.click(screen.getByRole("button", { name: "Crea account" }));

    expect(await screen.findByText("Temp4Worker9x")).toBeInTheDocument();
    expect(createBody!.get("email")).toBe("worker@acme.it");
    const row = (await screen.findByText("worker@acme.it", { selector: "span" })).closest("tr")!;
    expect(within(row).getByText("Password temporanea")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Sospendi" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Ho preso nota, chiudi" }));
    expect(screen.queryByText("Temp4Worker9x")).not.toBeInTheDocument();
  });

  it("esclude un documento dalla ricerca e lo reindicizza", async () => {
    let status = "indexed";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/auth/me")) return jsonResponse(ADMIN);
        if (url.endsWith("/archive")) {
          calls.push("archive");
          status = "archived";
          return jsonResponse({ id: 7, filename: "manuale.pdf", status });
        }
        if (url.endsWith("/reindex")) {
          calls.push("reindex");
          status = "indexed";
          return jsonResponse({ id: 7, filename: "manuale.pdf", status });
        }
        if (url.endsWith("/company/documents") && !init?.method) {
          return jsonResponse([{ id: 7, filename: "manuale.pdf", status, created_at: "2026-09-29T08:00:00Z", size_bytes: 2048 }]);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );
    window.history.replaceState(null, "", "/azienda?sezione=documenti");
    const user = userEvent.setup();
    render(<CompanyAdminPage />);

    await user.click(await screen.findByRole("button", { name: "Escludi dalla ricerca" }));
    expect(await screen.findByText("Escluso dalla ricerca")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Indicizza" }));
    expect(await screen.findByText("Indicizzato")).toBeInTheDocument();
    expect(calls).toEqual(["archive", "reindex"]);
  });
});
