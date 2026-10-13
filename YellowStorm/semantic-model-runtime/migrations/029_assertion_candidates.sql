-- Values other sources gave a record's field than the one served. ``assertions`` keeps one row per
-- (revision, record, field): the served value. When several documents state the same field, the
-- others stay here with their own evidence, so a disagreement or a corroboration can be shown.
CREATE TABLE IF NOT EXISTS semantic_population.assertion_candidates (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          TEXT        NOT NULL,
  data_revision_id  TEXT        NOT NULL REFERENCES semantic_population.data_revisions(id)
    ON DELETE CASCADE,
  entity_id         TEXT        NOT NULL,
  attribute         TEXT        NOT NULL,
  value             TEXT,
  origin            TEXT        NOT NULL DEFAULT 'source'
    CHECK (origin IN ('source', 'human', 'system')),
  evidence          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  mapping_version   TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (data_revision_id, entity_id)
    REFERENCES semantic_population.entities(data_revision_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS semantic_population_assertion_candidates_entity_idx
  ON semantic_population.assertion_candidates (data_revision_id, entity_id, attribute);
