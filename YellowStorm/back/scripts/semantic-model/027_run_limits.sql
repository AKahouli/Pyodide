-- 027 - How much one population run may read and keep, as an admin set it. Holds only the limits
-- that were set: anything left out falls back to the built-in value.
ALTER TABLE semantic_model.extraction_settings
  ADD COLUMN IF NOT EXISTS run_limits JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(run_limits) = 'object');
