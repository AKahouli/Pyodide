---
feature_doc_schema: 1
feature_id: semantic-model
---

# Semantic models

## Evidence and scope

Source revision/branch: `33cfe3300` / `baseline/semantic-model-001`, plus the scoped graph inspector implementation diff.
Verified on: 2026-10-15.
Verification level: source inspection, focused automated checks, scoped code review, direct AGE queries and local browser QA listed below. This does not establish a deployed production configuration.
Scope: semantic-record provenance, AGE graph projection and read-only source metadata in the data graph inspector, plus agent guidance for retrieving source documents. Existing workspace authorization remains in force.

Autonomous AI ownership migration: `e9ef1676c` / `baseline/semantic-model-001`, plus the scoped runtime/backend/ADK diff, verified 2026-10-15 through source, focused tests and required review. Controlled gateway transport verifies inference without backend/ADK/database configuration; it does not establish live gateway/deployment compatibility. The older browser/AGE evidence below concerns provenance and the inspector.

## Purpose and workflows

### Cross-workspace document discovery and index connection diagnostics

AGE restore identity diagnostics (2026-10-21): a raw `ag_graph` row does not prove
Cypher can resolve the graph. In AGE 1.8, graph IDs must agree with the graph's
namespace OID; a restore can preserve plain-OID graph/label references while
remapping namespace identities. This caused bootstrap `_label_name` to reject
graph 96952 although its schema existed under OID 16415. Fresh read-only Cypher
failed for both the application role and administrator, including after explicit
`LOAD 'age'`, ruling out a simple pool/preload fix. Repair is a separately approved,
transactional graph/label catalog remap with writers paused and verification before
commit, not graph recreation or suppressing startup errors. Never drop the AGE
extension or graph contents to resolve this mismatch. The localhost indexing
webhook warning is a separate callback-reachability issue, not this startup crash.
The approved local repair completed with a verified catalog backup: 26 graphs and
204 labels retained, all physical vertex/edge counts unchanged, no orphan labels.
Fresh administrator and application sessions each passed 52 vertex/edge Cypher
checks across all graphs. Backend startup then completed successfully and runtime
readiness returned 200. The guarded operator helper and rollback-validation mode
are documented in `YellowStorm/back/scripts/semantic-model/repair-age-graph-oids.md`;
this is not an automatic bootstrap repair for arbitrary restores.

3072 embedding migration (2026-10-21): user-approved disposable search reset uses
runtime migration 038. Only search documents/passages/cache are cleared; generation
state becomes failed with `embedding_storage_changed`, while generated records,
mappings and population bindings survive. Fixed storage width is 3072; conflicting
environment overrides fail before build admission. Embedding requests explicitly
send `dimensions: 3072` for both documents and queries, and returned width is still
validated (no truncation/padding). The current provider accepted that explicit
width in a synthetic live probe. Real-PostgreSQL rollback/topology/preservation
regressions passed 2/2, followed by successful local application: all 35 embedding
columns are `halfvec(3072)` and all 16 vector indexes valid. Preserved source-table
counts and exact population bindings were checked before/after. Fresh index rebuild
is required; migration alone does not qualify search readiness.

Indexed storage-name correlation (2026-10-21): the indexer receives the Workspace
storage filename (`assetId` plus the backend-sanitized original name), while the
mapper displays the original name. Runtime resolution uses the reauthorized current
asset ID to construct that exact storage filename first, then supports existing
unprefixed/whitespace legacy names. Workspace/uploader fences and ambiguous-result
denial remain in force; no wildcard suffix lookup or readiness bypass is used.
Sanitization mirrors backend UTF-16 truncation. Focused logical-index/document/
field-discovery regressions passed 88 tests (10 failed before the fix).
A remote indexer needs a reachable backend webhook, not its own loopback URL.

Multi-source asset grants use a SHA-256 digest of the canonical admission, rather
than embedding the admission and full job command in every header. Consumption
still loads and authorizes the live canonical task, exact admission and source
version. Issuance explicitly projects the five execution-proof fields. Old-format
grants fail closed; deploy backend instances together. No header limit is raised.

