export type Hit = {
  source?: string;
  page?: number;
  chunk_index?: number;
  score?: number;
  text?: string;
};

export type Candidate = {
  machine_id: string;
  machine_name: string;
  score: number;
  reference_image: string;
};

export type AskResult = {
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
  /** Row of this search in the chat history (null if it couldn't be recorded). */
  analysis_id?: string | null;
  detail?: string;
};

export type Chat = { id: number; title: string; knowledge_mode: "base" | "merged"; detail?: string };
export type DocumentStatus = "pending" | "indexed" | "failed" | "archived";
export type CompanyDocument = {
  id: number;
  filename: string;
  status?: DocumentStatus;
  created_at?: string;
  /** Only in the company admin's view. */
  size_bytes?: number | null;
  indexed_at?: string | null;
  uploaded_by?: string | null;
};
export type ChatMessage = { id: number; role: "user" | "assistant"; content: string };
/** A past search of a chat, as shown in the history cards. */
export type AnalysisEntry = {
  id: string;
  created_at: string;
  question: string;
  status: "recognized" | "not_recognized" | "failed";
  machine_name: string | null;
  machine_type: string | null;
  vision_score: number | null;
  answer: string | null;
  reason: string | null;
  sources: { source: string | null; page: number | null }[];
  /** JPEG data URL of the photo; null for searches made before thumbnails existed. */
  thumbnail: string | null;
};
export type AuthMode = "login" | "forgot" | "2fa" | "2fa-recovery";
export type UserRole = "employee" | "company_admin";
export type CurrentUser = {
  id?: number;
  email?: string;
  full_name?: string | null;
  role?: UserRole;
  company_id?: number | null;
  company_domain?: string | null;
  company_name?: string | null;
  /** The account still uses the password handed over by whoever created it. */
  password_is_temporary?: boolean;
  terms_accepted?: boolean;
  detail?: string;
};

export type Employee = {
  id: number;
  email: string;
  full_name: string | null;
  role: UserRole;
  status: "active" | "blocked";
  status_reason: string | null;
  password_is_temporary: boolean;
  two_factor_enabled: boolean;
  last_login_at: string | null;
  last_active_at: string | null;
  created_at: string;
  analyses_count: number;
};

export type CompanyDashboard = {
  days: number;
  employees: { total: number; active: number; blocked: number; active_in_period: number; temporary_passwords: number };
  documents: Record<"indexed" | "archived" | "pending" | "failed", number>;
  analyses: {
    total: number;
    recognized: number;
    not_recognized: number;
    failed: number;
    with_company_documents: number;
    avg_duration_ms: number | null;
    recognition_rate: number | null;
  };
  daily: { day: string; total: number; recognized: number }[];
  top_machines: { machine_name: string; analyses: number }[];
  per_employee: {
    id: number;
    email: string;
    full_name: string | null;
    role: UserRole;
    status: "active" | "blocked";
    analyses: number;
    recognized: number;
    last_analysis_at: string | null;
    last_active_at: string | null;
  }[];
};

export type CompanyAuditEntry = {
  id: number;
  created_at: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  actor: string | null;
  details: Record<string, string>;
};

export type TwoFactorStatus = { enabled: boolean; recovery_codes_remaining: number };
export type TwoFactorCodeSentResult = { sent: boolean; email?: string };
export type TwoFactorConfirmResult = { enabled: boolean; recovery_codes: string[] };
export type TwoFactorRecoveryCodesResult = { recovery_codes: string[] };
