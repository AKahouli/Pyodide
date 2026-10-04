-- 029 - Graph search settings, as an admin set them for every model: how records are cut into
-- searchable text (index_settings: card and passage sizes; changing them builds new search indexes
-- on the next search) and how a search request is matched (search_settings). Both hold only the
-- values that were set: anything left out falls back to the built-in value.
ALTER TABLE semantic_model.extraction_settings
  ADD COLUMN IF NOT EXISTS index_settings JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(index_settings) = 'object');

ALTER TABLE semantic_model.extraction_settings
  ADD COLUMN IF NOT EXISTS search_settings JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(search_settings) = 'object');
