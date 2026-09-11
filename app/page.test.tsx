import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("utente senza azienda", () => {
  it("non vede il pulsante '+ Azienda' ne' l'upload documenti", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "solo@gmail.com", company_domain: null });
      }
      if (url.includes("/chats")) {
        return jsonResponse([]);
      }
      if (url.includes("/company/documents")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Home />);

    await waitFor(() => expect(screen.getByText("solo@gmail.com")).toBeInTheDocument());

    expect(screen.queryByText("+ Azienda")).not.toBeInTheDocument();
    expect(screen.queryByText(/Documenti aziendali/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"][accept="application/pdf"]')).toBeNull();
  });
});

describe("flusso di registrazione", () => {
  it("effettua il login immediato dopo la registrazione", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/register")) {
        return jsonResponse({
          token: "fresh-token",
          email: "nuovo@digitalmens.it",
          company_domain: "digitalmens.it",
        });
      }
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "nuovo@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.includes("/chats")) {
        return jsonResponse([]);
      }
      if (url.includes("/company/documents")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Crea un account" }));
    await user.type(screen.getByPlaceholderText("Email"), "nuovo@digitalmens.it");
    await user.type(screen.getByPlaceholderText(/Password/), "SuperSecret123");
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Registrati" }));

    await waitFor(() => expect(window.localStorage.getItem("assistant-token")).toBe("fresh-token"));
    await waitFor(() => expect(screen.getByText("nuovo@digitalmens.it")).toBeInTheDocument());
  });

  it("non invia la richiesta se i termini non sono accettati", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Crea un account" }));
    await user.type(screen.getByPlaceholderText("Email"), "nuovo@digitalmens.it");
    await user.type(screen.getByPlaceholderText(/Password/), "SuperSecret123");
    await user.click(screen.getByRole("button", { name: "Registrati" }));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("password dimenticata", () => {
  it("invia la richiesta di reset e torna al login", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/forgot-password")) {
        return jsonResponse({ message: "Se l'indirizzo esiste, riceverai un'email con le istruzioni." });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Password dimenticata?" }));
    await user.type(screen.getByPlaceholderText("Email"), "user@digitalmens.it");
    await user.click(screen.getByRole("button", { name: "Invia istruzioni" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/backend/auth/forgot-password", expect.objectContaining({ method: "POST" })),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Accedi" })).toBeInTheDocument());
  });
});

describe("invio domanda (/api/ask)", () => {
  it("include sempre l'header Authorization con il token dell'utente", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    if (!URL.createObjectURL) {
      URL.createObjectURL = vi.fn(() => "blob:fake");
    }
    if (!URL.revokeObjectURL) {
      URL.revokeObjectURL = vi.fn();
    }
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.includes("/chats")) {
        return jsonResponse([]);
      }
      if (url.includes("/company/documents")) {
        return jsonResponse([]);
      }
      if (url === "/api/ask") {
        return jsonResponse({ recognized: false, reason: "test", question: "domanda" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await waitFor(() => expect(screen.getByText("user@digitalmens.it")).toBeInTheDocument());

    const fileInput = document.getElementById("machine-image") as HTMLInputElement;
    const file = new File(["fake-image-bytes"], "machine.png", { type: "image/png" });
    await user.upload(fileInput, file);

    await user.click(screen.getByRole("button", { name: /Analizza e rispondi/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ask",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer fake-token" },
        }),
      ),
    );
  });
});

describe("logout", () => {
  it("chiama l'endpoint di logout e torna alla schermata di login", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.includes("/chats")) {
        return jsonResponse([]);
      }
      if (url.includes("/company/documents")) {
        return jsonResponse([]);
      }
      if (url.includes("/auth/logout")) {
        return jsonResponse({ message: "Logout effettuato." });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await waitFor(() => expect(screen.getByText("user@digitalmens.it")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Esci" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/backend/auth/logout",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(window.localStorage.getItem("assistant-token")).toBeNull());
    expect(await screen.findByText("Assistente macchine")).toBeInTheDocument();
  });
});
