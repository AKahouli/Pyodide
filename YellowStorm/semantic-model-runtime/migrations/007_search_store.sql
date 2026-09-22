-- P7: search-owned projections and authorized contexts (plan 7.1, P7.18).
-- Entity projections are derived from accepted revisions by population and
-- rebuilt per revision; contexts bind an actor to a model/revision/scope with
-- an expiry. The search coordinator (NestJS) consumes both; neither stores
-- raw evidence or document content.
CREATE SCHEMA IF NOT EXISTS semantic_search;

CREATE TABLE IF NOT EXISTS semantic_search.entity_projections (
  entity_id         TEXT        NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 300),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL,
  concept_id        TEXT        NOT NULL,
  display_label     TEXT        NOT NULL DEFAULT '',
  identity          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  search_keys       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (data_revision_id, entity_id)
);
CREATE INDEX IF NOT EXISTS semantic_search_projections_lookup_idx
  ON semantic_search.entity_projections (model_id, data_revision_id, concept_id);

CREATE TABLE IF NOT EXISTS semantic_search.contexts (
  id                TEXT        PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
  actor_user_id     TEXT        NOT NULL CHECK (char_length(actor_user_id) BETWEEN 1 AND 200),
  model_id          TEXT        NOT NULL,
  model_version_id  TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL,
  source_scope      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  required_sources  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  coverage          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS semantic_search_contexts_actor_idx
  ON semantic_search.contexts (actor_user_id, model_id, expires_at DESC);

REVOKE ALL ON ALL TABLES IN SCHEMA semantic_search FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA semantic_search
      TO semantic_app;
  END IF;
END $$;
