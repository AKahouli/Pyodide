-- 030 - How much the AI reads for one derived source (a concept filled from another concept's
-- records), as a document mapping can override it. Holds only the limits that were set: anything
-- left out falls back to the admin default, then to the built-in one.
ALTER TABLE semantic_model.derived_sources
  ADD COLUMN IF NOT EXISTS ai_settings JSONB CHECK (ai_settings IS NULL OR jsonb_typeof(ai_settings) = 'object');
