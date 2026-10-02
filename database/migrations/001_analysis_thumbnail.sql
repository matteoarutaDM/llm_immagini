-- Miniatura della foto di ogni analisi, mostrata nella cronologia della chat.
-- Idempotente: il backend la riapplica a ogni avvio.
ALTER TABLE app.analyses ADD COLUMN IF NOT EXISTS image_thumbnail bytea;
