-- 026 - Named, reusable settings for reading a concept from documents: each field's rules and
-- reading mode, the AI limits and the identity fields. Applying a preset copies it into a mapping;
-- changing the preset later does not change mappings already saved.
CREATE TABLE IF NOT EXISTS semantic_model.mapping_presets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id      UUID        NOT NULL,
  name            TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  description     TEXT        CHECK (description IS NULL OR char_length(description) <= 500),
  field_mappings  JSONB       NOT NULL CHECK (jsonb_typeof(field_mappings) = 'array'),
  ai_settings     JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(ai_settings) = 'object'),
  identity_fields JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(identity_fields) = 'array'),
  created_by      TEXT        NOT NULL,
  updated_by      TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_mapping_presets_name_idx
  ON semantic_model.mapping_presets (model_id, concept_id, lower(btrim(name)));
