-- P6: runtime-owned specification mirror and serving bindings (plan 7.1/7.2).
-- NestJS owns semantic_model definitions; this mirror holds the immutable
-- snapshots the runtime executes against. No cross-database foreign keys.
CREATE SCHEMA IF NOT EXISTS semantic_runtime;

CREATE TABLE IF NOT EXISTS semantic_runtime.specifications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  home_workspace_id  TEXT        NOT NULL CHECK (char_length(home_workspace_id) BETWEEN 1 AND 200),
  model_id           TEXT        NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  model_version_id   TEXT        NOT NULL CHECK (char_length(model_version_id) BETWEEN 1 AND 200),
  spec_hash          TEXT        NOT NULL CHECK (spec_hash ~ '^sha256:[0-9a-f]{64}$'),
  specification      JSONB       NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (home_workspace_id, model_id, model_version_id)
);

CREATE TABLE IF NOT EXISTS semantic_runtime.active_bindings (
  model_id             TEXT        NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  environment          TEXT        NOT NULL DEFAULT 'production'
    CHECK (environment IN ('production', 'shadow', 'test')),
  model_version_id     TEXT        NOT NULL,
  data_revision_id     TEXT        NOT NULL,
  projection_ref       TEXT        NOT NULL,
  correction_sequence  BIGINT      NOT NULL DEFAULT 0 CHECK (correction_sequence >= 0),
  version              BIGINT      NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, environment)
);

REVOKE ALL ON semantic_runtime.specifications, semantic_runtime.active_bindings FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE ON semantic_runtime.specifications TO semantic_app;
    GRANT SELECT, INSERT, UPDATE ON semantic_runtime.active_bindings TO semantic_app;
  END IF;
END $$;
