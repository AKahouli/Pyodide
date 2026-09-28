ALTER TABLE semantic_model.models
  ADD COLUMN IF NOT EXISTS execution_owner TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS runtime_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS runtime_claimed_by TEXT;

ALTER TABLE semantic_model.models
  DROP CONSTRAINT IF EXISTS semantic_models_execution_owner_check;
ALTER TABLE semantic_model.models
  ADD CONSTRAINT semantic_models_execution_owner_check
  CHECK (execution_owner IN ('legacy', 'runtime'));

ALTER TABLE IF EXISTS semantic_model.graph_index_jobs
  DROP CONSTRAINT IF EXISTS graph_index_jobs_status_check;
ALTER TABLE IF EXISTS semantic_model.graph_index_jobs
  ADD CONSTRAINT graph_index_jobs_status_check
  CHECK (status IN ('pending', 'in_progress', 'indexed', 'failed', 'superseded'));

CREATE INDEX IF NOT EXISTS semantic_models_execution_owner_idx
  ON semantic_model.models (execution_owner, updated_at DESC);
