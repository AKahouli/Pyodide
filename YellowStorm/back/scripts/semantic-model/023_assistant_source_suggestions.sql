-- 023 - Sources an assistant suggests for a model's concepts. Nothing is connected until a
-- person picks a suggestion (or other files) in the designer; a person can also skip one.
-- One row per concept; the options hold the workspaces, folders and files as the assistant
-- proposed them, with names and file counts read when the suggestion was made.
CREATE TABLE IF NOT EXISTS semantic_model.assistant_source_suggestions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id         UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id       UUID        NOT NULL,
  concept_key      TEXT        NOT NULL,
  options          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  note             TEXT        NOT NULL DEFAULT '',
  status           TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'skipped')),
  created_by       TEXT        NOT NULL,
  agent_id         TEXT,
  conversation_id  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, concept_key)
);
