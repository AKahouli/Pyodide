-- Evaluation runs: LLM-generated narrative report (structured sections).
SET LOCAL lock_timeout = '5s';

ALTER TABLE "evaluation"."evaluation" ADD COLUMN IF NOT EXISTS "narrative" jsonb;
