---
feature_doc_schema: 1
feature_id: semantic-model
---

# Semantic models

## Evidence and scope

Source revision/branch: `28eb652e506d7a30e630d72a333c77f85399fe16` / `baseline/semantic-model-001` (caller-supplied HEAD; scoped implementation diff inspected).
Verified on: 2026-10-14.
Verification level: source inspection and focused runtime, MCP and backend checks listed below; no live browser QA or deployed configuration was verified. Earlier handoffs prematurely called the work end-to-end complete; this page reflects the final scoped evidence and verified limits.
Scope: semantic-record provenance and AGE graph projection, plus agent guidance for retrieving source documents. Existing workspace authorization remains in force.

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
| Trace a record to its source document | Record retrieval and graph-path results expose provenance locators; use existing document tools with workspace scope and filename where available, following each connected tool's declared schema |

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

Semantic record provenance originates in existing source provenance. Backend assistant retrieval forwards non-empty provenance for `find_records` and `get_related_records`, preserves record provenance in query/traversal rows, and includes it on records along connection paths. Runtime locators expose available `workspaceId`, `documentId`, compatibility `assetId` and `filename`; `filename` may be absent. Chained and merged derived concepts carry their underlying document references, deduplicated by workspace/document. MCP treats provenance as a locator, not evidence: follow connected document-tool schemas, use workspace scope and a declared `file_name`/document identifier only when accepted, and resolve missing filenames through `list_workspace_files(source_workspace_id=workspaceId)` by matching returned file identity/name rather than fabricating one. Facts supported by freshly retrieved document text may be answered with file/section citations and must be distinguished from model-record fields. Record search and graph reads retain existing acting-user workspace visibility filtering; locators do not grant document access.

AGE projection stores an array-valued `source_documents` property on each record vertex, containing structured workspace/document identifiers and filename when present. Manual records have an empty array. Chained and merged derived concepts inherit deduplicated original document references. This is reserved projection metadata: business identity/attributes cannot overwrite it, graph-exposure hidden-field restoration cannot replace protected properties, and existing `workspace_ids` remain available for Cypher visibility checks. Direct Cypher can read the locator array or individual values; executable projection/read code owns exact query details. Existing graphs need a new data revision or forced re-projection to acquire this property. This changes projection properties within the existing runtime and graph lifecycle; no new schema, service or topology is introduced.

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
| AGE document locators and graph exposure | [AGE projection](../../../YellowStorm/semantic-model-runtime/app/population/age_projection.py), [runtime projection guide](../../../YellowStorm/semantic-model-runtime/README.md); use existing projection/re-projection lifecycle and Cypher readers |
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
- Existing AGE projections do not acquire `source_documents` automatically; rebuild data or force re-projection. A filename is included only when present in source provenance; no broader workspace/tabular filename acquisition behavior is asserted.

## Focused verification

The caller reports the following focused checks passed for the supplied branch evidence (not live QA):

| Area | Existing coverage / command |
| --- | --- |
| Catalog/editor | From `YellowStorm/front`: `npm test -- src/modules/semantic-model/pages/SemanticModelCatalogPage.test.tsx src/modules/semantic-model/pages/SemanticModelEditorPage.test.tsx` |
| Mapping and run UI | Existing `components/mapping/*.test.tsx`, `components/population/*.test.tsx`, `components/records/*.test.tsx`; run the affected test file from the frontend directory |
| AGE projection/exposure | Focused projection/exposure tests, 34 passed; isolated AGE direct-Cypher integration, 1 passed (4 unrelated tests deselected); cleanup verified (caller-reported) |
| Diff hygiene | `git diff --check` passed (caller-reported) |
| Visible workflow | Private browser QA at catalog/editor routes; own the test model/source/run data and verify the specific criterion rather than altering shared fixtures |

For Python always use conda `meta`; never run integration mutations against a shared developer dataset without owned fixtures.

## Related context and maintenance

- [Context index](../README.md), [frontend instructions](../../../YellowStorm/front/AGENTS.md), [backend instructions](../../../YellowStorm/back/AGENTS.md).
- [System overview](../architecture/overview.md), [component map](../architecture/component-map.md), [cross-service contracts](../architecture/cross-service-contracts.md), [persistence](../backend/persistence.md).
- [Runtime contracts](../../../YellowStorm/semantic-model-runtime/contracts/v1/README.md), [search plan](../../../YellowStorm/semantic-model-runtime/docs/graph-search-plan.md), [QA fixtures](../testing/qa-fixtures.md).
- [Semantic Model MCP tools](../../../mcp/mcp-semantic-model/server.py) and [runtime provenance shaping](../../../YellowStorm/semantic-model-runtime/app/graph_search/retrieval.py) own the executable provenance and retrieval guidance; keep their payload definitions in code.
- [AGE projection source](../../../YellowStorm/semantic-model-runtime/app/population/age_projection.py), [projection tests](../../../YellowStorm/semantic-model-runtime/tests/test_age_projection.py), [direct-Cypher integration test](../../../YellowStorm/semantic-model-runtime/tests/test_age_projection_integration.py) and [graph exposure tests](../../../YellowStorm/semantic-model-runtime/tests/test_graph_exposure.py) verify projection metadata, reserved-property handling and rebuild/re-projection behavior.
- [Architecture change control](../architecture/change-control.md) governs new schema/service/module/runtime proposals; significant approved design decisions belong in ADRs.

Update this page alongside implementation when workflows, reusable owners, limits or verification entry points change.
The maintainer can prepare updates after source stabilizes; the owning coding agent supplies changed behavior, source paths and actual verification evidence.
Keep documentation on the same feature branch and PR as its code, and record pending documentation work in the task checkpoint before a handoff.
No unresolved worker filename blocker is carried forward: it is outside this final scoped diff and is removed as stale from the prior handoff. No ADR is needed; projection metadata reuses existing AGE graph lifecycle and introduces no topology change.
