-- Search that follows links (find_records from a record it names to the records asked for) and
-- search texts naming linked records read every link of some records, whatever the relationship.
-- The unique key and the target index both start with the relation, so they cannot serve that.
CREATE INDEX IF NOT EXISTS semantic_population_relationships_source_any_idx
  ON semantic_population.relationships (data_revision_id, source_entity_id)
  WHERE state = 'accepted';
CREATE INDEX IF NOT EXISTS semantic_population_relationships_target_any_idx
  ON semantic_population.relationships (data_revision_id, target_entity_id)
  WHERE state = 'accepted';

-- The vectors' space of a generation (embedding model and instructions, not the search text
-- format): a search may compare its request vector with a generation of another text format,
-- the one kept while the new one is built. NULL: built before this column, compared by words only.
ALTER TABLE semantic_graph_search.index_generations ADD COLUMN IF NOT EXISTS vector_fingerprint TEXT;

-- The last ready generation of a model, searched while another one is built.
CREATE INDEX IF NOT EXISTS semantic_graph_search_generations_ready_idx
  ON semantic_graph_search.index_generations (model_id, completed_at DESC)
  WHERE state = 'ready';
