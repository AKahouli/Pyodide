-- Walks over the stored links (query_records on a linked record's field, traverse-records) read a
-- relationship from either end. Its unique key starts with (data_revision_id, relation_id,
-- source_entity_id), so it serves the walk from the source; this index serves the walk back from
-- the target, which is how a walk is checked from the records it reaches.
CREATE INDEX IF NOT EXISTS semantic_population_relationships_target_idx
  ON semantic_population.relationships (data_revision_id, relation_id, target_entity_id)
  WHERE state = 'accepted';
