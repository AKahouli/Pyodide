-- Search index progress while a generation is built: the step the build is at ('documents': reading
-- the records into search cards; 'embedding': computing vectors) and how many records have their
-- card written. The other counts (expected, indexed, exact-only, passages) are the existing columns,
-- now also written per batch during the build and settled when it finishes. NULL stage: not building.
ALTER TABLE semantic_graph_search.index_generations
  ADD COLUMN IF NOT EXISTS progress_stage TEXT
    CHECK (progress_stage IS NULL OR progress_stage IN ('documents', 'embedding')),
  ADD COLUMN IF NOT EXISTS loaded_count INT NOT NULL DEFAULT 0;
