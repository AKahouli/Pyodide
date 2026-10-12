-- When a search index build last made real progress (a wave of vectors stored, a page of records read,
-- a chunk of the cache reused). The generation lease is only renewed at those points, so this and
-- lease_until together tell a build that is slow from one whose worker is gone or stuck.
ALTER TABLE semantic_graph_search.index_generations
  ADD COLUMN IF NOT EXISTS progress_at TIMESTAMPTZ;