Population admission timestamps (2026-10-20): the application signs integer-second
issuance time while PostgreSQL persists fractional transaction-clock creation time.
Small independent-clock/transaction offsets caused correctly bound jobs to be
rejected before metadata access, unlike interactive previews. Asset authorization
allows at most one second of creation-time skew below signed issuance time; creation
after signed expiry, malformed windows and windows over 300 seconds still reject.
Live lease/capability, exact command/source/version and current access checks are
unchanged. Larger skew remains fail-closed and requires clock/deployment correction.
The focused asset-grant suite passed 34 tests; this is not live-job qualification.

Population health preserves sanitized source reason codes from singular `detail`
as well as supported existing diagnostics, with at most 25 source examples per
group. Model health displays these under the existing localized code label;
Last Result retains its serving summary and health navigation. Field attribution
is included only when the gap explicitly names a field, never guessed from every
field in a concept. Previously persisted revisions that dropped reasons cannot
recover them retroactively. Regression checks: runtime summary 2, backend health
12 and frontend health 17 tests (English/French/Arabic) passed; affected backend
and frontend TypeScript checks passed.

Interactive document preview and field suggestions use a distinct metadata
handoff (user-approved 2026-10-20): after current model/source/workspace checks,
Nest builds exact-document metadata and overwrites any caller-provided authority
before sending the existing service-key-authenticated runtime request. The runtime
requires actor/model/source equality and validates metadata before index access.
Only these interactive routes supply the explicit metadata callback; job delivery
continues to require execution-bound asset grants. This fixes interactive preview
calling job-only metadata delivery without a task, which raised
`asset_execution_authority_missing`. Focused runtime suites passed 85 tests and
backend client/source-mapping/asset-grant suites passed 119; live preview after a
coordinated backend/runtime restart remains separate qualification.

2026-10-20: non-tabular datasource discovery now obtains authoritative source
metadata through the existing execution-bound asset-grant path before previewing.
Previously its second pure preview used the default-deny verifier, so a PDF in a
different workspace failed even after admission. Grant issuance and metadata use
recheck current actor/source/task authorization; queued grant claims do not grant
access. No document-body download is needed for this check. Authorized same- and
cross-workspace cases plus revocation at both boundaries are regression-covered;
the focused asset-delivery/discovery/runtime-error suite passed 61 tests.

Population `InvalidCatalogNameError` / PostgreSQL `3D000` at pool connection is a
database-name/deployment failure, not a missing schema or revoked workspace grant.
Compare the worker's `SEMANTIC_INDEX_DATABASE_URL` host/port/database with the
actual Logical Search deployment and verify its dedicated reader can SELECT the
five logical index tables. Database existence alone does not prove table access.
Keep runtime job-store and AGE projection DSNs separate; never substitute an
administrator credential for a missing read-only grant. Worker restart and live
job retry are required to qualify an environment correction.

### Diagnostic and search-index localization

Localization repair (2026-10-17): `runtimeError` and `searchIndexRetry` are module-root
translation groups in English, French and Arabic, matching the existing component
lookups. English/French groups were accidentally nested beneath `myJobs`; Arabic
lacked both groups. Existing English/French copy and other locale entries are
preserved. The regression checks all diagnostic/retry labels across the three
languages. All 26 related TypeScript diagnostics are resolved without changing
components, shared translation typing, conversation code or runtime behavior.
Verification: frontend `tsc --noEmit -p .` and 66 focused diagnostic, retry and
editor tests passed; all 243 conversation source files match their pre-fix hashes.

### Reviewed document/workspace field suggestions

