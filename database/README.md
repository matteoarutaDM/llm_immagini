# Database PostgreSQL

Un solo database per il sito (schema `app`) e il backoffice (schema `ops`). Lo usano sia il backend FastAPI sia il backoffice Next.js.

| File | A cosa serve |
|---|---|
| `schema.sql` | tutte le tabelle, i tipi, gli indici, i vincoli e i ruoli |
| `seed.sql` | i due operatori di sviluppo del backoffice |
| `migrate_from_sqlite.py` | copia i dati del vecchio `data/app.db` (SQLite) in PostgreSQL |

## Creare il database

**Automatico.** Al primo avvio il backend (`npm run backend` o il container `backend`) applica `schema.sql` se lo schema `app` non esiste. Fuori da produzione applica anche `seed.sql`.

**A mano, con pgAdmin:** crea un database vuoto (es. `assistente`, encoding UTF8), apri il **Query Tool**, esegui `schema.sql` e poi `seed.sql`. Serve un utente che possa creare estensioni (`pgcrypto`, `citext`, `pg_trgm`), ad esempio `postgres`.

**Copiare i dati dal vecchio SQLite:**

```bash
.venv/bin/python database/migrate_from_sqlite.py --reset   # ricrea app/ops e copia data/app.db
```

Lo script mantiene gli ID originali, controlla che i conteggi coincidano tabella per tabella e lavora in un'unica transazione. Il file SQLite non viene toccato. Per passare i dati da Postgres.app a Docker c'è invece `docker/import-local-data.sh` (vedi [DOCKER.md](../DOCKER.md)).

Lo schema non va rieseguito su un database già in uso: le modifiche vanno fatte come migrazioni.

## Tabelle

| Schema | Tabella | Contenuto |
|---|---|---|
| `app` | `companies` | aziende, riconosciute dal dominio email |
| | `users` | utenti del sito: password (PBKDF2), 2FA, lockout, stato (`active`/`blocked`), ultimo accesso |
| | `user_recovery_codes`, `two_factor_email_codes`, `password_reset_tokens` | codici e token, solo come hash |
| | `company_documents` | PDF aziendali: nome originale, percorso su disco, stato di indicizzazione |
| | `chats`, `messages` | chat degli utenti; `company_document_ids` sono i nomi dei PDF selezionati |
| | `analyses` | una riga per ogni foto + domanda: esito, macchina, targhetta, risposta, fonti, errore interno, durata |
| `ops` | `operators` | operatori del backoffice (`admin`/`support`), password bcrypt, `requires_otp` |
| | `operator_sessions` | sessioni del backoffice (hash del cookie, scadenza, revoca) |
| | `operator_otp_challenges` | codici OTP degli admin (hash, tentativi, reinvii) |
| | `login_attempts` | tentativi di accesso al backoffice |
| | `audit_log` | azioni degli operatori: blocchi, riabilitazioni, eliminazioni di documenti |

## Regole garantite dal database

- `ops.audit_log` è **append-only**: `UPDATE` e `DELETE` diretti vengono rifiutati da un trigger. Sono ammesse solo le modifiche a cascata, per esempio `operator_id` messo a `NULL` quando si elimina un operatore.
- Un **admin** ha sempre `requires_otp = true`; il support può entrare con la sola password.
- Un utente **bloccato** ha sempre un motivo (`status_reason`).
- Un'analisi `recognized` ha sempre una macchina; una `failed` ha sempre un messaggio di errore.
- Le email sono confrontate senza distinguere maiuscole e minuscole (`citext`).

## Operatori del backoffice

`seed.sql` crea `admin@backoffice.local` / `Admin!2026` (con OTP) e `support@backoffice.local` / `Support!2026` (senza OTP). L'email dell'admin deve essere una casella reale, perché lì arriva il codice di accesso.

```sql
-- email reale per l'admin
UPDATE ops.operators SET email = 'nome@azienda.it' WHERE email = 'admin@backoffice.local';

-- nuova password
UPDATE ops.operators SET password_hash = crypt('password-lunga', gen_salt('bf', 12)) WHERE email = 'nome@azienda.it';

-- nuovo operatore
INSERT INTO ops.operators (email, name, role, password_hash, requires_otp)
VALUES ('mario@azienda.it', 'Mario', 'support', crypt('password-lunga', gen_salt('bf', 12)), false);
```

## Ruoli di connessione

Lo schema crea tre ruoli senza login, da assegnare agli utenti con cui si collegano le applicazioni:

```sql
CREATE ROLE assistente_api LOGIN PASSWORD '...' IN ROLE app_api;         -- backend FastAPI
CREATE ROLE backoffice_bff LOGIN PASSWORD '...' IN ROLE backoffice_api;  -- backoffice Next.js
CREATE ROLE analisi        LOGIN PASSWORD '...' IN ROLE readonly_analyst;
```

- `app_api` non vede lo schema `ops`.
- `backoffice_api` legge `app` e può modificare solo lo stato degli utenti.
- `readonly_analyst` non legge password, token e segreti 2FA.

Oggi, in sviluppo e in Docker, entrambe le applicazioni usano un unico utente amministratore del database.

## Manutenzione

`SELECT ops.purge_expired_secrets();` elimina token, codici, sessioni e tentativi di accesso scaduti. Va eseguita periodicamente, per esempio ogni notte con `pg_cron`.
