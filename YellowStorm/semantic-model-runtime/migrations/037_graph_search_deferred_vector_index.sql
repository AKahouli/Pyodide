-- Vector indexes of a search index generation are built once per generation, in bulk, instead of being
-- maintained row by row while the generation is filled.
--
-- Until now the HNSW indexes were defined on the parents (migrations 026 and 031), so every partition
-- created for a generation got its own, and every row written (copied from the previous generation, taken
-- from the vector cache or embedded) paid a graph insert: milliseconds per row, so a refresh of a large
-- model cost as much as a full build even when almost every record was carried over unchanged.
--
-- Now a generation's partitions are created without a vector index. The build fills them, then creates
-- "<partition>_hnsw" on each (app/persistence/vector_indexes.py) before the generation is ready. Searches
-- are unchanged: the planner uses the partition's own index once the query is pruned to it.
--
-- Existing generations keep working: dropping a parent index drops the indexes of its partitions, so the
-- ready generations (the only ones searched) get theirs back here, under the new names, built in bulk. Any
-- other generation is indexed when its build ends. This can take a while on a large model; the memory used
-- is sized to the rows (up to 2 GB per index).

DROP INDEX IF EXISTS semantic_graph_search.entity_documents_embedding_hnsw;
DROP INDEX IF EXISTS semantic_graph_search.entity_passages_embedding_hnsw;

DO $$
DECLARE
  generation record;
  tbl text;
  partition text;
  rows_to_index bigint;
  workers int := 8;
BEGIN
  FOR generation IN
    SELECT index_id::text AS key FROM semantic_graph_search.index_generations
    WHERE state = 'ready' ORDER BY created_at
  LOOP
    FOREACH tbl IN ARRAY ARRAY['entity_documents', 'entity_passages'] LOOP
      -- Same name as partitions.partition_name(): the table, then 16 hex digits of the key's sha256.
      partition := tbl || '_' || left(encode(sha256(convert_to(generation.key, 'UTF8')), 'hex'), 16);
      CONTINUE WHEN to_regclass(format('semantic_graph_search.%I', partition)) IS NULL;
      EXECUTE format('SELECT count(*) FROM semantic_graph_search.%I WHERE embedding IS NOT NULL', partition)
        INTO rows_to_index;
      -- In memory while it is built (about 6.5 KB a row), as app/persistence/vector_indexes.py sizes it.
      PERFORM set_config('maintenance_work_mem',
                         greatest(128, least(2048, rows_to_index * 6500 * 5 / 4 / 1048576 + 1))::text || 'MB', true);
      BEGIN
        PERFORM set_config('max_parallel_maintenance_workers', workers::text, true);
        IF workers > 0 THEN
          -- The vectors are in TOAST: the heap is too small for the planner to ask for workers by itself.
          EXECUTE format('ALTER TABLE semantic_graph_search.%I SET (parallel_workers = %s)', partition, workers);
        END IF;
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON semantic_graph_search.%I '
                       'USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)',
                       partition || '_hnsw', partition);
        EXECUTE format('ALTER TABLE semantic_graph_search.%I RESET (parallel_workers)', partition);
      EXCEPTION WHEN insufficient_resources THEN
        -- A parallel build shares memory with the server: little /dev/shm (a container's 64 MB) is not enough.
        IF workers = 0 THEN
          RAISE;
        END IF;
        RAISE NOTICE 'parallel vector index build failed (%); building without workers', SQLERRM;
        workers := 0;
        PERFORM set_config('max_parallel_maintenance_workers', '0', true);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON semantic_graph_search.%I '
                       'USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)',
                       partition || '_hnsw', partition);
      END;
    END LOOP;
  END LOOP;
END $$;
