# LLM YOLO Web

Web app Next.js con backend Python FastAPI basata su `CLI/modello_riconoscimento_finale.ipynb`.

## Cosa fa l'app

È un **assistente tecnico multimodale per macchinari industriali** (gru, carroponti, movimentatori container, ecc.). L'utente carica una **foto della macchina** insieme a una **domanda in linguaggio naturale** (es. "come si effettua la manutenzione ordinaria?") e l'app risponde combinando visione artificiale, OCR e RAG sui manuali tecnici.

Il flusso, per ogni richiesta (`POST /api/ask`), è:

1. **Riconoscimento della macchina nella foto** — non è un detector tipo YOLO né un classificatore fine-tunato: usa **SigLIP** (`google/siglip-base-patch16-224`) in modalità *zero-shot*, confrontando l'embedding dell'immagine caricata con un set di immagini di riferimento associate a ciascuna macchina nota (`CLI/machine.json`, `CLI/reference_images/`). Se il punteggio di similarità migliore è sotto una soglia (`IMAGE_RECOGNITION_THRESHOLD`, default 0.730) la macchina viene dichiarata "non riconosciuta" invece di essere indovinata a forza.
2. **Lettura della targhetta (OCR)** — dalla stessa foto (o da un ritaglio) viene estratto testo come modello/matricola, tramite **GOT-OCR-2.0** o, in alternativa, un LLM multimodale via endpoint OpenAI-compatible (`OCR_BACKEND=got|vision-llm`).
3. **Recupero dai manuali (RAG)** — la domanda, arricchita con macchina riconosciuta e identificatori letti, interroga un indice vettoriale (libreria `ragmens_core`: chunking dei PDF, embedding `sentence-transformers/all-MiniLM-L6-v2`, ricerca per similarità) costruito sui manuali PDF di quella macchina. Se la chat è di un utente aziendale in modalità `merged`, viene interrogato anche un secondo indice **separato per azienda**, costruito sui PDF caricati da quell'azienda, e i risultati vengono uniti.
4. **Generazione della risposta** — un LLM (client OpenAI-compatible, di default **Ollama locale** con `llama3.2`, ma configurabile verso qualunque endpoint compatibile) riceve un prompt che include macchina riconosciuta, confidenza, dati di targhetta, memoria di conversazione (breve e lunga, via `ragmens_core`) e i passaggi di manuale recuperati, con l'istruzione esplicita di non inventare procedure o codici non presenti nel contesto.

Attorno a questa pipeline c'è un livello applicativo completo: **autenticazione utenti** (registrazione con attivazione immediata, login, reset password via email), distinzione tra **utenti base** e **utenti aziendali** in base al dominio dell'email, **chat persistenti** con SQLite, e **upload di documenti PDF aziendali** isolati per azienda per arricchire la conoscenza RAG delle proprie chat.

## Struttura

- `CLI/`: notebook originali (pipeline di riferimento), knowledge base delle macchine (`machine.json`), immagini di reference per SigLIP, manuali PDF indicizzati, script OCR standalone e indici RAG di debug.
  - `modello_riconoscimento_finale.ipynb`: notebook principale, pipeline completa immagine → riconoscimento → OCR → RAG → LLM, portata in produzione in `backend/model_service.py`.
  - `modello_no_finetuned.ipynb`: variante di sviluppo della stessa pipeline zero-shot.
  - `rag_llm.ipynb`: notebook che isola solo la parte RAG + LLM (senza immagini), utile per testare l'indicizzazione dei PDF.
  - `got_ocr_runner.py`: script eseguito come subprocess dal backend per l'OCR con GOT-OCR-2.0.
- `backend/`: API Python FastAPI che riusa la logica del notebook.
  - `main.py`: app FastAPI, tutti gli endpoint REST (auth, chat, documenti, `/api/ask`), CORS, rate limiting.
  - `model_service.py`: `MachineAssistant`, il cuore ML (SigLIP, OCR, RAG generale + RAG per azienda, chiamata LLM). Caricato in modo lazy così l'API resta testabile anche senza lo stack ML installato.
  - `auth.py`, `database.py`: sessioni/token e modello dati SQLite (utenti, aziende, chat, messaggi, documenti, token di reset password).
  - `email_service.py`: invio email di reset password via SMTP (o log del link in sviluppo se SMTP non configurato).
  - `rate_limit.py`, `public_email_domains.py`: rate limiting in-memory e classificazione domini email pubblici vs aziendali.
  - `tests/`: suite pytest (auth, isolamento tra aziende, upload, RAG, rate limiting).
- `app/`: interfaccia Next.js (App Router) e proxy verso il backend.
  - `page.tsx`: UI applicativa unica (login/registrazione, sidebar chat, upload immagine e documenti, visualizzazione risposta e fonti RAG).
  - `reset-password/`, `privacy/`, `terms/`: pagine dedicate.
  - `api/backend/[...path]/route.ts`: proxy generico verso il backend FastAPI (`BACKEND_URL`, default `http://127.0.0.1:8000`).
  - `api/ask/route.ts`: proxy dedicato per `/api/ask` (upload multipart, timeout esteso per l'inferenza).

## Avvio

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
npm install
```

In due terminali:

```bash
npm run backend
npm run dev
```

Aprire `http://localhost:3000`.

## Utenti e conoscenza per chat

Il backend crea automaticamente `data/app.db` con SQLite. La registrazione classifica il dominio dopo `@` usando l'elenco in `backend/public_email_domains.py` (Gmail, Outlook, Hotmail, iCloud, Yahoo, libero.it, virgilio.it, proton.me, ecc.):

- domini pubblici/personali: utente base;
- altri domini (es. `@digitalmens.it`): utente aziendale, associato a quel dominio.

La registrazione attiva l'account **immediatamente**: non c'è verifica email, l'endpoint `POST /api/auth/register` restituisce subito un token valido (stesso shape del login) e, se il dominio è aziendale, associa l'utente alla company fin da subito.

Ogni chat salva la propria modalità di conoscenza:

- `base`: usa soltanto il RAG generale del progetto;
- `merged`: per utenti aziendali combina il RAG generale con i PDF dell'azienda selezionati per quella chat.

Gli utenti base non possono creare chat aziendali né caricare documenti. I documenti aziendali sono conservati sotto `data/companies/` e indicizzati separatamente per dominio.

### Configurazione per un ambiente reale

```bash
export APP_ENV="production"                 # in produzione l'avvio fallisce se AUTH_SECRET non è impostata
export AUTH_SECRET="una-stringa-lunga-e-casuale"
export DATABASE_PATH="/percorso/sicuro/app.db"
export ALLOWED_ORIGINS="https://tuo-dominio.example"
export SMTP_HOST="smtp.tuoprovider.example"  # per il reset password; altrimenti il link resta solo nei log
export SMTP_USER="..."
export SMTP_PASSWORD="..."
export MAX_UPLOAD_MB="30"                    # limite dimensione upload documenti aziendali
```

In sviluppo, se `AUTH_SECRET` non è impostata viene generato un secret casuale a ogni riavvio (tutte le sessioni precedenti diventano invalide); in produzione (`APP_ENV=production`) l'app non si avvia senza un secret esplicito.

### Test

```bash
python3 -m pip install -r requirements-dev.txt
python3 -m pytest          # test backend (auth, isolamento aziende, upload, RAG, rate limiting, ...)
npm test                   # test frontend (Vitest + Testing Library)
```
