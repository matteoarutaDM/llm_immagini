/** Domain enums shared by the API routes and the UI (mirror the PostgreSQL enums). */

export const ANALYSIS_STATUSES = ["recognized", "not_recognized", "failed"];

export const ANALYSIS_STATUS_LABELS = {
  recognized: "Riconosciuta",
  not_recognized: "Non riconosciuta",
  failed: "Errore",
};

export const KNOWLEDGE_MODES = ["base", "merged"];

export const KNOWLEDGE_MODE_LABELS = { base: "Manuali di base", merged: "Conoscenza aziendale" };

export const DOCUMENT_STATUSES = ["pending", "indexed", "failed", "archived"];

export const DOCUMENT_STATUS_LABELS = {
  pending: "In indicizzazione",
  indexed: "Indicizzato",
  failed: "Indicizzazione fallita",
  archived: "Escluso dalla ricerca",
};

export const USER_STATUSES = ["active", "blocked"];

export const USER_STATUS_LABELS = { active: "Attivo", blocked: "Bloccato" };

export const AUDIT_ACTION_LABELS = {
  "user.block": "Account bloccato",
  "user.unblock": "Account riabilitato",
  "user.role_change": "Ruolo modificato",
  "user.reset_password": "Nuova password temporanea",
  "operator.reset_password": "Password operatore reimpostata",
  "company.create": "Azienda creata",
  "company_admin.create": "Responsabile creato",
  "employee.create": "Dipendente creato",
  "employee.block": "Dipendente sospeso (dal responsabile)",
  "employee.unblock": "Dipendente riattivato (dal responsabile)",
  "employee.reset_password": "Nuova password (dal responsabile)",
  "document.upload": "Documento caricato",
  "document.archive": "Documento escluso dalla ricerca",
  "document.reindex": "Documento reindicizzato",
  "document.delete": "Documento eliminato",
};

export const USER_ROLE_LABELS = { company_admin: "Responsabile", employee: "Dipendente" };

export const PAGE_SIZE_DEFAULT = 20;
export const PAGE_SIZE_MAX = 100;
export const SEARCH_MAX_LENGTH = 120;