Verified 2026-10-16 against the scoped implementation diff on `security/p0p1-remediation`
(base `4461025e4`), using the 2026-10-15 automated checks, source review and signed-in
Chrome QA. In a document or workspace mapper, **Suggest fields & mappings** uses
the editable concept purpose and existing attributes. **Analyze documents** returns
local proposals with source quotes/page links, coverage and unread/truncation notices.
Review names, types and extraction definitions/methods; new fields start selected,
existing fields unchecked. **Apply selected** autosaves new attributes and the reviewed
purpose, preserves existing field definitions, and prepares only selected mappings.
The normal mapping save persists them after graph autosave; unselected mappings remain.

The existing authorized backend resolves sources; the runtime reauthorizes each asset
and owns inference under ADR-0015. AI receives bounded samples from at most five files,
forty usable blocks and 12,000 characters per file; these are AI context limits, not
underlying indexed-document read limits. Workspace sampling does not establish coverage
of every workspace file. Proposals require grounded excerpts or authoritative metadata.
Only locally generated rules verified against every complete, uncut sampled document
with accepted text/date values are offered as deterministic; other grounded fields use
AI definitions. Metadata mappings contain no extraction-only settings. Suggestions
create no population records and do not guarantee extraction values.

Owners: [review panel](../../../YellowStorm/front/src/modules/semantic-model/components/mapping/DocumentFieldSuggestions.tsx),
[mapping drawer](../../../YellowStorm/front/src/modules/semantic-model/components/mapping/DocumentSourceMappingDrawer.tsx),
[source authorization/coordinator](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-source-mapping.service.ts),
[runtime discovery](../../../YellowStorm/semantic-model-runtime/app/population/field_discovery.py)
and [runtime contract](../../../YellowStorm/semantic-model-runtime/contracts/v1/README.md#document-field-suggestions).

Focused evidence: backend source-mapping 50 tests and build passed; runtime discovery
and extraction transport 36 tests passed; frontend mapping/split/review 15 tests passed.
Required source review passed with no critical/major findings. Chrome QA on owned copy
`7f99f4fe-b699-4273-89ed-c9fe87ad1249` verified document and whole-workspace review,
selection, Apply, save and reopen; document evidence navigated to page 11. A preview
returned a cited value on page 8; other fields could be `not_found`, and no population
run was claimed. Full frontend typecheck was blocked by unrelated diagnostics, with
none in the changed discovery/mapping/API/types/read-provider paths. Existing index
rows still describe this feature and its owners; no new page, index row or ADR is needed.

Identity-choice recovery (2026-10-16): inspector and canvas key actions exclude
stored identity fields absent from the current concept before toggling a choice;
the inspector also treats an entirely stale rule as no usable identity. Saving a
replacement persists only current selections through the existing validated API.
The canvas action waits for graph autosave, as the inspector already does, so a
new field is persisted before its identity rule. This does not rewrite stored
rules until an explicit choice. Regression coverage in `SemanticModelInspector.test.tsx`
and `SemanticModelEditorPage.test.tsx` passed (46 tests); Chrome QA on the owned copy
above saved `docid` after the prior `documentid` field had been removed, and verified
the selected key after reload. No architecture, contract or index change is needed.

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

P1 asset authority now uses the dedicated `semantic-runtime` principal plus a
backend-signed canonical admission and a live task/lease/opaque claim proof.
Population retains active model/source authorization; model-less discovery is
limited to the exact uploaded source. Every operation and refresh rechecks current
rights/version, with job/attempt/source/options-isolated datasets and no raw-key
fallback. The [semantic asset contract](../../security/semantic-asset-grant-contract.md)
records source owners, scoped review, timestamp interoperability and outstanding
database/Ceph/deployment qualification. This local evidence does not close P1.

Runtime failure details are captured before exception codes are collapsed and
retained in existing task checkpoint/job progress JSON across retries, recovery
exhaustion and terminal completion. Job status has optional `errorDetails`; index
status hydrates the same sanitized projection through its exact generation,
job/model/revision join. Existing authorization, public error codes and schema
remain unchanged. [Diagnostic shaping](../../../YellowStorm/semantic-model-runtime/app/jobs/error_details.py)
allowlists bounded type/message, timestamp, available phase/attempt/correlation
IDs, SQLSTATE/HTTP status, source locations and cause summaries; raw exception
payloads, SQL parameters, credentials and document content are excluded.
Failed run/index panels, expanded history and My jobs expose **Failure details**
with expandable technical context. The header's **Search index** status entry
remains reachable after failure/reload. Older exhausted runs show retained error
identifiers with an explicit missing-diagnostics notice, never invented traces.
See [runtime diagnostics and rollout](../../../YellowStorm/semantic-model-runtime/README.md#failure-diagnostics-in-status-panels).

Failed search indexing can be retried independently with **Retry search indexing**. Recovery uses stored population records and compatible committed indexing batches/vector caches, without rereading sources or rerunning population. The existing owner/editor command carries expected data-revision and index identities; changed data or effective embedding/index settings reject recovery instead of silently changing its target. The panel suppresses duplicate submissions and follows the new attempt, keeping the previous failure visible while mounted (not across reload). See [index retry UI regressions](../../../YellowStorm/front/src/modules/semantic-model/components/population/SearchIndexProgress.test.tsx) and [runtime retry regressions](../../../YellowStorm/semantic-model-runtime/tests/test_graph_search_resume.py). Deploy or restart the Nest backend as well as the runtime API/workers when rolling out guarded index commands; an older loaded `GraphSearchIndexDto` rejects `expectedDataRevisionId` before the runtime is called. Ensure API and search workers load matching embedding-profile, serializer/field-policy and index-settings versions: profile drift fails closed with `embedding_profile_changed` before claim, record reads or provider calls; never bypass the fence by rewriting stored fingerprints.

The header labels a failed index **Search index failed**, opening its failure details and retry action. Trust center keeps the canvas mounted to preserve its viewport, but hides its full subtree with opacity and disables interaction/focus with native inert until returning to the canvas.

The search-index status entry also remains reachable when no current index exists or its status is loading/unavailable. A populated current revision with a `missing` index offers **Build search index**, explicitly creating an index for the current configuration from stored records, without rereading sources or rerunning population. This is distinct from retrying an existing failed generation: it carries the expected data revision but no nonexistent index identity. An older failed generation under another embedding profile remains stored and is not silently retried. No populated revision means no build action; status errors display a refresh action and block writes while retaining cached failure details.

P0 concurrency hardening uses independent task guards for datasource, population
and search, with one serialized renewal-loop connection per guard. Search retains
its progress-only generation lease/watchdog; task heartbeats cannot conceal a
stalled build. Index writes fence task → generation → batch/cache in one
transaction, including generation-only fencing for standalone index builds.
Population finalization holds task → job → short per-model cutover mutex before
freshness checks, binding CAS and atomic terminal completion. Correction INSERTs,
selected specifications and other binding changes share that mutex; optimistic
correction API prechecks remain compatible. Post-lock lease checks use PostgreSQL
wall time. See the [P0 invariant/release checklist](../testing/semantic-runtime-p0-release-gate.md)
for exact tests and pending deployment evidence; implementation is not a claim
that multi-replica staging has passed.

Semantic AI extraction is runtime-owned: API and population workers call LiteLLM directly, using deployment-owned extraction configuration and a non-secret profile identity. Prompts and response shaping live in [runtime extraction](../../../YellowStorm/semantic-model-runtime/app/datasource/attribute_extraction.py) and [prompt instructions](../../../YellowStorm/semantic-model-runtime/app/datasource/extraction_prompt.py); document/cell/derived readers retain grounding and provenance. NestJS obtains the runtime profile before fingerprinting AI requests. The backend inference bridge/default extraction-agent bootstrap and ADK semantic extraction package/router/settings are removed. Generic ADK document extraction is independent. See [ADR-0015](../decisions/ADR-0015-runtime-owned-semantic-ai-extraction.md).

Semantic record provenance originates in existing source provenance. Backend assistant retrieval forwards non-empty provenance for `find_records` and `get_related_records`, preserves record provenance in query/traversal rows, and includes it on records along connection paths. Runtime locators expose available `workspaceId`, `documentId`, compatibility `assetId` and `filename`; `filename` may be absent. Chained and merged derived concepts carry their underlying document references; canonical and MCP provenance can retain distinct mapping/version references to the same document. MCP treats provenance as a locator, not evidence: follow connected document-tool schemas, use workspace scope and a declared `file_name`/document identifier only when accepted, and resolve missing filenames through `list_workspace_files(source_workspace_id=workspaceId)` by matching returned file identity/name rather than fabricating one. Facts supported by freshly retrieved document text may be answered with file/section citations and must be distinguished from model-record fields. Record search and graph reads retain existing acting-user workspace visibility filtering; locators do not grant document access.

AGE projection stores an array-valued `source_documents` property on each record vertex, containing structured workspace/document identifiers and filename when present. Manual records have an empty array. Chained and merged derived concepts inherit deduplicated original document references. This is reserved projection metadata: business identity/attributes cannot overwrite it, graph-exposure hidden-field restoration cannot replace protected properties, and existing `workspace_ids` remain available for Cypher visibility checks. Direct Cypher can read the locator array or individual values; executable projection/read code owns exact query details. Existing graphs need a new data revision or forced re-projection to acquire this property. This changes projection properties within the existing runtime and graph lifecycle; no new schema, service or topology is introduced.

The AGE locator array deduplicates documents by `(workspaceId, documentId)`. The data graph record API exposes `source_documents` separately from concept-defined values. In **Data graph**, open a record's information badge to see **Source documents** in the right inspector: JSON can be expanded and copied, but cannot be edited as a business field. An empty array means no document locator; a null or absent property means the stored graph predates this metadata and the inspector directs the user to **Run → Rebuild graph from stored records**. The backend retains model-role and acting-user workspace checks before returning metadata. EN/FR text follows existing module localization.

## Reuse map

| Change | Existing owner to extend |
| --- | --- |
| API request/response or new editor action | [frontend API](../../../YellowStorm/front/src/modules/semantic-model/api.ts), [types](../../../YellowStorm/front/src/modules/semantic-model/types.ts), [backend DTOs](../../../YellowStorm/back/src/modules/semantic-model/dto/semantic-model.dto.ts), matching controller/service |
| Concept/field/relation edits | [graph command service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-graph-command.service.ts), [specification service](../../../YellowStorm/back/src/modules/semantic-model/services/model-specification.service.ts), existing editor components and graph history utilities |
| Source mapping / extraction | [source mapping service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-source-mapping.service.ts), [runtime profile client](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-runtime-client.service.ts), [runtime extraction](../../../YellowStorm/semantic-model-runtime/app/datasource/attribute_extraction.py), [runtime population modules](../../../YellowStorm/semantic-model-runtime/app/population), existing mapping drawers |
| Run admission / refresh / rebuild | [refresh service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-population-refresh.service.ts), [runtime client](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-runtime-client.service.ts), [job service](../../../YellowStorm/semantic-model-runtime/app/jobs/service.py), [population worker](../../../YellowStorm/semantic-model-runtime/app/workers/population_tasks.py) |
| Manual records / correction | [record panel](../../../YellowStorm/front/src/modules/semantic-model/components/records/ConceptRecordsPanel.tsx), [manual table editor](../../../YellowStorm/front/src/modules/semantic-model/components/records/ManualTableEditor.tsx), [manual store](../../../YellowStorm/semantic-model-runtime/app/persistence/manual_store.py), existing correction commands |
| Search / index lifecycle | [graph search service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-graph-search.service.ts), [runtime graph search](../../../YellowStorm/semantic-model-runtime/app/graph_search), [search worker](../../../YellowStorm/semantic-model-runtime/app/workers/graph_search_tasks.py) |
| Record-to-document provenance retrieval | [Runtime provenance shaping and workspace visibility](../../../YellowStorm/semantic-model-runtime/app/graph_search/retrieval.py), [record query visibility](../../../YellowStorm/semantic-model-runtime/app/graph_search/record_query.py), [MCP tool guidance and result preservation](../../../mcp/mcp-semantic-model/server.py); extend these existing owners and follow document connector schemas |
| AGE document locators and graph exposure | [AGE projection](../../../YellowStorm/semantic-model-runtime/app/population/age_projection.py), [runtime projection guide](../../../YellowStorm/semantic-model-runtime/README.md); use existing projection/re-projection lifecycle and Cypher readers |
| Source metadata in the graph inspector | [Record response shaping](../../../YellowStorm/back/src/modules/semantic-model/domain/graph-outline.ts), [graph viewer](../../../YellowStorm/front/src/modules/semantic-model/components/editor/SemanticModelGraphViewer.tsx), [record inspector](../../../YellowStorm/front/src/modules/semantic-model/components/graph/GraphRecordPanel.tsx); keep reserved metadata separate from editable concept fields |
| Publication / cloning / deletion | [version service](../../../YellowStorm/back/src/modules/semantic-model/services/semantic-model-version.service.ts), owning model service, runtime revision activation/publish/clone/purge routes |

Keep payload definitions in executable DTOs/types/schemas; this page intentionally does not duplicate them.
For contract changes, verify the frontend caller, NestJS translator and Python receiver together.
Reuse existing revision, lease, authorization and idempotency checks instead of adding a parallel persistence/job subsystem.

## Constraints and limitations

Document/cell/derived AI preview and population accept generated values directly
under the user's 2026-10-16 approval, including summaries and combined passages.
The shared reader validates requested fields, JSON value types, enum choices and
at least one citation to supplied evidence; it no longer requires a literal text
match or a quoted sibling field. Citations are model-attributed source locators,
not independent factual verification. The first remains the page/column anchor;
the full valid reference list survives document and cached cell/derived provenance.
Existing explicit cleanup/date normalization remains. Document extraction v3 and
prompt v2 invalidate old filtered answers; stored revisions need a new run to change.
Restart backend plus runtime API/population workers together; unknown profiles and
queued jobs with mismatched identities still fail closed. This updates extraction
behavior within ADR-0015's existing ownership; no new architecture or index entry.
Executable checks: `tests/test_document_population.py`, `tests/test_cell_fields.py`,
`tests/test_semantic_ai_runtime.py`, and backend `semantic-runtime-client.service.spec.ts`.
Verification on 2026-10-16: runtime 103 tests, backend 45 tests and backend build
passed; scoped source/documentation review passed. Signed-in Chrome QA on owned
model `7f99f4fe-b699-4273-89ed-c9fe87ad1249` displayed synthesized steps in preview,
then populated two records. The run completed with three gaps in existing Rules
fields; all three AI fields were persisted. The records table and stored assertions
confirmed generated steps plus retained supplied citations; search indexing finished.

- A job request being accepted is not completion; the editor follows terminal states including `completed_with_gaps`, `failed`, `cancelled` and `superseded`.
- Runtime record/graph reads use scoped POST read contracts; legacy unscoped GET record/graph routes return HTTP 410. Preserve caller scope when extending reads.
- Full graph search needs configured embedding support and database extensions; the runtime guide documents exact-key-only behavior without an embedding profile.
- Runtime admission/dispatch depend on write/dispatcher switches and running workers. Source presence does not establish that these are enabled locally.
- AI inference needs matching runtime API/worker `SEMANTIC_AI_*` configuration and a JSON-mode-capable gateway model. Extraction profile changes invalidate AI job/cache identity; legacy queued agent-library identities require resubmission/rebuild. Existing stored revisions are retained. No agent-library entry or ADK service is required for inference; backend workspace asset access still applies.
- Datasource admission requires explicit `workspaceId`; unsupported cross-workspace execution adapters remain fail-closed as documented by the runtime guide.
- A valid AGE projection and population revision are distinct from editor definitions. Inspect graph status, freshness and version bindings when diagnosing missing records.
- Do not treat health UI, mapped sources, a published definition or a queued index as proof that all records were populated or indexed successfully.
- Provenance may omit `filename` when source metadata has no filename; document retrieval guidance must use available provenance and the declared document-tool schema, not assume optional identifiers or arguments.
- Preserve actor-scoped workspace filtering when changing retrieval: source-document handles do not grant access to the document or override existing visibility rules.
- Existing AGE projections do not acquire `source_documents` automatically; rebuild data or force re-projection. A filename is included only when present in stored source provenance. Re-projection does not fetch missing names from workspaces or reread documents; legacy records can therefore retain workspace/document IDs without filenames.

## Focused verification

Use the existing entry points below for affected behavior. Only rows with explicit results describe checks run for the source metadata changes; the remaining rows are reusable coverage entry points.

| Area | Existing coverage / command |
| --- | --- |
| Catalog/editor | From `YellowStorm/front`: `npm test -- src/modules/semantic-model/pages/SemanticModelCatalogPage.test.tsx src/modules/semantic-model/pages/SemanticModelEditorPage.test.tsx` |
| Mapping and run UI | Existing `components/mapping/*.test.tsx`, `components/population/*.test.tsx`, `components/records/*.test.tsx`; run the affected test file from the frontend directory |
| Backend boundary | From `YellowStorm/back`: `npm test -- semantic-model.controller.spec.ts`; service tests are colocated under `src/modules/semantic-model/services/` |
| Runtime population | From `YellowStorm/semantic-model-runtime`: `conda run -n meta pytest tests/test_population_commands.py tests/test_population_tabular.py tests/test_document_population.py -q` |
| Durable runtime / search | Existing `tests/test_jobs.py`, `tests/test_concept_refresh.py`, `tests/test_scoped_population_reads.py`, `tests/test_graph_search.py`; integration variants require their configured database/services |
| P0 multi-worker correctness | `scripts/run_p0_gate.py`: isolated PostgreSQL, fail on missing prerequisites/skips, JUnit plus commit/source digest; [invariants and staging status](../testing/semantic-runtime-p0-release-gate.md). Workflow: `.github/workflows/semantic-runtime-p0.yml` |
| Autonomous AI extraction | Runtime `tests/test_attribute_extraction_client.py` and `tests/test_semantic_ai_runtime.py`: direct LiteLLM transport, service authentication, reference filtering, grounded cell values, runtime profile admission, fail-closed queued identities before cache/fetch/metadata, fingerprint invalidation and unsupported-JSON failure behavior passed. Backend: 200 focused cases and build passed; required review found no critical/major issues |
| AGE projection/exposure | Focused projection/exposure tests, 34 passed; isolated AGE direct-Cypher integration, 1 passed (4 unrelated tests deselected); cleanup verified (caller-reported) |
| Graph record API | `npm test -- graph-outline.spec.ts --runInBand`: 7 passed; metadata remains separate from editable values and distinguishes missing metadata from an empty array |
| Graph inspector | `npm test -- SemanticModelGraphViewer.test.tsx --run`: 31 passed; includes read-only source metadata on a derived-concept record |
| Types/build and review | Frontend `npx tsc --noEmit -p .` and backend `npm run build` passed; scoped code review found no critical/major findings |
| Local AGE and browser verification | Model `61ce5cd7-68e6-4ade-a5e8-cf42e3d108a8`: both served graphs re-projected from stored records. Direct Cypher verified metadata on all 228 draft and 26,671 published vertices. All draft records returned workspace/document IDs and filenames; legacy published records returned IDs without filenames. Signed-in Chrome QA, explicitly authorized by the user, verified expanded JSON on a derived Correspondant record in the inspector |
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
Projection metadata and its inspector need no separate ADR; runtime-owned semantic AI inference is governed by [ADR-0015](../decisions/ADR-0015-runtime-owned-semantic-ai-extraction.md).
