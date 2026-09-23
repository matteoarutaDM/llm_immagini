# Avviare l'app con Docker

L'app gira in tre container gestiti da `docker compose`:

| Servizio | Cosa fa | Porta |
|---|---|---|
| `db` | PostgreSQL 18 con i dati del sito e del backoffice | `127.0.0.1:5433` (solo per pgAdmin) |
| `backend` | FastAPI: riconoscimento immagini, OCR, ricerca nei manuali | nessuna, solo interna |
| `web` | Next.js: sito (`/`) e backoffice (`/admin`) | `3000` |

Il modello linguistico **resta su Ollama, installato sul Mac**. Dentro Docker su Mac non userebbe la GPU e sarebbe molto più lento. Il backend lo raggiunge all'indirizzo `host.docker.internal:11434`.

## 1. Cosa installare

- **Docker Desktop**: <https://www.docker.com/products/docker-desktop/>. Dalle impostazioni assegna almeno **8 GB di memoria** (Settings → Resources), perché i modelli di visione e OCR occupano molta RAM.
- **Ollama** con il modello scelto in `LLM_MODEL`, già scaricato: `ollama pull llama3.2`.
- I **manuali di base** in `CLI/pdf_immagini/`. Non sono nel repository: vengono letti dal Mac e montati nel container in sola lettura.

## 2. Configurare

```bash
cp .env.docker.example .env.docker
```

Apri `.env.docker` e compila:

- `POSTGRES_PASSWORD`, e la stessa password dentro `DATABASE_URL`;
- `AUTH_SECRET` e `BACKOFFICE_API_TOKEN`: due segreti diversi, generati con
  `python3 -c "import secrets; print(secrets.token_urlsafe(32))"`;
- `SMTP_*`: in produzione servono per la 2FA, il reset della password e il codice di accesso degli admin.

`.env.docker` è escluso da git e non viene copiato nelle immagini.

## 3. Primo avvio

### A. Portare i dati che hai già (consigliato)

Copia nel container il database `assistente` di Postgres.app e i PDF delle aziende:

```bash
./docker/import-local-data.sh
docker compose up -d --build
```

Lo script si ferma se il database del container contiene già dei dati, così non sovrascrive niente.

### B. Installazione nuova, senza dati

```bash
docker compose up -d --build
```

Il backend crea le tabelle da solo al primo avvio. In produzione non crea operatori: aggiungili così, usando un'email vera per l'admin, dove arriverà il codice di accesso:

```bash
docker compose exec db psql -U assistente -d assistente -c "
  INSERT INTO ops.operators (email, name, role, password_hash, requires_otp) VALUES
  ('tu@azienda.it',      'Admin',    'admin',   crypt('password-lunga-admin',   gen_salt('bf', 12)), true),
  ('support@azienda.it', 'Supporto', 'support', crypt('password-lunga-support', gen_salt('bf', 12)), false);"
```

### Cosa aspettarsi la prima volta

- **La build** richiede diversi minuti: scarica PyTorch (versione solo CPU) e le altre librerie.
- **La prima domanda** è lenta. Il backend scarica i modelli di Hugging Face (circa 2 GB, salvati nel volume `hf-models`) e ricostruisce una volta l'indice dei manuali. Dalla seconda in poi è normale.

Apri <http://localhost:3000> per il sito e <http://localhost:3000/admin> per il backoffice.

## 4. Comandi di tutti i giorni

```bash
docker compose ps                  # stato dei servizi
docker compose logs -f backend     # log del backend (anche web, db)
docker compose restart backend     # riavvio di un servizio
docker compose down                # ferma tutto (i dati restano nei volumi)
git pull && docker compose up -d --build   # aggiornare dopo una modifica al codice
```

## 5. Dove sono i dati

Nei volumi Docker, che sopravvivono a `docker compose down`:

| Volume | Contenuto |
|---|---|
| `pgdata` | database |
| `company-documents` | PDF caricati dalle aziende |
| `rag-index`, `rag-memory` | indice e memoria della ricerca nei manuali (si possono ricostruire) |
| `hf-models` | modelli scaricati (si possono riscaricare) |

**Backup del database:**

```bash
docker compose exec -T db pg_dump -U assistente assistente > backup-$(date +%F).sql
```

**pgAdmin:** registra un server con Host `localhost`, Port `5433`, Username `assistente` e la password di `.env.docker`.

`docker compose down -v` cancella anche i volumi, quindi **tutti i dati**. Usalo solo se vuoi ripartire da zero.

## 6. Mettere online (non solo sul tuo Mac)

- **HTTPS obbligatorio.** In produzione i cookie di sessione del backoffice sono `Secure`: da un indirizzo `http://` diverso da `localhost` il login al backoffice non funziona. Metti davanti un reverse proxy con certificato (Caddy, Traefik, Nginx) e aggiorna `FRONTEND_URL` e `ALLOWED_ORIGINS`.
- **Ollama o un altro modello.** Sul server, imposta `OPENAI_BASE_URL` verso un servizio raggiungibile. Senza GPU le risposte sono lente.
- **Porta del database.** Se il database non serve da fuori, togli `ports` dal servizio `db`.

## 7. Problemi comuni

| Sintomo | Causa probabile |
|---|---|
| Le risposte falliscono con errori di connessione al modello | Ollama non è avviato sul Mac, oppure il modello di `LLM_MODEL` non è stato scaricato. |
| Il backend si riavvia di continuo | Guarda `docker compose logs backend`. Spesso manca un valore obbligatorio (`AUTH_SECRET`) oppure c'è `DEBUG_EMAIL_TOKENS=true` con `APP_ENV=production`. |
| "Manuali mancanti" nei log | `CLI/pdf_immagini/` è vuota o non contiene i PDF elencati in `CLI/machine.json`. |
| Il container del backend viene chiuso per memoria | Aumenta la memoria di Docker Desktop (almeno 8 GB). |
| Il codice OTP dell'admin non arriva | `SMTP_*` non è configurato, oppure l'email dell'operatore admin non è una casella reale. |
