import type {
  AnalysisEntry,
  AskResult,
  Chat,
  ChatMessage,
  CompanyAuditEntry,
  CompanyDashboard,
  CompanyDocument,
  CurrentUser,
  Employee,
  TwoFactorCodeSentResult,
  TwoFactorConfirmResult,
  TwoFactorRecoveryCodesResult,
  TwoFactorStatus,
} from "../types";

export type ApiResponse<T> = { ok: boolean; status: number; data: T };

async function request<T>(input: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export type AuthResponse = CurrentUser & {
  token?: string;
  message?: string;
  detail?: string;
  requires_2fa?: boolean;
  challenge_token?: string;
};

export type MessageResponse = { message?: string; detail?: string };
export type DeleteResponse = { deleted?: boolean; detail?: string };

export const authApi = {
  login: (email: string, password: string) => {
    const body = new FormData();
    body.append("email", email);
    body.append("password", password);
    return request<AuthResponse>("/api/backend/auth/login", { method: "POST", body });
  },
  logout: (token: string) =>
    request<MessageResponse>("/api/backend/auth/logout", { method: "POST", headers: authHeaders(token) }),
  me: (token: string) => request<CurrentUser>("/api/backend/auth/me", { headers: authHeaders(token) }),
  acceptTerms: (token: string) =>
    request<{ terms_accepted?: boolean; detail?: string }>("/api/backend/auth/accept-terms", {
      method: "POST",
      headers: authHeaders(token),
    }),
  changePassword: (token: string, currentPassword: string, newPassword: string) => {
    const body = new FormData();
    body.append("current_password", currentPassword);
    body.append("new_password", newPassword);
    return request<{ changed?: boolean; token?: string; detail?: string }>("/api/backend/auth/change-password", {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  forgotPassword: (email: string) => {
    const body = new FormData();
    body.append("email", email);
    return request<MessageResponse>("/api/backend/auth/forgot-password", { method: "POST", body });
  },
  resetPassword: (token: string, newPassword: string) => {
    const body = new FormData();
    body.append("token", token);
    body.append("new_password", newPassword);
    return request<MessageResponse>("/api/backend/auth/reset-password", { method: "POST", body });
  },
  setup2fa: (token: string) =>
    request<TwoFactorCodeSentResult & { detail?: string }>("/api/backend/auth/2fa/setup", {
      method: "POST",
      headers: authHeaders(token),
    }),
  confirm2fa: (token: string, code: string) => {
    const body = new FormData();
    body.append("code", code);
    return request<TwoFactorConfirmResult & { detail?: string }>("/api/backend/auth/2fa/confirm", {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  resend2fa: (challengeToken: string) => {
    const body = new FormData();
    body.append("challenge_token", challengeToken);
    return request<{ sent?: boolean; detail?: string }>("/api/backend/auth/2fa/resend", { method: "POST", body });
  },
  verify2fa: (challengeToken: string, code: string) => {
    const body = new FormData();
    body.append("challenge_token", challengeToken);
    body.append("code", code);
    return request<AuthResponse>("/api/backend/auth/2fa/verify", { method: "POST", body });
  },
  recovery2fa: (challengeToken: string, recoveryCode: string) => {
    const body = new FormData();
    body.append("challenge_token", challengeToken);
    body.append("recovery_code", recoveryCode);
    return request<AuthResponse>("/api/backend/auth/2fa/recovery", { method: "POST", body });
  },
  requestDisable2fa: (token: string, password: string) => {
    const body = new FormData();
    body.append("password", password);
    return request<{ sent?: boolean; detail?: string }>("/api/backend/auth/2fa/disable/request-code", {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  disable2fa: (token: string, password: string, code: string, recoveryCode?: string) => {
    const body = new FormData();
    body.append("password", password);
    if (code) body.append("code", code);
    if (recoveryCode) body.append("recovery_code", recoveryCode);
    return request<{ disabled?: boolean; detail?: string }>("/api/backend/auth/2fa/disable", {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  requestRegenerateRecoveryCodes: (token: string, password: string) => {
    const body = new FormData();
    body.append("password", password);
    return request<{ sent?: boolean; detail?: string }>(
      "/api/backend/auth/2fa/recovery-codes/regenerate/request-code",
      { method: "POST", headers: authHeaders(token), body },
    );
  },
  regenerateRecoveryCodes: (token: string, password: string, code: string) => {
    const body = new FormData();
    body.append("password", password);
    body.append("code", code);
    return request<TwoFactorRecoveryCodesResult & { detail?: string }>(
      "/api/backend/auth/2fa/recovery-codes/regenerate",
      { method: "POST", headers: authHeaders(token), body },
    );
  },
  status2fa: (token: string) =>
    request<TwoFactorStatus>("/api/backend/auth/2fa/status", { headers: authHeaders(token) }),
};

export const chatsApi = {
  list: (token: string) => request<Chat[]>("/api/backend/chats", { headers: authHeaders(token) }),
  create: (token: string, knowledgeMode: "base" | "merged", title: string, documentIds: string[]) => {
    const body = new FormData();
    body.append("title", title);
    body.append("knowledge_mode", knowledgeMode);
    body.append("company_document_ids", JSON.stringify(documentIds));
    return request<Chat>("/api/backend/chats", { method: "POST", headers: authHeaders(token), body });
  },
  messages: (token: string, chatId: number) =>
    request<ChatMessage[]>(`/api/backend/chats/${chatId}/messages`, { headers: authHeaders(token) }),
  analyses: (token: string, chatId: number) =>
    request<AnalysisEntry[]>(`/api/backend/chats/${chatId}/analyses`, { headers: authHeaders(token) }),
  delete: (token: string, chatId: number) =>
    request<DeleteResponse>(`/api/backend/chats/${chatId}`, { method: "DELETE", headers: authHeaders(token) }),
  rename: (token: string, chatId: number, title: string) => {
    const body = new FormData();
    body.append("title", title);
    return request<Chat>(`/api/backend/chats/${chatId}`, { method: "PATCH", headers: authHeaders(token), body });
  },
};

export const documentsApi = {
  list: (token: string) =>
    request<CompanyDocument[]>("/api/backend/company/documents", { headers: authHeaders(token) }),
  upload: (token: string, file: File) => {
    const body = new FormData();
    body.append("document", file);
    return request<CompanyDocument>("/api/backend/company/documents", {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  delete: (token: string, documentId: number) =>
    request<DeleteResponse>(`/api/backend/company/documents/${documentId}`, {
      method: "DELETE",
      headers: authHeaders(token),
    }),
  /** Company admin: keep the file but remove it from the RAG. */
  archive: (token: string, documentId: number) =>
    request<CompanyDocument & { detail?: string }>(`/api/backend/company/documents/${documentId}/archive`, {
      method: "POST",
      headers: authHeaders(token),
    }),
  /** Company admin: put an archived or failed document back into the RAG. */
  reindex: (token: string, documentId: number) =>
    request<CompanyDocument & { detail?: string }>(`/api/backend/company/documents/${documentId}/reindex`, {
      method: "POST",
      headers: authHeaders(token),
    }),
};

export type CreatedEmployee = { employee?: Employee; temporary_password?: string; detail?: string };

/** Company admin area: employees, dashboard, activity log. */
export const companyApi = {
  employees: (token: string) =>
    request<Employee[] & { detail?: string }>("/api/backend/company/employees", { headers: authHeaders(token) }),
  createEmployee: (token: string, email: string, fullName: string) => {
    const body = new FormData();
    body.append("email", email);
    body.append("full_name", fullName);
    return request<CreatedEmployee>("/api/backend/company/employees", { method: "POST", headers: authHeaders(token), body });
  },
  setEmployeeStatus: (token: string, employeeId: number, status: "active" | "blocked", reason = "") => {
    const body = new FormData();
    body.append("status", status);
    body.append("reason", reason);
    return request<{ status?: string; detail?: string }>(`/api/backend/company/employees/${employeeId}/status`, {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  resetEmployeePassword: (token: string, employeeId: number) =>
    request<{ temporary_password?: string; detail?: string }>(
      `/api/backend/company/employees/${employeeId}/reset-password`,
      { method: "POST", headers: authHeaders(token) },
    ),
  dashboard: (token: string, days = 30) =>
    request<CompanyDashboard & { detail?: string }>(`/api/backend/company/dashboard?days=${days}`, {
      headers: authHeaders(token),
    }),
  audit: (token: string, page = 1) =>
    request<{ items: CompanyAuditEntry[]; total: number; page: number; page_size: number; detail?: string }>(
      `/api/backend/company/audit?page=${page}`,
      { headers: authHeaders(token) },
    ),
};

export const askApi = {
  ask: (token: string | null, image: File, question: string, chatId?: number, language?: string) => {
    const body = new FormData();
    body.append("image", image);
    body.append("question", question);
    if (language) body.append("language", language);
    if (chatId !== undefined) body.append("chat_id", String(chatId));
    return request<AskResult>("/api/ask", { method: "POST", headers: authHeaders(token), body });
  },
};

export const speechApi = {
  transcribe: (token: string | null, audio: Blob) => {
    const extension = audio.type.includes("mp4") ? "mp4" : audio.type.includes("ogg") ? "ogg" : "webm";
    const body = new FormData();
    body.append("audio", audio, `recording.${extension}`);
    return request<{ text?: string; detail?: string }>("/api/backend/transcribe", {
      method: "POST",
      headers: authHeaders(token),
      body,
    });
  },
  /** The backend reads the text aloud with Piper and returns WAV audio. */
  speak: async (token: string | null, text: string): Promise<SpeakResponse> => {
    const body = new FormData();
    body.append("text", text);
    const response = await fetch("/api/backend/speak", { method: "POST", headers: authHeaders(token), body });
    if (response.ok) return { ok: true, audio: await response.blob() };
    const data = (await response.json().catch(() => ({}))) as { detail?: string };
    return { ok: false, detail: data.detail };
  },
};

export type SpeakResponse = { ok: true; audio: Blob } | { ok: false; detail?: string };
