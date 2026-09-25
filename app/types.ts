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
export type DocumentStatus = "pending" | "indexed" | "failed";
export type CompanyDocument = { id: number; filename: string; status?: DocumentStatus; created_at?: string };
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
export type AuthMode = "login" | "register" | "verify" | "forgot" | "2fa" | "2fa-recovery";
export type CurrentUser = { email?: string; company_domain?: string | null };

export type TwoFactorStatus = { enabled: boolean; recovery_codes_remaining: number };
export type TwoFactorCodeSentResult = { sent: boolean; email?: string };
export type TwoFactorConfirmResult = { enabled: boolean; recovery_codes: string[] };
export type TwoFactorRecoveryCodesResult = { recovery_codes: string[] };
