# Documentazione tecnica — Assistente Macchine

Documentazione di riferimento dell'intero sistema: frontend Next.js, backend FastAPI, pipeline di riconoscimento macchine (visione + OCR + RAG + LLM), autenticazione, persistenza e configurazione. Riflette lo stato del codice sul branch corrente (`claude/ui-refactor-auth`), non solo l'ultimo commit.

> Nota: dove qualcosa nel codice non corrisponde a quanto descritto nel `README.md` esistente, questo documento segue il codice reale e segnala esplicitamente la discrepanza (vedi §10 "Problemi noti").

---

## 1. Panoramica

L'app è un assistente per il riconoscimento e la consultazione di manuali di macchinari industriali, con quattro fasi in sequenza:

1. **Riconoscimento macchina da foto** — embedding SigLIP (zero-shot) confrontato contro immagini di riferimento curate staticamente in `CLI/reference_images/` + `CLI/machine.json`.
2. **Lettura targhetta (OCR)** — estrazione di modello/matricola dalla foto, via GOT-OCR-2.0 (default) o un LLM vision-capable in alternativa.
3. **Retrieval (RAG)** — ricerca nei manuali PDF della macchina riconosciuta (base di conoscenza statica) e, opzionalmente, nei PDF caricati dall'azienda dell'utente (base di conoscenza per-tenant).
4. **Generazione risposta** — un LLM (di default un modello locale via Ollama) risponde citando solo passaggi effettivamente presenti nei manuali recuperati.

Frontend e backend sono due processi separati:

- **Frontend**: Next.js 16 (App Router), un'unica pagina applicativa (`app/page.tsx`), porta 3000.
- **Backend**: FastAPI (`backend/main.py`), porta 8000, con SQLite (`data/app.db`) e indici FAISS su filesystem.

---

## 2. Architettura e comunicazione frontend↔backend

Il browser parla solo con Next.js; Next.js fa da proxy verso FastAPI, così il token e l'URL reale del backend non sono mai esposti al client.

- `app/api/backend/[...path]/route.ts` — proxy generico per tutte le chiamate REST (`GET/POST/PATCH/DELETE`), inoltra `content-type` e `authorization`, verso `${BACKEND_URL}/api/<path>`.
- `app/api/ask/route.ts` — proxy dedicato a `/api/ask` (multipart, upload immagine), `maxDuration = 300` secondi per via dei tempi di inferenza ML; se il backend non è raggiungibile, risponde con un 502 in italiano che suggerisce `npm run backend`.
- `BACKEND_URL` (env, default `http://127.0.0.1:8000`) è l'unica configurazione che lega i due processi.

In sviluppo servono **due terminali**: `npm run backend` (uvicorn) e `npm run dev` (Next.js). Non esiste alcuna configurazione Docker/CI/deploy nel repo: il deployment in produzione è manuale.

---

## 3. Autenticazione e sicurezza

### 3.1 Registrazione — `POST /api/auth/register`

Campi form: `email`, `password`, `terms_accepted`. Validazioni, in ordine:

1. Email normalizzata (`lower + strip`), formato validato con una regex permissiva (`^[^@\s]+@([^@\s]+)$` — non richiede un dominio con punto/TLD valido).
2. Password: unico requisito è la lunghezza minima di **8 caratteri**. Nessun controllo di complessità (maiuscole/cifre/simboli), nessun controllo su password compromesse.
3. `terms_accepted` obbligatorio (checkbox Termini + Privacy).
4. Email duplicata → `409`.

La registrazione **non richiede verifica email** nello stato attuale: viene restituito subito un token utilizzabile. (In passato questa funzionalità è stata aggiunta e poi rimossa — vedi §10.)

**Associazione azienda automatica**: alla registrazione (e retroattivamente al primo login se mancante), il dominio dell'email viene estratto e confrontato con una lista di ~55 provider email "pubblici" (`backend/public_email_domains.py`: gmail, outlook, libero.it, virgilio.it, ecc.). Se il dominio **non** è pubblico, viene creata automaticamente (se non esiste già) una riga in `companies` con quel dominio, e l'utente viene collegato — **senza alcuna approvazione manuale**. Ogni nuovo dominio aziendale diventa quindi una "azienda" a sé, e tutti gli utenti con lo stesso dominio email condividono automaticamente documenti e chat aziendali.

