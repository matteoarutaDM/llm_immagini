-- Ruoli aziendali: il super admin (backoffice) crea aziende e capi azienda,
-- il capo azienda crea i dipendenti. Niente più registrazione libera.
-- Idempotente: il backend lo riapplica a ogni avvio.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'app' AND t.typname = 'user_role'
  ) THEN
    CREATE TYPE app.user_role AS ENUM ('employee', 'company_admin');
  END IF;
END
$$;

ALTER TABLE app.users ADD COLUMN IF NOT EXISTS role app.user_role NOT NULL DEFAULT 'employee';
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS password_is_temporary boolean NOT NULL DEFAULT false;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS created_by_user_id bigint REFERENCES app.users(id) ON DELETE SET NULL;
ALTER TABLE app.users ADD COLUMN IF NOT EXISTS created_by_operator_id bigint REFERENCES ops.operators(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_company_admin_has_company') THEN
    ALTER TABLE app.users ADD CONSTRAINT users_company_admin_has_company
      CHECK (role <> 'company_admin' OR company_id IS NOT NULL);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS users_company_role_idx ON app.users (company_id, role);

ALTER TABLE app.companies ADD COLUMN IF NOT EXISTS created_by_operator_id bigint REFERENCES ops.operators(id) ON DELETE SET NULL;

-- Registro attività unico: azioni degli operatori del backoffice (operator_id)
-- e dei capi azienda sul sito (actor_user_id), con l'azienda coinvolta.
-- ID semplici, senza FK: il registro resta leggibile anche se un account sparisce.
ALTER TABLE ops.audit_log ADD COLUMN IF NOT EXISTS actor_user_id bigint;
ALTER TABLE ops.audit_log ADD COLUMN IF NOT EXISTS company_id bigint;
CREATE INDEX IF NOT EXISTS audit_log_company_idx ON ops.audit_log (company_id, created_at DESC);

-- Il sito (FastAPI) scrive e legge il registro della propria azienda.
-- Solo se il ruolo esiste: i database non creati da schema.sql possono non averlo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    GRANT USAGE ON SCHEMA ops TO app_api;
    GRANT SELECT, INSERT ON ops.audit_log TO app_api;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA ops TO app_api;
  END IF;
END
$$;
