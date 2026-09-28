-- Manual sources: records people typed in (or migrated from the legacy
-- pipeline) are an immutable snapshot the population task reads like any
-- other source. The snapshot id is a content hash chosen by the caller, so an
-- unchanged record set reuses the same snapshot and the same revision.
CREATE TABLE IF NOT EXISTS semantic_population.manual_snapshots (
  id            TEXT        PRIMARY KEY CHECK (id ~ '^[a-z0-9_-]{8,128}$'),
  model_id      TEXT        NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  row_count     INTEGER,
  link_count    INTEGER,
  committed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS semantic_population_manual_snapshots_model_idx
  ON semantic_population.manual_snapshots (model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS semantic_population.manual_rows (
  snapshot_id  TEXT  NOT NULL REFERENCES semantic_population.manual_snapshots(id) ON DELETE CASCADE,
  concept_id   TEXT  NOT NULL,
  row_key      TEXT  NOT NULL CHECK (char_length(row_key) BETWEEN 1 AND 200),
  label        TEXT  NOT NULL DEFAULT '',
  "values"     JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (snapshot_id, row_key)
);
CREATE INDEX IF NOT EXISTS semantic_population_manual_rows_concept_idx
  ON semantic_population.manual_rows (snapshot_id, concept_id);

CREATE TABLE IF NOT EXISTS semantic_population.manual_links (
  snapshot_id     TEXT NOT NULL REFERENCES semantic_population.manual_snapshots(id) ON DELETE CASCADE,
  relation_id     TEXT NOT NULL,
  source_row_key  TEXT NOT NULL,
  target_row_key  TEXT NOT NULL,
  PRIMARY KEY (snapshot_id, relation_id, source_row_key, target_row_key)
);

REVOKE ALL ON semantic_population.manual_snapshots, semantic_population.manual_rows,
  semantic_population.manual_links FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON semantic_population.manual_snapshots,
      semantic_population.manual_rows, semantic_population.manual_links TO semantic_app;
  END IF;
END $$;
