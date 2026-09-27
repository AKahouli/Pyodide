-- What a mapped document yielded the last time it was read. A run over a large
-- workspace reuses the result of every document whose content, mapping, concept
-- and extractor are unchanged, so only new or edited files are read again.
CREATE TABLE IF NOT EXISTS semantic_population.document_extractions (
  cache_key   TEXT        PRIMARY KEY CHECK (cache_key ~ '^sha256:[0-9a-f]{64}$'),
  model_id    TEXT        NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  concept_id  TEXT        NOT NULL CHECK (char_length(concept_id) BETWEEN 1 AND 200),
  asset_id    TEXT        NOT NULL CHECK (char_length(asset_id) BETWEEN 1 AND 300),
  output      JSONB       NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS semantic_population_document_extractions_asset_idx
  ON semantic_population.document_extractions (model_id, concept_id, asset_id);

REVOKE ALL ON semantic_population.document_extractions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON semantic_population.document_extractions TO semantic_app;
  END IF;
END $$;
