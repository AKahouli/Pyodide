CREATE TABLE IF NOT EXISTS semantic_model.mapping_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id      UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  status        TEXT        NOT NULL DEFAULT 'running'
                            CHECK (status IN ('running', 'completed', 'failed')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  result        JSONB,
  error         TEXT,
  search_summary JSONB
);

CREATE INDEX IF NOT EXISTS mapping_runs_model_id_idx
  ON semantic_model.mapping_runs (model_id, started_at DESC);
