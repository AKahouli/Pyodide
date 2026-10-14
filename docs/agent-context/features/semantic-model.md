---
feature_doc_schema: 1
feature_id: semantic-model
---

# Semantic models

## Evidence and scope

Source revision/branch: `f548c8f6a804fdf2b5e259e00216aa5446ef2ca2` / `baseline/semantic-model-001` (caller-supplied base; current branch diff inspected).
Verified on: 2026-10-14.
Verification level: source inspection and focused runtime, MCP and backend tests listed below; no live browser QA or deployed configuration was verified.
Scope: semantic-record provenance returned by `find_records`, `get_related_records` and `query_records`, plus agent guidance for retrieving corresponding source documents. Existing workspace authorization remains in force.

## Purpose and workflows

Semantic models describe concepts, fields and relationships, map workspace data to those definitions, and produce inspectable population revisions for search and use by agents.

| Workflow | Implemented entry point / behavior |
| --- | --- |
| Browse models | `#/semantic-models`: catalog search and filters for scope, kind, status and content; create, clone, archive and delete flows |
| Design a model | `#/semantic-models/:modelId`: concept/field/relation canvas, inspector, graph operations, canvas positions, validation and change history |
| Use a workspace model | `#/workspace/:id/semantic-model`: workspace-scoped model entry; connected workspaces and knowledge bindings determine source context |
| Map source data | Source mapping drawers and knowledge panel: document/tabular/workspace sources, derived sources, reusable mapping presets, field recipes and computed fields |
| Populate and inspect | Build/refresh/rebuild commands, model/mapping/concept scopes, job progress/history/stop controls, data preview, concept record tables and graph viewer |
| Resolve ambiguity | Identity fields, relation matching and source priority rules; health/readiness checks, review queue, corrections and correction undo |
| Publish and search | Draft/published versions, version comparison, graph search index status/build/stop/restart, search and expansion APIs |
| Trace a record to its source document | The three record retrieval tools expose provenance handles; use the existing document connector tools with filename/workspace scope as described below, following each tool's declared schema |

Route ownership: [Router.tsx](../../../YellowStorm/front/src/Router.tsx).
Page ownership: [catalog](../../../YellowStorm/front/src/modules/semantic-model/pages/SemanticModelCatalogPage.tsx), [editor](../../../YellowStorm/front/src/modules/semantic-model/pages/SemanticModelEditorPage.tsx).

## Ownership and boundaries

| Owner | Responsibility and source |
| --- | --- |
| React frontend | Typed API calls, editor state, query/cache invalidation, job polling and scoped realtime invalidation: [api.ts](../../../YellowStorm/front/src/modules/semantic-model/api.ts), [query hooks](../../../YellowStorm/front/src/modules/semantic-model/query/hooks.ts), [store](../../../YellowStorm/front/src/modules/semantic-model/store.ts) |
| NestJS semantic-model module | Public authenticated model API, graph/specification commands, authorization, workspace/source binding, mappings, versions, grants and runtime coordination: [module registration](../../../YellowStorm/back/src/modules/semantic-model/semantic-model.module.ts), [controller](../../../YellowStorm/back/src/modules/semantic-model/controllers/semantic-model.controller.ts) |
| Definition persistence | PostgreSQL model/specification persistence and separate configurable AGE connection: [database service](../../../YellowStorm/back/src/modules/semantic-model/infrastructure/semantic-model-database.service.ts), [model repository](../../../YellowStorm/back/src/modules/semantic-model/repositories/semantic-model.repository.ts), [graph repository](../../../YellowStorm/back/src/modules/semantic-model/repositories/semantic-graph.repository.ts) |
| Python semantic runtime | FastAPI datasource, population, job and search routes; Celery workers execute durable jobs: [app](../../../YellowStorm/semantic-model-runtime/app/main.py), [population routes](../../../YellowStorm/semantic-model-runtime/app/api/population_routes.py), [runtime guide](../../../YellowStorm/semantic-model-runtime/README.md) |
| Runtime persistence | PostgreSQL jobs/outbox/leases, population revisions, records/assertions/relationships, document extraction cache and search generations; AGE projections serve immutable graph revisions: [population store](../../../YellowStorm/semantic-model-runtime/app/persistence/population_store.py), [jobs store](../../../YellowStorm/semantic-model-runtime/app/persistence/postgres_jobs.py), [migrations](../../../YellowStorm/semantic-model-runtime/migrations) |

