-- User-approved disposable search data upgrade; semantic_population and serving bindings survive.
-- Pause runtime API/workers and other writers. migrate.py commits SQL + checksum atomically;
-- failure rolls back data, generation states, column types and indexes together.
LOCK TABLE semantic_graph_search.index_generations,
  semantic_graph_search.entity_passages, semantic_graph_search.entity_documents,
  semantic_graph_search.embedding_cache IN ACCESS EXCLUSIVE MODE;

-- No CASCADE: only these rebuildable search rows may be cleared, including all their partitions.
TRUNCATE semantic_graph_search.entity_passages, semantic_graph_search.entity_documents,
  semantic_graph_search.embedding_cache;
-- READY is the search-serving selector (there is no separate search current-pointer table).
-- Preserve population active_bindings: they serve generated records, not embedding generations.
UPDATE semantic_graph_search.index_generations
SET state = 'failed', owner = NULL, lease_until = NULL,
    last_error_code = 'embedding_storage_changed', completed_at = now(),
    loaded_count = 0, indexed_count = 0, exact_only_count = 0, failed_count = 0,
    passage_count = 0, passage_indexed_count = 0, passage_truncated_count = 0,
    reused_count = 0, embedding_calls = 0, carried_count = 0, rebuilt_count = 0, embedded_count = 0,
    progress_stage = NULL;

DO $$
DECLARE
  idx record;
  definitions text[] := '{}';
  roots text[] := '{}';
  attachments text[] := '{}';
  definition text;
BEGIN
  -- Capture the COMPLETE index tree before dropping anything. pg_get_indexdef returns ON ONLY
  -- for partitioned indexes: replaying only a root would leave it invalid, without its children.
  FOR idx IN
    WITH tables AS (
      SELECT relid, level FROM pg_partition_tree('semantic_graph_search.entity_documents')
      UNION ALL SELECT relid, level FROM pg_partition_tree('semantic_graph_search.entity_passages')
      UNION ALL SELECT 'semantic_graph_search.embedding_cache'::regclass, 0
    )
    SELECT i.indexrelid::regclass AS name, pg_get_indexdef(i.indexrelid) AS definition,
           parent.inhparent::regclass AS parent_name
    FROM pg_index i
    JOIN tables t ON t.relid = i.indrelid
    JOIN pg_class x ON x.oid = i.indexrelid
    JOIN pg_am am ON am.oid = x.relam
    LEFT JOIN pg_inherits parent ON parent.inhrelid = i.indexrelid
    WHERE am.amname IN ('hnsw', 'ivfflat')
      AND pg_get_indexdef(i.indexrelid) ~ '\membedding\M'
    ORDER BY t.level, i.indexrelid
  LOOP
    definitions := array_append(definitions, replace(idx.definition, 'halfvec(2560)', 'halfvec(3072)'));
    IF idx.parent_name IS NULL THEN
      roots := array_append(roots, idx.name::text);
    ELSE
      -- Attach deepest children first, then their now-valid parents.
      attachments := array_prepend(format('ALTER INDEX %s ATTACH PARTITION %s',
                                         idx.parent_name, idx.name), attachments);
    END IF;
  END LOOP;
  FOREACH definition IN ARRAY roots LOOP
    EXECUTE format('DROP INDEX %s', definition);
  END LOOP;

  -- ALTER recurses to every attached partition, including empty ones. NULL is deliberate:
  -- old-space vectors must never be truncated/padded/reinterpreted as new-space vectors.
  ALTER TABLE semantic_graph_search.entity_documents
    ALTER COLUMN embedding TYPE halfvec(3072) USING NULL::halfvec(3072);
  ALTER TABLE semantic_graph_search.entity_passages
    ALTER COLUMN embedding TYPE halfvec(3072) USING NULL::halfvec(3072);
  ALTER TABLE semantic_graph_search.embedding_cache
    ALTER COLUMN embedding TYPE halfvec(3072) USING NULL::halfvec(3072);

  FOREACH definition IN ARRAY definitions LOOP
    EXECUTE definition;
  END LOOP;
  FOREACH definition IN ARRAY attachments LOOP
    EXECUTE definition;
  END LOOP;
END $$;
