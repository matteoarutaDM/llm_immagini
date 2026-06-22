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