RabbitMQ carries task references; PostgreSQL remains the durable job authority.
Workers claim leased tasks and recover stalled deliveries through the existing dispatcher/recovery path.
NestJS calls the runtime through its service client; workers obtain workspace assets through trusted backend adapters, rather than browser credentials.

Semantic record provenance is produced from existing source provenance; it does not create a separate document contract. The record-returning `find_records`, `get_related_records` and `query_records` results preserve provenance containing `workspaceId` and `documentId`, retain `assetId` as a compatibility handle, and include `filename` when available. Runtime provenance description gathers available values from the existing source and asset references and deduplicates references; records derived through chained or merged sources retain the deduplicated source references represented in their provenance. MCP guidance maps provenance `filename` to the document tools' `file_name` and `workspaceId` to their workspace scope. Where a declared document tool accepts `document_id`, guidance uses `documentId` (with `assetId` as compatibility fallback); always follow the actual tool schema rather than assuming additional arguments. Record tools remain actor-scoped: inaccessible workspaces are filtered from search/query results and hidden linked records are excluded from related-record results/counts.

## Reuse map

| Change | Existing owner to extend |
| --- | --- |
| API request/response or new editor action | [frontend API](../../../YellowStorm/front/src/modules/semantic-model/api.ts), [types](../../../YellowStorm/front/src/modules/semantic-model/types.ts), [backend DTOs](../../../YellowStorm/back/src/modules/semantic-model/dto/semantic-model.dto.ts), matching controller/service |
| Concept/field/relation edits | [graph command service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-graph-command.service.ts), [specification service](../../../YellowStorm/back/src/modules/semantic-model/services/model-specification.service.ts), existing editor components and graph history utilities |
| Source mapping / extraction | [source mapping service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-source-mapping.service.ts), [attribute extraction service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-attribute-extraction.service.ts), [runtime population modules](../../../YellowStorm/semantic-model-runtime/app/population), existing mapping drawers |
| Run admission / refresh / rebuild | [refresh service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-population-refresh.service.ts), [runtime client](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-runtime-client.service.ts), [job service](../../../YellowStorm/semantic-model-runtime/app/jobs/service.py), [population worker](../../../YellowStorm/semantic-model-runtime/app/workers/population_tasks.py) |
| Manual records / correction | [record panel](../../../YellowStorm/front/src/modules/semantic-model/components/records/ConceptRecordsPanel.tsx), [manual table editor](../../../YellowStorm/front/src/modules/semantic-model/components/records/ManualTableEditor.tsx), [manual store](../../../YellowStorm/semantic-model-runtime/app/persistence/manual_store.py), existing correction commands |
| Search / index lifecycle | [graph search service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-graph-search.service.ts), [runtime graph search](../../../YellowStorm/semantic-model-runtime/app/graph_search), [search worker](../../../YellowStorm/semantic-model-runtime/app/workers/graph_search_tasks.py) |
| Record-to-document provenance retrieval | [Runtime provenance shaping and workspace visibility](../../../YellowStorm/semantic-model-runtime/app/graph_search/retrieval.py), [record query visibility](../../../YellowStorm/semantic-model-runtime/app/graph_search/record_query.py), [MCP tool guidance and result preservation](../../../mcp/mcp-semantic-model/server.py); extend these existing owners and follow document connector schemas |
| Publication / cloning / deletion | [version service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-model-version.service.ts), owning model service, runtime revision activation/publish/clone/purge routes |

Keep payload definitions in executable DTOs/types/schemas; this page intentionally does not duplicate them.
For contract changes, verify the frontend caller, NestJS translator and Python receiver together.
Reuse existing revision, lease, authorization and idempotency checks instead of adding a parallel persistence/job subsystem.

## Constraints and limitations

