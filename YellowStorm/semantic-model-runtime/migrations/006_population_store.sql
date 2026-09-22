-- P6A: canonical population store (plan 7.1/7.2). Assertions persist
-- independently from accepted serving values; identities are namespaced and
-- composite; corrections and review items are first-class rows. The AGE
-- serving projection is derived from data_revisions, never written directly.
CREATE SCHEMA IF NOT EXISTS semantic_population;

CREATE TABLE IF NOT EXISTS semantic_population.data_revisions (
  id                   TEXT        PRIMARY KEY CHECK (char_length(id) BETWEEN 1 AND 200),
  model_id             TEXT        NOT NULL CHECK (char_length(model_id) BETWEEN 1 AND 200),
  model_version_id     TEXT        NOT NULL CHECK (char_length(model_version_id) BETWEEN 1 AND 200),
  spec_hash            TEXT        NOT NULL CHECK (spec_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_observations  JSONB       NOT NULL DEFAULT '[]'::jsonb,
  correction_sequence  BIGINT      NOT NULL DEFAULT 0 CHECK (correction_sequence >= 0),
  projection_ref       TEXT,
  coverage             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  validation_state     TEXT        NOT NULL DEFAULT 'pending'
    CHECK (validation_state IN ('pending', 'valid', 'invalid', 'superseded')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS semantic_population_revisions_model_idx
  ON semantic_population.data_revisions (model_id, created_at DESC);

CREATE TABLE IF NOT EXISTS semantic_population.entities (
  id                TEXT        NOT NULL CHECK (char_length(id) BETWEEN 1 AND 300),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  concept_id        TEXT        NOT NULL,
  namespace         TEXT        NOT NULL,
  identity_key      TEXT        NOT NULL,
  label             TEXT        NOT NULL DEFAULT '',
  attributes        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  provenance        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (data_revision_id, id)
);
CREATE INDEX IF NOT EXISTS semantic_population_entities_concept_idx
  ON semantic_population.entities (model_id, data_revision_id, concept_id);

CREATE TABLE IF NOT EXISTS semantic_population.entity_identities (
  entity_id         TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL,
  alias_namespace   TEXT        NOT NULL,
  alias_key         TEXT        NOT NULL,
  PRIMARY KEY (data_revision_id, alias_namespace, alias_key),
  FOREIGN KEY (data_revision_id, entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS semantic_population_aliases_entity_idx
  ON semantic_population.entity_identities (data_revision_id, entity_id);

CREATE TABLE IF NOT EXISTS semantic_population.assertions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  entity_id         TEXT        NOT NULL,
  attribute         TEXT        NOT NULL,
  value             TEXT,
  origin            TEXT        NOT NULL DEFAULT 'source'
    CHECK (origin IN ('source', 'human', 'system')),
  validation_state  TEXT        NOT NULL DEFAULT 'accepted'
    CHECK (validation_state IN ('accepted', 'contested', 'retracted')),
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  mapping_version   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_revision_id, entity_id, attribute),
  FOREIGN KEY (data_revision_id, entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS semantic_population.relationships (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  relation_id       TEXT        NOT NULL,
  source_entity_id  TEXT        NOT NULL,
  target_entity_id  TEXT        NOT NULL,
  matching_strategy TEXT,
  state             TEXT        NOT NULL DEFAULT 'accepted'
    CHECK (state IN ('accepted', 'suppressed', 'retracted')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (data_revision_id, relation_id, source_entity_id, target_entity_id),
  FOREIGN KEY (data_revision_id, source_entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE,
  FOREIGN KEY (data_revision_id, target_entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS semantic_population.review_items (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  model_version_id  TEXT        NOT NULL,
  data_revision_id  TEXT        REFERENCES semantic_population.data_revisions(id)
    ON DELETE SET NULL,
  kind              TEXT        NOT NULL,
  state             TEXT        NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'resolved', 'invalidated')),
  prompt            TEXT        NOT NULL DEFAULT '',
  candidates        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  resolution        JSONB,
  resolved_by       TEXT,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS semantic_population_reviews_model_idx
  ON semantic_population.review_items (model_id, state, created_at DESC);

CREATE TABLE IF NOT EXISTS semantic_population.corrections (
  sequence          BIGSERIAL   PRIMARY KEY,
  model_id          TEXT        NOT NULL,
  model_version_id  TEXT        NOT NULL,
  actor_user_id     TEXT        NOT NULL,
  reason            TEXT        NOT NULL DEFAULT '',
  target_identity   JSONB       NOT NULL,
  action            TEXT        NOT NULL
    CHECK (action IN ('create_entity', 'edit_entity', 'remove_entity',
                      'add_relationship', 'remove_relationship',
                      'set_override', 'reset_override', 'suppress', 'unsuppress')),
  payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  data_revision_id  TEXT        REFERENCES semantic_population.data_revisions(id)
    ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS semantic_population_corrections_model_idx
  ON semantic_population.corrections (model_id, sequence DESC);

REVOKE ALL ON ALL TABLES IN SCHEMA semantic_population FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semantic_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA semantic_population
      TO semantic_app;
  END IF;
END $$;
