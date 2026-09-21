import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=reset-token-123"),
}));

import ResetPasswordPage from "./page";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("pagina di reset password", () => {
  it("invia il token e la nuova password e mostra la conferma", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/reset-password")) {
        const body = init?.body as FormData;
        expect(body.get("token")).toBe("reset-token-123");
        expect(body.get("new_password")).toBe("BrandNewPass456");
        return jsonResponse({ reset: true });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByPlaceholderText("Nuova password (almeno 8 caratteri)"), "BrandNewPass456");
    await user.type(screen.getByPlaceholderText("Conferma nuova password"), "BrandNewPass456");
    await user.click(screen.getByRole("button", { name: "Reimposta password" }));

    await screen.findByText("Password aggiornata");
  });

  it("mostra un errore se le due password non coincidono", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByPlaceholderText("Nuova password (almeno 8 caratteri)"), "BrandNewPass456");
    await user.type(screen.getByPlaceholderText("Conferma nuova password"), "Different123");
    await user.click(screen.getByRole("button", { name: "Reimposta password" }));

    await screen.findByText("Le due password non coincidono.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mostra l'errore del backend per un token scaduto o non valido", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: "Il link per reimpostare la password e' scaduto." }, 400));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<ResetPasswordPage />);

    await user.type(screen.getByPlaceholderText("Nuova password (almeno 8 caratteri)"), "BrandNewPass456");
    await user.type(screen.getByPlaceholderText("Conferma nuova password"), "BrandNewPass456");
    await user.click(screen.getByRole("button", { name: "Reimposta password" }));

    await screen.findByText("Il link per reimpostare la password e' scaduto.");
  });
});
