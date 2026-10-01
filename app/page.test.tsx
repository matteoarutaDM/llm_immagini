import { render, screen, waitFor, within } from "@testing-library/react";
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
      if (url.includes("/analyses")) return jsonResponse([]);
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

describe("accesso", () => {
  it("non offre la registrazione: gli account li crea il responsabile dell'azienda", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<Home />);

    expect(screen.getByRole("button", { name: "Accedi" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Crea un account" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Conferma password")).not.toBeInTheDocument();
    expect(screen.getByText(/credenziali te le fornisce il responsabile/i)).toBeInTheDocument();
  });

  it("dal login si sceglie la lingua: l'interfaccia cambia subito e la scelta resta salvata", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const user = userEvent.setup();
    const { unmount } = render(<Home />);

    const select = screen.getByLabelText("Lingua");
    expect(select).toHaveValue("it");
    await user.selectOptions(select, "es");
    expect(window.localStorage.getItem("answerLanguage")).toBe("es");
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByLabelText("Idioma")).toHaveValue("es");

    unmount();
    render(<Home />);
    await waitFor(() => expect(screen.getByLabelText("Idioma")).toHaveValue("es"));
  });

  it("al primo accesso chiede di accettare i termini, poi apre l'app", async () => {
    let termsAccepted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/login")) {
        return jsonResponse({
          token: "first-login-token",
          email: "nuovo@digitalmens.it",
          company_domain: "digitalmens.it",
          company_name: "Digital Mens",
          role: "employee",
          terms_accepted: false,
          password_is_temporary: true,
        });
      }
      if (url.includes("/auth/accept-terms")) {
        termsAccepted = true;
        return jsonResponse({ terms_accepted: true });
      }
      if (url.includes("/auth/me")) {
        return jsonResponse({
          email: "nuovo@digitalmens.it",
          company_domain: "digitalmens.it",
          company_name: "Digital Mens",
          role: "employee",
          terms_accepted: termsAccepted,
          password_is_temporary: true,
        });
      }
      if (url.includes("/chats") || url.includes("/company/documents")) {
        return termsAccepted ? jsonResponse([]) : jsonResponse({ detail: "Accetta i Termini" }, 403);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);
    await user.type(screen.getByPlaceholderText("Email"), "nuovo@digitalmens.it");
    await user.type(screen.getByPlaceholderText("Password (almeno 8 caratteri)"), "Temporanea12");
    await user.click(screen.getByRole("button", { name: "Accedi" }));

    const accept = await screen.findByRole("button", { name: "Accetta e continua" });
    expect(accept).toBeDisabled();
    expect(screen.getByText(/account di Digital Mens/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    await user.click(accept);

    await waitFor(() => expect(screen.getByText("nuovo@digitalmens.it")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/accept-terms"))).toBe(true);
    expect(window.localStorage.getItem("assistant-token")).toBe("first-login-token");
  });

  it("ricorda la password temporanea e permette di cambiarla dal profilo", async () => {
    window.localStorage.setItem("assistant-token", "old-token");
    let changeBody: FormData | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/me")) {
        return jsonResponse({
          email: "worker@digitalmens.it",
          full_name: "Luca Bianchi",
          company_domain: "digitalmens.it",
          company_name: "Digital Mens",
          role: "employee",
          terms_accepted: true,
          password_is_temporary: true,
        });
      }
      if (url.includes("/auth/change-password")) {
        changeBody = init?.body as FormData;
        return jsonResponse({ changed: true, token: "new-token" });
      }
      if (url.includes("/chats") || url.includes("/company/documents")) return jsonResponse([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    expect(await screen.findByText(/Stai usando la password temporanea ricevuta/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cambia password" }));
    await user.type(screen.getByPlaceholderText("Password attuale"), "Temporanea12");
    await user.type(screen.getByPlaceholderText("Nuova password (almeno 8 caratteri)"), "MiaPassword99");
    await user.type(screen.getByPlaceholderText("Conferma nuova password"), "MiaPassword99");
    await user.click(screen.getByRole("button", { name: "Salva nuova password" }));

    expect(await screen.findByText("Password aggiornata.")).toBeInTheDocument();
    expect(changeBody!.get("current_password")).toBe("Temporanea12");
    expect(changeBody!.get("new_password")).toBe("MiaPassword99");
    expect(window.localStorage.getItem("assistant-token")).toBe("new-token");
    expect(screen.queryByText(/Stai usando la password temporanea ricevuta/)).not.toBeInTheDocument();
  });

  it("il dipendente sceglie i documenti per la chat ma non li carica ne' li elimina", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/auth/me")) {
          return jsonResponse({ email: "worker@digitalmens.it", company_domain: "digitalmens.it", role: "employee", terms_accepted: true });
        }
        if (url.endsWith("/api/backend/chats")) return jsonResponse([]);
        if (url.endsWith("/api/backend/company/documents")) {
          return jsonResponse([{ id: 7, filename: "manuale-linea.pdf", status: "indexed" }]);
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const user = userEvent.setup();
    render(<Home />);
    await user.click(await screen.findByRole("button", { name: "Documenti aziendali 0/1" }));

    expect(screen.getByLabelText("Includi manuale-linea.pdf nella prossima chat aziendale")).toBeInTheDocument();
    expect(screen.queryByLabelText("Carica documento PDF aziendale")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Rimuovi manuale-linea.pdf dalla memoria RAG")).not.toBeInTheDocument();
    expect(screen.getByText("I documenti sono gestiti dal responsabile della tua azienda.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Gestione azienda" })).not.toBeInTheDocument();
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
      if (url.includes("/analyses")) return jsonResponse([]);
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

describe("lingua delle risposte", () => {
  it("mostra la pagina nella lingua scelta e invia a /api/ask la lingua, con la domanda predefinita in italiano", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    window.localStorage.setItem("answerLanguage", "fr");
    if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:fake");
    if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/auth/me")) return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      if (url.includes("/analyses") || url.includes("/chats") || url.includes("/company/documents")) return jsonResponse([]);
      if (url === "/api/ask") return jsonResponse({ recognized: false, reason: "test", question: "domanda" });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);
    await waitFor(() => expect(screen.getByText("user@digitalmens.it")).toBeInTheDocument());

    const fileInput = document.getElementById("machine-image") as HTMLInputElement;
    await user.upload(fileInput, new File(["fake-image-bytes"], "machine.png", { type: "image/png" }));
    expect((screen.getByLabelText("Question technique") as HTMLTextAreaElement).value).toMatch(/^Identifie l'objet sur la photo/);
    await user.click(screen.getByRole("button", { name: /Analyser et répondre/ }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/ask")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/ask")!;
    const body = init?.body as FormData;
    expect(body.get("language")).toBe("fr");
    // The manuals are in Italian: the untouched default question is sent in Italian.
    expect(body.get("question")).toMatch(/^Identifica l'oggetto nella foto/);
  });
});

describe("risposte per chat", () => {
  it("una nuova chat riparte pulita e tornando alla chat precedente la risposta c'e' ancora", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/me")) return jsonResponse({ email: "user@gmail.com", company_domain: null });
      if (url.includes("/messages")) return jsonResponse([]);
      if (url.includes("/chats") && init?.method === "POST") {
        return jsonResponse({ id: 2, title: "Conoscenza base", knowledge_mode: "base" });
      }
      if (url.includes("/chats")) return jsonResponse([{ id: 1, title: "Gru del porto", knowledge_mode: "base" }]);
      if (url.includes("/company/documents")) return jsonResponse([]);
      if (url === "/api/ask") return jsonResponse({ recognized: false, reason: "Foto troppo scura" });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gru del porto" })).toBeInTheDocument());

    const fileInput = document.getElementById("machine-image") as HTMLInputElement;
    await user.upload(fileInput, new File(["img"], "gru.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: /Analizza e rispondi/ }));
    await waitFor(() => expect(screen.getByText("Foto troppo scura")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /Nuova chat/ }));
    await waitFor(() => expect(screen.queryByText("Foto troppo scura")).not.toBeInTheDocument());
    expect(screen.queryByAltText("Anteprima immagine caricata")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Gru del porto" }));
    await waitFor(() => expect(screen.getByText("Foto troppo scura")).toBeInTheDocument());
  });
});

describe("logout", () => {
  it("chiama l'endpoint di logout e torna alla schermata di login", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
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

    await user.click(screen.getByRole("button", { name: /User user@digitalmens\.it/i }));
    await user.click(screen.getByRole("button", { name: "Esci" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/backend/auth/logout",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(window.localStorage.getItem("assistant-token")).toBeNull());
    expect((await screen.findAllByText(/Assistente Macchine/i)).length).toBeGreaterThan(0);
  });
});

describe("storico chat", () => {
  it("rinomina una chat dal dialog personalizzato", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.endsWith("/api/backend/chats") && (!init?.method || init.method === "GET")) {
        return jsonResponse([{ id: 2, title: "Chat recente", knowledge_mode: "base" }]);
      }
      if (url.includes("/company/documents")) return jsonResponse([]);
      if (url.endsWith("/chats/2/messages")) return jsonResponse([]);
      if (url.endsWith("/chats/2") && init?.method === "PATCH") {
        return jsonResponse({ id: 2, title: "Diagnostica motore", knowledge_mode: "base" });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await screen.findByRole("button", { name: "Chat recente" });
    await user.click(screen.getByRole("button", { name: "Rinomina chat Chat recente" }));
    const dialog = screen.getByRole("dialog", { name: "Rinomina chat" });
    expect(dialog).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Nome della chat" });
    await user.clear(input);
    await user.type(input, "Diagnostica motore");
    await user.click(screen.getByRole("button", { name: "Salva nome" }));

    await screen.findByRole("button", { name: "Diagnostica motore" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/chats/2",
      expect.objectContaining({ method: "PATCH", headers: { Authorization: "Bearer fake-token" } }),
    );
  });

  it("elimina una chat e seleziona automaticamente la successiva", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.endsWith("/api/backend/chats") && (!init?.method || init.method === "GET")) {
        return jsonResponse([
          { id: 2, title: "Chat recente", knowledge_mode: "base" },
          { id: 1, title: "Chat precedente", knowledge_mode: "base" },
        ]);
      }
      if (url.includes("/company/documents")) return jsonResponse([]);
      if (url.endsWith("/chats/2/messages")) return jsonResponse([]);
      if (url.endsWith("/chats/1/messages")) return jsonResponse([]);
      if (url.endsWith("/chats/2") && init?.method === "DELETE") return jsonResponse({ deleted: true });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await screen.findByRole("button", { name: "Chat recente" });
    await user.click(screen.getByRole("button", { name: "Elimina chat Chat recente" }));
    expect(screen.getByRole("dialog", { name: "Elimina chat" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Elimina definitivamente" }));

    await waitFor(() => expect(screen.queryByText("Chat recente")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Chat precedente" })).toHaveAttribute("aria-current", "page");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/backend/chats/2",
      expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer fake-token" } }),
    );
  });
});

describe("login con 2FA", () => {
  it("mostra la schermata di verifica e completa il login con il codice via email", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/login")) {
        return jsonResponse({ requires_2fa: true, challenge_token: "chal-123" });
      }
      if (url.includes("/auth/2fa/verify")) {
        return jsonResponse({ token: "verified-token", email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it" });
      }
      if (url.includes("/chats") || url.includes("/company/documents")) return jsonResponse([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await user.type(screen.getByPlaceholderText("Email"), "user@digitalmens.it");
    await user.type(screen.getByPlaceholderText("Password (almeno 8 caratteri)"), "SuperSecret123");
    await user.click(screen.getByRole("button", { name: "Accedi" }));

    await screen.findByText("Ti abbiamo inviato un codice via email. Inseriscilo qui sotto.");
    await user.type(screen.getByPlaceholderText("000000"), "123456");
    await user.click(screen.getByRole("button", { name: "Verifica" }));

    await waitFor(() => expect(screen.getByText("user@digitalmens.it")).toBeInTheDocument());
    expect(window.localStorage.getItem("assistant-token")).toBe("verified-token");
  });

  it("permette di accedere con un codice di recupero", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/login")) {
        return jsonResponse({ requires_2fa: true, challenge_token: "chal-456" });
      }
      if (url.includes("/auth/2fa/recovery")) {
        return jsonResponse({ token: "recovery-token", email: "user@digitalmens.it", company_domain: null });
      }
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: null });
      }
      if (url.includes("/chats") || url.includes("/company/documents")) return jsonResponse([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await user.type(screen.getByPlaceholderText("Email"), "user@digitalmens.it");
    await user.type(screen.getByPlaceholderText("Password (almeno 8 caratteri)"), "SuperSecret123");
    await user.click(screen.getByRole("button", { name: "Accedi" }));

    await screen.findByText("Ti abbiamo inviato un codice via email. Inseriscilo qui sotto.");
    await user.click(screen.getByRole("button", { name: "Usa un codice di recupero" }));

    await screen.findByPlaceholderText("XXXXX-XXXXX");
    await user.type(screen.getByPlaceholderText("XXXXX-XXXXX"), "ABCDE-12345");
    await user.click(screen.getByRole("button", { name: "Accedi con codice di recupero" }));

    await waitFor(() => expect(screen.getByText("user@digitalmens.it")).toBeInTheDocument());
    expect(window.localStorage.getItem("assistant-token")).toBe("recovery-token");
  });
});

describe("password dimenticata", () => {
  it("mostra sempre lo stesso messaggio generico dopo l'invio", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/forgot-password")) {
        return jsonResponse({
          message: "Se esiste un account associato a questa email, riceverai le istruzioni per reimpostare la password.",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Password dimenticata?" }));
    await user.type(screen.getByPlaceholderText("Email"), "chiunque@example.com");
    await user.click(screen.getByRole("button", { name: "Invia istruzioni" }));

    await screen.findByText(/Se esiste un account associato a questa email/);
  });
});

describe("documenti aziendali", () => {
  it("mostra una notifica quando il PDF è indicizzato", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    const indexedDocument = { id: 7, filename: "manuale-linea.pdf", status: "indexed" };
    let documentListRequests = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/me")) {
        return jsonResponse({ email: "user@digitalmens.it", company_domain: "digitalmens.it", role: "company_admin" });
      }
      if (url.endsWith("/api/backend/chats")) return jsonResponse([]);
      if (url.endsWith("/api/backend/company/documents") && init?.method === "POST") {
        return jsonResponse(indexedDocument);
      }
      if (url.endsWith("/api/backend/company/documents")) {
        documentListRequests += 1;
        return jsonResponse(documentListRequests > 1 ? [indexedDocument] : []);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<Home />);

    await screen.findByRole("button", { name: "Documenti aziendali 0/0" });
    await user.click(screen.getByRole("button", { name: "Documenti aziendali 0/0" }));
    const input = screen.getByLabelText("Carica documento PDF aziendale");
    await user.upload(input, new File(["%PDF-test"], "manuale-linea.pdf", { type: "application/pdf" }));

    expect(await screen.findByText("Documento indicizzato")).toBeInTheDocument();
    expect(screen.getAllByText("manuale-linea.pdf").length).toBeGreaterThan(0);
  });
});

describe("dettatura della domanda", () => {
  class FakeMediaRecorder {
    static isTypeSupported = (type: string) => type === "audio/webm";
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable: ((event: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    }
  }

  function stubMicrophone() {
    const stopTrack = vi.fn();
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) },
    });
    return stopTrack;
  }

  function stubWorkspace(transcribeResponse: Response) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/analyses")) return jsonResponse([]);
      if (url.includes("/auth/me")) return jsonResponse({ email: "tecnico@azienda.it", company_domain: null });
      if (url.includes("/chats")) return jsonResponse([]);
      if (url.includes("/company/documents")) return jsonResponse([]);
      if (url.includes("/transcribe")) {
        expect((init?.body as FormData).get("audio")).toBeInstanceOf(Blob);
        return transcribeResponse;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  });

  it("registra, trascrive sul backend e sostituisce la domanda predefinita", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    const stopTrack = stubMicrophone();
    const fetchMock = stubWorkspace(jsonResponse({ text: "Come cambio il filtro dell'olio?" }));
    const user = userEvent.setup();

    render(<Home />);
    await user.click(await screen.findByRole("button", { name: "Detta la domanda" }));
    await user.click(await screen.findByRole("button", { name: "Interrompi dettatura" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Domanda tecnica")).toHaveValue("Come cambio il filtro dell'olio?"),
    );
    expect(stopTrack).toHaveBeenCalled();
    const transcribeCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/transcribe"));
    expect(transcribeCall?.[1]?.headers).toEqual({ Authorization: "Bearer fake-token" });
  });

  it("mostra l'errore del backend e lascia invariata la domanda", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    stubMicrophone();
    stubWorkspace(jsonResponse({ detail: "Non ho capito la domanda." }, 422));
    const user = userEvent.setup();

    render(<Home />);
    const textarea = await screen.findByLabelText("Domanda tecnica");
    const before = (textarea as HTMLTextAreaElement).value;
    await user.click(await screen.findByRole("button", { name: "Detta la domanda" }));
    await user.click(await screen.findByRole("button", { name: "Interrompi dettatura" }));

    expect(await screen.findByText("Non ho capito la domanda.")).toBeInTheDocument();
    expect(textarea).toHaveValue(before);
  });

  it("nasconde il pulsante se il browser non puo' usare il microfono", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    stubWorkspace(jsonResponse({}));

    render(<Home />);
    await screen.findByLabelText("Domanda tecnica");

    expect(screen.queryByRole("button", { name: "Detta la domanda" })).not.toBeInTheDocument();
  });
});

describe("cronologia delle ricerche", () => {
  const previous = {
    id: "a",
    created_at: new Date().toISOString(),
    question: "Perché scatta l'allarme?",
    status: "recognized",
    machine_name: "Carroponte portuale",
    machine_type: "gru",
    vision_score: 0.91,
    answer: "Controllare il limitatore di carico.",
    reason: null,
    sources: [{ source: "manuale.pdf", page: 12 }],
    thumbnail: "data:image/jpeg;base64,/9j/",
  };
  const latest = { ...previous, id: "b", question: "E il freno?", answer: "Verificare le pastiglie." };

  it("mostra le ricerche passate come schede e ci aggiunge la nuova dopo la risposta", async () => {
    window.localStorage.setItem("assistant-token", "fake-token");
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    let analyses = [previous];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/auth/me")) return jsonResponse({ email: "user@gmail.com", company_domain: null });
      if (url.includes("/chats/1/analyses")) return jsonResponse(analyses);
      if (url.includes("/messages")) return jsonResponse([]);
      if (url.includes("/chats")) return jsonResponse([{ id: 1, title: "Gru del porto", knowledge_mode: "base" }]);
      if (url.includes("/company/documents")) return jsonResponse([]);
      if (url === "/api/ask") {
        analyses = [latest, previous];
        return jsonResponse({
          recognized: true,
          machine: { id: "cp", macchina: "Carroponte portuale" },
          answer: latest.answer,
          analysis_id: "b",
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<Home />);

    const history = await screen.findByRole("region", { name: /Ricerche precedenti/ });
    expect(within(history).getByText("Oggi")).toBeInTheDocument();
    expect(within(history).getByText("Carroponte portuale")).toBeInTheDocument();
    expect(within(history).getByText("Confidenza 91%")).toBeInTheDocument();

    await user.upload(document.getElementById("machine-image") as HTMLInputElement, new File(["img"], "gru.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: /Analizza e rispondi/ }));

    // The new answer is shown in full above; the history keeps listing the earlier search only.
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/analyses")).length).toBe(2));
    expect(screen.getByText("Verificare le pastiglie.")).toBeInTheDocument();
    expect(within(history).queryByText(/E il freno/)).not.toBeInTheDocument();
    expect(within(history).getAllByRole("listitem")).toHaveLength(1);

    await user.click(within(history).getByRole("button", { expanded: false }));
    expect(within(history).getByRole("button", { name: "Ascolta la risposta" })).toBeInTheDocument();
    expect(within(history).getByText("manuale.pdf")).toBeInTheDocument();
  });
});
