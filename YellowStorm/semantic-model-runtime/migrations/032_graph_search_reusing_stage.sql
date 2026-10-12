-- The search index build reports a "reusing" stage while it copies cached vectors.
ALTER TABLE semantic_graph_search.index_generations
  DROP CONSTRAINT IF EXISTS index_generations_progress_stage_check;
ALTER TABLE semantic_graph_search.index_generations
  ADD CONSTRAINT index_generations_progress_stage_check
    CHECK (progress_stage IS NULL OR progress_stage IN ('documents', 'reusing', 'embedding'));
