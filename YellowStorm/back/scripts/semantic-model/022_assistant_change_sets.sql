-- 022 - Changes an assistant made to a model, so people can see and undo them.
-- One row per assistant request: the graph operations that made it and those that
-- undo it, the key fields before and after, and the sources it added or removed.
CREATE TABLE IF NOT EXISTS semantic_model.assistant_change_sets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id         UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  version_id       UUID        NOT NULL,
  actor_user_id    TEXT        NOT NULL,
  agent_id         TEXT,
  conversation_id  TEXT,
  summary          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  graph_forward    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  graph_undo       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  identity_before  JSONB       NOT NULL DEFAULT '{}'::jsonb,
  identity_after   JSONB       NOT NULL DEFAULT '{}'::jsonb,
  sources_added    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  sources_removed  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  undone_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS assistant_change_sets_model_idx
  ON semantic_model.assistant_change_sets (model_id, created_at DESC);
