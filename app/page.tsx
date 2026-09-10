"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowUpTrayIcon,
  CheckCircleIcon,
  CpuChipIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";

type Hit = {
  source?: string;
  page?: number;
  chunk_index?: number;
  score?: number;
  text?: string;
};

type Candidate = {
  machine_id: string;
  machine_name: string;
  score: number;
  reference_image: string;
};

type AskResult = {
  recognized: boolean;
  reason?: string;
  machine?: {
    id: string;
    macchina: string;
    tipo?: string;
    manuali?: string[];
  };
  vision_score?: number;
  vision_candidates?: Candidate[];
  recognition_summary?: {
    status: string;
    exact_model_identified: boolean;
    model_code?: string | null;
    serial_number?: string | null;
    asset_tag?: string | null;
  };
  image_identifiers?: {
    available?: boolean;
    error?: string;
    model_code?: string | null;
    serial_number?: string | null;
    asset_tag?: string | null;
    visible_text?: string[];
    raw_text?: string;
    notes?: string | null;
  };
  answer?: string;
  hits?: Hit[];
  detail?: string;
};

type Chat = { id: number; title: string; knowledge_mode: "base" | "merged" };
type Document = { id: number; filename: string };
type ChatMessage = { id: number; role: "user" | "assistant"; content: string };

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register" | "verify" | "forgot">("login");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authInfo, setAuthInfo] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [companyDomain, setCompanyDomain] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [question, setQuestion] = useState(
    "Riconosci l'oggetto, leggi seriale o modello se visibili, e dimmi cosa posso verificare per controllare se la pompa idraulica funziona correttamente.",
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => Boolean(image && question.trim() && !loading), [image, question, loading]);

  useEffect(() => {
    const savedToken = window.localStorage.getItem("assistant-token");
    if (savedToken) {
      setToken(savedToken);
      void loadWorkspace(savedToken);
    }
  }, []);

  async function loadWorkspace(authToken: string) {
    const headers = { Authorization: `Bearer ${authToken}` };
    const [meResponse, chatsResponse, documentsResponse] = await Promise.all([
      fetch("/api/backend/auth/me", { headers }),
      fetch("/api/backend/chats", { headers }),
      fetch("/api/backend/company/documents", { headers }),
    ]);
    if (!meResponse.ok) {
      window.localStorage.removeItem("assistant-token");
      setToken(null);
      return;
    }
    const me = (await meResponse.json()) as { email?: string; company_domain?: string | null };
    const loadedChats = (await chatsResponse.json()) as Chat[];
    setEmail(me.email ?? "");
    setCompanyDomain(me.company_domain ?? null);
    setChats(loadedChats);
    setActiveChat(loadedChats[0] ?? null);
    if (documentsResponse.ok) setDocuments((await documentsResponse.json()) as Document[]);
  }

  async function onAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setAuthInfo(null);
    const body = new FormData();
    body.append("email", email);
    body.append("password", password);
    if (authMode === "register") body.append("terms_accepted", String(termsAccepted));
    const response = await fetch(`/api/backend/auth/${authMode}`, { method: "POST", body });
    const payload = (await response.json()) as {
      token?: string;
      detail?: string;
      message?: string;
      company_domain?: string | null;
    };
    if (!response.ok) {
      setAuthError(payload.detail ?? "Autenticazione non riuscita.");
      return;
    }
    if (authMode === "register" && !payload.token) {
      // Email verification is required in this environment: the account
      // stays pending until the confirmation link/token is verified.
      setAuthInfo(payload.message ?? "Controlla la tua email per confermare l'account.");
      setAuthMode("verify");
      return;
    }
    if (!payload.token) {
      setAuthError("Autenticazione non riuscita.");
      return;
    }
    window.localStorage.setItem("assistant-token", payload.token);
    setToken(payload.token);
    setCompanyDomain(payload.company_domain ?? null);
    await loadWorkspace(payload.token);
  }

  async function onVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    const body = new FormData();
    body.append("token", verificationToken);
    const response = await fetch("/api/backend/auth/verify-email", { method: "POST", body });
    const payload = (await response.json()) as { message?: string; detail?: string };
    if (!response.ok) {
      setAuthError(payload.detail ?? "Verifica non riuscita.");
      return;
    }
    setAuthInfo(payload.message ?? "Email confermata. Ora puoi accedere.");
    setVerificationToken("");
    setAuthMode("login");
  }

  async function onResendVerification() {
    setAuthError(null);
    setResendingVerification(true);
    try {
      const body = new FormData();
      body.append("email", email);
      const response = await fetch("/api/backend/auth/resend-verification", { method: "POST", body });
      const payload = (await response.json()) as { message?: string; detail?: string };
      setAuthInfo(payload.message ?? "Se l'indirizzo esiste, riceverai una nuova email.");
    } finally {
      setResendingVerification(false);
    }
  }

  async function onForgotSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError(null);
    setForgotSubmitting(true);
    try {
      const body = new FormData();
      body.append("email", forgotEmail);
      const response = await fetch("/api/backend/auth/forgot-password", { method: "POST", body });
      const payload = (await response.json()) as { message?: string; detail?: string };
      if (!response.ok) {
        setAuthError(payload.detail ?? "Richiesta non riuscita.");
        return;
      }
      setAuthInfo(payload.message ?? "Se l'indirizzo esiste, riceverai un'email con le istruzioni.");
      setAuthMode("login");
    } finally {
      setForgotSubmitting(false);
    }
  }

  async function onLogout() {
    if (token) {
      await fetch("/api/backend/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    window.localStorage.removeItem("assistant-token");
    setToken(null);
    setPassword("");
    setAuthError(null);
    setAuthInfo(null);
    setAuthMode("login");
  }

  async function createChat(knowledgeMode: "base" | "merged") {
    if (!token) return;
    const body = new FormData();
    body.append("title", knowledgeMode === "base" ? "Conoscenza base" : "Conoscenza aziendale");
    body.append("knowledge_mode", knowledgeMode);
    body.append("company_document_ids", JSON.stringify(selectedDocuments));
    const response = await fetch("/api/backend/chats", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (response.ok) {
      const created = (await response.json()) as Chat;
      setChats((current) => [created, ...current]);
      setActiveChat(created);
    }
  }

  async function selectChat(chat: Chat | null) {
    setActiveChat(chat);
    if (!token || !chat) {
      setHistory([]);
      return;
    }
    const response = await fetch(`/api/backend/chats/${chat.id}/messages`, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) setHistory((await response.json()) as ChatMessage[]);
  }

  async function uploadDocument(file: File | null) {
    if (!token || !file) return;
    setUploading(true);
    const body = new FormData();
    body.append("document", file);
    const response = await fetch("/api/backend/company/documents", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body,
    });
    if (response.ok) {
      const document = (await response.json()) as Document;
      setDocuments((current) => [document, ...current]);
    }
    setUploading(false);
  }

  function onFileChange(file: File | null) {
    setImage(file);
    setResult(null);
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!image) {
      setError("Carica un'immagine prima di inviare.");
      return;
    }

    const formData = new FormData();
    formData.append("image", image);
    formData.append("question", question);
    if (activeChat) formData.append("chat_id", String(activeChat.id));

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      const payload = (await response.json()) as AskResult;
      if (!response.ok) {
        throw new Error(payload.detail ?? "Richiesta non riuscita.");
      }
      setResult(payload);
      const answer = payload.answer;
      if (activeChat && answer) {
        setHistory((current) => [
          ...current,
          { id: Date.now(), role: "user", content: question.trim() },
          { id: Date.now() + 1, role: "assistant", content: answer },
        ]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore inatteso.");
    } finally {
      setLoading(false);
    }
  }

  return (
    !token ? (
      <main className="grid min-h-screen place-items-center px-4 py-8">
        {authMode === "verify" ? (
          <form className="w-full max-w-md space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm" onSubmit={onVerifySubmit}>
            <div>
              <h1 className="text-2xl font-semibold">Verifica la tua email</h1>
              <p className="mt-1 text-sm text-neutral-600">
                Ti abbiamo inviato un link di conferma. Incolla qui sotto il token ricevuto per attivare l&apos;account.
              </p>
            </div>
            {authInfo ? <p className="text-sm text-emerald-800">{authInfo}</p> : null}
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
              type="text"
              placeholder="Token di verifica"
              value={verificationToken}
              onChange={(event) => setVerificationToken(event.target.value)}
              required
            />
            {authError ? <p className="text-sm text-red-700">{authError}</p> : null}
            <button className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white" type="submit">
              Conferma account
            </button>
            <button
              className="text-sm text-emerald-800 underline disabled:cursor-not-allowed disabled:text-neutral-400"
              type="button"
              disabled={resendingVerification || !email}
              onClick={() => void onResendVerification()}
            >
              {resendingVerification ? "Invio in corso..." : "Non hai ricevuto l'email? Invia di nuovo"}
            </button>
            <button className="text-sm text-emerald-800 underline" type="button" onClick={() => { setAuthMode("login"); setAuthError(null); }}>
              Torna al login
            </button>
          </form>
        ) : authMode === "forgot" ? (
          <form className="w-full max-w-md space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm" onSubmit={onForgotSubmit}>
            <div>
              <h1 className="text-2xl font-semibold">Password dimenticata</h1>
              <p className="mt-1 text-sm text-neutral-600">
                Inserisci la tua email: se l&apos;account esiste, riceverai un link per reimpostare la password.
              </p>
            </div>
            <input
              className="w-full rounded-md border border-neutral-300 px-3 py-2"
              type="email"
              placeholder="Email"
              value={forgotEmail}
              onChange={(event) => setForgotEmail(event.target.value)}
              required
            />
            {authInfo ? <p className="text-sm text-emerald-800">{authInfo}</p> : null}
            {authError ? <p className="text-sm text-red-700">{authError}</p> : null}
            <button
              className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-neutral-400"
              type="submit"
              disabled={forgotSubmitting}
            >
              {forgotSubmitting ? "Invio in corso..." : "Invia istruzioni"}
            </button>
            <button className="text-sm text-emerald-800 underline" type="button" onClick={() => { setAuthMode("login"); setAuthError(null); setAuthInfo(null); }}>
              Torna al login
            </button>
          </form>
        ) : (
          <form className="w-full max-w-md space-y-4 rounded-lg border border-neutral-300 bg-white p-6 shadow-sm" onSubmit={onAuthSubmit}>
            <div>
              <h1 className="text-2xl font-semibold">Assistente macchine</h1>
              <p className="mt-1 text-sm text-neutral-600">Accedi per conservare chat e conoscenze.</p>
            </div>
            <input className="w-full rounded-md border border-neutral-300 px-3 py-2" type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <input className="w-full rounded-md border border-neutral-300 px-3 py-2" type="password" placeholder="Password (almeno 8 caratteri)" value={password} onChange={(event) => setPassword(event.target.value)} required />
            {authMode === "register" ? (
              <label className="flex items-start gap-2 text-xs leading-5 text-neutral-700">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  required
                />
                <span>
                  Accetto i{" "}
                  <a className="text-emerald-800 underline" href="/terms" target="_blank" rel="noreferrer">
                    Termini di servizio
                  </a>{" "}
                  e l&apos;
                  <a className="text-emerald-800 underline" href="/privacy" target="_blank" rel="noreferrer">
                    Informativa sulla privacy
                  </a>
                </span>
              </label>
            ) : null}
            {authInfo ? <p className="text-sm text-emerald-800">{authInfo}</p> : null}
            {authError ? <p className="text-sm text-red-700">{authError}</p> : null}
            <button className="w-full rounded-md bg-emerald-700 px-4 py-3 font-semibold text-white" type="submit">
              {authMode === "login" ? "Accedi" : "Registrati"}
            </button>
            <div className="flex items-center justify-between">
              <button
                className="text-sm text-emerald-800 underline"
                type="button"
                onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(null); setAuthInfo(null); }}
              >
                {authMode === "login" ? "Crea un account" : "Ho gia un account"}
              </button>
              {authMode === "login" ? (
                <button
                  className="text-sm text-emerald-800 underline"
                  type="button"
                  onClick={() => { setForgotEmail(email); setAuthMode("forgot"); setAuthError(null); setAuthInfo(null); }}
                >
                  Password dimenticata?
                </button>
              ) : null}
            </div>
          </form>
        )}
      </main>
    ) : (
    <main className="min-h-screen px-4 py-5 text-neutral-950 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[420px_1fr]">
        <section className="rounded-lg border border-neutral-300 bg-white/90 shadow-sm">
          <div className="border-b border-neutral-200 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-md bg-emerald-700 text-white">
                <CpuChipIcon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Assistente macchine</h1>
                <p className="text-sm text-neutral-600">Immagine, riconoscimento, manuali, risposta tecnica.</p>
              </div>
            </div>
          </div>

          <form className="space-y-5 p-5" onSubmit={onSubmit}>
            <div className="space-y-2 rounded-md bg-neutral-50 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>{email || "Account autenticato"}</span>
                <button type="button" className="text-emerald-800 underline" onClick={() => void onLogout()}>Esci</button>
              </div>
              <select className="w-full rounded-md border border-neutral-300 bg-white px-2 py-2" value={activeChat?.id ?? ""} onChange={(event) => void selectChat(chats.find((chat) => chat.id === Number(event.target.value)) ?? null)}>
                <option value="">Seleziona una chat</option>
                {chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.title} ({chat.knowledge_mode})</option>)}
              </select>
              <div className="flex gap-2">
                <button type="button" className="rounded border border-neutral-300 px-2 py-1" onClick={() => void createChat("base")}>+ Base</button>
                {companyDomain ? <button type="button" className="rounded border border-neutral-300 px-2 py-1" onClick={() => void createChat("merged")}>+ Azienda</button> : null}
              </div>
              {companyDomain ? (
                <>
                  <label className="block text-xs font-medium">Documenti aziendali per la prossima chat</label>
                  {documents.map((document) => <label key={document.id} className="flex gap-2 text-xs"><input type="checkbox" checked={selectedDocuments.includes(document.filename)} onChange={(event) => setSelectedDocuments((current) => event.target.checked ? [...current, document.filename] : current.filter((item) => item !== document.filename))} />{document.filename}</label>)}
                  <input type="file" accept="application/pdf" disabled={uploading} onChange={(event) => void uploadDocument(event.target.files?.[0] ?? null)} />
                </>
              ) : null}
            </div>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-800">Immagine macchina</span>
              <input
                className="sr-only"
                type="file"
                accept="image/*"
                onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                id="machine-image"
              />
              <span className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-neutral-400 bg-neutral-50 px-4 py-6 text-center transition hover:border-emerald-700 hover:bg-emerald-50">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Anteprima immagine caricata"
                    className="max-h-64 w-full rounded-md object-contain"
                  />
                ) : (
                  <>
                    <PhotoIcon className="h-10 w-10 text-neutral-500" />
                    <span className="mt-3 text-sm font-medium">Seleziona o trascina una foto</span>
                    <span className="mt-1 text-xs text-neutral-500">JPG, PNG, WEBP</span>
                  </>
                )}
              </span>
              <label
                htmlFor="machine-image"
                className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium hover:bg-neutral-100"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                Carica immagine
              </label>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-neutral-800">Domanda</span>
              <textarea
                className="min-h-36 w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm leading-6 outline-none ring-emerald-700 transition focus:ring-2"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
              />
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-400"
            >
              <PaperAirplaneIcon className="h-5 w-5" />
              {loading ? "Elaborazione in corso..." : "Analizza e rispondi"}
            </button>

            {error ? (
              <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
          </form>
        </section>

        <section className="space-y-5">
          {history.length ? (
            <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold">Storico chat</h2>
              <div className="mt-3 space-y-3">
                {history.map((message) => <div key={message.id} className={`rounded-md p-3 text-sm leading-6 ${message.role === "user" ? "bg-emerald-50" : "bg-neutral-50"}`}><strong>{message.role === "user" ? "Tu" : "Assistente"}:</strong> {message.content}</div>)}
              </div>
            </div>
          ) : null}
          {!result && !loading ? (
            <div className="rounded-lg border border-neutral-300 bg-white/80 p-8 text-center shadow-sm">
              <DocumentTextIcon className="mx-auto h-12 w-12 text-neutral-500" />
              <h2 className="mt-4 text-lg font-semibold">Risultato analisi</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-600">
                Il risultato mostrerà macchina riconosciuta, confidenza, dati OCR, risposta del modello e fonti RAG dai
                manuali.
              </p>
            </div>
          ) : null}

          {loading ? (
            <div className="rounded-lg border border-neutral-300 bg-white p-8 shadow-sm">
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-700" />
              </div>
              <p className="mt-4 text-sm text-neutral-700">
                Caricamento modelli e generazione risposta. La prima richiesta può richiedere più tempo.
              </p>
            </div>
          ) : null}

          {result ? <ResultView result={result} /> : null}
        </section>
      </div>
    </main>
    )
  );
}

