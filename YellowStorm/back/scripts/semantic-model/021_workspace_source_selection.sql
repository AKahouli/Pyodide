-- 021 - A workspace mapping can cover picked folders and files instead of the whole workspace.
-- selection holds {"folderIds": [...], "documentIds": [...]}; NULL keeps the older meaning
-- (the whole workspace, or the single folder in folder_id).
ALTER TABLE semantic_model.source_mappings
  ADD COLUMN IF NOT EXISTS selection JSONB;
ALTER TABLE semantic_model.source_mappings
  DROP CONSTRAINT IF EXISTS source_mappings_selection_check;
ALTER TABLE semantic_model.source_mappings
  ADD CONSTRAINT source_mappings_selection_check
  CHECK (selection IS NULL OR (scope = 'workspace' AND jsonb_typeof(selection) = 'object'));
