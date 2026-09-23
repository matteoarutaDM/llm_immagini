# Assistente Macchine

Assistente tecnico multimodale per macchinari industriali (gru, carroponti, movimentatori di container, droni…). L'utente carica una **foto della macchina** e fa una **domanda**. L'app riconosce la macchina, legge la targhetta e risponde citando i manuali tecnici.

Il progetto ha tre parti:

- **sito** (`/`): Next.js, per gli utenti;
- **backoffice** (`/admin`): Next.js, per il team interno (admin e support);
- **backend** (FastAPI): riconoscimento, OCR e ricerca nei manuali.

Tutto usa lo stesso database **PostgreSQL**. Il modello linguistico gira su **Ollama** (o su un endpoint compatibile con OpenAI).

```
Browser ──► Next.js :3000 ──┬──► FastAPI :8000 ──► Ollama :11434 (sul Mac)
            sito + /admin   │        │
                            └────────┴──► PostgreSQL (schemi app + ops)
```

## Avvio rapido

### Con Docker (consigliato)

```bash
cp .env.docker.example .env.docker     # compila password, segreti e SMTP
./docker/import-local-data.sh          # solo la prima volta, per portare i dati esistenti
docker compose up -d --build
```

Sito su <http://localhost:3000>, backoffice su <http://localhost:3000/admin>. Un solo comando avvia database, backend e sito. Servono Docker Desktop e Ollama acceso sul Mac. Guida completa (backup, aggiornamenti, messa online, problemi comuni): **[DOCKER.md](DOCKER.md)**.

### In locale, per sviluppare

