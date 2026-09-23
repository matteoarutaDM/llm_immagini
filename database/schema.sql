-- =============================================================================
-- Assistente Macchine — schema PostgreSQL (sito + backoffice admin/support)
-- =============================================================================
-- PostgreSQL 14+ (testato su 18). Da eseguire su un database vuoto.
-- Il backend FastAPI lo applica da solo al primo avvio se lo schema `app` non
-- esiste; in alternativa si esegue da pgAdmin (Query Tool) o con psql.
--
--   app  → sito: aziende, utenti, autenticazione/2FA, documenti aziendali,
--          chat, messaggi, analisi (foto + domanda → riconoscimento + risposta)
--   ops  → backoffice: operatori (admin/support), sessioni, OTP, tentativi di
--          accesso, audit log
--
-- Convenzioni: PK bigint IDENTITY (UUID per le analisi, esposte negli URL del
-- backoffice), date timestamptz, segreti salvati solo come hash, email citext.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), crypt() per le password operatori
CREATE EXTENSION IF NOT EXISTS citext;     -- email case-insensitive
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- ricerca ILIKE veloce (email, domande)

CREATE SCHEMA app;
CREATE SCHEMA ops;

-- -----------------------------------------------------------------------------
-- Tipi
-- -----------------------------------------------------------------------------
CREATE TYPE app.user_status      AS ENUM ('active', 'blocked');
CREATE TYPE app.knowledge_mode   AS ENUM ('base', 'merged');
CREATE TYPE app.message_role     AS ENUM ('user', 'assistant');
CREATE TYPE app.document_status  AS ENUM ('pending', 'indexed', 'failed');
CREATE TYPE app.otp_purpose      AS ENUM ('enable', 'login', 'disable', 'regenerate');
CREATE TYPE app.analysis_status  AS ENUM ('recognized', 'not_recognized', 'failed');
CREATE TYPE ops.operator_role    AS ENUM ('admin', 'support');

-- -----------------------------------------------------------------------------
-- Funzioni di servizio
-- -----------------------------------------------------------------------------
CREATE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Tabelle append-only: vietate UPDATE/DELETE dirette. Restano ammesse le
-- modifiche fatte dalle foreign key (pg_trigger_depth() > 1), es. SET NULL
-- quando si elimina un operatore.
CREATE FUNCTION app.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'la tabella %.% è append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

-- =============================================================================
-- ops.operators (prima di app.users, che la referenzia)
-- =============================================================================
CREATE TABLE ops.operators (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                 citext NOT NULL UNIQUE,
  name                  text NOT NULL CHECK (length(btrim(name)) > 0),
  role                  ops.operator_role NOT NULL,
  password_hash         text NOT NULL,              -- bcrypt: crypt(password, gen_salt('bf', 12))
  requires_otp          boolean NOT NULL DEFAULT true,
  is_active             boolean NOT NULL DEFAULT true,
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operators_admin_requires_otp CHECK (role <> 'admin' OR requires_otp)
);
COMMENT ON TABLE ops.operators IS 'Staff del backoffice (distinti dagli utenti del sito).';
COMMENT ON COLUMN ops.operators.requires_otp IS 'Codice via email dopo la password: sempre per gli admin, no per il support.';