### 3.2 Login — `POST /api/auth/login`

- Password verificata con **PBKDF2-HMAC-SHA256, 310.000 iterazioni**, salt casuale a 16 byte, confronto a tempo costante (`hmac.compare_digest`).
- **Mitigazione enumerazione utenti**: anche per email inesistenti viene comunque eseguito un confronto PBKDF2 contro un hash fittizio precalcolato, per rendere il tempo di risposta statisticamente indistinguibile; il messaggio d'errore (`401`) è identico sia per "email sconosciuta" sia per "password errata".
- **Blocco account**: dopo 5 tentativi falliti consecutivi (`AUTH_MAX_FAILED_ATTEMPTS`), l'account si blocca per 15 minuti (`AUTH_LOCKOUT_SECONDS`) — blocco per **account**, non per IP. Il contatore si azzera solo con un login riuscito (non decade nel tempo).

### 3.3 Modello dei token

Token firmato, **non JWT**, formato custom: `"{user_id}:{token_version}:{scadenza}:{nonce}".firma`, firma HMAC-SHA256 su `AUTH_SECRET`.

- Scadenza: 24h di default (`AUTH_TOKEN_TTL_SECONDS`).
- `AUTH_SECRET` obbligatorio in produzione (`APP_ENV=production` → l'app rifiuta di avviarsi se manca); in sviluppo, se assente, viene generato un segreto casuale ad ogni riavvio del processo (quindi **tutte le sessioni scadono ad ogni restart in dev**).
- **Non esiste una tabella sessioni per dispositivo**: la revoca è un singolo contatore `token_version` per utente. Il logout (`POST /api/auth/logout`) incrementa quel contatore → **invalida contemporaneamente tutti i token attivi dell'utente su tutti i dispositivi**. Non è possibile disconnettere una sola sessione lasciando le altre attive.

### 3.4 Rate limiting

Limiter in-memory a finestra scorrevole, **per-processo** (va sostituito con uno store condiviso tipo Redis se si passa a più worker):

| Endpoint | Limite default | Finestra |
|---|---|---|
| `POST /api/auth/login` | 10 richieste | 60s |
| `POST /api/auth/register` | 5 richieste | 60s |
| `POST /api/ask` | 20 richieste | 60s |

Chiave = IP client. Nessun limite su logout, `/me`, chat, documenti.

### 3.5 CORS / CSP

- Backend: `CORSMiddleware` con allowlist esplicita (`ALLOWED_ORIGINS`, default `localhost:3000` + `127.0.0.1:3000`), non `"*"`.
- Frontend (`next.config.ts`): CSP `default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`, più `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`. `'unsafe-inline'`/`'unsafe-eval'` sono ancora presenti per il fast refresh di sviluppo — da restringere in produzione.
- Il token è salvato in `localStorage["assistant-token"]` lato client (non cookie), scelta coerente con l'architettura "tutte le chiamate stesso-origine via proxy".

### 3.6 `CurrentUser` (dipendenza FastAPI)

Ogni endpoint protetto richiede `Authorization: Bearer <token>`; il token viene decodificato, l'utente ricaricato dal DB e il `token_version` ricontrollato ad ogni richiesta. L'oggetto utente esposto ai route handler contiene solo `{id, email, company_domain}` — mai l'hash password o i contatori di sicurezza.

---

## 4. Chat

Tabella `chats`: `id, user_id, title, knowledge_mode ('base'|'merged'), company_document_ids (JSON), created_at, updated_at`.

- `POST /api/chats` — crea una chat; `knowledge_mode` e `company_document_ids` sono **fissati alla creazione** e non modificabili in seguito. `"merged"` è consentito solo se l'utente appartiene a un'azienda (altrimenti `403`).
- `PATCH /api/chats/{id}` — unico campo modificabile: `title`.
- `DELETE /api/chats/{id}` — cancellazione fisica, propaga ai messaggi via `ON DELETE CASCADE`.
- `GET /api/chats/{id}/messages` — cronologia ordinata.

I messaggi (`messages`: `id, chat_id, role, content, created_at`) vengono salvati **lato server dentro `/api/ask`** quando è presente un `chat_id` attivo: sempre il messaggio utente, e il messaggio assistente solo se è stata prodotta una risposta (il ramo "macchina non riconosciuta" non salva nulla). Se non c'è una chat attiva (`chat_id` assente), lo scambio resta effimero, visibile solo nella sessione corrente della pagina.

---

## 5. Documenti aziendali e memoria RAG

### 5.1 Due basi di conoscenza distinte

| | Base (statica) | Aziendale (per-tenant) |
|---|---|---|
| Contenuto | Manuali associati a ogni macchina in `CLI/machine.json` | PDF caricati dagli utenti di un'azienda |
| Percorso | `CLI/pdf_immagini/` + `CLI/index_no_finetuned/` | `data/companies/<sha256(dominio)[:16]>/{pdfs,index,memory,debug}/` |
| Modificabile da UI | No (curata da chi sviluppa il progetto) | Sì (upload/delete via webapp) |
| Isolamento | Condivisa da tutti | Isolata per dominio email aziendale |

### 5.2 Upload — `POST /api/company/documents`

1. Validazione: content-type `application/pdf`, estensione `.pdf`, **magic bytes** (`%PDF`) del file, limite dimensione (`MAX_UPLOAD_MB`, default 30MB).
2. Il file viene salvato con un nome casuale su disco (il nome originale resta solo come metadato per l'utente, evitando collisioni tra upload con lo stesso nome).
3. Riga inserita in `documents` con `status = 'pending'`.
4. **Indicizzazione sincrona**: subito dopo il salvataggio, l'endpoint forza la ricostruzione dell'indice FAISS dell'azienda (`ensure_company_rag_ready`) prima di rispondere:
   - successo → tutti i documenti dell'azienda passano a `status = 'indexed'`;
   - eccezione durante l'indicizzazione → solo il documento appena caricato passa a `status = 'failed'`, errore loggato.
5. Non esiste indicizzazione incrementale: ogni modifica al corpus PDF di un'azienda comporta il **ri-embedding completo** di tutti i suoi PDF (nessun aggiornamento a livello di singolo chunk).

### 5.3 Elenco e cancellazione

- `GET /api/company/documents` — elenco per azienda dell'utente autenticato, con `id, filename, status, created_at`.
- `DELETE /api/company/documents/{id}` — cancella file su disco + riga DB + invalida la cache RAG in memoria dell'azienda (rebuild pigro alla prossima domanda, non sincrono come per l'upload).

### 5.4 UI — pannello "Documenti aziendali"

Nella sidebar (`app/components/DocumentUploader.tsx`), scoped automaticamente all'azienda dell'utente loggato:

- Lista scrollabile (altezza massima, scroll interno) con badge di stato colorato per PDF: verde "In memoria RAG" (indexed), giallo "Indicizzazione..." (pending), rosso "Errore indicizzazione" (failed).
- Checkbox per riga = seleziona il documento da includere nella **prossima chat aziendale** (`knowledge_mode: 'merged'`) — non cancella nulla.
- Icona documento-con-meno per riga = **rimuove il PDF dalla memoria RAG** in modo permanente, con conferma.
- Le due azioni sono intenzionalmente separate (icone e didascalie diverse) per evitare ambiguità tra "seleziona per la chat" e "elimina dalla memoria".

### 5.5 Le foto NON sono in questa memoria

A differenza dei PDF, le foto caricate in chat per il riconoscimento macchina **non vengono mai salvate né apprese in modo persistente**: il file va in una directory temporanea, usato una volta per l'inferenza SigLIP, poi cancellato subito (`finally: image_path.unlink(...)`, eseguito in ogni caso, anche in errore). Le immagini di riferimento contro cui si confronta sono statiche e globali (`CLI/reference_images/` + `CLI/machine.json`), non caricabili né cancellabili da webapp, non isolate per azienda. Non esiste alcuna tabella `images`/`photos` nel DB.

---

## 6. `/api/ask` — pipeline di riconoscimento end-to-end

Richiesta multipart: `question`, `image`, `chat_id` (opzionale), `top_k` (default 12). Rate-limited (20/min/IP).

1. **Identificazione macchina** (`identify_machine`): embedding SigLIP dell'immagine, similarità coseno contro le reference embeddings di ogni macchina in `machine.json`; se il punteggio migliore è sotto soglia (`IMAGE_RECOGNITION_THRESHOLD`, default `0.730`) → risposta `{"recognized": false, "reason": ...}`, niente OCR/retrieval/LLM, niente persistenza messaggi.
2. **OCR targhetta** (`extract_image_identifiers`): backend configurabile via `OCR_BACKEND`:
   - `"got"` (default) — GOT-OCR-2.0 locale via subprocess, poi estrazione regex di modello/matricola dal testo grezzo, con fallback fuzzy-match contro i codici modello noti nel progetto.
   - qualsiasi altro valore — un LLM vision-capable riceve l'immagine come data-URL e risponde in JSON strutturato.
   - In caso di errore, `image_identifiers.available = false` senza bloccare il resto della pipeline.
3. **Retrieval**: la query di ricerca è `"{nome macchina} {tipo} {identificatori OCR} {domanda utente}"` (i codici letti dalla targhetta entrano quindi anche nella query, non solo nella visualizzazione). Cerca prima nella base statica, filtrata ai soli manuali della macchina riconosciuta; se `knowledge_mode == 'merged'` e l'utente ha un'azienda, unisce anche gli hit dalla base aziendale (filtrata ai documenti selezionati dalla chat) — i risultati vengono concatenati e **riordinati globalmente per punteggio**, poi troncati a `top_k` (non c'è una quota fissa riservata a ciascuna fonte).
4. **Generazione risposta grounded** (`answer_from_manuals`): il LLM riceve solo i passaggi recuperati e deve rispondere in JSON con citazioni verificabili (`passage_id`, `quote` verbatim ≥20 caratteri effettivamente presente nel passaggio). Ogni punto che non supera la verifica viene scartato; se nessun punto è valido, risposta fissa "non ho trovato informazioni sufficienti". Il client LLM (via libreria `openai`, compatibile OpenAI) punta di default a **Ollama locale** (`http://localhost:11434/v1`, modello `llama3.2`).
5. **Memoria conversazionale**: session id = combinazione di `chat_id` + macchina riconosciuta (fix applicato in un commit recente per evitare che le conversazioni si mescolassero tra chat/utenti diversi). Memoria breve (ultimi messaggi) e lunga (FAISS) vengono **scritte** ad ogni turno — ma, allo stato attuale del codice, **non vengono mai rilette** nel prompt usato per rispondere: la generazione della risposta (`answer_from_manuals`) usa solo i passaggi dei manuali, la domanda e i dati della macchina, non la cronologia. È un gap architetturale da tenere presente: la "memoria" esiste solo come log, non incide ancora sulle risposte.
6. **Pulizia**: il file immagine temporaneo viene sempre cancellato, indipendentemente dall'esito.
7. **Persistenza**: se c'è una `chat_id`, il turno viene salvato in `messages` (vedi §4).

---

## 7. Frontend — struttura e convenzioni

### 7.1 Pattern di stato

Nessuna libreria di stato esterna (niente Redux/Zustand/React Query): quattro hook indipendenti, composti solo in `app/page.tsx`:

- `useAuth` — sessione, token in `localStorage`.
- `useChats` — lista chat, cronologia, CRUD.
- `useCompanyDocuments` — documenti aziendali, upload/selezione/cancellazione.
- `useAsk` — immagine/domanda correnti, risultato, stato di caricamento.

Ogni hook restituisce `{ ...stato, ...azioni }`; nessun hook importa un altro hook — l'orchestrazione (es. passare `chats.appendExchange` dentro `ask.submit`) avviene solo in `page.tsx`.

### 7.2 Componenti principali (`app/components/`)

| Componente | Ruolo |
|---|---|
| `AuthPanel` | Switcher tra login/registrazione/verifica/recupero password |
| `ChatSidebar` | Colonna sinistra: account, elenco chat, documenti aziendali, upload immagine, domanda |
| `DocumentUploader` | Elenco PDF aziendali con stato RAG, selezione per chat, cancellazione |
| `ImageUploader` | Drag&drop / selezione foto con anteprima |
| `AnswerCard` / `OcrCard` / `CandidatesCard` / `SourcesPanel` | Visualizzazione risultato: risposta, dati targhetta, candidati macchina, fonti citate |
| `MessageList` / `MessageBubble` | Cronologia chat (solo messaggi utente — la risposta assistente è mostrata via `AnswerCard`, non duplicata) |
| `InferenceProgress` | Indicatore di caricamento indeterminato (puramente cosmetico, il backend non riporta progresso reale) |

### 7.3 Stile

- Tailwind v4 "CSS-first" (nessun `tailwind.config.*`, configurazione in `app/globals.css`).
- **Dark mode automatica**, basata su `prefers-color-scheme` del sistema operativo — non c'è un selettore tema in UI, né una classe `dark` applicata via JS.
- Palette: **emerald** come colore primario/brand, **neutral** per superfici/testo, colori semantici solo per stato (rosso = errore/eliminazione, ambra = in attesa, azzurro = info).
- Nessuna libreria di componenti (niente shadcn/MUI): tutto Tailwind scritto a mano; icone da `@heroicons/react`.

### 7.4 Test

- Frontend: **Vitest** + Testing Library, 6 test in `app/page.test.tsx` (registrazione/login immediato, header di autorizzazione su `/api/ask`, logout, eliminazione chat attiva). Comando: `npm test`.
- Backend: **pytest**, 11 moduli in `backend/tests/` (autenticazione, rate limiting, isolamento multi-azienda, upload/cancellazione documenti, retrieval "grounded", migrazioni DB, ecc.), con fixture che isolano ogni test su un DB SQLite temporaneo e azzerano i rate limiter in-memory. Comando: `python3 -m pytest`.

---

## 8. Backend — schema dati e endpoint

### 8.1 Schema SQLite (`data/app.db`)

```
companies(id, domain UNIQUE, name, created_at)
users(id, email UNIQUE, password_hash, company_id → companies, token_version,
      failed_login_attempts, locked_until, terms_accepted_at, created_at)
chats(id, user_id → users [CASCADE], title, knowledge_mode CHECK('base'|'merged'),
      company_document_ids JSON, created_at, updated_at)
messages(id, chat_id → chats [CASCADE], role CHECK('user'|'assistant'), content, created_at)
documents(id, company_id → companies [CASCADE], filename, path,
          status CHECK('pending'|'indexed'|'failed'), created_at)
```

Le migrazioni (`init_db()`) aggiungono colonne mancanti su un DB preesistente senza perdita dati (es. `status` su `documents`, valorizzata `'indexed'` per le righe già esistenti, dato che erano già indicizzate prima che il campo esistesse).

### 8.2 Endpoint REST

| Metodo | Percorso | Auth | Note |
|---|---|---|---|
| POST | `/api/auth/register` | — | rate-limited |
| POST | `/api/auth/login` | — | rate-limited |
| POST | `/api/auth/logout` | ✓ | invalida tutti i token dell'utente |
| GET | `/api/auth/me` | ✓ | |
| GET | `/api/chats` | ✓ | |
| POST | `/api/chats` | ✓ | |
| PATCH | `/api/chats/{id}` | ✓ | solo `title` |
| DELETE | `/api/chats/{id}` | ✓ | |
| GET | `/api/chats/{id}/messages` | ✓ | |
| GET | `/api/company/documents` | ✓ | |
| POST | `/api/company/documents` | ✓ | indicizzazione sincrona |
| DELETE | `/api/company/documents/{id}` | ✓ | |
| POST | `/api/ask` | ✓ | rate-limited, multipart |

---

## 9. Configurazione (variabili d'ambiente)

Caricate da `.env` alla radice del repo (non versionato). Nessun file `.env.example` presente nel repo.

**Autenticazione / sessione**
| Variabile | Default |
|---|---|
| `DATABASE_PATH` | `data/app.db` |
| `APP_ENV` | `development` |
| `AUTH_SECRET` | *(obbligatoria in produzione)* |
| `AUTH_TOKEN_TTL_SECONDS` | `86400` (24h) |
| `AUTH_MAX_FAILED_ATTEMPTS` | `5` |
| `AUTH_LOCKOUT_SECONDS` | `900` (15min) |

**Rete / rate limiting**
| Variabile | Default |
|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` |
| `MAX_UPLOAD_MB` | `30` |
| `RATE_LIMIT_LOGIN_MAX` / `_WINDOW_SECONDS` | `10` / `60` |
| `RATE_LIMIT_REGISTER_MAX` / `_WINDOW_SECONDS` | `5` / `60` |
| `RATE_LIMIT_ASK_MAX` / `_WINDOW_SECONDS` | `20` / `60` |
| `BACKEND_URL` (frontend) | `http://127.0.0.1:8000` |

**Percorsi/dati ML**
| Variabile | Default |
|---|---|
| `PDF_DIR` | `CLI/pdf_immagini` |
| `REFERENCE_IMAGES_DIR` | `CLI/reference_images` |
| `MACHINE_KB_PATH` | `CLI/machine.json` |
| `INDEX_DIR` | `CLI/index_no_finetuned` |
| `MEM_DIR` | `CLI/memory_no_finetuned` |
| `COMPANY_DATA_DIR` | `data/companies` |

**Modelli / LLM**
| Variabile | Default |
|---|---|
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` |
| `SIGLIP_MODEL` | `google/siglip-base-patch16-224` |
| `OPENAI_BASE_URL` | `http://localhost:11434/v1` (Ollama locale) |
| `LLM_MODEL` | `llama3.2` |
| `OPENAI_API_KEY` | `ollama` (placeholder) |
| `OCR_BACKEND` | `got` (alternativa: qualsiasi altro valore → vision-LLM) |
| `GOT_OCR_MODEL` | `stepfun-ai/GOT-OCR-2.0-hf` |
| `OCR_DEVICE` | `cpu` |
| `IMAGE_RECOGNITION_THRESHOLD` | `0.730` |
| `TOP_K` / `CONTEXT_MAX_CHARS` / `CHUNK_SIZE` / `CHUNK_OVERLAP` / `MIN_CHUNK_CHARS` | `12` / `16000` / `1200` / `220` / `50` |
| `FORCE_REBUILD_INDEX` | `0` |

---

## 10. Problemi noti / debiti tecnici

Da tenere presenti perché non sempre evidenti leggendo solo l'interfaccia:

1. **Verifica email e recupero password non funzionanti**: il frontend (`AuthPanel`, `useAuth`, `app/lib/api.ts`) contiene ancora l'intera UI e le chiamate per "verifica email" e "password dimenticata", ma i corrispondenti endpoint (`/api/auth/verify-email`, `/resend-verification`, `/forgot-password`, `/reset-password`) **non esistono più nel backend** (rimossi insieme a `backend/email_service.py`). Chi clicca "Password dimenticata?" oggi riceve un errore generico dal proxy, non un vero flusso di reset. Il file `.env` contiene ancora `REQUIRE_EMAIL_VERIFICATION=false`, variabile non più letta da nessuna parte del backend.
2. **Memoria conversazionale scritta ma non riletta**: short-term e long-term memory vengono salvate ad ogni turno, ma la generazione della risposta non le usa — l'assistente non ha "memoria" nel senso in cui l'utente probabilmente se lo aspetta, nonostante l'infrastruttura esista.
3. **Nessuna indicizzazione incrementale**: ogni upload/cancellazione di PDF aziendale ricostruisce l'intero indice FAISS dell'azienda da zero. Accettabile a bassi volumi, da rivedere se il numero di PDF per azienda cresce molto.
4. **Rate limiter e cache RAG in memoria di processo**: non condivisi tra più worker/istanze — un deploy multi-processo richiederebbe uno store condiviso (es. Redis) per rate limiting e coerenza della cache.
5. **Le foto non sono in nessuna "memoria" persistente** (vedi §5.5) — sono solo query momentanee, a differenza dei PDF.
6. **Pagine Privacy/Termini segnaposto**: `app/privacy/page.tsx` e `app/terms/page.tsx` sono esplicitamente etichettate come testo segnaposto, non conformi GDPR di per sé.
7. **README.md da allineare**: descrive ancora pagine `verify-email/`/`reset-password/` come esistenti — non sono più nel codice sorgente (restano solo tracce stantie nei tipi generati da Next.js in `.next/`, che spariscono al prossimo build pulito).

---

## 11. Come eseguire il progetto in locale

```bash
# Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
npm run backend      # uvicorn su :8000

# Frontend (altro terminale)
npm install
npm run dev           # Next.js su :3000
```

Test:

```bash
python3 -m pip install -r requirements-dev.txt && python3 -m pytest   # backend
npm test                                                                # frontend
```

Il database SQLite e gli indici FAISS vengono creati automaticamente al primo avvio (`data/app.db`, `data/companies/`, `CLI/index_no_finetuned/`).