Prerequisiti: Python 3.12, Node 20.9+, PostgreSQL (es. [Postgres.app](https://postgresapp.com)), Ollama con il modello scaricato (`ollama pull llama3.2`).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm install
cp .env.example .env                   # imposta almeno DATABASE_URL e AUTH_SECRET
```

Poi, in due terminali:

```bash
npm run backend    # FastAPI su :8000 (al primo avvio crea lo schema nel database vuoto)
npm run dev        # Next.js su :3000
```

- **Permesso di Postgres.app:** alla prima connessione di un nuovo programma, Postgres.app mostra una finestra di permesso. Va confermata, altrimenti le connessioni restano in attesa o vengono rifiutate.
- **Dati dal vecchio SQLite:** per copiare in PostgreSQL i dati di `data/app.db` c'è `.venv/bin/python database/migrate_from_sqlite.py` (vedi [database/README.md](database/README.md)).

## Come funziona una domanda (`POST /api/ask`)

1. **Riconoscimento della macchina.** SigLIP (`google/siglip-base-patch16-224`) in modalità zero-shot confronta la foto con le immagini di riferimento di ogni macchina (`CLI/machine.json`, `CLI/reference_images/`). Sotto la soglia `IMAGE_RECOGNITION_THRESHOLD` (default 0.730) la macchina è dichiarata "non riconosciuta", non indovinata.
2. **Lettura della targhetta.** Modello, matricola e asset tag vengono estratti con GOT-OCR-2.0 (`CLI/got_ocr_runner.py`, eseguito come subprocess) oppure con un LLM multimodale (`OCR_BACKEND=got|vision-llm`).
3. **Ricerca nei manuali (RAG).** La libreria `ragmens_core` indicizza i PDF di `CLI/pdf_immagini/` (embedding `all-MiniLM-L6-v2`, FAISS) e cerca i passaggi pertinenti. Nelle chat aziendali (`merged`) interroga anche un indice separato per azienda, costruito sui PDF caricati da quell'azienda.
4. **Risposta.** L'LLM riceve macchina, dati di targhetta, memoria della conversazione e passaggi dei manuali. La risposta è accettata solo se cita testualmente i passaggi; altrimenti l'utente riceve un messaggio prudente ("non ho trovato informazioni sufficienti").
5. **Registrazione.** Ogni richiesta viene salvata in `app.analyses`: esito, macchina, targhetta, risposta, fonti, errore interno e durata. È quello che il backoffice monitora. La foto **non** viene conservata: è un file temporaneo cancellato a fine richiesta.

Il sito attende la risposta del backend fino a `ASK_TIMEOUT_SECONDS` (default 30 minuti, `0` = nessun limite). La prima domanda dopo l'avvio può essere lenta perché carica i modelli.

## Sito

- **Account:** registrazione (con accettazione dei termini) e login immediato, reset password via email, 2FA opzionale via email con codici di recupero, blocco temporaneo dopo troppi tentativi falliti.
- **Utenti base e aziendali:** un'email con dominio pubblico (Gmail, Outlook, libero.it…, elenco in `backend/public_email_domains.py`) crea un utente base. Qualunque altro dominio (es. `@digitalmens.it`) associa l'utente all'azienda di quel dominio.
- **Chat:** in modalità `base` usano solo i manuali generali; in modalità `merged` (solo utenti aziendali) aggiungono i PDF dell'azienda.
- **Risposte per chat:** la risposta completa (fonti, targhetta, candidati) resta legata alla chat che l'ha chiesta. "Nuova chat" riparte pulita e, tornando alla chat, la risposta è ancora lì. Dopo un ricaricamento della pagina restano domande e risposte come messaggi.
- **Documenti aziendali:** PDF caricati dagli utenti aziendali, salvati in `data/companies/` e indicizzati per dominio.
- **Account bloccati:** un utente bloccato dal backoffice non può entrare e viene disconnesso da tutti i dispositivi.

## Backoffice (`/admin`)

Area riservata al team, separata dagli utenti del sito (gli operatori sono in `ops.operators`).

| Sezione | Contenuto | Admin | Support |
|---|---|:-:|:-:|
| Dashboard | analisi di oggi, tasso di riconoscimento, errori, tempi, macchine più analizzate, analisi da verificare | ✓ | ✓ |
| Analisi | elenco filtrabile e dettaglio: domanda, risposta, fonti, targhetta, candidati, errore interno | ✓ | ✓ |
| Utenti | elenco, dettaglio con attività e chat | ✓ | ✓ |
| Utenti → blocca / riabilita | con motivo obbligatorio | ✓ | |
| Documenti | stato di indicizzazione dei PDF aziendali | ✓ | ✓ |
| Documenti → elimina | cancella il file e aggiorna l'indice dell'azienda | ✓ | |
| Registro attività | chi ha fatto cosa, quando e perché (non modificabile) | ✓ | |

- **Accesso:** gli **admin** usano password più un codice a 6 cifre via email (OTP); il **support** entra con la sola password. I permessi sono definiti in `app/admin/_lib/permissions.js` e verificati dal server su ogni richiesta; l'interfaccia nasconde solo le azioni non consentite.
- **Sessioni:** token casuale in un cookie `httpOnly` e `SameSite=Strict`, con l'hash salvato in `ops.operator_sessions`. Il logout invalida il token lato server. Le richieste che modificano dati devono arrivare dall'app stessa (header dedicato e controllo dell'origine).
- **Password operatori:** bcrypt, verificate da PostgreSQL con `pgcrypto`. Dopo 5 errori l'account resta bloccato per 15 minuti. Ogni tentativo è registrato in `ops.login_attempts`.
- **Eliminazione dei documenti:** passa dal backend, perché è il backend a tenere in memoria l'indice dei manuali di ogni azienda. Usa l'endpoint interno `DELETE /internal/company-documents/{id}`, protetto da `BACKOFFICE_API_TOKEN` (stesso valore per sito e backend). Non è raggiungibile dal proxy pubblico `/api/backend/*`.

Operatori iniziali di sviluppo (da `database/seed.sql`, inseriti solo fuori produzione): `admin@backoffice.local` / `Admin!2026` e `support@backoffice.local` / `Support!2026`. L'email dell'admin deve essere una casella reale, perché lì arriva l'OTP. Le password vanno cambiate: vedi [database/README.md](database/README.md).

## Database

PostgreSQL, schema in [`database/schema.sql`](database/schema.sql):

- **`app`**: aziende, utenti, codici 2FA e reset, documenti aziendali, chat, messaggi, analisi;
- **`ops`**: operatori, sessioni, OTP, tentativi di accesso, registro attività.

Il backend applica lo schema da solo se il database è vuoto. Le modifiche successive vanno fatte come migrazioni, non rieseguendo lo script. Dettagli, vincoli e ruoli: [database/README.md](database/README.md).

## Configurazione

Tutte le variabili sono in [`.env.example`](.env.example) (sviluppo) e [`.env.docker.example`](.env.docker.example) (Docker). Le principali:

| Variabile | A cosa serve |
|---|---|
| `DATABASE_URL` | connessione PostgreSQL, usata da backend e backoffice |
| `APP_ENV` | `production` rende obbligatori `AUTH_SECRET` e SMTP e vieta `DEBUG_EMAIL_TOKENS` |
| `AUTH_SECRET` | firma dei token degli utenti del sito |
| `BACKOFFICE_API_TOKEN` | segreto condiviso backoffice → backend (eliminazione documenti) |
| `SMTP_*`, `DEBUG_EMAIL_TOKENS` | email di 2FA, reset password e OTP degli admin; in sviluppo, senza SMTP, `DEBUG_EMAIL_TOKENS=true` scrive i codici nei log |
| `OPENAI_BASE_URL`, `LLM_MODEL` | endpoint e modello dell'LLM (default Ollama locale, `llama3.2`) |
| `BACKEND_URL` | dove Next.js raggiunge FastAPI (default `http://127.0.0.1:8000`) |
| `ASK_TIMEOUT_SECONDS` | attesa massima di una domanda con foto |
| `TEST_DATABASE_URL` | database dei test backend (deve finire con `_test`) |

## Struttura

```
app/                      Next.js (App Router)
  page.jsx                sito: login, chat, foto + domanda, risposta e fonti
  components/, hooks/     interfaccia del sito (useAsk: risposte per chat)
  reset-password/, privacy/, terms/
  api/ask/route.ts        inoltro di /api/ask al backend con attesa lunga
  api/backend/[...path]/  proxy generico verso FastAPI
  api/admin/              API del backoffice (auth, dashboard, analisi, utenti, documenti, audit)
  admin/                  backoffice
    (console)/            pagine protette: dashboard, analyses, users, documents, audit
    login/                login + OTP
    _components/          UI del backoffice (ui/ = componenti riutilizzabili)
    _lib/                 client API, permessi, costanti
    _server/              solo server: PostgreSQL, sessioni, OTP, email, audit, servizi
proxy.js                  redirect al login per /admin senza sessione
backend/                  FastAPI
  main.py                 endpoint (auth, 2FA, chat, documenti, /api/ask, /internal)
  model_service.py        SigLIP, OCR, RAG generale e per azienda, LLM
  database.py             pool PostgreSQL (psycopg), password, token, lockout
  auth.py, email_service.py, rate_limit.py, two_factor_service.py
  tests/                  pytest
database/                 schema.sql, seed.sql, migrate_from_sqlite.py
docker/                   Dockerfile di backend e sito, import-local-data.sh
docker-compose.yml        db + backend + web
CLI/                      notebook originali, machine.json, immagini di riferimento, manuali PDF, OCR
```

## Test

Servono un PostgreSQL in esecuzione (lo stesso di sviluppo) e le dipendenze di sviluppo.

```bash
pip install -r requirements-dev.txt
python3 -m pytest      # backend: ricrea da zero il database assistente_test
npm test               # sito e backoffice (Vitest): usa il database assistente_backoffice_test
```

Nessuno dei due tocca il database `assistente`.

## Limiti noti

- Con `llama3.2`, un modello piccolo, la risposta spesso non supera il controllo delle citazioni e l'utente riceve "non ho trovato informazioni sufficienti", anche quando la macchina è riconosciuta e le fonti sono giuste.
- Su un Mac senza GPU (anche in Docker) OCR e LLM girano sul processore: la prima domanda dopo l'avvio può richiedere molti minuti, le successive meno.
- Sessioni, OTP e registro sono nel database, ma i limiti di richieste (rate limiting) sono in memoria: valgono per una sola istanza del backend e del sito.
- La documentazione tecnica di dettaglio in `docs/DOCUMENTAZIONE.md` descrive ancora la versione con SQLite.