CREATE TRIGGER operators_updated_at BEFORE UPDATE ON ops.operators
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- =============================================================================
-- app: aziende e utenti
-- =============================================================================
CREATE TABLE app.companies (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  domain      citext NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.companies IS 'Aziende riconosciute dal dominio email non pubblico; condividono i documenti.';

CREATE TABLE app.users (
  id                        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                     citext NOT NULL UNIQUE,
  password_hash             text NOT NULL,          -- PBKDF2-SHA256 "salt$digest" (backend/database.py)
  company_id                bigint REFERENCES app.companies(id) ON DELETE SET NULL,

  -- sicurezza accesso
  token_version             integer NOT NULL DEFAULT 0,   -- +1 = tutte le sessioni invalidate
  failed_login_attempts     integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until              timestamptz,
  terms_accepted_at         timestamptz,

  -- 2FA via email
  two_factor_enabled        boolean NOT NULL DEFAULT false,
  two_factor_secret         text,
  two_factor_pending_secret text,
  two_factor_confirmed_at   timestamptz,

  -- stato account, gestito dal backoffice
  status                    app.user_status NOT NULL DEFAULT 'active',
  status_reason             text,
  status_changed_at         timestamptz,
  status_changed_by         bigint REFERENCES ops.operators(id) ON DELETE SET NULL,

  last_login_at             timestamptz,
  last_active_at            timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_blocked_needs_reason CHECK (status = 'active' OR status_reason IS NOT NULL)
);
COMMENT ON COLUMN app.users.token_version IS 'Incrementato a logout, reset password, disattivazione 2FA e blocco: invalida i token emessi.';

CREATE INDEX users_company_idx      ON app.users (company_id);
CREATE INDEX users_blocked_idx      ON app.users (status) WHERE status = 'blocked';
CREATE INDEX users_last_active_idx  ON app.users (last_active_at DESC NULLS LAST);
CREATE INDEX users_email_trgm_idx   ON app.users USING gin ((email::text) gin_trgm_ops);

CREATE TRIGGER users_updated_at BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- -----------------------------------------------------------------------------
-- Token e codici utente (solo hash)
-- -----------------------------------------------------------------------------
CREATE TABLE app.user_recovery_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_recovery_codes_unused_idx ON app.user_recovery_codes (user_id) WHERE used_at IS NULL;

CREATE TABLE app.password_reset_tokens (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON app.password_reset_tokens (user_id);

CREATE TABLE app.two_factor_email_codes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  purpose     app.otp_purpose NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX two_factor_email_codes_active_idx
  ON app.two_factor_email_codes (user_id, purpose, id DESC) WHERE used_at IS NULL;

-- =============================================================================
-- app: documenti aziendali, chat, messaggi
-- =============================================================================
CREATE TABLE app.company_documents (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    bigint NOT NULL REFERENCES app.companies(id) ON DELETE CASCADE,
  uploaded_by   bigint REFERENCES app.users(id) ON DELETE SET NULL,
  filename      text NOT NULL,                 -- nome originale mostrato all'utente
  storage_path  text NOT NULL UNIQUE,          -- file su disco (nome casuale)
  size_bytes    bigint CHECK (size_bytes >= 0),
  status        app.document_status NOT NULL DEFAULT 'pending',
  indexed_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX company_documents_company_idx ON app.company_documents (company_id, created_at DESC);
CREATE INDEX company_documents_status_idx  ON app.company_documents (status) WHERE status <> 'indexed';

CREATE TABLE app.chats (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id               bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  title                 text NOT NULL CHECK (length(btrim(title)) > 0),
  knowledge_mode        app.knowledge_mode NOT NULL DEFAULT 'base',
  -- nomi file dei documenti aziendali selezionati per la chat (vuoto = tutti)
  company_document_ids  text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chats_user_idx ON app.chats (user_id, updated_at DESC);

CREATE TABLE app.messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id     bigint NOT NULL REFERENCES app.chats(id) ON DELETE CASCADE,
  role        app.message_role NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_chat_idx ON app.messages (chat_id, id);

-- =============================================================================
-- app.analyses: una riga per ogni richiesta foto + domanda (/api/ask)
-- La foto non viene conservata (è un file temporaneo), solo i suoi metadati.
-- =============================================================================
CREATE TABLE app.analyses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 bigint NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  chat_id                 bigint REFERENCES app.chats(id) ON DELETE SET NULL,
  knowledge_mode          app.knowledge_mode NOT NULL,
  question                text NOT NULL,
  status                  app.analysis_status NOT NULL,

  -- riconoscimento
  machine_id              text,
  machine_name            text,
  machine_type            text,
  vision_score            real,
  exact_model_identified  boolean,
  model_code              text,
  serial_number           text,
  asset_tag               text,
  vision_candidates       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{machine_id, machine_name, score}]

  -- risposta
  answer                  text,
  sources                 jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{source, page, score, excerpt}]
  reason                  text,          -- motivo del mancato riconoscimento (mostrato all'utente)
  error_message           text,          -- errore interno (visibile solo nel backoffice)

  -- immagine caricata
  image_filename          text,
  image_content_type      text,
  image_size_bytes        bigint CHECK (image_size_bytes >= 0),

  duration_ms             integer CHECK (duration_ms >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT analyses_recognized_has_machine CHECK (status <> 'recognized' OR machine_id IS NOT NULL),
  CONSTRAINT analyses_failed_has_error CHECK (status <> 'failed' OR error_message IS NOT NULL)
);
CREATE INDEX analyses_created_idx        ON app.analyses (created_at DESC);
CREATE INDEX analyses_user_created_idx   ON app.analyses (user_id, created_at DESC);
CREATE INDEX analyses_status_created_idx ON app.analyses (status, created_at DESC);
CREATE INDEX analyses_machine_idx        ON app.analyses (machine_id, created_at DESC) WHERE machine_id IS NOT NULL;
CREATE INDEX analyses_chat_idx           ON app.analyses (chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX analyses_question_trgm_idx  ON app.analyses USING gin (question gin_trgm_ops);

-- =============================================================================
-- ops: sessioni, OTP, tentativi di accesso, audit
-- =============================================================================
CREATE TABLE ops.operator_sessions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id  bigint NOT NULL REFERENCES ops.operators(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,          -- sha256 esadecimale del cookie bo_session
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  CONSTRAINT operator_sessions_expiry CHECK (expires_at > created_at)
);
CREATE INDEX operator_sessions_operator_idx ON ops.operator_sessions (operator_id) WHERE revoked_at IS NULL;
CREATE INDEX operator_sessions_expires_idx  ON ops.operator_sessions (expires_at);

CREATE TABLE ops.operator_otp_challenges (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id   bigint NOT NULL REFERENCES ops.operators(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,         -- sha256 esadecimale del challengeToken
  code_hash     text NOT NULL,                -- sha256 esadecimale del codice a 6 cifre
  attempts      smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  resend_count  smallint NOT NULL DEFAULT 0 CHECK (resend_count BETWEEN 0 AND 3),
  last_sent_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operator_otp_challenges_operator_idx ON ops.operator_otp_challenges (operator_id, created_at DESC);

CREATE TABLE ops.login_attempts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email           citext NOT NULL,
  operator_id     bigint REFERENCES ops.operators(id) ON DELETE SET NULL,
  ip              inet,
  success         boolean NOT NULL,
  failure_reason  text,                       -- invalid_credentials, otp_invalid, otp_locked, ...
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_email_idx ON ops.login_attempts (email, created_at DESC);
CREATE INDEX login_attempts_ip_idx    ON ops.login_attempts (ip, created_at DESC);

CREATE TABLE ops.audit_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operator_id  bigint REFERENCES ops.operators(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (action ~ '^[a-z_]+\.[a-z_]+$'),   -- es. 'user.block'
  target_type  text NOT NULL,
  target_id    text NOT NULL,
  reason       text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_target_idx   ON ops.audit_log (target_type, target_id, created_at DESC);
CREATE INDEX audit_log_operator_idx ON ops.audit_log (operator_id, created_at DESC);
CREATE INDEX audit_log_created_idx  ON ops.audit_log USING brin (created_at);

CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON ops.audit_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_mutation();

-- =============================================================================
-- Manutenzione: pulizia di token, codici e sessioni scaduti (es. ogni notte)
-- =============================================================================
CREATE FUNCTION ops.purge_expired_secrets() RETURNS void
LANGUAGE sql AS $$
  DELETE FROM app.password_reset_tokens   WHERE expires_at < now() - interval '7 days';
  DELETE FROM app.two_factor_email_codes  WHERE expires_at < now() - interval '7 days';
  DELETE FROM ops.operator_otp_challenges WHERE expires_at < now() - interval '1 day';
  DELETE FROM ops.operator_sessions       WHERE expires_at < now() - interval '30 days';
  DELETE FROM ops.login_attempts          WHERE created_at < now() - interval '180 days';
$$;

-- =============================================================================
-- Ruoli applicativi (NOLOGIN) da assegnare agli utenti di connessione, es.
--   CREATE ROLE assistente_api LOGIN PASSWORD '...' IN ROLE app_api;
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backoffice_api') THEN
    CREATE ROLE backoffice_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_analyst') THEN
    CREATE ROLE readonly_analyst NOLOGIN;
  END IF;
END
$$;

-- Sito (FastAPI): tutto lo schema app, niente ops.
GRANT USAGE ON SCHEMA app TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO app_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO app_api;

-- Backoffice (Next.js): legge app, può solo bloccare/sbloccare utenti; gestisce ops.
GRANT USAGE ON SCHEMA app, ops TO backoffice_api;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO backoffice_api;
GRANT UPDATE (status, status_reason, status_changed_at, status_changed_by, token_version) ON app.users TO backoffice_api;
GRANT SELECT, INSERT, UPDATE ON ops.operators, ops.operator_sessions, ops.operator_otp_challenges TO backoffice_api;
GRANT SELECT, INSERT ON ops.login_attempts, ops.audit_log TO backoffice_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA ops TO backoffice_api;

-- Analisi / report: sola lettura, niente segreti.
GRANT USAGE ON SCHEMA app, ops TO readonly_analyst;
GRANT SELECT ON app.companies, app.company_documents, app.chats, app.messages, app.analyses, ops.audit_log
  TO readonly_analyst;
GRANT SELECT (id, email, company_id, status, two_factor_enabled, last_login_at, last_active_at, created_at)
  ON app.users TO readonly_analyst;

COMMIT;
