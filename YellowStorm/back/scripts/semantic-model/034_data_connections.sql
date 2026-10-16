-- 034 - The data sources a model reads from, made by its editors and shown in its source explorer.
-- A mail archive points at a .zip of .eml files (or one .eml) in a workspace and is read as three
-- tables: messages, participants and attachments. Further kinds (SQL databases) add their settings
-- in `config`; credentials are never stored here.
CREATE TABLE IF NOT EXISTS semantic_model.data_connections (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL CHECK (kind IN ('mail_archive')),
  name         TEXT        NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  workspace_id TEXT        NOT NULL,
  document_id  TEXT        NOT NULL,
  config       JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  created_by   TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, kind, document_id)
);
