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
  const auth = useAuth();
  const chats = useChats();
  const documents = useCompanyDocuments();
  const ask = useAsk();

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

  async function onAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (auth.authMode !== "login" && auth.authMode !== "register") return;
    const session = await auth.submitAuth(auth.authMode);
    if (session) await loadWorkspace(session.token);
  }

  function onSubmitAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask.submit(auth.token, chats.activeChat?.id, chats.appendExchange);
  }

  if (!auth.token) return <AuthPanel auth={auth} onAuthSubmit={onAuthSubmit} />;

  return (
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
            onDeleteChat={(chat) => void chats.deleteChat(auth.token, chat)}
            onRenameChat={(chat, title) => void chats.renameChat(auth.token, chat, title)}
            renamingChatId={chats.renamingChatId}
            renameError={chats.renameError}
            onCreateChat={(mode) => void chats.createChat(auth.token, mode, documents.selectedDocuments)}
            creatingChat={chats.creatingChat}
            deletingChatId={chats.deletingChatId}
            deleteError={chats.deleteError}
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
