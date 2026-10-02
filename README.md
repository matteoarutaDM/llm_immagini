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
14. [Remote Ollama / RTX 5090 setup](#14-remote-ollama--rtx-5090-setup)
15. [LLM fallback: RTX 5090 -> Modal](#15-llm-fallback-rtx-5090---modal)

---

## 1. Architettura

```
Browser ──► Next.js :3000 ──┬──► FastAPI :8000 ──► Ollama :11434 (LLM, locale o PC GPU remoto, §14)
            sito + /admin   │        │
                            └────────┴──► PostgreSQL (schemi app + ops)
```

| Parte | Tecnologia | Ruolo |
|---|---|---|
| **Sito** (`/`) | Next.js 16, App Router | interfaccia per gli utenti: login, chat, foto + domanda, risposte |
| **Backoffice** (`/admin`) | Next.js, route handler in `app/api/admin` | area del team interno (admin e support) |
| **Backend** | FastAPI (Python 3.12) | autenticazione degli utenti, chat, documenti, riconoscimento + OCR + ricerca nei manuali |
| **Database** | PostgreSQL 18 | dati del sito (schema `app`) e del backoffice (schema `ops`) |
| **LLM** | Ollama (API nativa `/api/chat`), locale o remoto | scrittura della risposta |

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

- **LLM su Ollama, fuori da Docker:** sul Mac girano solo sito, backend e database. Il modello linguistico gira su Ollama nel PC Windows aziendale con RTX 5090, che il backend raggiunge via Tailscale all'indirizzo di `OLLAMA_BASE_URL` in `.env.docker` (per esempio `http://100.x.x.x:11434`, [§14](#14-remote-ollama--rtx-5090-setup)). Per usare l'Ollama installato sul Mac: `OLLAMA_BASE_URL=http://host.docker.internal:11434`. Dentro Docker su Mac il modello non userebbe la GPU e sarebbe molto più lento.
- **File:** i file coinvolti sono `docker-compose.yml`, `docker/backend.Dockerfile`, `docker/web.Dockerfile`, `.dockerignore` e `.env.docker.example`.

### 3.2 Prerequisiti e configurazione

- **Docker Desktop:** installa la versione giusta per il processore (Mac Intel, Mac Apple Silicon o Windows) e assegnale almeno **8 GB di memoria** da Settings → Resources.
- **Ollama:** deve essere acceso sul PC GPU, con il modello di `OLLAMA_MODEL` già scaricato (per esempio `ollama pull llama3.1:8b`), e raggiungibile dal Mac via Tailscale: `curl http://100.x.x.x:11434/api/tags`.
- **Manuali di base:** la cartella `CLI/pdf_immagini/` (circa 370 MB) non è su git e va copiata a mano. Viene montata nel container in sola lettura.

```bash
cp .env.docker.example .env.docker
```

In `.env.docker` compila:

- `POSTGRES_PASSWORD`, e la stessa password dentro `DATABASE_URL`;
- `AUTH_SECRET` e `BACKOFFICE_API_TOKEN`, due segreti diversi generati con `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`;
- `SMTP_*`: in produzione è obbligatorio, perché serve per la 2FA, il reset della password e l'OTP degli admin;
- `OLLAMA_BASE_URL` e `OLLAMA_MODEL` (§14.1). Vanno in `.env.docker`, non in `.env`: Docker Compose passa al container solo `.env.docker`.

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
- **LLM:** imposta `OLLAMA_BASE_URL` verso un Ollama raggiungibile dal server, per esempio il PC GPU via Tailscale ([§14](#14-remote-ollama--rtx-5090-setup)). Senza GPU le risposte sono lente.
- **Porta del database:** se il database non serve da fuori, togli `ports` dal servizio `db`.

### 3.8 Problemi comuni

| Sintomo | Causa probabile |
|---|---|
| Le risposte falliscono con «Servizio AI non disponibile» | Ollama è spento o irraggiungibile, oppure il modello di `OLLAMA_MODEL` non è stato scaricato. Controlla `GET /health/ai` ([§14](#14-remote-ollama--rtx-5090-setup)). |
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
2. **Lettura della targhetta.** GOT-OCR-2.0 (`backend/ocr_service.py`, caricato una volta e tenuto in memoria) estrae modello, matricola e asset tag, con un fuzzy match sui codici noti. Il testo letto resta in una piccola cache in memoria per hash della foto, quindi più domande sulla stessa foto non rifanno l'OCR. Con `OCR_IN_PROCESS=0` torna il vecchio subprocess `CLI/got_ocr_runner.py`. Con `OCR_BACKEND` diverso da `got` lo fa invece un LLM multimodale. Se l'OCR fallisce, la pipeline prosegue senza.
3. **Ricerca nei manuali (RAG).** La query è composta da macchina, tipo, codici letti e domanda. Cerca nei manuali della macchina riconosciuta (libreria `ragmens_core`: chunk, embedding `all-MiniLM-L6-v2`, FAISS). Nelle chat `merged` unisce anche i risultati dell'indice dell'azienda, riordina tutto per punteggio e tronca a `top_k`.
4. **Risposta verificata.** L'LLM deve rispondere in JSON citando passaggi dei manuali parola per parola (almeno 20 caratteri). Ogni punto senza una citazione verificabile viene scartato; se non ne resta nessuno, l'utente riceve "non ho trovato informazioni sufficienti".
5. **Salvataggio.** Se c'è una chat, domanda e risposta vanno in `app.messages`. Ogni richiesta, riconosciuta, non riconosciuta o fallita, va in `app.analyses` con esito, macchina, targhetta, risposta, fonti, errore interno e durata. È quello che vede il backoffice.
6. **Foto.** Viene salvata in un file temporaneo e **cancellata sempre** a fine richiesta. Resta solo una miniatura JPEG (lato massimo 320 px) nella colonna `analyses.image_thumbnail`, mostrata nella cronologia della chat.

### 5.1 Tempi e profiling

Ogni `/api/ask` scrive nei log del backend una riga `PERF` con il tempo di ogni fase e metriche non sensibili (dimensioni, conteggi, mai testi, prompt o immagini), più una riga `OLLAMA PERF` con i tempi restituiti da Ollama. Il `request_id` compare in tutte le righe della richiesta ed è restituito nell'header `X-Request-ID`.

```bash
docker compose logs backend | grep -E "PERF|OLLAMA PERF"
# PERF /api/ask rid=… total_ms=20750 upload_auth_ms=… recognition_ms=730 ocr_ms=18970 retrieval_ms=100
#   prompt_build_ms=0 ollama_ms=1350 citation_validation_ms=0 memory_save_ms=90 db_save_ms=… rag_hits=12 …
# OLLAMA PERF load_ms=11 prompt_tokens=2776 prompt_eval_ms=339 output_tokens=168 generation_ms=743 generation_tps=226 …
```

Tempi misurati su Mac Intel i7-8750H (Docker, solo CPU) con `llama3.1:8b` sulla RTX 5090:

| Caso | Prima | Dopo |
|---|---|---|
| Foto nuova, modelli già caricati | ~50 s | ~20 s (di cui OCR ~19 s) |
| Stessa foto, domanda successiva | ~47 s | ~3 s |
| Prima domanda dopo un riavvio | ~248 s | ~95 s senza preload; ~76 s con `PRELOAD_MODELS=1` (il preload dura 50–60 s in background) |

Il collo di bottiglia che resta è GOT-OCR su CPU: l'encoder visivo lavora a 1024×1024 in float32 e costa ~10 s anche su foto piccole, mentre Ollama risponde in 1–2 s. Sotto carico prolungato il Mac rallenta per il calore (`pmset -g therm`: `CPU_Speed_Limit` fino a 48), e i tempi dell'OCR oscillano tra 16 e 35 s.

Benchmark ripetibile, che non scrive la memoria reale:

```bash
docker cp CLI/immagini_test/carroponte_portuale_test1.jpg assistente-macchine-backend-1:/tmp/
docker exec -i assistente-macchine-backend-1 python - /tmp/carroponte_portuale_test1.jpg --preload < scripts/benchmark_ask.py
```

Il sito attende il backend fino a `ASK_TIMEOUT_SECONDS` (default 30 minuti; con `0` nessun limite). In caso di errore interno l'utente riceve un messaggio generico, mentre il dettaglio resta visibile solo nel backoffice.

---

## 6. Sito: account, aziende, chat e documenti

### 6.1 Account e sicurezza

- **Niente registrazione libera:** gli account li crea il super admin (i responsabili) o il responsabile dell'azienda (i dipendenti), con una password temporanea mostrata una sola volta. Al primo accesso la persona accetta Termini e Privacy; la password temporanea può tenerla o cambiarla dal *Profilo*, a sua scelta (§6.2).
- **Password:** PBKDF2-HMAC-SHA256 con 310.000 iterazioni e salt casuale, confrontata a tempo costante. Anche per un'email inesistente viene fatto un confronto finto, così la risposta non rivela quali email sono registrate.
- **Cambio password:** dal *Profilo* (`POST /api/auth/change-password`), chiede quella attuale e chiude le altre sessioni.
- **Blocco dopo troppi tentativi:** dopo 5 password sbagliate l'account resta bloccato per 15 minuti (`AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_SECONDS`).
- **Token:** firmato con HMAC su `AUTH_SECRET` (non è un JWT), scade dopo 24 ore e il browser lo tiene in `localStorage`.
  - Contiene un `token_version`: incrementandolo si invalidano **tutti** i token dell'utente.
  - Il `token_version` aumenta a logout, reset della password, disattivazione della 2FA e blocco dal backoffice.
- **2FA via email:** facoltativa, con codice a 6 cifre e codici di recupero.
- **Password dimenticata:** reset tramite link via email, valido 30 minuti; il link nuovo annulla quelli precedenti.
- **Account bloccati** (dal backoffice o dal responsabile dell'azienda): non possono più entrare (rispondono 403) e vengono disconnessi da tutti i dispositivi.

**Limiti di richieste** (in memoria, per indirizzo IP):

| Operazione | Limite di default |
|---|---|
| login e cambio password | 10 al minuto |
| domanda con foto | 20 al minuto |
| verifica codice 2FA / codice di recupero | 10 ogni 5 minuti |
| invio di un nuovo codice 2FA | 5 ogni 5 minuti |
| password dimenticata | 5 ogni 5 minuti, per IP e per email |

**Protezioni di rete:**
- **CORS:** il backend accetta solo le origini elencate in `ALLOWED_ORIGINS`.
- **Header di sicurezza:** il sito invia CSP `default-src 'self'`, `X-Frame-Options: DENY` e `nosniff`.

### 6.2 Ruoli: super admin, responsabile, dipendente

```
SUPER ADMIN (backoffice /admin, ops.operators)  crea aziende e responsabili, vede e gestisce tutto
  └─ RESPONSABILE (sito, ruolo company_admin)   usa il sito come un dipendente + «Gestione azienda» (/azienda)
       └─ DIPENDENTE (sito, ruolo employee)      chat, foto e domande su manuali e documenti dell'azienda
```

| | Dipendente | Responsabile | Super admin |
|---|:-:|:-:|:-:|
| Chat, foto e domande sul sito | ✓ | ✓ | — |
| Creare dipendenti, sospenderli, dare una nuova password temporanea | — | la sua azienda | tutti |
| Documenti: caricare, indicizzare, escludere dalla ricerca, eliminare | — | la sua azienda | tutti |
| Dashboard con le statistiche | — | la sua azienda, **senza il testo di domande e risposte** | tutte |
| Registro attività | — | la sua azienda | tutto |
| Creare aziende, nominare o revocare i responsabili | — | — | ✓ |

- **Aziende:** le crea il super admin (nome e dominio), non più in automatico dal dominio dell'email. Il dominio identifica l'azienda e la cartella dei suoi documenti; l'email dei dipendenti non deve per forza avere quel dominio.
- **Responsabili:** il super admin li crea con *Nuovo account* nella pagina dell'azienda, oppure nomina un dipendente esistente. Un'azienda può averne più di uno. Un responsabile non può gestire gli altri responsabili né sé stesso.
- **Password temporanea:** 12 caratteri senza simboli ambigui, mostrata una sola volta a chi crea l'account e mai salvata in chiaro. Resta valida finché la persona non la cambia; il sito ricorda con un avviso che è temporanea.
- **Isolamento:** ogni endpoint `/api/company/*` ricava l'azienda dall'account di chi chiama, mai dalla richiesta: chiedere un dipendente o un documento di un'altra azienda risponde 404.
- **Utenti esistenti:** con la migrazione `003` sono diventati tutti dipendenti della loro azienda; il super admin nomina i responsabili dal backoffice.

### 6.3 Chat

- **Modalità di conoscenza:** ogni chat ha una modalità fissata alla creazione.
  - `base`: solo i manuali generali;
  - `merged`: solo per utenti aziendali, aggiunge i PDF indicizzati dell'azienda selezionati per quella chat.
- **Titolo:** è l'unica cosa modificabile di una chat.
- **Eliminazione:** eliminare una chat cancella anche i suoi messaggi.
- **Risposte per chat:** la risposta completa (fonti, targhetta, candidati) resta legata alla chat che l'ha chiesta. "Nuova chat" riparte pulita e, tornando in una chat, la sua risposta è ancora lì. Dopo un ricaricamento della pagina restano domande e risposte come messaggi.

### 6.4 Documenti aziendali

| | Manuali di base | Documenti aziendali |
|---|---|---|
| Contenuto | manuali delle macchine di `CLI/machine.json` | PDF caricati dal responsabile di un'azienda |
| Dove | `CLI/pdf_immagini/`, indice in `CLI/index_no_finetuned/` | `data/companies/<hash del dominio>/` |
| Chi li gestisce | chi sviluppa il progetto | il responsabile dal sito (`/azienda`); il super admin dal backoffice |
| Visibilità | tutti | solo l'azienda |

- **Upload:** controlla tipo, estensione, firma `%PDF` e dimensione (`MAX_UPLOAD_MB`). Il file viene salvato con un nome casuale e l'indice dell'azienda viene ricostruito subito: lo stato del documento passa a `indexed`, oppure a `failed`.
- **Stati:** `indexed` (usato nelle risposte), `archived` (escluso dalla ricerca: il file resta in `archive/` e si può reindicizzare), `pending`, `failed` (si può riprovare con *Indicizza*). I dipendenti vedono solo i documenti indicizzati.
- **Escludi dalla ricerca / Indicizza:** sposta il file fra `pdfs/` (quello che il RAG indicizza) e `archive/`; l'indice si ricostruisce senza toccare la logica RAG.
- **Eliminazione:** cancella file e riga e libera l'indice in memoria, che viene ricostruito alla domanda successiva.
- **Aggiornamento dell'indice:** non è incrementale. Ogni modifica ricalcola l'indice di tutti i PDF dell'azienda.

---

## 7. Backoffice

Area riservata al team su `/admin` (il **super admin**). Gli operatori sono distinti dagli utenti del sito (`ops.operators`). I responsabili delle aziende non entrano qui: hanno la loro area sul sito (`/azienda`, §6.2).

| Sezione | Contenuto | Admin | Support |
|---|---|:-:|:-:|
| Dashboard | analisi di oggi, tasso di riconoscimento, errori, tempi, macchine più analizzate, analisi da verificare | ✓ | ✓ |
| Aziende | elenco con persone, responsabili, documenti e analisi degli ultimi 30 giorni; dettaglio con gli account | ✓ | ✓ |
| Aziende → nuova azienda, nuovo account, nomina o revoca del responsabile, nuova password temporanea | la password compare una sola volta; tutto passa dal backend (`/internal/*`) | ✓ | |
| Analisi | elenco filtrabile e dettaglio: domanda, risposta, fonti, targhetta, candidati, errore interno | ✓ | ✓ |
| Utenti | elenco, dettaglio con attività e chat | ✓ | ✓ |
| Utenti → blocca / riabilita | motivo obbligatorio | ✓ | |
| Documenti | stato di indicizzazione dei PDF aziendali | ✓ | ✓ |
| Documenti → escludi dalla ricerca / reindicizza | il file resta; l'indice dell'azienda viene aggiornato | ✓ | |
| Documenti → elimina | motivo obbligatorio; cancella il file e aggiorna l'indice dell'azienda | ✓ | |
| Registro attività | chi ha fatto cosa, quando e perché (non modificabile), anche le azioni dei responsabili sul sito | ✓ | |

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
| POST | `/api/auth/login` | con limiti di richieste; può chiedere la 2FA. La registrazione libera non esiste più |
| POST | `/api/auth/accept-terms` | primo accesso: accettazione di Termini e Privacy (prima di allora le altre API rispondono 403) |
| POST | `/api/auth/change-password` | facoltativo: password attuale + nuova, restituisce un nuovo token |
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
| GET | `/api/company/documents` | responsabile: tutti con lo stato; dipendenti: solo gli indicizzati |
| POST | `/api/company/documents` | upload e indicizzazione (solo responsabile) |
| POST | `/api/company/documents/{id}/archive`, `/reindex` | esclude dalla ricerca o reindicizza (solo responsabile) |
| DELETE | `/api/company/documents/{id}` | eliminazione definitiva (solo responsabile) |
| GET, POST | `/api/company/employees` | elenco e creazione dei dipendenti, con password temporanea (solo responsabile) |
| POST | `/api/company/employees/{id}/status`, `/reset-password` | sospensione (motivo obbligatorio) / riattivazione, nuova password temporanea (solo responsabile) |
| GET | `/api/company/dashboard?days=30`, `/api/company/audit` | statistiche e registro attività dell'azienda, senza testo delle domande (solo responsabile) |
| POST | `/api/ask` | foto + domanda (§5) |
| POST | `/api/transcribe` | audio della domanda dettata (campo `audio`) → `{ "text" }`, trascritto in locale con Whisper |
| POST | `/api/speak` | pezzo di risposta da leggere (campo `text`, max `MAX_SPEAK_CHARS`) → audio WAV, generato in locale con Piper |
| DELETE | `/internal/company-documents/{id}` | solo backoffice, header `X-Internal-Token` |
| POST | `/internal/companies`, `/internal/companies/{id}/accounts?role=`, `/internal/users/{id}/role`, `/internal/users/{id}/reset-password`, `/internal/company-documents/{id}/archive`, `/reindex` | solo backoffice (super admin), header `X-Internal-Token` |
| GET | `/health` | controllo di salute (non dipende dal modello) |
| GET | `/health/ai` | raggiungibilità di Ollama e presenza del modello, senza generare: 200 `{status: "ok", provider, model}` oppure 503 `{status: "unavailable", provider}`. Non passa dal proxy del sito |

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
| Limiti di richieste | `RATE_LIMIT_LOGIN_*`, `RATE_LIMIT_ASK_*`, `RATE_LIMIT_TRANSCRIBE_*`, `RATE_LIMIT_SPEAK_*`, `RATE_LIMIT_2FA_*`, `RATE_LIMIT_2FA_SEND_*`, `RATE_LIMIT_FORGOT_PASSWORD_*` |
| LLM | `OLLAMA_BASE_URL` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.2`), `OLLAMA_TIMEOUT` (120 s), `OLLAMA_CONNECT_TIMEOUT` (10 s), `OLLAMA_NUM_CTX`, `OLLAMA_NUM_PREDICT`, `OLLAMA_KEEP_ALIVE`, `VISION_LLM_BASE_URL`, `VISION_LLM_MODEL`. Fallback: `LLM_FALLBACK_ENABLED`, `MODAL_*`, `LLM_PRIMARY_*` ([§15](#15-llm-fallback-rtx-5090---modal)). Ancora accettate se le `OLLAMA_*` mancano: `OPENAI_BASE_URL` (il suffisso `/v1` viene tolto) e `LLM_MODEL`. Dettagli in [§14](#14-remote-ollama--rtx-5090-setup) |
| Modelli e OCR | `SIGLIP_MODEL`, `EMBEDDING_MODEL`, `OCR_BACKEND` (`got`), `GOT_OCR_MODEL`, `OCR_DEVICE` (`cpu`), `OCR_IN_PROCESS` (1), `OCR_CACHE_SIZE` (32), `OCR_MAX_NEW_TOKENS` (512), `PRELOAD_MODELS` (0; 1 in Docker), `HF_LOCAL_FILES_ONLY`, `IMAGE_RECOGNITION_THRESHOLD` (0.730) |
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
  azienda/                   «Gestione azienda» del responsabile: panoramica, dipendenti, documenti, registro
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
  main.py                    endpoint (sito, area aziendale, /internal), limiti di richieste, salvataggio delle analisi
  accounts.py                creazione account con password temporanea, registro attività
  model_service.py           SigLIP, OCR, RAG generale e per azienda, prompt e verifica delle citazioni
  llm_service.py             unico punto d'accesso al modello (configurazione, futuro fallback)
  ollama_client.py           unico client HTTP verso Ollama (/api/chat, /api/generate, /api/tags)
  modal_client.py            client del fallback Modal (API OpenAI di vLLM)
  llm_errors.py              errori del modello → 503 / 504 / 500
  ocr_service.py             GOT-OCR residente in memoria, cache per foto, warm-up
  perf.py                    profiling per richiesta (righe PERF, request id)
  database.py                pool PostgreSQL (psycopg), password, token, blocco per tentativi
  auth.py, email_service.py, two_factor_service.py, rate_limit.py, public_email_domains.py
  tests/                     pytest
database/                    schema, seed, migrazione da SQLite
docker/                      Dockerfile di backend e sito, script di importazione
docker-compose.yml
scripts/benchmark_ask.py     benchmark della pipeline senza HTTP né database
deploy/modal_app.py          app Modal del fallback LLM (vLLM + Llama 3.1 8B), deploy separato
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
- **backend:** autenticazione, 2FA, reset della password, limiti di richieste, isolamento tra aziende, upload e documenti, registrazione delle analisi, account bloccati, endpoint interno, ruoli aziendali (account con password temporanea, termini al primo accesso, cambio password, area del responsabile, isolamento tra aziende, dashboard senza testo delle domande), client Ollama ed errori del modello (con HTTP simulato, senza un Ollama reale), `/health/ai`, fallback Modal e circuit breaker (senza chiamare Modal);
- **backoffice:** permessi, password bcrypt e blocco, OTP, sessioni, blocco degli utenti con audit, analisi e dashboard, eliminazione dei documenti, aziende (creazione, account, ruoli, password) con audit sull'azienda;
- **sito:** login (senza registrazione) e 2FA, primo accesso con i termini, password temporanea e cambio dal profilo, documenti per dipendenti e responsabili, invio della domanda, risposte per chat, logout, pagina «Gestione azienda».

---

## 13. Limiti noti e debiti tecnici

- **Risposte prudenti con `llama3.2`.** È un modello piccolo e spesso non supera il controllo delle citazioni, quindi l'utente riceve "non ho trovato informazioni sufficienti" anche quando la macchina è riconosciuta e le fonti sono giuste. Da provare `llama3.1` o un controllo meno severo.
- **Memoria della conversazione non usata.** Memoria breve e lunga vengono salvate a ogni domanda, ma la risposta non le rilegge (`build_prompt` non viene chiamata): l'assistente non "ricorda" i turni precedenti.
- **OCR lento su CPU.** GOT-OCR gira sul processore del Mac (in Docker non c'è accesso alla GPU): ~19 s per ogni foto nuova. Spostarlo sul PC con la RTX 5090 lo porterebbe probabilmente sotto il secondo, ma richiede un servizio OCR su quel PC (§5.1).
- **Una sola istanza.** I limiti di richieste e l'indice di ogni azienda sono in memoria di processo. Con più istanze servirebbe uno store condiviso (per esempio Redis).
- **Indice non incrementale.** Ogni modifica ai PDF di un'azienda ricalcola l'intero indice.
- **Interfaccia incompleta:**
  - l'attivazione della 2FA esiste nelle API (§9.1), ma nel sito manca il pulsante per attivarla;
  - la schermata "verifica email" di `AuthPanel` punta a un endpoint che nel backend non esiste.
- **Privacy e Termini segnaposto.** `app/privacy` e `app/terms` contengono testo provvisorio e non sono conformi al GDPR così come sono.
- **CSP permissiva.** Include `'unsafe-inline'` e `'unsafe-eval'` per lo sviluppo; va ristretta in produzione.

---

## 14. Remote Ollama / RTX 5090 setup

Il modello può girare su un altro computer, per esempio il PC Windows aziendale con la RTX 5090. Il backend lo raggiunge in HTTP sulla rete privata Tailscale, e cambiare macchina richiede solo di modificare `OLLAMA_BASE_URL`, senza toccare il codice.

```
Browser ──► Next.js ──► FastAPI ──(OLLAMA_BASE_URL, rete Tailscale)──► PC Windows RTX 5090 ──► Ollama ──► Llama
```

- **Solo lato server.** L'indirizzo di Ollama esiste solo nelle variabili d'ambiente del backend. Il browser non lo vede mai, nemmeno in `/health/ai`, e il backend non espone un proxy generico verso Ollama.
- **Un solo punto d'accesso al modello.** Tutte le chiamate passano da `backend/llm_service.py`, che usa `backend/ollama_client.py` (API native `/api/chat`, `/api/generate`, `/api/tags`, senza streaming). RAG, prompt, verifica delle citazioni e memoria non sono cambiati. Un secondo provider, come un fallback RunPod, si aggiunge in `LLMService` (c'è un TODO nel punto giusto).
- **Avvio indipendente.** All'avvio il backend non contatta Ollama: parte anche con il PC GPU spento, e le domande rispondono 503 finché Ollama non torna raggiungibile.
- **Tailscale** lavora solo a livello di rete: il backend non esegue comandi Tailscale e non contiene logica specifica.

### 14.1 Variabili

| Variabile | Default | Significato |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | `http://localhost:11434` in locale, `http://100.x.x.x:11434` o `http://server-ai:11434` (MagicDNS) in remoto |
| `OLLAMA_MODEL` | `llama3.2` | nome esatto come in `ollama list`, per esempio `llama3.1:8b` |
| `OLLAMA_TIMEOUT` | `120` | secondi di attesa della risposta completa |
| `OLLAMA_CONNECT_TIMEOUT` | `10` | secondi per aprire la connessione: con il PC spento l'errore arriva dopo questo tempo |
| `OLLAMA_NUM_CTX` | vuoto | finestra di contesto in token; vuoto = default del modello |
| `OLLAMA_NUM_PREDICT` | vuoto | massimo di token generati per risposta (consigliato `1024`, le risposte valide sono 150–400 token). Senza limite, un modello che entra in un ciclo genera fino a `OLLAMA_TIMEOUT` e l'utente riceve 504 |
| `OLLAMA_KEEP_ALIVE` | vuoto | per quanto il modello resta nella VRAM dopo una domanda (`30m`, `-1` = sempre); vuoto = default di Ollama, 5 minuti, dopo i quali ricaricarlo costa ~2–4,5 s |

Le vecchie `OPENAI_BASE_URL` (per esempio `http://localhost:11434/v1`, il suffisso `/v1` viene tolto) e `LLM_MODEL` valgono ancora quando le `OLLAMA_*` non sono impostate. `OPENAI_API_KEY` non serve più.

**Errori restituiti al sito** (formato abituale `{ "detail": "..." }`, senza traceback né indirizzi):

| Caso | HTTP |
|---|---|
| PC spento, Ollama non avviato, rete assente, connessione interrotta | 503 |
| Modello non installato | 503 |
| Risposta oltre `OLLAMA_TIMEOUT` | 504 |
| Errore HTTP di Ollama o risposta non valida | 500 |

Ogni errore finisce anche in `app.analyses` e quindi nel backoffice. I log del backend (`backend.ollama`) riportano endpoint, modello, durata, status HTTP e causa, per esempio `Ollama request model=llama3.1:8b duration=2.42s status=200`. Non riportano mai prompt, documenti o token.

### 14.2 Sul PC RTX 5090 (Windows, PowerShell)

```powershell
ollama --version
ollama pull llama3.1:8b
ollama list                                        # il nome qui deve coincidere con OLLAMA_MODEL
Invoke-RestMethod http://localhost:11434/api/tags  # Ollama risponde in locale

# Di default Ollama ascolta solo su 127.0.0.1. Per renderlo raggiungibile via Tailscale:
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0:11434", "User")
# poi chiudi Ollama dall'icona nella barra delle applicazioni e riaprilo.

# Firewall (PowerShell come amministratore): porta 11434 aperta solo agli indirizzi Tailscale.
New-NetFirewallRule -DisplayName "Ollama (solo Tailscale)" -Direction Inbound -Protocol TCP `
  -LocalPort 11434 -RemoteAddress 100.64.0.0/10 -Action Allow

tailscale ip -4                                    # indirizzo 100.x.x.x da usare in OLLAMA_BASE_URL
```

Ollama non ha autenticazione: **non** inoltrare mai la porta 11434 sul router e non esporla su Internet. Per restringere l'accesso al solo server del backend, usa anche le ACL di Tailscale.

### 14.3 Sul computer del backend (Windows, PowerShell)

```powershell
# 1. Raggiungibilità del PC GPU
tailscale status
Test-NetConnection 100.x.x.x -Port 11434           # TcpTestSucceeded : True
Invoke-RestMethod http://100.x.x.x:11434/api/tags  # elenco dei modelli installati

# 2. Prova diretta di Ollama (senza backend)
$body = @{ model = "llama3.1:8b"; messages = @(@{ role = "user"; content = "Ciao" }); stream = $false } | ConvertTo-Json -Depth 5
(Invoke-RestMethod -Method Post http://100.x.x.x:11434/api/chat -ContentType "application/json" -Body $body).message.content

# 3. Installazione e avvio del backend (serve anche PostgreSQL, vedi §4)
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env                        # poi imposta DATABASE_URL, OLLAMA_BASE_URL, OLLAMA_MODEL
.\run_backend.ps1                                  # usa i valori di .env
.\run_backend.ps1 -OllamaBaseUrl http://100.x.x.x:11434 -OllamaModel llama3.1:8b   # oppure li sovrascrive

# 4. Health check (in un secondo terminale)
curl.exe -i http://127.0.0.1:8000/health/ai
# 200 {"status":"ok","provider":"ollama","model":"llama3.1:8b"}
# 503 {"status":"unavailable","provider":"ollama"}

# 5. Domanda completa: login, poi foto + domanda
$login = Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/auth/login -Body @{ email = "utente@azienda.it"; password = "..." }
$token = $login.token                              # con la 2FA attiva serve prima /api/auth/2fa/verify
curl.exe -s -X POST http://127.0.0.1:8000/api/ask -H "Authorization: Bearer $token" `
  -F "question=Come si esegue la manutenzione ordinaria?" -F "image=@CLI\immagini_test\carroponte_portuale_test1.jpg"
```

**Verificare che lavori la RTX 5090.** Sul PC GPU, durante una domanda:

```powershell
nvidia-smi -l 1      # ollama.exe tra i processi, memoria GPU occupata e "GPU-Util" alta
ollama ps            # colonna PROCESSOR: "100% GPU"
```

**Passare da locale a remoto.** In `.env` cambia solo l'indirizzo e riavvia il backend:

```
OLLAMA_BASE_URL=http://localhost:11434     # Ollama sullo stesso computer
OLLAMA_BASE_URL=http://100.x.x.x:11434     # PC RTX 5090 via Tailscale
```

In alternativa, per una sola sessione: `$env:OLLAMA_BASE_URL = "http://100.x.x.x:11434"` prima di avviare il backend. Con il backend in Docker, metti il valore in `.env.docker`: il container deve poter raggiungere l'indirizzo Tailscale del PC GPU, quindi verificalo con `docker compose exec backend python -c "import httpx; print(httpx.get('http://100.x.x.x:11434/api/tags').status_code)"`.

### 14.4 Troubleshooting

| Problema | Cosa controllare |
|---|---|
| **Ollama non raggiungibile** (503, log `reason=unreachable` o `connect timeout`) | PC RTX acceso e non in sospensione; Ollama avviato (`ollama list` sul PC); Tailscale connesso su entrambi (`tailscale status`); `OLLAMA_HOST=0.0.0.0:11434` impostato e Ollama riavviato; `Test-NetConnection 100.x.x.x -Port 11434`; regola del Firewall di Windows |
| **Timeout** (504, log `reason=timeout`) | modello troppo pesante per la VRAM; contesto troppo grande (`CONTEXT_MAX_CHARS`, `OLLAMA_NUM_CTX`); GPU occupata da altri processi (`nvidia-smi`); primo caricamento del modello in memoria; se serve, alza `OLLAMA_TIMEOUT` |
| **Modello inesistente** (503, log `status=404`, `/health/ai` con `"reason": "model_not_found"`) | sul PC RTX `ollama list`; `OLLAMA_MODEL` deve coincidere con il nome, tag compreso (`llama3.1:8b`); altrimenti `ollama pull <modello>` |
| **GPU non utilizzata** (risposte lente) | `nvidia-smi` durante una generazione e `ollama ps`: se PROCESSOR indica CPU, aggiorna i driver NVIDIA e Ollama (la serie RTX 50 richiede versioni recenti) oppure scegli un modello che entri nei 32 GB di VRAM |
| **Errore del servizio AI** (500) | log `backend.ollama`: riportano lo status HTTP e il messaggio di Ollama (per esempio memoria esaurita) |

---

## 15. LLM fallback: RTX 5090 -> Modal

La RTX 5090 aziendale resta **sempre il provider principale**. Modal è un fallback serverless che entra in gioco **solo** quando il PC non può rispondere per un problema infrastrutturale. Le richieste non vanno mai a entrambi.

```
backend ─► LLMService ─┬─► PRIMARY  Ollama sulla RTX 5090 (Tailscale)
                       └─► FALLBACK Modal: vLLM + meta-llama/Llama-3.1-8B-Instruct su GPU cloud
                           (solo se il primario ha un errore infrastrutturale)
```

- **Cosa resta nel backend:** RAG, OCR, prompt e verifica delle citazioni sono gli stessi qualunque provider risponda. Modal riceve gli stessi messaggi, con la stessa temperatura e lo stesso limite di token (`OLLAMA_NUM_PREDICT` → `max_tokens`), e fa solo inference.
- **Dati:** quando il fallback è attivo, domanda ed estratti dei manuali, anche aziendali, escono dalla rete aziendale verso Modal. Serve l'approvazione dell'azienda.
- **Codice:** `backend/llm_service.py` (fallback, circuit breaker, contatori), `backend/modal_client.py`, `backend/llm_errors.py` (`INFRASTRUCTURE_ERRORS`), `deploy/modal_app.py`.

### 15.1 Quando parte il fallback

| Attiva il fallback | NON attiva il fallback (errore restituito così com'è) |
|---|---|
| connessione rifiutata o interrotta, host irraggiungibile, DNS | 400 (richiesta non valida) |
| timeout di connessione (PC spento, Tailscale giù) | 401 / 403 (chiave o autenticazione) |
| timeout di risposta (`OLLAMA_TIMEOUT`) | 500 o risposta non valida del modello |
| HTTP 502 / 503 / 504 (e 429) | risposta valida ma senza citazioni verificabili |
| modello non installato sul PC (404): quel server non può rispondere, Modal ha la sua copia | errori di database, autenticazione dell'utente, validazione |

Se anche Modal fallisce, il sito riceve l'errore di Modal: 504 per timeout, 503 se non raggiungibile, 500 per errore o chiave sbagliata.

### 15.2 Variabili (`.env.docker`)

| Variabile | Default | Significato |
|---|---|---|
| `LLM_FALLBACK_ENABLED` | `false` | `true` attiva il fallback, ma solo con `MODAL_BASE_URL` e `MODAL_API_KEY` compilati. `false` + `docker compose up -d backend` lo spegne subito |
| `MODAL_BASE_URL` | vuoto | URL dell'app Modal, senza `/v1` |
| `MODAL_API_KEY` | vuoto | uguale a `VLLM_API_KEY` nel secret Modal. Solo lato server: non va nel frontend, nei log né su git |
| `MODAL_MODEL` | `meta-llama/Llama-3.1-8B-Instruct` | deve coincidere con il modello del deploy |
| `MODAL_TIMEOUT` / `MODAL_CONNECT_TIMEOUT` | `300` / `10` | il timeout comprende l'avvio a freddo della GPU (~2 minuti dopo una pausa) |
| `MODAL_MAX_CONCURRENT_REQUESTS` | `2` | massimo di richieste Modal contemporanee da questo backend; le altre aspettano |
| `LLM_PRIMARY_FAILURE_THRESHOLD` | `3` | errori infrastrutturali consecutivi che aprono il circuit breaker |
| `LLM_PRIMARY_COOLDOWN_SECONDS` | `60` | per quanto la RTX 5090 viene saltata dopo l'apertura |
| `OLLAMA_CONNECT_TIMEOUT` | `5` in Docker | breve, così con il PC spento il fallback parte dopo ~5 s |

**Circuit breaker.** Dopo `LLM_PRIMARY_FAILURE_THRESHOLD` errori infrastrutturali di fila, per `LLM_PRIMARY_COOLDOWN_SECONDS` le domande vanno direttamente su Modal, senza aspettare il timeout del PC. Finito il cooldown, una sola richiesta riprova la RTX 5090, mentre le altre restano su Modal. Se va bene si torna al primario; se no si aspetta un altro cooldown. Vive in memoria nel processo del backend, senza Redis.

### 15.3 Deploy su Modal

Serve un account Modal e un account Hugging Face che abbia accettato la licenza di [Llama 3.1 8B Instruct](https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct), con un token di lettura.

```bash
# 1. CLI Modal. Su Windows e sui Mac Apple Silicon basta: pip install modal
#    Su questo Mac Intel pip non riesce a compilare una dipendenza (cbor2),
#    quindi usa un container usa e getta:
docker run --rm -it -v "$PWD/deploy:/deploy" python:3.12-slim bash
pip install modal

# 2. Login: apre un link da confermare nel browser
modal setup

# 3. Secret con il token Hugging Face e una chiave API nuova e casuale
python -c "import secrets; print(secrets.token_urlsafe(32))"      # → chiave per VLLM_API_KEY
modal secret create assistente-llm-fallback HF_TOKEN=hf_xxx VLLM_API_KEY=<chiave>

# 4. Deploy: stampa l'URL, del tipo https://<workspace>--assistente-llm-fallback-serve.modal.run
modal deploy /deploy/modal_app.py        # fuori dal container: modal deploy deploy/modal_app.py
```

L'app scala a zero: nessuna GPU è accesa quando il fallback non serve (`min_containers=0`, massimo 1 container). Dopo l'ultima richiesta il container resta pronto per `MODAL_SCALEDOWN_SECONDS` (default 300), poi si spegne. La richiesta successiva paga un avvio a freddo: GPU, caricamento del modello e, solo la prima volta, il download da Hugging Face in un volume Modal. Le impostazioni di deploy (`MODAL_GPU`, default `L4`, e le altre) sono descritte in cima a `deploy/modal_app.py`.

Poi, in `.env.docker`:

```
LLM_FALLBACK_ENABLED=true
MODAL_BASE_URL=https://<workspace>--assistente-llm-fallback-serve.modal.run
MODAL_API_KEY=<la stessa chiave del secret>
```

e `docker compose up -d backend`. Controllo:

```bash
docker exec assistente-macchine-backend-1 python -c "import urllib.request as u;print(u.urlopen('http://127.0.0.1:8000/health/ai').read().decode())"
# "fallback": {"provider": "modal", "enabled": true, "configured": true, ...}
```

`/health/ai` non chiama mai Modal, per non accendere una GPU a pagamento a ogni controllo: per il fallback riporta solo la configurazione. Con il PC spento e il fallback pronto risponde `"status": "degraded"` con HTTP 200; senza nessun provider utilizzabile risponde 503.

### 15.4 Test del failover

```bash
docker compose logs -f backend | grep -E "llm provider=|Modal request|circuit"
```

| Test | Azione | Risultato atteso nei log |
|---|---|---|
| **A — primario** | PC e Ollama accesi, fai una domanda dal sito | `llm provider=ollama result=success`, nessuna riga `Modal request` |
| **B — fallback** | chiudi Ollama sul PC (*Quit Ollama*), fai una domanda | `llm provider=ollama result=unavailable ... fallback=modal`, poi `llm provider=modal result=success`. Dalla 4ª domanda: `result=skipped reason=circuit_open`, senza più attesa sul PC |
| **C — ritorno** | riapri Ollama, aspetta `LLM_PRIMARY_COOLDOWN_SECONDS`, fai una domanda | `llm provider=ollama result=success` e `circuit=closed` |

Ogni richiesta Modal registra `duration_seconds`, i token e i contatori (`llm_fallback_requests`, `llm_fallback_successes`, …), visibili anche in `/health/ai`. Il costo si ricava dalla durata e dal prezzo della GPU sul sito di Modal: il backend non lo stima.

### 15.5 Troubleshooting

| Problema | Cosa controllare |
|---|---|
| Il fallback non parte mai | `LLM_FALLBACK_ENABLED=true` e entrambe le variabili `MODAL_*` compilate. Nei log di avvio compare `role=fallback provider=modal`; con un errore 400/401/500 del primario il fallback non parte, ed è voluto |
| Modal risponde 401 | `MODAL_API_KEY` diversa da `VLLM_API_KEY` nel secret Modal |
| Prima risposta Modal in timeout (504) | avvio a freddo più lungo di `MODAL_TIMEOUT`: alzalo (per esempio 300) oppure aumenta `MODAL_SCALEDOWN_SECONDS` nel deploy |
| Il deploy fallisce scaricando il modello | licenza Llama 3.1 non accettata su Hugging Face, oppure `HF_TOKEN` mancante o sbagliato nel secret |
| Modal risponde 400 | prompt più lungo di `MODAL_MAX_MODEL_LEN` (8192). Ollama in quel caso tronca il prompt, vLLM invece rifiuta la richiesta |
| Costi inattesi | log `Modal request ... duration_seconds` e dashboard Modal; `LLM_FALLBACK_ENABLED=false` + `docker compose up -d backend` spegne il fallback subito |

