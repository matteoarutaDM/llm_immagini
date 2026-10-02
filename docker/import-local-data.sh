#!/usr/bin/env bash
# Porta nei container i dati che hai in locale:
#   1. il database "assistente" di Postgres.app  → servizio db
#   2. i PDF caricati dalle aziende (data/companies) → volume company-documents
#
# Va lanciato UNA volta, su un'installazione Docker nuova (database vuoto).
#   ./docker/import-local-data.sh
#
# Variabili opzionali: LOCAL_DATABASE_URL (default: Postgres.app su localhost:5432).

set -euo pipefail
cd "$(dirname "$0")/.."

LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres@localhost:5432/assistente}"
PG_BIN="${PG_BIN:-/Applications/Postgres.app/Contents/Versions/latest/bin}"
PG_DUMP="$PG_BIN/pg_dump"
[ -x "$PG_DUMP" ] || PG_DUMP="$(command -v pg_dump)"
LOCAL_COMPANY_DIR="$PWD/data/companies"
CONTAINER_COMPANY_DIR="/app/data/companies"

say() { printf '\n==> %s\n' "$1"; }

[ -f .env.docker ] || { echo "Manca .env.docker: copia .env.docker.example e compilalo."; exit 1; }

say "Avvio solo il database"
docker compose up -d --wait db

say "Controllo che il database nel container sia vuoto"
if docker compose exec -T db psql -U assistente -d assistente -XAtc "SELECT 1 FROM information_schema.schemata WHERE schema_name = 'app'" | grep -q 1; then
  echo "Il database nel container contiene già lo schema 'app': importazione annullata per non sovrascrivere dati."
  echo "Per ripartire da zero: docker compose down && docker volume rm assistente-macchine_pgdata"
  exit 1
fi

say "Copio il database locale ($LOCAL_DATABASE_URL) nel container"
"$PG_DUMP" --no-owner --no-privileges --format=plain "$LOCAL_DATABASE_URL" \
  | docker compose exec -T db psql -U assistente -d assistente -X -q -v ON_ERROR_STOP=1 > /dev/null

say "Aggiorno i percorsi dei PDF aziendali"
docker compose exec -T db psql -U assistente -d assistente -X -q -v ON_ERROR_STOP=1 -c \
  "UPDATE app.company_documents SET storage_path = replace(storage_path, '$LOCAL_COMPANY_DIR', '$CONTAINER_COMPANY_DIR') WHERE storage_path LIKE '$LOCAL_COMPANY_DIR/%';"

if [ -d "$LOCAL_COMPANY_DIR" ]; then
  say "Copio i PDF aziendali nel volume"
  docker compose build backend
  docker compose run --rm --no-deps --user root \
    -v "$LOCAL_COMPANY_DIR:/import:ro" backend \
    sh -c "cp -a /import/. $CONTAINER_COMPANY_DIR/ && chown -R app:app $CONTAINER_COMPANY_DIR"
fi

say "Controllo"
docker compose exec -T db psql -U assistente -d assistente -X -c \
  "SELECT (SELECT count(*) FROM app.users) AS utenti, (SELECT count(*) FROM app.chats) AS chat,
          (SELECT count(*) FROM app.company_documents) AS documenti, (SELECT count(*) FROM ops.operators) AS operatori;"

say "Fatto. Avvia tutto con: docker compose up -d --build"