function ResultView({ result }: { result: AskResult }) {
  if (!result.recognized) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900 shadow-sm">
        <div className="flex items-center gap-2 font-semibold">
          <ExclamationTriangleIcon className="h-5 w-5" />
          Immagine non riconosciuta
        </div>
        <p className="mt-2 text-sm">{result.reason ?? "La soglia di riconoscimento non è stata superata."}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
              <CheckCircleIcon className="h-5 w-5" />
              Oggetto riconosciuto
            </div>
            <h2 className="mt-2 text-2xl font-semibold">{result.machine?.macchina}</h2>
            <p className="mt-1 text-sm text-neutral-600">{result.machine?.tipo}</p>
          </div>
          <div className="rounded-md border border-neutral-300 px-3 py-2 text-right">
            <div className="text-xs uppercase text-neutral-500">Confidenza</div>
            <div className="text-lg font-semibold">{formatScore(result.vision_score)}</div>
          </div>
        </div>
        <p className="mt-4 rounded-md bg-neutral-50 p-3 text-sm leading-6 text-neutral-800">
          {result.recognition_summary?.status}
        </p>
      </div>

      <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Risposta</h3>
        <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-neutral-800">{result.answer}</div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">OCR targhetta</h3>
          {result.image_identifiers?.available ? (
            <div className="mt-3 space-y-2 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <IdentifierField label="Modello" value={result.image_identifiers.model_code} />
                <IdentifierField label="Seriale/codice letto" value={result.image_identifiers.serial_number} />
                <IdentifierField label="Asset tag" value={result.image_identifiers.asset_tag} />
              </div>
              {result.image_identifiers.visible_text?.length ? (
                result.image_identifiers.visible_text.slice(0, 8).map((line, index) => (
                  <div key={`${line}-${index}`} className="rounded-md bg-neutral-50 px-3 py-2">
                    {line}
                  </div>
                ))
              ) : (
                <p className="text-neutral-600">Nessun testo classificabile trovato.</p>
              )}
              {result.image_identifiers.notes ? (
                <p className="text-xs leading-5 text-neutral-500">{result.image_identifiers.notes}</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-neutral-600">
              OCR non disponibile: {result.image_identifiers?.error ?? "nessun dettaglio ricevuto"}.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold">Candidati visione</h3>
          <div className="mt-3 space-y-2">
            {result.vision_candidates?.map((candidate) => (
              <div
                key={candidate.machine_id}
                className="flex items-center justify-between gap-3 rounded-md bg-neutral-50 px-3 py-2 text-sm"
              >
                <span>{candidate.machine_name}</span>
                <span className="font-semibold">{formatScore(candidate.score)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-300 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold">Fonti recuperate</h3>
        <div className="mt-3 space-y-3">
          {result.hits?.map((hit, index) => (
            <article key={`${hit.source}-${hit.page}-${hit.chunk_index}-${index}`} className="rounded-md bg-neutral-50 p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{hit.source}</span>
                <span className="text-neutral-500">pagina {hit.page}</span>
                <span className="text-neutral-500">chunk {hit.chunk_index}</span>
                <span className="ml-auto text-neutral-700">{formatScore(hit.score)}</span>
              </div>
              {hit.text ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-neutral-600">{hit.text}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function IdentifierField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-md bg-neutral-50 px-3 py-2">
      <div className="text-xs uppercase text-neutral-500">{label}</div>
      <div className="mt-1 font-semibold text-neutral-900">{value || "n/d"}</div>
    </div>
  );
}

function formatScore(score?: number) {
  if (typeof score !== "number") {
    return "n/d";
  }
  return score.toFixed(3);
}
