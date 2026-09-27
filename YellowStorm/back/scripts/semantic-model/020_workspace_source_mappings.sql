-- 020 - A mapping can cover a whole workspace, or one of its folders.
-- The row's document_id holds a workspace key (workspace:<id>:<folder|all>);
-- the files it covers are resolved each time data is generated, so files
-- added later are included. source_label is the name shown for the source.
ALTER TABLE semantic_model.source_mappings
  ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'document',
  ADD COLUMN IF NOT EXISTS folder_id TEXT,
  ADD COLUMN IF NOT EXISTS source_label TEXT;
ALTER TABLE semantic_model.source_mappings
  DROP CONSTRAINT IF EXISTS source_mappings_scope_check;
ALTER TABLE semantic_model.source_mappings
  ADD CONSTRAINT source_mappings_scope_check
  CHECK (scope IN ('document', 'workspace') AND (scope = 'workspace' OR folder_id IS NULL));
