# Assistente Macchine

Assistente tecnico multimodale per macchinari industriali (gru, carroponti, movimentatori di container, droni…). L'utente carica una **foto della macchina** e fa una **domanda**; l'app riconosce la macchina, legge la targhetta e risponde citando i manuali tecnici.

Questo è l'unico documento del progetto: avvio, Docker, funzionamento, backoffice, database, API, configurazione e limiti noti.

## Indice

1. [Architettura](#1-architettura)
2. [Avvio rapido](#2-avvio-rapido)
3. [Docker](#3-docker)
4. [Sviluppo in locale](#4-sviluppo-in-locale)
5. [Come funziona una domanda](#5-come-funziona-una-domanda)
6. [Sito: account, aziende, chat e documenti](#6-sito-account-aziende-chat-e-documenti)
7. [Backoffice](#7-backoffice)
8. [Database](#8-database)
9. [API](#9-api)
10. [Configurazione](#10-configurazione)
11. [Struttura del codice](#11-struttura-del-codice)
12. [Test](#12-test)
13. [Limiti noti e debiti tecnici](#13-limiti-noti-e-debiti-tecnici)

---

## 1. Architettura

```
Browser ──► Next.js :3000 ──┬──► FastAPI :8000 ──► Ollama :11434 (LLM, sul Mac)
            sito + /admin   │        │
                            └────────┴──► PostgreSQL (schemi app + ops)
```

| Parte | Tecnologia | Ruolo |
|---|---|---|
| **Sito** (`/`) | Next.js 16, App Router | interfaccia per gli utenti: login, chat, foto + domanda, risposte |
| **Backoffice** (`/admin`) | Next.js, route handler in `app/api/admin` | area del team interno (admin e support) |
| **Backend** | FastAPI (Python 3.12) | autenticazione degli utenti, chat, documenti, riconoscimento + OCR + ricerca nei manuali |
| **Database** | PostgreSQL 18 | dati del sito (schema `app`) e del backoffice (schema `ops`) |
| **LLM** | Ollama (`llama3.2`) o qualsiasi endpoint compatibile OpenAI | scrittura della risposta |

- **Accesso al backend:** il browser parla solo con Next.js. Il sito raggiunge FastAPI tramite i proxy `app/api/backend/[...path]` e `app/api/ask`, quindi l'indirizzo del backend non è mai esposto.
- **Accesso al database del backoffice:** il backoffice legge e scrive PostgreSQL direttamente. Chiama il backend solo per le operazioni che toccano i file e l'indice dei manuali, cioè l'eliminazione dei documenti.

---

## 2. Avvio rapido

**Con Docker (consigliato):** un comando avvia database, backend e sito.

```bash
cp .env.docker.example .env.docker     # compila password, segreti e SMTP (§3.2)
docker compose up -d --build
```

Sito su <http://localhost:3000>, backoffice su <http://localhost:3000/admin>. Dettagli in [§3](#3-docker).

**In locale, per sviluppare:** due terminali, `npm run backend` e `npm run dev`. Dettagli in [§4](#4-sviluppo-in-locale).

---

## 3. Docker

### 3.1 Servizi

| Servizio | Cosa fa | Porta sul Mac |
|---|---|---|
| `db` | PostgreSQL 18 | `127.0.0.1:5433` (solo per pgAdmin) |
| `backend` | FastAPI con i modelli AI (PyTorch solo CPU) | nessuna, raggiungibile solo dal servizio web |
| `web` | sito + backoffice (Next.js `standalone`) | `3000`, oppure `WEB_PORT=3001 docker compose up -d` |

- **LLM su Ollama, fuori da Docker:** il modello linguistico resta su Ollama, installato sul Mac, e il backend lo raggiunge all'indirizzo `host.docker.internal:11434`. Dentro Docker su Mac non userebbe la GPU e sarebbe molto più lento.
- **File:** i file coinvolti sono `docker-compose.yml`, `docker/backend.Dockerfile`, `docker/web.Dockerfile`, `.dockerignore` e `.env.docker.example`.

### 3.2 Prerequisiti e configurazione

- **Docker Desktop:** installa la versione giusta per il processore (Mac Intel, Mac Apple Silicon o Windows) e assegnale almeno **8 GB di memoria** da Settings → Resources.
- **Ollama:** deve essere installato e acceso, con il modello già scaricato: `ollama pull llama3.2`.
- **Manuali di base:** la cartella `CLI/pdf_immagini/` (circa 370 MB) non è su git e va copiata a mano. Viene montata nel container in sola lettura.

```bash
cp .env.docker.example .env.docker
```

In `.env.docker` compila:

- `POSTGRES_PASSWORD`, e la stessa password dentro `DATABASE_URL`;
- `AUTH_SECRET` e `BACKOFFICE_API_TOKEN`, due segreti diversi generati con `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`;
- `SMTP_*`: in produzione è obbligatorio, perché serve per la 2FA, il reset della password e l'OTP degli admin.

`.env.docker` è escluso da git e dalle immagini. Va passato a mano, in modo privato.

### 3.3 Primo avvio

**A. Con i dati che hai già in Postgres.app.** Lo script copia nel container il database e i PDF delle aziende, poi si avvia tutto:

```bash
./docker/import-local-data.sh
docker compose up -d --build
```

Lo script si ferma se il database del container contiene già dei dati, così non sovrascrive niente.

**B. Installazione nuova, senza dati:**

```bash
docker compose up -d --build
```

Il backend crea le tabelle da solo. In produzione non crea gli operatori del backoffice: aggiungili come in [§8.4](#84-operatori-del-backoffice).

**Cosa aspettarsi la prima volta:**
- **La build** richiede diversi minuti (circa 2,2 GB per il backend, circa 430 MB per il sito).
- **La prima domanda** è lenta, può volerci più di mezz'ora su un Mac Intel senza GPU. Il backend scarica circa 2 GB di modelli Hugging Face nel volume `hf-models` e ricostruisce una volta l'indice dei manuali. Dalla seconda domanda in poi resta solo l'analisi.

### 3.4 Comandi di tutti i giorni

| Situazione | Comando |
|---|---|
| Avviare tutto (anche dopo un riavvio del Mac) | `docker compose up -d` |
| Dopo aver modificato il codice | `docker compose up -d --build` |
| Stato dei servizi | `docker compose ps` |
| Log | `docker compose logs -f backend` (o `web`, `db`) |
| Fermare tutto (i dati restano) | `docker compose down` |

- **Riavvio automatico:** i container ripartono da soli quando Docker Desktop si avvia. Per farlo partire all'accesso al Mac, attiva Settings → General → *Start Docker Desktop when you sign in*.
- **Modifiche al codice:** in Docker non si vedono da sole. Serve sempre `--build`.
- **Porta già occupata:** se `npm run dev` è acceso occupa la porta 3000 e il sito Docker non parte. Fermalo, oppure usa `WEB_PORT`.

### 3.5 Dati, backup e pgAdmin

I dati vivono nei volumi Docker, che sopravvivono a `docker compose down`:

| Volume | Contenuto |
|---|---|
| `pgdata` | database |
| `company-documents` | PDF caricati dalle aziende |
| `rag-index`, `rag-memory`, `rag-debug` | indice e memoria della ricerca nei manuali (ricostruibili) |
| `hf-models` | modelli scaricati (riscaricabili) |

```bash
docker compose exec -T db pg_dump -U assistente assistente > backup-$(date +%F).sql   # backup

# ripristino: solo su un'installazione nuova, prima di avviare il backend
docker compose up -d --wait db
docker compose exec -T db psql -U assistente -d assistente < backup.sql
docker compose up -d
```

**pgAdmin:** registra un server con Host `localhost`, Port `5433`, Username `assistente` e la password di `.env.docker`.

`docker compose down -v` cancella anche i volumi, quindi **tutti i dati**.

### 3.6 Usare il progetto da un altro dispositivo

**Installarlo su un altro computer.** Su quel computer:
1. installa Docker Desktop, Ollama e git;
2. `git clone -b fase1 https://github.com/matteoarutaDM/llm_immagini.git`;
3. copia a mano `CLI/pdf_immagini/` e `.env.docker`;
4. lancia `docker compose up -d --build`.

L'installazione parte vuota. Per portare i dati, sull'altro computer ripristina il backup **prima** del passo 4, come in [§3.5](#35-dati-backup-e-pgadmin): se il backend parte prima crea tabelle vuote e il ripristino fallisce. I PDF delle aziende vanno copiati a parte, nel volume `company-documents`. Ogni installazione ha il suo database: quello che succede su una non compare sull'altra. Docker è stato provato solo su Mac Intel.

**Usare l'installazione di questo Mac dalla stessa rete Wi-Fi.** Apri `http://<IP-del-Mac>:3000`.
- **Sito:** funziona, ma senza dettatura vocale: il browser concede il microfono solo su HTTPS o su `localhost`, quindi il pulsante «Detta» non compare.
- **Backoffice:** il login no. In produzione i cookie di sessione sono `Secure` e funzionano solo su HTTPS o su `localhost`.

### 3.7 Messa online

- **HTTPS obbligatorio:** metti davanti un reverse proxy con certificato (Caddy, Traefik, Nginx) e aggiorna `FRONTEND_URL` e `ALLOWED_ORIGINS`.
- **LLM:** imposta `OPENAI_BASE_URL` verso un endpoint raggiungibile dal server. Senza GPU le risposte sono lente.
- **Porta del database:** se il database non serve da fuori, togli `ports` dal servizio `db`.

### 3.8 Problemi comuni

| Sintomo | Causa probabile |
|---|---|
| Le risposte falliscono con errori di connessione al modello | Ollama è spento, oppure il modello di `LLM_MODEL` non è stato scaricato. |
| Il backend si riavvia di continuo | Leggi `docker compose logs backend`. Di solito manca `AUTH_SECRET`, oppure c'è `DEBUG_EMAIL_TOKENS=true` insieme ad `APP_ENV=production`. |
| "Manuali mancanti" nei log | `CLI/pdf_immagini/` è vuota o non contiene i PDF elencati in `CLI/machine.json`. |
| Il container del backend viene chiuso per memoria | Porta la memoria di Docker Desktop ad almeno 8 GB. |
| `ports are not available: 3000` | La porta è occupata, di solito da `npm run dev`. |
| Il codice OTP dell'admin non arriva | `SMTP_*` non è configurato, oppure l'email dell'admin non è una casella reale. |

---

## 4. Sviluppo in locale

Servono Python 3.12, Node 20.9+, PostgreSQL (per esempio [Postgres.app](https://postgresapp.com)) e Ollama con il modello scaricato.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm install
cp .env.example .env          # imposta almeno DATABASE_URL e, per il backoffice, BACKOFFICE_API_TOKEN
```

In due terminali:

```bash
npm run backend    # FastAPI su :8000; al primo avvio crea lo schema nel database vuoto
npm run dev        # Next.js su :3000 (sito e backoffice, con ricarica automatica)
```

- **Permesso di Postgres.app:** alla prima connessione di un nuovo programma, Postgres.app mostra una finestra di permesso. Va confermata con OK, altrimenti le connessioni restano in attesa o vengono rifiutate.
- **Email in sviluppo:** se non configuri l'SMTP, con `DEBUG_EMAIL_TOKENS=true` i codici 2FA, i link di reset e gli OTP del backoffice vengono scritti nei log.

---

## 5. Come funziona una domanda

`POST /api/ask` riceve, in multipart, `question`, `image`, `chat_id` (facoltativo) e `top_k` (default 12).

1. **Riconoscimento della macchina.** SigLIP (`google/siglip-base-patch16-224`) in modalità zero-shot confronta la foto con le immagini di riferimento di ogni macchina (`CLI/machine.json`, `CLI/reference_images/`). Sotto la soglia `IMAGE_RECOGNITION_THRESHOLD` (default 0.730) la macchina viene dichiarata "non riconosciuta" e la pipeline si ferma lì.
2. **Lettura della targhetta.** GOT-OCR-2.0 (`CLI/got_ocr_runner.py`, eseguito come subprocess) estrae modello, matricola e asset tag, con un fuzzy match sui codici noti. Con `OCR_BACKEND` diverso da `got` lo fa invece un LLM multimodale. Se l'OCR fallisce, la pipeline prosegue senza.
3. **Ricerca nei manuali (RAG).** La query è composta da macchina, tipo, codici letti e domanda. Cerca nei manuali della macchina riconosciuta (libreria `ragmens_core`: chunk, embedding `all-MiniLM-L6-v2`, FAISS). Nelle chat `merged` unisce anche i risultati dell'indice dell'azienda, riordina tutto per punteggio e tronca a `top_k`.
4. **Risposta verificata.** L'LLM deve rispondere in JSON citando passaggi dei manuali parola per parola (almeno 20 caratteri). Ogni punto senza una citazione verificabile viene scartato; se non ne resta nessuno, l'utente riceve "non ho trovato informazioni sufficienti".
5. **Salvataggio.** Se c'è una chat, domanda e risposta vanno in `app.messages`. Ogni richiesta, riconosciuta, non riconosciuta o fallita, va in `app.analyses` con esito, macchina, targhetta, risposta, fonti, errore interno e durata. È quello che vede il backoffice.
6. **Foto.** Viene salvata in un file temporaneo e **cancellata sempre** a fine richiesta. Resta solo una miniatura JPEG (lato massimo 320 px) nella colonna `analyses.image_thumbnail`, mostrata nella cronologia della chat.

Il sito attende il backend fino a `ASK_TIMEOUT_SECONDS` (default 30 minuti; con `0` nessun limite). In caso di errore interno l'utente riceve un messaggio generico, mentre il dettaglio resta visibile solo nel backoffice.

---

## 6. Sito: account, aziende, chat e documenti

### 6.1 Account e sicurezza

- **Registrazione:** chiede email, password di almeno 8 caratteri e accettazione dei termini, e fa entrare subito.
- **Password:** PBKDF2-HMAC-SHA256 con 310.000 iterazioni e salt casuale, confrontata a tempo costante. Anche per un'email inesistente viene fatto un confronto finto, così la risposta non rivela quali email sono registrate.
- **Blocco dopo troppi tentativi:** dopo 5 password sbagliate l'account resta bloccato per 15 minuti (`AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_SECONDS`).
- **Token:** firmato con HMAC su `AUTH_SECRET` (non è un JWT), scade dopo 24 ore e il browser lo tiene in `localStorage`.
  - Contiene un `token_version`: incrementandolo si invalidano **tutti** i token dell'utente.
  - Il `token_version` aumenta a logout, reset della password, disattivazione della 2FA e blocco dal backoffice.
- **2FA via email:** facoltativa, con codice a 6 cifre e codici di recupero.
- **Password dimenticata:** reset tramite link via email, valido 30 minuti; il link nuovo annulla quelli precedenti.
- **Account bloccati dal backoffice:** non possono più entrare (rispondono 403) e vengono disconnessi da tutti i dispositivi.

**Limiti di richieste** (in memoria, per indirizzo IP):

| Operazione | Limite di default |
|---|---|
| login | 10 al minuto |
| registrazione | 5 al minuto |
| domanda con foto | 20 al minuto |
| verifica codice 2FA / codice di recupero | 10 ogni 5 minuti |
| invio di un nuovo codice 2FA | 5 ogni 5 minuti |
| password dimenticata | 5 ogni 5 minuti, per IP e per email |

**Protezioni di rete:**
- **CORS:** il backend accetta solo le origini elencate in `ALLOWED_ORIGINS`.
- **Header di sicurezza:** il sito invia CSP `default-src 'self'`, `X-Frame-Options: DENY` e `nosniff`.

### 6.2 Utenti base e aziendali

Il dominio dell'email decide il tipo di utente:
- **Dominio pubblico** (Gmail, Outlook, libero.it… elenco in `backend/public_email_domains.py`): utente base.
- **Qualsiasi altro dominio** (per esempio `@digitalmens.it`): l'utente viene associato all'azienda di quel dominio, creata in automatico e senza approvazione. Tutti gli utenti dello stesso dominio condividono i documenti aziendali.

### 6.3 Chat

- **Modalità di conoscenza:** ogni chat ha una modalità fissata alla creazione.
  - `base`: solo i manuali generali;
  - `merged`: solo per utenti aziendali, aggiunge i PDF dell'azienda selezionati per quella chat.
- **Titolo:** è l'unica cosa modificabile di una chat.
- **Eliminazione:** eliminare una chat cancella anche i suoi messaggi.
- **Risposte per chat:** la risposta completa (fonti, targhetta, candidati) resta legata alla chat che l'ha chiesta. "Nuova chat" riparte pulita e, tornando in una chat, la sua risposta è ancora lì. Dopo un ricaricamento della pagina restano domande e risposte come messaggi.

### 6.4 Documenti aziendali

| | Manuali di base | Documenti aziendali |
|---|---|---|
| Contenuto | manuali delle macchine di `CLI/machine.json` | PDF caricati dagli utenti di un'azienda |
| Dove | `CLI/pdf_immagini/`, indice in `CLI/index_no_finetuned/` | `data/companies/<hash del dominio>/` |
| Chi li gestisce | chi sviluppa il progetto | l'azienda dal sito; l'admin dal backoffice |
| Visibilità | tutti | solo l'azienda |

- **Upload:** controlla tipo, estensione, firma `%PDF` e dimensione (`MAX_UPLOAD_MB`). Il file viene salvato con un nome casuale e l'indice dell'azienda viene ricostruito subito: lo stato del documento passa a `indexed`, oppure a `failed`.
- **Eliminazione:** cancella file e riga e libera l'indice in memoria, che viene ricostruito alla domanda successiva.
- **Aggiornamento dell'indice:** non è incrementale. Ogni modifica ricalcola l'indice di tutti i PDF dell'azienda.

---

## 7. Backoffice

Area riservata al team su `/admin`. Gli operatori sono distinti dagli utenti del sito (`ops.operators`).

| Sezione | Contenuto | Admin | Support |
|---|---|:-:|:-:|
| Dashboard | analisi di oggi, tasso di riconoscimento, errori, tempi, macchine più analizzate, analisi da verificare | ✓ | ✓ |
| Analisi | elenco filtrabile e dettaglio: domanda, risposta, fonti, targhetta, candidati, errore interno | ✓ | ✓ |
| Utenti | elenco, dettaglio con attività e chat | ✓ | ✓ |
| Utenti → blocca / riabilita | motivo obbligatorio | ✓ | |
| Documenti | stato di indicizzazione dei PDF aziendali | ✓ | ✓ |
| Documenti → elimina | motivo obbligatorio; cancella il file e aggiorna l'indice dell'azienda | ✓ | |
| Registro attività | chi ha fatto cosa, quando e perché (non modificabile) | ✓ | |

**Accesso**
- **Admin:** password e poi un codice a 6 cifre via email. Il codice scade in 5 minuti, vale una volta sola e si blocca dopo 5 errori; si può reinviare dopo 30 secondi, fino a 3 volte.
- **Support:** solo password.
- **Password:** bcrypt, verificate da PostgreSQL con `pgcrypto`. Dopo 5 errori l'account resta bloccato per 15 minuti. Tutti i tentativi finiscono in `ops.login_attempts`.

**Sicurezza**
- **Permessi:** sono in `app/admin/_lib/permissions.js` e il server li verifica su ogni richiesta; l'interfaccia si limita a nascondere le azioni non consentite. Un 401 o un 403 riporta al login.
- **Sessione:**
  - token casuale in un cookie `httpOnly` e `SameSite=Strict` (`Secure` in produzione), con l'hash salvato in `ops.operator_sessions`;
  - durata di 8 ore;
  - il logout la revoca lato server;
  - `proxy.js` rimanda al login chi apre `/admin` senza cookie, poi il layout verifica davvero la sessione.
- **Protezione CSRF:** le modifiche devono avere l'header `X-Requested-With: backoffice` e un'origine uguale a quella dell'app.
- **Eliminazione dei documenti:**
  - passa dal backend (`DELETE /internal/company-documents/{id}`), perché è il backend a tenere in memoria l'indice di ogni azienda;
  - l'endpoint è protetto da `BACKOFFICE_API_TOKEN`, che deve avere lo stesso valore in sito e backend;
  - sta sotto `/internal` e non sotto `/api`, quindi il proxy pubblico non lo raggiunge.

Le email del backoffice (OTP) usano le stesse variabili `SMTP_*` del backend.

---

## 8. Database

### 8.1 File

| File | A cosa serve |
|---|---|
| `database/schema.sql` | tabelle, tipi, indici, vincoli, trigger e ruoli |
| `database/seed.sql` | i due operatori di sviluppo del backoffice |
| `database/migrations/*.sql` | modifiche allo schema per i database già esistenti, idempotenti |
| `database/migrate_from_sqlite.py` | copia i dati del vecchio `data/app.db` (SQLite) in PostgreSQL |
| `docker/import-local-data.sh` | copia database e PDF da Postgres.app a Docker |

Il backend applica `schema.sql` da solo se lo schema `app` non esiste, e fuori da produzione applica anche `seed.sql`. In alternativa puoi farlo da pgAdmin: crei un database vuoto ed esegui i due file nel Query Tool, con un utente che possa creare le estensioni `pgcrypto`, `citext` e `pg_trgm`. Lo schema non va rieseguito su un database già in uso: le modifiche successive vanno in `database/migrations/`, come file SQL idempotenti (`ADD COLUMN IF NOT EXISTS`...). Il backend li applica a ogni avvio in ordine di nome; ogni modifica va riportata anche in `schema.sql`.

**Dal vecchio SQLite:** `.venv/bin/python database/migrate_from_sqlite.py --reset`. Lo script mantiene gli ID, controlla che i conteggi coincidano tabella per tabella e lavora in un'unica transazione. Il file SQLite non viene toccato.

### 8.2 Tabelle

| Schema | Tabella | Contenuto |
|---|---|---|
| `app` | `companies` | aziende, riconosciute dal dominio email |
| | `users` | utenti del sito: password, 2FA, blocco per tentativi, stato (`active`/`blocked`), ultimo accesso e ultima attività |
| | `user_recovery_codes`, `two_factor_email_codes`, `password_reset_tokens` | codici e token, salvati solo come hash |
| | `company_documents` | PDF aziendali: nome originale, percorso su disco, dimensione, stato di indicizzazione |
| | `chats`, `messages` | chat e messaggi; `company_document_ids` contiene i nomi dei PDF selezionati |
| | `analyses` | una riga per ogni foto + domanda (§5) |
| `ops` | `operators` | operatori del backoffice (`admin`/`support`), password bcrypt, `requires_otp` |
| | `operator_sessions`, `operator_otp_challenges` | sessioni e codici OTP (solo hash) |
| | `login_attempts` | tentativi di accesso al backoffice |
| | `audit_log` | blocchi, riabilitazioni, eliminazioni di documenti |

### 8.3 Regole garantite dal database

- **Registro attività non modificabile:** su `ops.audit_log` un trigger rifiuta `UPDATE` e `DELETE` diretti. Restano ammesse solo le modifiche a cascata, per esempio l'operatore messo a `NULL` quando viene eliminato.
- **Admin sempre con OTP:** un admin ha sempre `requires_otp = true`.
- **Motivo del blocco:** un utente bloccato ha sempre un motivo.
- **Coerenza delle analisi:** un'analisi `recognized` ha sempre una macchina; una `failed` ha sempre un errore.
- **Email:** vengono confrontate senza distinguere maiuscole e minuscole (`citext`).

### 8.4 Operatori del backoffice

Operatori di sviluppo creati da `seed.sql`, solo fuori produzione:
- `admin@backoffice.local` / `Admin!2026`, con OTP;
- `support@backoffice.local` / `Support!2026`.

L'email dell'admin deve essere una casella reale, perché lì arriva l'OTP.

```sql
UPDATE ops.operators SET email = 'nome@azienda.it' WHERE email = 'admin@backoffice.local';
UPDATE ops.operators SET password_hash = crypt('password-lunga', gen_salt('bf', 12)) WHERE email = 'nome@azienda.it';
INSERT INTO ops.operators (email, name, role, password_hash, requires_otp)
VALUES ('mario@azienda.it', 'Mario', 'support', crypt('password-lunga', gen_salt('bf', 12)), false);
```

In Docker, esegui queste query con `docker compose exec db psql -U assistente -d assistente -c "..."`.

### 8.5 Ruoli e manutenzione

Lo schema crea tre ruoli senza login, da assegnare agli utenti di connessione, per esempio `CREATE ROLE assistente_api LOGIN PASSWORD '...' IN ROLE app_api;`:
- `app_api` (backend) non vede lo schema `ops`;
- `backoffice_api` legge `app` e può modificare solo lo stato degli utenti;
- `readonly_analyst` non legge segreti.

Oggi le applicazioni usano un unico utente amministratore del database.

`SELECT ops.purge_expired_secrets();` elimina token, codici, sessioni e tentativi scaduti. Va eseguita periodicamente, per esempio ogni notte con `pg_cron`.

---

## 9. API

### 9.1 Backend (FastAPI, raggiunto da `/api/backend/*` e `/api/ask`)

| Metodo | Percorso | Note |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login` | con limiti di richieste; il login può chiedere la 2FA |
| POST | `/api/auth/logout` · GET `/api/auth/me` | il logout invalida tutti i token |
| POST | `/api/auth/2fa/setup`, `/confirm`, `/resend`, `/verify`, `/recovery` | attivazione e login con 2FA |
| POST | `/api/auth/2fa/disable/request-code`, `/disable` | disattivazione (password + codice) |
| POST | `/api/auth/2fa/recovery-codes/regenerate/request-code`, `/regenerate` | nuovi codici di recupero |
| GET | `/api/auth/2fa/status` | stato della 2FA e codici rimasti |
| POST | `/api/auth/forgot-password`, `/api/auth/reset-password` | reset della password via email |
| GET, POST | `/api/chats` | elenco e creazione |
| PATCH, DELETE | `/api/chats/{id}` | rinomina ed eliminazione |
| GET | `/api/chats/{id}/messages` | messaggi della chat (per le chat senza analisi registrate) |
| GET | `/api/chats/{id}/analyses` | ricerche passate della chat, dalla più recente: macchina, confidenza, domanda, risposta, fonti e miniatura (data URL) |
| GET, POST | `/api/company/documents` | elenco e upload (solo utenti aziendali) |
| DELETE | `/api/company/documents/{id}` | eliminazione da parte dell'azienda |
| POST | `/api/ask` | foto + domanda (§5) |
| POST | `/api/transcribe` | audio della domanda dettata (campo `audio`) → `{ "text" }`, trascritto in locale con Whisper |
| POST | `/api/speak` | pezzo di risposta da leggere (campo `text`, max `MAX_SPEAK_CHARS`) → audio WAV, generato in locale con Piper |
| DELETE | `/internal/company-documents/{id}` | solo backoffice, header `X-Internal-Token` |
| GET | `/health` | controllo di salute |

### 9.2 Backoffice (Next.js, `/api/admin/*`)

`auth/login`, `auth/otp/verify`, `auth/otp/resend`, `auth/logout`, `auth/me`, `dashboard`, `analyses`, `analyses/{id}`, `analyses/machines`, `users`, `users/{id}` (PATCH per bloccare o riabilitare), `documents`, `documents/{id}` (DELETE), `audit`. Gli errori hanno la forma `{ "error": { "code", "message" } }`.

---

## 10. Configurazione

Tutte le variabili sono elencate in `.env.example` (sviluppo) e `.env.docker.example` (Docker). Le principali:

| Gruppo | Variabili |
|---|---|
| Database | `DATABASE_URL`, `DB_POOL_MIN_SIZE`, `DB_POOL_MAX_SIZE`, `TEST_DATABASE_URL` (deve finire con `_test`) |
| Sicurezza | `APP_ENV` (`production` rende obbligatori `AUTH_SECRET` e SMTP e vieta `DEBUG_EMAIL_TOKENS`), `AUTH_SECRET`, `AUTH_TOKEN_TTL_SECONDS`, `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_SECONDS`, `ALLOWED_ORIGINS`, `FRONTEND_URL` |
| Backoffice | `BACKOFFICE_API_TOKEN`, `BACKOFFICE_SESSION_TTL_SECONDS` (8 h), `BACKOFFICE_OTP_TTL_SECONDS` (5 min), `BACKOFFICE_LOGIN_MAX_ATTEMPTS` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME`, `SMTP_USE_TLS`, `DEBUG_EMAIL_TOKENS` |
| Collegamenti | `BACKEND_URL` (default `http://127.0.0.1:8000`), `ASK_TIMEOUT_SECONDS` (default 1800), `MAX_UPLOAD_MB` |
| Limiti di richieste | `RATE_LIMIT_LOGIN_*`, `RATE_LIMIT_REGISTER_*`, `RATE_LIMIT_ASK_*`, `RATE_LIMIT_TRANSCRIBE_*`, `RATE_LIMIT_SPEAK_*`, `RATE_LIMIT_2FA_*`, `RATE_LIMIT_2FA_SEND_*`, `RATE_LIMIT_FORGOT_PASSWORD_*` |
| LLM | `OPENAI_BASE_URL` (default Ollama `http://localhost:11434/v1`), `OPENAI_API_KEY`, `LLM_MODEL` (`llama3.2`), `VISION_LLM_BASE_URL`, `VISION_LLM_MODEL` |
| Modelli e OCR | `SIGLIP_MODEL`, `EMBEDDING_MODEL`, `OCR_BACKEND` (`got`), `GOT_OCR_MODEL`, `OCR_DEVICE` (`cpu`), `HF_LOCAL_FILES_ONLY`, `IMAGE_RECOGNITION_THRESHOLD` (0.730) |
| Dettatura vocale | `WHISPER_MODEL` (`small`), `WHISPER_DEVICE` (`cpu`), `WHISPER_COMPUTE_TYPE` (`int8`), `WHISPER_LANGUAGE` (`it`), `WHISPER_CPU_THREADS`, `MAX_AUDIO_MB` (10) |
| Lettura delle risposte | `PIPER_VOICE` (`it_IT-paola-medium`), `PIPER_VOICE_REPO` (`rhasspy/piper-voices`), `PIPER_LENGTH_SCALE` (1.05), `MAX_SPEAK_CHARS` (2000) |
| Ricerca nei manuali | `TOP_K` (12), `CONTEXT_MAX_CHARS`, `CHUNK_SIZE`, `CHUNK_OVERLAP`, `MIN_CHUNK_CHARS`, `FORCE_REBUILD_INDEX` |
| Percorsi | `PDF_DIR`, `REFERENCE_IMAGES_DIR`, `MACHINE_KB_PATH`, `INDEX_DIR`, `MEM_DIR`, `OUTPUT_DEBUG_DIR`, `COMPANY_DATA_DIR` |

---

## 11. Struttura del codice

```
app/                         Next.js (App Router)
  page.jsx                   sito: compone gli hook e i componenti
  hooks/                     useAuth, useChats, useCompanyDocuments, useAsk (risposte per chat)
  components/                AuthPanel, ChatSidebar, AnalysisComposer, AnswerCard, SourcesPanel,
                             OcrCard, CandidatesCard, MessageList, DocumentPanel, DocumentUploader…
  reset-password/, privacy/, terms/
  api/ask/route.ts           inoltro di /api/ask al backend con attesa lunga
  api/backend/[...path]/     proxy generico verso FastAPI
  api/admin/                 API del backoffice
  admin/                     backoffice
    (console)/               pagine protette: dashboard, analyses, users, documents, audit
    login/                   login + OTP
    _components/             UI del backoffice (ui/ = componenti riutilizzabili: tabella, filtri, modali, grafici)
    _lib/                    client API, permessi, costanti, formattazione
    _hooks/                  caricamento dati, filtri nell'URL
    _server/                 solo server: PostgreSQL, sessioni, OTP, email, audit, servizi
proxy.js                     redirect al login per /admin senza sessione
backend/                     FastAPI
  main.py                    endpoint, limiti di richieste, salvataggio delle analisi
  model_service.py           SigLIP, OCR, RAG generale e per azienda, LLM
  database.py                pool PostgreSQL (psycopg), password, token, blocco per tentativi
  auth.py, email_service.py, two_factor_service.py, rate_limit.py, public_email_domains.py
  tests/                     pytest
database/                    schema, seed, migrazione da SQLite
docker/                      Dockerfile di backend e sito, script di importazione
docker-compose.yml
CLI/                         pipeline originale e dati del modello
  modello_riconoscimento_finale.ipynb   notebook di riferimento (portato in model_service.py)
  modello_no_finetuned.ipynb, rag_llm.ipynb
  machine.json, reference_images/       macchine note e immagini di riferimento
  pdf_immagini/                         manuali di base (non su git)
  got_ocr_runner.py                     OCR eseguito come subprocess
  index_no_finetuned/, memory_no_finetuned/, outputs_debug_no_finetuned/   generati dal backend
```

**Convenzioni del frontend:**
- **Stato:** nessuna libreria di stato; gli hook non si importano tra loro e vengono composti in `page.jsx`.
- **Stile:** Tailwind v4 configurato in `app/globals.css`, icone da `@heroicons/react`.
- **File per strumenti AI:** `AGENTS.md` e `CLAUDE.md` contengono istruzioni per gli assistenti AI. `AGENTS.md` viene rigenerato da `next dev`.

---

## 12. Test

Servono un PostgreSQL in esecuzione (quello di sviluppo) e le dipendenze di sviluppo.

```bash
pip install -r requirements-dev.txt
python3 -m pytest      # backend: ricrea da zero il database assistente_test
npm test               # sito e backoffice (Vitest): usa il database assistente_backoffice_test
```

I test non toccano il database `assistente`. Coprono:
- **backend:** autenticazione, 2FA, reset della password, limiti di richieste, isolamento tra aziende, upload e documenti, registrazione delle analisi, account bloccati, endpoint interno;
- **backoffice:** permessi, password bcrypt e blocco, OTP, sessioni, blocco degli utenti con audit, analisi e dashboard, eliminazione dei documenti;
- **sito:** login e 2FA, invio della domanda, risposte per chat, logout.

---

## 13. Limiti noti e debiti tecnici

- **Risposte prudenti con `llama3.2`.** È un modello piccolo e spesso non supera il controllo delle citazioni, quindi l'utente riceve "non ho trovato informazioni sufficienti" anche quando la macchina è riconosciuta e le fonti sono giuste. Da provare `llama3.1` o un controllo meno severo.
- **Memoria della conversazione non usata.** Memoria breve e lunga vengono salvate a ogni domanda, ma la risposta non le rilegge (`build_prompt` non viene chiamata): l'assistente non "ricorda" i turni precedenti.
- **Lentezza senza GPU.** Su un Mac senza GPU, anche in Docker, OCR e LLM girano sul processore: la prima domanda dopo l'avvio può richiedere molti minuti.
- **Una sola istanza.** I limiti di richieste e l'indice di ogni azienda sono in memoria di processo. Con più istanze servirebbe uno store condiviso (per esempio Redis).
- **Indice non incrementale.** Ogni modifica ai PDF di un'azienda ricalcola l'intero indice.
- **Interfaccia incompleta:**
  - l'attivazione della 2FA esiste nelle API (§9.1), ma nel sito manca il pulsante per attivarla;
  - la schermata "verifica email" di `AuthPanel` punta a un endpoint che nel backend non esiste.
- **Privacy e Termini segnaposto.** `app/privacy` e `app/terms` contengono testo provvisorio e non sono conformi al GDPR così come sono.
- **CSP permissiva.** Include `'unsafe-inline'` e `'unsafe-eval'` per lo sviluppo; va ristretta in produzione.
