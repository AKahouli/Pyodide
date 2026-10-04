-- 032 - A spreadsheet (or e-mail archive) source can expand one column into several items (the
-- recipients a row lists, as text or a JSON array): each item is read as a row of its own, so one row
-- makes several records. Holds the column and how it is split; null when the source does not expand.
ALTER TABLE semantic_model.source_mappings
  ADD COLUMN IF NOT EXISTS expand JSONB CHECK (expand IS NULL OR jsonb_typeof(expand) = 'object');
