CREATE TABLE IF NOT EXISTS semantic_model.graph_index_jobs (
  model_id UUID PRIMARY KEY REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','indexed','failed')),
  target_version_id UUID NOT NULL REFERENCES semantic_model.versions(id) ON DELETE CASCADE,
  target_revision INTEGER NOT NULL,
  indexed_version_id UUID REFERENCES semantic_model.versions(id) ON DELETE SET NULL,
  indexed_revision INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graph_index_jobs_ready_idx
  ON semantic_model.graph_index_jobs (next_attempt_at, updated_at)
  WHERE status IN ('pending','in_progress');
