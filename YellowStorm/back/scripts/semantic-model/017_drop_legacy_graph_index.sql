-- 017 - Drop the legacy pipeline tables.
-- Every model runs on the semantic runtime (016): the legacy LLM build
-- (mapping_runs, build_runs) and the sem_<modelId> AGE graph indexing queue
-- (graph_index_jobs) have no readers or writers left. Records and record
-- relations stay: they are the manual source sent to the runtime.
-- models.execution_owner is kept (always 'runtime', no longer read).
DROP TABLE IF EXISTS semantic_model.graph_index_jobs;
DROP TABLE IF EXISTS semantic_model.build_runs;
DROP TABLE IF EXISTS semantic_model.mapping_runs;
