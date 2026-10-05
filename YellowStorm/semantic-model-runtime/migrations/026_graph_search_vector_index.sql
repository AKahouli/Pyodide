-- Approximate nearest-neighbour indexes for search, so a meaning search stays fast on large
-- models (a 25,000-e-mail mailbox gives hundreds of thousands of cards and passages).
--
-- halfvec indexes accept up to 4,000 dimensions, so the 2,560-dimension embeddings fit. Searches
-- filter by index generation, concept and workspace: they use pgvector's iterative scans (0.8+)
-- so a filter that discards many neighbours still returns enough of them.

DO $$
DECLARE
  installed text := (SELECT extversion FROM pg_extension WHERE extname = 'vector');
BEGIN
  IF string_to_array(installed, '.')::int[] < ARRAY[0, 8, 0] THEN
    RAISE EXCEPTION 'graph search vector indexes need pgvector 0.8 or later (installed: %)', installed;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS entity_documents_embedding_hnsw
  ON semantic_graph_search.entity_documents
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS entity_passages_embedding_hnsw
  ON semantic_graph_search.entity_passages
  USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
