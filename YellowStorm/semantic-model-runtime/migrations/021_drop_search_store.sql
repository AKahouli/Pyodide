-- The chat search store is retired: the fused search endpoint that read it is
-- gone and runs no longer write entity projections.
DROP SCHEMA IF EXISTS semantic_search CASCADE;
