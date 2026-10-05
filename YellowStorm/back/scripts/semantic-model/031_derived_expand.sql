-- 031 - A derived source can expand one field of the source concept into several items (the
-- recipients a message lists, as text or a JSON array): each item is read as a record of its own.
-- Holds the field, how it is split, and optionally the relationship linking each source record to
-- the records its items made; null when the derived source does not expand a field.
ALTER TABLE semantic_model.derived_sources
  ADD COLUMN IF NOT EXISTS expand JSONB CHECK (expand IS NULL OR jsonb_typeof(expand) = 'object');
