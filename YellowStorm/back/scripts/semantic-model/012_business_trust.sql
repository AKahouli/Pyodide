-- =============================================================================
-- 012 - Business trust: mapping validation and review decisions
-- =============================================================================

ALTER TABLE semantic_model.source_mappings
  ADD COLUMN IF NOT EXISTS validated_source_version TEXT,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ;

ALTER TABLE semantic_model.review_items
  ADD COLUMN IF NOT EXISTS resolution JSONB CHECK (resolution IS NULL OR jsonb_typeof(resolution) = 'object'),
  ADD COLUMN IF NOT EXISTS resolved_by TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
