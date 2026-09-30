-- 024 - How much of a document the AI reads. An admin sets the defaults once; a document
-- mapping can override any of them. Both hold only the limits that were set: anything left
-- out falls back to the admin default, then to the built-in one.
CREATE TABLE IF NOT EXISTS semantic_model.extraction_settings (
  singleton    BOOLEAN     PRIMARY KEY DEFAULT true CHECK (singleton),
  ai_settings  JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ai_settings) = 'object'),
  updated_by   TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE semantic_model.source_mappings
  ADD COLUMN IF NOT EXISTS ai_settings JSONB CHECK (ai_settings IS NULL OR jsonb_typeof(ai_settings) = 'object');
