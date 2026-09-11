import type { AskResult, Chat, ChatMessage, CompanyDocument, CurrentUser } from "../types";

export type ApiResponse<T> = { ok: boolean; status: number; data: T };

async function request<T>(input: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch(input, init);
  const data = (await response.json().catch(() => ({}))) as T;
  return { ok: response.ok, status: response.status, data };
}

function authHeaders(token: string | null): HeadersInit | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

export type AuthResponse = {
  token?: string;
  email?: string;
  company_domain?: string | null;
  message?: string;
  detail?: string;
};

export type MessageResponse = { message?: string; detail?: string };

export const authApi = {
  register: (email: string, password: string, termsAccepted: boolean) => {
    const body = new FormData();
    body.append("email", email);
    body.append("password", password);
    body.append("terms_accepted", String(termsAccepted));
    return request<AuthResponse>("/api/backend/auth/register", { method: "POST", body });
  },
  login: (email: string, password: string) => {
    const body = new FormData();
    body.append("email", email);
    body.append("password", password);
    return request<AuthResponse>("/api/backend/auth/login", { method: "POST", body });
  },
  logout: (token: string) =>
    request<MessageResponse>("/api/backend/auth/logout", { method: "POST", headers: authHeaders(token) }),
  me: (token: string) => request<CurrentUser>("/api/backend/auth/me", { headers: authHeaders(token) }),
  verifyEmail: (token: string) => {
    const body = new FormData();
    body.append("token", token);
    return request<MessageResponse>("/api/backend/auth/verify-email", { method: "POST", body });
  },
  resendVerification: (email: string) => {
    const body = new FormData();
    body.append("email", email);
    return request<MessageResponse>("/api/backend/auth/resend-verification", { method: "POST", body });
  },
  forgotPassword: (email: string) => {
    const body = new FormData();
    body.append("email", email);
    return request<MessageResponse>("/api/backend/auth/forgot-password", { method: "POST", body });
  },
  resetPassword: (token: string, password: string) => {
    const body = new FormData();
    body.append("token", token);
    body.append("password", password);
    return request<MessageResponse>("/api/backend/auth/reset-password", { method: "POST", body });
  },
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
};

export const askApi = {
  ask: (token: string | null, image: File, question: string, chatId?: number) => {
    const body = new FormData();
    body.append("image", image);
    body.append("question", question);
    if (chatId !== undefined) body.append("chat_id", String(chatId));
    return request<AskResult>("/api/ask", { method: "POST", headers: authHeaders(token), body });
  },
};
