-- Durable, idempotent source-event inbox and per-asset revision history.
CREATE TABLE IF NOT EXISTS semantic_jobs.source_revisions (
  event_id       TEXT        PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 200),
  workspace_id   TEXT        NOT NULL CHECK (char_length(workspace_id) BETWEEN 1 AND 200),
  asset_id       TEXT        NOT NULL CHECK (char_length(asset_id) BETWEEN 1 AND 200),
  revision       BIGINT      NOT NULL CHECK (revision > 0),
  event_type     TEXT        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  payload        JSONB       NOT NULL,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, asset_id, revision)
);

CREATE INDEX IF NOT EXISTS semantic_jobs_source_revisions_asset_idx
  ON semantic_jobs.source_revisions (workspace_id, asset_id, revision DESC);

CREATE TABLE IF NOT EXISTS semantic_jobs.source_heads (
  workspace_id   TEXT        NOT NULL,
  asset_id       TEXT        NOT NULL,
  revision       BIGINT      NOT NULL CHECK (revision > 0),
  event_id       TEXT        NOT NULL REFERENCES semantic_jobs.source_revisions(event_id),
  event_type     TEXT        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL,
  payload        JSONB       NOT NULL,
  deleted        BOOLEAN     NOT NULL DEFAULT false,
  last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, asset_id)
);

ALTER TABLE semantic_jobs.source_heads
  ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now();

REVOKE ALL ON semantic_jobs.source_revisions, semantic_jobs.source_heads FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT ON semantic_jobs.source_heads TO semantic_app;
  END IF;
END $$;
