SET LOCAL lock_timeout = '5s';

ALTER TABLE evaluation.evaluation
  ADD COLUMN IF NOT EXISTS prepared jsonb,
  ADD COLUMN IF NOT EXISTS progress jsonb;
