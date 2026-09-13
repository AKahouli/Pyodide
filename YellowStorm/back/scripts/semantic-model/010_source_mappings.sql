-- =============================================================================
-- 010 — Source mappings & identity rules (structured source modeling)
-- =============================================================================
-- Structured data mappings (Excel/CSV sheets) onto concepts, plus the concept
-- identity rules used to recognize the same business entity across rows.
-- Mappings are draft-scoped: concept ids refer to the current draft version.
-- Version snapshotting of mappings ships with publish (see plan F12).
-- =============================================================================

CREATE TABLE IF NOT EXISTS semantic_model.source_mappings (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id     UUID        NOT NULL,
  workspace_id   TEXT        NOT NULL,
  document_id    TEXT        NOT NULL,
  sheet_name     TEXT        NOT NULL DEFAULT '',
  asset_kind     TEXT        NOT NULL DEFAULT 'excel_sheet' CHECK (asset_kind IN ('excel_sheet', 'csv', 'document')),
  field_mappings JSONB       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(field_mappings) = 'array'),
  status         TEXT        NOT NULL DEFAULT 'ready' CHECK (status IN ('draft', 'ready', 'needs_review', 'source_unavailable', 'broken')),
  created_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, concept_id, document_id, sheet_name)
);

ALTER TABLE semantic_model.source_mappings
  DROP CONSTRAINT IF EXISTS source_mappings_asset_kind_check;
ALTER TABLE semantic_model.source_mappings
  ADD CONSTRAINT source_mappings_asset_kind_check
  CHECK (asset_kind IN ('excel_sheet', 'csv', 'document'));

CREATE INDEX IF NOT EXISTS semantic_source_mappings_model_idx
  ON semantic_model.source_mappings (model_id);
CREATE INDEX IF NOT EXISTS semantic_source_mappings_workspace_idx
  ON semantic_model.source_mappings (workspace_id);

CREATE TABLE IF NOT EXISTS semantic_model.identity_rules (
  model_id    UUID        NOT NULL REFERENCES semantic_model.models(id) ON DELETE CASCADE,
  concept_id  UUID        NOT NULL,
  fields      JSONB       NOT NULL CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) > 0),
  updated_by  TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (model_id, concept_id)
);
