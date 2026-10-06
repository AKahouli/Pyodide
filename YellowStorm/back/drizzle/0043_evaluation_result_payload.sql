SET LOCAL lock_timeout = '5s';

ALTER TABLE evaluation.evaluation_result
  ADD COLUMN IF NOT EXISTS payload jsonb;
