# LLM YOLO Web

Web app Next.js con backend Python FastAPI basata su `CLI/modello_riconoscimento_finale.ipynb`.

## Struttura

- `CLI/`: notebook, dati, immagini, manuali, indici e script originali.
- `backend/`: API Python che riusa la logica del notebook.
- `app/`: interfaccia Next.js e proxy verso il backend.

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

### Verifica email obbligatoria

La registrazione **non effettua più il login automatico**. Crea l'utente in stato "pending" e genera un token di conferma:

- se è configurato un provider SMTP (`SMTP_HOST` e variabili correlate), il link di conferma viene inviato via email;
- altrimenti, in sviluppo, il link (con il token) viene stampato nei log del backend, con una riga tipo:
  `SMTP non configurato: link di verifica per <email> ... token=<TOKEN>`.

Per attivare l'account bisogna chiamare `POST /api/auth/verify-email` con quel token (dall'interfaccia c'è una schermata dedicata "Verifica la tua email" dove incollarlo). Il login resta bloccato (403) finché l'account non è verificato. Solo alla verifica l'utente aziendale viene associato alla company del proprio dominio.

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
export SMTP_HOST="smtp.tuoprovider.example"  # altrimenti il link di verifica resta solo nei log
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
