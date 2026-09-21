-- P4.6: semantic-owned observations of the existing logical index.
-- These record what the runtime observed, not a new native vectorstore revision.
CREATE SCHEMA IF NOT EXISTS semantic_datasource;

CREATE TABLE IF NOT EXISTS semantic_datasource.index_observations (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       TEXT        NOT NULL CHECK (char_length(workspace_id) BETWEEN 1 AND 200),
  asset_id           TEXT        NOT NULL CHECK (char_length(asset_id) BETWEEN 1 AND 200),
  asset_version_id   TEXT        NOT NULL CHECK (char_length(asset_version_id) BETWEEN 1 AND 300),
  document_pk        BIGINT,
  verification       TEXT        NOT NULL CHECK (verification IN ('verified', 'partial', 'unknown')),
  fingerprint        TEXT,
  readiness          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  observed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- NULL document_pk is a valid "unresolved observation"; COALESCE keeps the
-- upsert conflict target usable where a plain UNIQUE would treat NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS semantic_datasource_index_observations_uidx
  ON semantic_datasource.index_observations (asset_version_id, COALESCE(document_pk, -1));
CREATE INDEX IF NOT EXISTS semantic_datasource_index_observations_asset_idx
  ON semantic_datasource.index_observations (workspace_id, asset_id, observed_at DESC);

REVOKE ALL ON semantic_datasource.index_observations FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE ON semantic_datasource.index_observations TO semantic_app;
  END IF;
END $$;
