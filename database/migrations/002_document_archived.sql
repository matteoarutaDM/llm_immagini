-- Documento aziendale tolto dal RAG ma conservato: il capo azienda può reindicizzarlo.
-- Da solo in questo file: un valore di ENUM appena aggiunto non si può usare
-- nella stessa transazione. Idempotente: il backend lo riapplica a ogni avvio.
ALTER TYPE app.document_status ADD VALUE IF NOT EXISTS 'archived';
