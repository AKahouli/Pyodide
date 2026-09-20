# semantic_model data migration — yellowstorm_semantic → agentstore

**Date:** 20 September 2026 (UTC)
**Tool:** `YellowStorm/semantic-model-runtime/scripts/migrate-definitions-data.py` (dry-run default)
**Result:** MIGRATE-OK — every migrated table matched on row count and full-row md5 digest.

## Source / target

- Source (read-only): `yellowstorm_semantic` on 142.132.131.111:3520, PostgreSQL 16.14, AGE 1.6.0. Untouched by this migration.
- Target: `agentstore` on poc.postgres.yellowmind.ai:3515, PostgreSQL 17.6, no AGE. Written as `semantic_app` in one transaction (rollback on any failure).

## Migrated (19 tables, 2298 rows, all checksums matched)

models 52, versions 52, node_types 61, relation_types 10, records 176,
record_relations 224, memberships 56, workspace_links 64, knowledge_bindings 64,
source_mappings 10, identity_rules 3, relation_resolution_rules 3,
source_resolution_policies 1, ontology_artifacts 3, review_items 0,
events 779, mapping_runs 8, build_runs 12, graph_index_jobs 8.

Ordering: FK-topological, parents first. The models↔versions bidirectional pair
is DEFERRABLE INITIALLY DEFERRED by design; it was ordered out and checked at
commit with SET CONSTRAINTS ALL DEFERRED. Counts and row digests are verified
inside the destination transaction against a REPEATABLE READ source snapshot
before commit; any mismatch rolls back both transactions and exits non-zero
(proven live: a duplicate-PK re-apply rolled back, exited 1, counts unchanged).

## Excluded with reasons

- `schema_migrations`: source ledger of the old database; the target keeps its own.
- `Document, Entity, MENTIONS, RELATED_TO, _ag_label_edge, _ag_label_vertex`:
  stranded AGE label tables inside the relational schema, superseded by
  revision graphs in `ag_catalog`; zero code references.
- `structured_edges, structured_entities, structured_sources` (51 rows),
  `graph_catalog` (401), `graph_embeddings` (176): no code, script, or
  migration reference anywhere in the repository; experimental/orphaned.
- AGE graph data (8 per-model `sem_*` graphs + 2 system graphs): NOT copied.
  Population rebuild owns graph construction (plan Phase 9); the graph
  instance (:3520, PG 16.14, AGE 1.6.0) matches the source engine version.

## Schema drift absorbed

`structured_mapping JSONB` existed on old `node_types`/`relation_types` with no
tracked owner. Canonicalized into `000_deploy_all.sql` and
`001_semantic_model_tables.sql` CREATE TABLEs plus incremental
`013_absorb_structured_mapping.sql` (numbered past the existing
`008_build_runs.sql` to avoid a filename collision). Nullable, no backfill;
values preserved.

## Split-database operations after the flip

- `migrate.mjs` routes `002_semantic_age_graph.sql` (and its AGE extension
  install) to the `SEMANTIC_AGEGRAPH_*` pool; all other files and the ledger
  stay on the definitions pool. Verified by running it against the flipped
  config: 001–013 applied/recorded.
- Least-privilege graph access requires the one-time platform setting
  `ALTER DATABASE "semantic-model" SET session_preload_libraries = 'age'`
  (superuser, no restart). Explicit `LOAD 'age'` is then redundant: the NestJS
  bootstrap strips LOAD lines, `migrate.mjs` skips them for 002, and the AGE
  repository tolerates a denied LOAD while still failing loudly when AGE is
  genuinely unavailable.
- Canonical bootstrap (`000_deploy_all.sql` aggregate and
  `001_semantic_model_tables.sql`) now includes `structured_mapping`, so fresh
  databases cannot re-drift.

## Rollback

- Old database was never written; it remains the fallback.
- `.env` flip keeps the previous values as ROLLBACK comments; a pre-flip
  backup copy exists outside the repo.
- Target schemas are additive; removal (only when safe) is DROP SCHEMA per
  data-plane runbook, never touching logicalsearch or the old database.
