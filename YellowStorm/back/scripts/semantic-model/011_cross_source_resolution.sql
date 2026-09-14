-- =============================================================================
-- 011 — Cross-source relation resolution and source priority
-- =============================================================================

CREATE TABLE IF NOT EXISTS semantic_model.relation_resolution_rules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id         UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  relation_id      UUID        NOT NULL,
  source_attribute TEXT        NOT NULL,
  target_attribute TEXT        NOT NULL,
  strategy         TEXT        NOT NULL CHECK (strategy IN ('exact', 'case_insensitive', 'normalized')),
  ambiguity_policy TEXT        NOT NULL DEFAULT 'review' CHECK (ambiguity_policy IN ('review', 'unresolved')),
  updated_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, relation_id)
);

CREATE INDEX IF NOT EXISTS semantic_relation_resolution_rules_model_idx
  ON semantic_model.relation_resolution_rules (model_id);

CREATE TABLE IF NOT EXISTS semantic_model.source_resolution_policies (
  model_id         UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id       UUID        NOT NULL,
  priorities       JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(priorities) = 'array'),
  default_strategy TEXT        NOT NULL DEFAULT 'primary_then_fallback'
    CHECK (default_strategy = 'primary_then_fallback'),
  updated_by       TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, concept_id)
);

CREATE TABLE IF NOT EXISTS semantic_model.review_items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL CHECK (kind IN ('ambiguous_relation', 'source_conflict', 'broken_mapping')),
  target_id   TEXT        NOT NULL,
  fingerprint TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  details     JSONB       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS semantic_review_items_open_idx
  ON semantic_model.review_items (model_id, updated_at DESC)
  WHERE status = 'open';
