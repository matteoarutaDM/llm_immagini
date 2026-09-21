"use client";

import { useEffect, useState } from "react";
import { Bars3Icon } from "@heroicons/react/24/outline";

import { AnalysisComposer } from "./components/AnalysisComposer";
import { AnswerCard } from "./components/AnswerCard";
import { AuthPanel } from "./components/AuthPanel";
import { CandidatesCard } from "./components/CandidatesCard";
import { ChatSidebar } from "./components/ChatSidebar";
import { DocumentUploader } from "./components/DocumentUploader";
import { DocumentPanel } from "./components/DocumentPanel";
import { EmptyState } from "./components/EmptyState";
import { InferenceProgress } from "./components/InferenceProgress";
import { IndexNotification } from "./components/IndexNotification";
import { MessageList } from "./components/MessageList";
import { OcrCard } from "./components/OcrCard";
import { SourcesPanel } from "./components/SourcesPanel";
import { useAsk } from "./hooks/useAsk";
import { useAuth } from "./hooks/useAuth";
import { useChats } from "./hooks/useChats";
import { useCompanyDocuments } from "./hooks/useCompanyDocuments";
import { authApi, chatsApi, documentsApi } from "./lib/api";

export default function Home() {
  const auth = useAuth();
  const chats = useChats();
  const documents = useCompanyDocuments();
  const ask = useAsk();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [documentsOpen, setDocumentsOpen] = useState(false);

  async function loadWorkspace(authToken) {
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
    if (chatsResponse.ok) {
      chats.hydrate(chatsResponse.data);
      if (chatsResponse.data[0]) await chats.selectChat(authToken, chatsResponse.data[0]);
    }
    if (documentsResponse.ok) documents.hydrate(documentsResponse.data);
  }

  useEffect(() => {
    const saved = auth.restoreSession();
    if (saved) void loadWorkspace(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onAuthSubmit(event) {
    event.preventDefault();
    let session = null;
    if (auth.authMode === "login" || auth.authMode === "register") {
      session = await auth.submitAuth(auth.authMode);
    } else if (auth.authMode === "2fa") {
      session = await auth.verifyTwoFactor();
    } else if (auth.authMode === "2fa-recovery") {
      session = await auth.verifyRecoveryCode();
    } else {
      return;
    }
    if (session) await loadWorkspace(session.token);
  }

  function onSubmitAsk(event) {
    event.preventDefault();
    void ask.submit(auth.token, chats.activeChat?.id, chats.appendExchange);
  }

  if (!auth.token) return <AuthPanel auth={auth} onAuthSubmit={onAuthSubmit} />;

  return (
    <main className="h-dvh overflow-hidden bg-app-bg text-app-text">
      <div className="flex h-full min-w-0">
        <ChatSidebar
          open={navigationOpen}
          onClose={() => setNavigationOpen(false)}
          email={auth.email}
          companyDomain={auth.companyDomain}
          onLogout={() => void auth.logout()}
          chats={chats.chats}
          activeChat={chats.activeChat}
          onSelectChat={(chat) => {
            void chats.selectChat(auth.token, chat);
            setNavigationOpen(false);
          }}
          onDeleteChat={(chat) => void chats.deleteChat(auth.token, chat)}
          onRenameChat={(chat, title) => void chats.renameChat(auth.token, chat, title)}
          renamingChatId={chats.renamingChatId}
          renameError={chats.renameError}
          onCreateChat={(mode) => {
            void chats.createChat(auth.token, mode, mode === "merged" ? documents.selectedDocuments : []);
            setNavigationOpen(false);
          }}
          creatingChat={chats.creatingChat}
          deletingChatId={chats.deletingChatId}
          deleteError={chats.deleteError}
          documentCount={documents.documents.length}
          selectedDocumentCount={documents.selectedDocuments.length}
          onOpenDocuments={() => {
            setDocumentsOpen(true);
            setNavigationOpen(false);
          }}
        />

        <section className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-app-border bg-app-bg/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
            <button
              type="button"
              className="touch-target grid place-items-center rounded-xl text-app-secondary transition hover:bg-app-hover hover:text-app-text lg:hidden"
              onClick={() => setNavigationOpen(true)}
              aria-label="Apri navigazione"
              aria-expanded={navigationOpen}
            >
              <Bars3Icon className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-app-text">{chats.activeChat?.title ?? "Nuova analisi"}</p>
              <p className="truncate text-xs text-app-muted">
                {chats.activeChat?.knowledge_mode === "merged" ? "Conoscenza aziendale" : "Manuali tecnici di base"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-2 text-xs text-app-muted sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-app-accent shadow-[0_0_10px_var(--accent)]" />
                Sistema operativo
              </span>
              {auth.companyDomain ? (
                <button
                  type="button"
                  onClick={() => setDocumentsOpen(true)}
                  className="touch-target rounded-xl border border-app-border px-3 text-xs font-medium text-app-secondary transition hover:border-app-border-strong hover:bg-app-surface hover:text-app-text lg:hidden"
                >
                  PDF {documents.selectedDocuments.length}
                </button>
              ) : null}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
              <div className="mx-auto w-full max-w-4xl">
                <MessageList history={chats.history} />
                {!ask.result && !ask.loading ? <EmptyState /> : null}

                <AnalysisComposer
                  previewUrl={ask.previewUrl}
                  onImageChange={ask.onFileChange}
                  question={ask.question}
                  onQuestionChange={ask.setQuestion}
                  selectedDocumentCount={documents.selectedDocuments.length}
                  hasCompanyAccess={Boolean(auth.companyDomain)}
                  onOpenDocuments={() => setDocumentsOpen(true)}
                  canSubmit={ask.canSubmit}
                  loading={ask.loading}
                  error={ask.error}
                  onSubmit={onSubmitAsk}
                />

                {ask.loading ? <InferenceProgress /> : null}
                {ask.result ? (
                  <div className="mt-10 space-y-8 pb-12">
                    <AnswerCard result={ask.result} />
                    {ask.result.recognized ? (
                      <>
                        <OcrCard identifiers={ask.result.image_identifiers} />
                        <SourcesPanel
                          hits={ask.result.hits}
                          companyDocumentFilenames={documents.documents.map((document) => document.filename)}
                        />
                        <CandidatesCard candidates={ask.result.vision_candidates} />
                      </>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      <DocumentPanel open={documentsOpen && Boolean(auth.companyDomain)} onClose={() => setDocumentsOpen(false)}>
        <DocumentUploader
          documents={documents.documents}
          selectedDocuments={documents.selectedDocuments}
          uploading={documents.uploading}
          deletingId={documents.deletingId}
          deleteError={documents.deleteError}
          onToggle={documents.toggleSelected}
          onUpload={(file) => void documents.upload(auth.token, file)}
          onDelete={(document) => void documents.remove(auth.token, document)}
        />
      </DocumentPanel>
      <IndexNotification
        filename={documents.indexedDocument}
        onDismiss={documents.dismissIndexedNotification}
      />
    </main>
  );
}
