-- 025 - A concept filled from another concept's records: one record per distinct key value the
-- source records carry (a contract's customer id and name become an organization). When records
-- sharing a key disagree on a field, the conflict rule picks the value kept; the most recent rule
-- orders them by a field of the source concept.
CREATE TABLE IF NOT EXISTS semantic_model.derived_sources (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id           UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id         UUID        NOT NULL,
  source_concept_id  UUID        NOT NULL,
  field_mappings     JSONB       NOT NULL CHECK (jsonb_typeof(field_mappings) = 'array'),
  conflict_rule      TEXT        NOT NULL DEFAULT 'most_frequent'
                     CHECK (conflict_rule IN ('most_frequent', 'latest', 'longest', 'leave_empty')),
  order_by           TEXT,
  created_by         TEXT        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (concept_id <> source_concept_id),
  CHECK ((conflict_rule = 'latest') = (order_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS semantic_derived_sources_model_idx
  ON semantic_model.derived_sources (model_id);
