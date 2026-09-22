-- Gate E: bounded datasource results and mapping health are worker-owned.
CREATE SCHEMA IF NOT EXISTS semantic_datasource;

CREATE TABLE IF NOT EXISTS semantic_datasource.discovery_profiles (
  id                  TEXT        PRIMARY KEY,
  workspace_id        TEXT        NOT NULL,
  asset_id             TEXT        NOT NULL,
  source_fingerprint   TEXT        NOT NULL,
  source_version       TEXT,
  parser_version       TEXT        NOT NULL,
  options_fingerprint  TEXT        NOT NULL,
  status               TEXT        NOT NULL,
  profile              JSONB       NOT NULL,
  preview              JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, asset_id, source_fingerprint, options_fingerprint)
);
CREATE INDEX IF NOT EXISTS discovery_profiles_latest_idx
  ON semantic_datasource.discovery_profiles (workspace_id, asset_id, completed_at DESC);

CREATE TABLE IF NOT EXISTS semantic_datasource.mapping_health (
  model_id             UUID        NOT NULL,
  mapping_id           UUID        NOT NULL,
  source_fingerprint   TEXT,
  mapping_version      TEXT        NOT NULL,
  state                 TEXT        NOT NULL
    CHECK (state IN ('healthy', 'changed', 'broken', 'unavailable', 'checking')),
  missing_fields       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  available_fields     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  warnings             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  checked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, mapping_id)
);

REVOKE ALL ON ALL TABLES IN SCHEMA semantic_datasource FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA semantic_datasource TO semantic_app;
  END IF;
END $$;
