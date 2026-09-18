"use client";

import { FormEvent, useEffect } from "react";

import { AnswerCard } from "./components/AnswerCard";
import { AuthPanel } from "./components/AuthPanel";
import { CandidatesCard } from "./components/CandidatesCard";
import { ChatHeader } from "./components/ChatHeader";
import { ChatSidebar } from "./components/ChatSidebar";
import { EmptyState } from "./components/EmptyState";
import { InferenceProgress } from "./components/InferenceProgress";
import { MessageList } from "./components/MessageList";
import { OcrCard } from "./components/OcrCard";
import { SourcesPanel } from "./components/SourcesPanel";
import { useAsk } from "./hooks/useAsk";
import { useAuth } from "./hooks/useAuth";
import { useChats } from "./hooks/useChats";
import { useCompanyDocuments } from "./hooks/useCompanyDocuments";
import { authApi, chatsApi, documentsApi } from "./lib/api";

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
    const [meResponse, chatsResponse, documentsResponse] = await Promise.all([
      authApi.me(authToken),
      chatsApi.list(authToken),
      documentsApi.list(authToken),
    ]);
    if (!meResponse.ok) {
      auth.clearSession();
      return;
    }
    auth.hydrateProfile(meResponse.data.email ?? "", meResponse.data.company_domain ?? null);
    chats.hydrate(chatsResponse.data);
    if (chatsResponse.data[0]) await chats.selectChat(authToken, chatsResponse.data[0]);
    if (documentsResponse.ok) documents.hydrate(documentsResponse.data);
  }

  useEffect(() => {
    const saved = auth.restoreSession();
    if (saved) void loadWorkspace(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <section className="h-fit rounded-2xl border border-neutral-200/70 bg-white/90 shadow-xl shadow-neutral-900/[0.06] backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/90 dark:shadow-black/30">
          <ChatHeader />
          <ChatSidebar
            email={auth.email}
            companyDomain={auth.companyDomain}
            onLogout={() => void auth.logout()}
            chats={chats.chats}
            activeChat={chats.activeChat}
            onSelectChat={(chat) => void chats.selectChat(auth.token, chat)}
            onCreateChat={(mode) => void chats.createChat(auth.token, mode, documents.selectedDocuments)}
            creatingChat={chats.creatingChat}
            documents={documents.documents}
            selectedDocuments={documents.selectedDocuments}
            uploading={documents.uploading}
            onToggleDocument={documents.toggleSelected}
            onUploadDocument={(file) => void documents.upload(auth.token, file)}
            previewUrl={ask.previewUrl}
            onImageChange={ask.onFileChange}
            question={ask.question}
            onQuestionChange={ask.setQuestion}
            canSubmit={ask.canSubmit}
            loading={ask.loading}
            error={ask.error}
            onSubmit={onSubmitAsk}
          />
        </section>

        <section className="space-y-5">
          <MessageList history={chats.history} />

          {!ask.result && !ask.loading ? <EmptyState /> : null}
          {ask.loading ? <InferenceProgress /> : null}

          {ask.result ? (
            <div className="space-y-5">
              <AnswerCard result={ask.result} />
              {ask.result.recognized ? (
                <>
                  <div className="grid gap-5 xl:grid-cols-2">
                    <OcrCard identifiers={ask.result.image_identifiers} />
                    <CandidatesCard candidates={ask.result.vision_candidates} />
                  </div>
                  <SourcesPanel
                    hits={ask.result.hits}
                    companyDocumentFilenames={documents.documents.map((document) => document.filename)}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
