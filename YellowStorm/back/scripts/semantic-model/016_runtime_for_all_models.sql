-- 016 - Every model runs on the semantic runtime (UX phase 1).
-- Records made by the legacy pipeline stay on the draft and are sent to the
-- runtime as a manual source on the next build; chat reads a model only
-- once a version built by the runtime is published.
UPDATE semantic_model.models
  SET execution_owner = 'runtime', runtime_claimed_at = COALESCE(runtime_claimed_at, now()),
      runtime_claimed_by = COALESCE(runtime_claimed_by, 'migration:016'), updated_at = now()
  WHERE execution_owner = 'legacy';
ALTER TABLE semantic_model.models ALTER COLUMN execution_owner SET DEFAULT 'runtime';

-- One line: the migration runner splits statements on a semicolon at end of line.
DO $$ BEGIN IF to_regclass('semantic_model.graph_index_jobs') IS NOT NULL THEN UPDATE semantic_model.graph_index_jobs SET status = 'superseded', completed_at = now(), last_error = 'Moved to the semantic runtime', updated_at = now() WHERE status IN ('pending', 'in_progress', 'failed'); END IF; END $$;