- A job request being accepted is not completion; the editor follows terminal states including `completed_with_gaps`, `failed`, `cancelled` and `superseded`.
- Runtime record/graph reads use scoped POST read contracts; legacy unscoped GET record/graph routes return HTTP 410. Preserve caller scope when extending reads.
- Full graph search needs configured embedding support and database extensions; the runtime guide documents exact-key-only behavior without an embedding profile.
- Runtime admission/dispatch depend on write/dispatcher switches and running workers. Source presence does not establish that these are enabled locally.
- Datasource admission requires explicit `workspaceId`; unsupported cross-workspace execution adapters remain fail-closed as documented by the runtime guide.
- A valid AGE projection and population revision are distinct from editor definitions. Inspect graph status, freshness and version bindings when diagnosing missing records.
- Do not treat health UI, mapped sources, a published definition or a queued index as proof that all records were populated or indexed successfully.
- Provenance may omit `filename` when source metadata has no filename; document retrieval guidance must use available provenance and the declared document-tool schema, not assume optional identifiers or arguments.
- Preserve actor-scoped workspace filtering when changing retrieval: source-document handles do not grant access to the document or override existing visibility rules.

## Focused verification

The caller reports the following checks passed for the supplied branch evidence:

| Area | Existing coverage / command |
| --- | --- |
| Catalog/editor | From `YellowStorm/front`: `npm test -- src/modules/semantic-model/pages/SemanticModelCatalogPage.test.tsx src/modules/semantic-model/pages/SemanticModelEditorPage.test.tsx` |
| Mapping and run UI | Existing `components/mapping/*.test.tsx`, `components/population/*.test.tsx`, `components/records/*.test.tsx`; run the affected test file from the frontend directory |
| Backend boundary | From `YellowStorm/back`: `npm test -- semantic-model.controller.spec.ts`; service tests are colocated under `src/modules/semantic-model/services/` |
| Runtime population | From `YellowStorm/semantic-model-runtime`: `conda run -n meta pytest tests/test_population_commands.py tests/test_population_tabular.py tests/test_document_population.py -q` |
| Durable runtime / search | Existing `tests/test_jobs.py`, `tests/test_concept_refresh.py`, `tests/test_scoped_population_reads.py`, `tests/test_graph_search.py`; integration variants require their configured database/services |
| Provenance runtime | From `YellowStorm/semantic-model-runtime`: focused conda tests, 149 passed (caller-reported) |
| MCP provenance and guidance | From `mcp/mcp-semantic-model`: `test_server`, 24 passed (caller-reported) |
| Backend search boundary | From `YellowStorm/back`: semantic-graph-search service spec, 15 passed (caller-reported) |
| Diff hygiene | `git diff --check` passed (caller-reported) |
| Visible workflow | Private browser QA at catalog/editor routes; own the test model/source/run data and verify the specific criterion rather than altering shared fixtures |

For Python always use conda `meta`; never run integration mutations against a shared developer dataset without owned fixtures.

## Related context and maintenance

- [Context index](../README.md), [frontend instructions](../../../YellowStorm/front/AGENTS.md), [backend instructions](../../../YellowStorm/back/AGENTS.md).
- [System overview](../architecture/overview.md), [component map](../architecture/component-map.md), [cross-service contracts](../architecture/cross-service-contracts.md), [persistence](../backend/persistence.md).
- [Runtime contracts](../../../YellowStorm/semantic-model-runtime/contracts/v1/README.md), [search plan](../../../YellowStorm/semantic-model-runtime/docs/graph-search-plan.md), [QA fixtures](../testing/qa-fixtures.md).
- [Semantic Model MCP tools](../../../mcp/mcp-semantic-model/server.py) and [runtime provenance shaping](../../../YellowStorm/semantic-model-runtime/app/graph_search/retrieval.py) own the executable provenance and retrieval guidance; keep their payload definitions in code.
- [Architecture change control](../architecture/change-control.md) governs new schema/service/module/runtime proposals; significant approved design decisions belong in ADRs.

Update this page alongside implementation when workflows, reusable owners, limits or verification entry points change.
The maintainer can prepare updates after source stabilizes; the owning coding agent supplies changed behavior, source paths and actual verification evidence.
Keep documentation on the same feature branch and PR as its code, and record pending documentation work in the task checkpoint before a handoff.
The pre-existing dirty `YellowStorm/semantic-model-runtime/app/workers/population_tasks.py` was preserved and not inspected or modified as part of this documentation update.
