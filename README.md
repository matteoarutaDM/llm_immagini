# Chatbot XR Supp CLI - Modello

## Preparazione ambiente

Prima di eseguire il notebook, creare un ambiente virtuale Python:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Installare poi le dipendenze richieste:

```bash
python3 -m pip install -r requirements.txt
```

## Preparazione dei PDF

Creare una directory chiamata `pdfs` nella root del progetto:

```bash
mkdir -p pdfs
```

Inserire dentro `pdfs` i file PDF che devono essere usati per creare il contesto del chatbot.

Esempio:

```text
pdfs/
  documento_1.pdf
  documento_2.pdf
  manuale.pdf
```
# llm_immagini
