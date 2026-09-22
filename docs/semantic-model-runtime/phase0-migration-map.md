# Semantic Model Runtime — Phase 0 Migration Map

**Date:** 19 September 2026
**Plan:** `yellowmind_semantic_model_multiphase_implementation_plan.md` (Yellowmind Semantic Model, multi-phase)
**Status:** Phase 0 executed on branch `agara-worky-006`. This file records the verified baseline, the classification of every existing heavy path, and the Phase 0 code deliverables (P0.6, P0.8, P0.9).

---

## 1. Baseline record (P0.1)

| Item | Value at execution time |
|---|---|
| Repository | `YellowsysOrg/YellowStorm-poc` (monorepo: `YellowStorm/back`, `YellowStorm/front`, `yellowstorm-adk`, `yellowstorm-code-runtime`, `mcp-agent`, `mcp-m365`) |
| Branch / HEAD | `agara-worky-006` @ `9196fffa0f5ef874729e9c1de01e316ae29fd0ab` ("postgres migration final") |
| Working tree | Clean at start of Phase 0; plan's pinned baseline `7de3bb68` is an ancestor (branch carries the workspace/project/governance Postgres migration work ahead of `main`) |
| `YellowsysOrg/Yellowstorm-vectorstore` | **Not checked out locally** (no sibling clone under `C:\prog`). Read-only integration target only. |
| `YellowsysOrg/mcp-server-logical-search` | **Not checked out locally.** Additive integration target (Phase 8). |

Boundaries honored: no changes to any file outside `YellowStorm/back/src/config/**`, `.github/workflows/ci.yml`, `YellowStorm/semantic-model-runtime/**` (new), and `docs/**` (this document).

---

## 2. Existing semantic-model feature inventory (P0.2)

Full evidence was gathered by read-only exploration on 19 Sep 2026; the load-bearing facts:

### 2.1 NestJS backend (`YellowStorm/back/src/modules/semantic-model/`)

- **Storage:** PostgreSQL only (no MongoDB) + Apache AGE graphs in the same instance. Dedicated pool via `infrastructure/semantic-model-database.service.ts`; boot-time schema bootstrap from `YellowStorm/back/scripts/semantic-model/000_deploy_all.sql` (tables: `models`, `versions`, `workspace_links`, `node_types`, `relation_types`, `records`, `record_relations`, `knowledge_bindings`, `memberships`, `events`, `ontology_artifacts`, `mapping_runs`, `build_runs`, `graph_index_jobs`, `source_mappings`, `identity_rules`, `relation_resolution_rules`, `source_resolution_policies`, `review_items`).
- **API surface:** 57 routes on `SemanticModelController` (`@Controller('semantic-models')`) + 3 workspace-scoped routes on `WorkspaceSemanticModelController`. All guarded by `PermissionsGuard` + `@RequirePermissions('semantic_models.*')`; model-level RBAC via `semantic_model.memberships` (`owner|editor|viewer`) enforced in `SemanticModelService.requireRole`. Every mutation audits into `semantic_model.events`.
- **Scheduled work:** exactly one — `SemanticGraphIndexWorkerService.process()` `@Interval(5000)` claiming `graph_index_jobs` with `FOR UPDATE SKIP LOCKED` + advisory lock.
- **External clients:** `SemanticModelNativeSearchClient` (`SEMANTIC_MODEL_NATIVE_SEARCH_URL` + batch URL + token), `SemanticSearchGraphClient` (`SEMANTIC_SEARCH_URL` → `POST /v1/graphs/index`), ADK calls to `{indexing.apiAdk}/semantic-model/ontologies/generate` and `.../mappings/generate` (`ADK_API_KEY`), and `AgentTaskExecutionService.runSingleAgentTask` for document field extraction (`SEMANTIC_MODEL_DOCUMENT_EXTRACTION_AGENT_ID`).
- **Config:** `YellowStorm/back/src/config/semantic-model.config.ts` (`SEMANTIC_PG_*`, `SEMANTIC_AGE_GRAPH`, schema `semantic_model`).

### 2.2 Frontend (`YellowStorm/front/src/modules/semantic-model/`)

- Pages: `SemanticModelCatalogPage`, `SemanticModelEditorPage`, `WorkspaceSemanticModelPage`; editor tabs `structure | records | mappings` (`EditorMode` in `types.ts`); overlays: `SemanticTrustPanel`, `VersionsPanel`, `SemanticModelGraphViewer`, build banner.
- Single API client `api.ts` over `API_ENDPOINTS.semanticModels` (`front/src/lib/api/config.ts:373-422`). i18n via module locales `en.json`/`fr.json`.

---

## 3. Heavy-path classification map (P0.3)

| # | Path (evidence) | Current behavior | Classification → R1 destination |
|---|---|---|---|
| A | `services/spreadsheet-concept.resolver.ts` (`:74-113`) | Downloads whole file into a buffer and parses with ExcelJS **inside NestJS** per request; 50 MB gate at `:78`; row scan capped at 5 000 (`PREVIEW_ROW_SCAN_LIMIT`); mapping-health re-parses up to 50 workbooks per request (`semantic-business-trust.service.ts:107`) | **Delegate** → datasource workers (discovery/preparation); NestJS keeps thin clients |
| B | `services/document-extraction-concept.resolver.ts` (`:98-140`) | Native-search retrieval + ADK agent extraction; preview hardcodes `complete: true` (`:87`) — "whole source processed", not "required values found" | **Replace** → population runtime; deterministic-first extraction + independent validation |
| C | `services/semantic-graph-index-worker.service.ts` (`:18-58`) | 5 s poller; `dropGraph` then `buildGraph` (destructive whole-graph rebuild) then calls retired `SemanticSearchGraphClient.index` | **Replace** → population workers build revision-specific graphs; activation is atomic (plan §6C) |
| D | `repositories/semantic-age-graph.repository.ts` | All AGE write mechanics (`ensureGraph/dropGraph/buildGraph`); writers = worker (C) and clone path (`semantic-model.service.ts:189-193`); `readGraph` used by graph viewer. `applyMappingPlan` AGE counters are dead code (`semantic-model-mapping-proposal.service.ts:464`) | **Keep as read adapter; retire all NestJS write callers** |
| E | `POST semantic-models/:id/graph/validate` (`semantic-model.controller.ts:125-130`) | "Validate" first calls `rebuildAgeGraph` which **enqueues a destructive AGE rebuild** on every Ctrl+S (`semantic-model-mapping-proposal.service.ts:525-533`), then runs the (pure, keep-worthy) validator | **Replace route** → validation becomes non-mutating; rebuild becomes an explicit runtime command |
| F | `SemanticModelCorpusPreparationService` | Cheap metadata manifest via `WorkspaceDocumentService` (100/page loop), no LLM/AGE | **Keep** (bounded) |
| G | `SemanticModelOntologyGenerationService`, `SemanticModelMappingProposalService`, `SemanticModelBuildOrchestratorService` | Ontology/mapping generation are ADK HTTP calls; apply/identity-resolution and a setInterval/heartbeat job runner run in-process; orchestration polls every 3 s in an infinite loop | **Delegate/Replace** → runtime jobs + durable queues (plan §6.3); remove in-process orchestration |
| H | `SemanticModelEvidenceSearchService` + `SemanticModelNativeSearchClient` | Fan-out to retired `search_native` endpoint; **complete caller list**: doc-extraction resolver + evidence search only. Single-item `search()` has no non-test callers | **Retire** with the endpoint |
| I | `SemanticSearchGraphClient` (`SEMANTIC_SEARCH_URL`) | Only caller: index worker. **⚠ Additional consumer outside the feature:** `modules/agent/agent.service.ts:908-910` injects `{SEMANTIC_SEARCH_URL}/v1/graphs/search/fused` + token into agent runtime params when a conversation carries a `semanticModelId` (reached via `SemanticModelService.resolveSearchSchema` from `message.controller.ts:264` and `stream.service.ts:1039`) | **Retire after the runtime absorbs both index and fused-search duties**; retirement is sequenced, never a same-commit delete |
| J | Frontend triggers | Ctrl+S validate (`SemanticModelEditorPage.tsx:193-220`), graph-viewer open/sync → `indexAgeGraph` (`:283-295`, `SemanticModelGraphViewer.tsx:385-399`), Inspector "apply to all sources" → `rebuildAgeGraph` (`SemanticModelInspector.tsx:63-91`), both mapping drawers' preview mutations, validate dialog → `POST builds` | **Update in the same change** that retires each endpoint (Phase 9 list, plan §9B) |
| K | Dead config | `SEMANTIC_MODEL_SEARCH_AGENT_ID` in `back/.env` has **no readers** anywhere in src/scripts | Delete at Phase 9 cleanup |

---

## 4. Workspace asset/storage/event reality (P0.5)

Owner module `YellowStorm/back/src/modules/workspace` (Drizzle/Postgres, schema `workspace`); blob storage in `YellowStorm/back/src/modules/document` (Ceph S3 via AWS SDK v3).

**Available and reusable:**

- Asset row `workspace.workspace_documents` (`YellowStorm/back/src/modules/postgres/schema/workspace.schema.ts:73-125`): `id`, `workspaceId`, `originalName`, `mimeType`, `size`, `path` (S3 key), `contentHash`, `status`, `indexingStatus` + index bookkeeping (`indexingTaskId`, `lastIndexedAt`, …), `createdBy`, `parentId`/`isFolder`.
- Storage: `DocumentService.download` (buffered), `openReadStream` (range), `generateSasUrl` (presigned GET/PUT), workspace layout `{ownerUserId}/{storagePrefix}/{filename}` with immutable `storagePrefix`.
- Events (Mongo transactional outbox → in-process dispatcher, `@Cron` 5 s): `workspace.document.registered.v1`, `.artifact_ready.v1`, `.indexing_started.v1`, `.indexing_ready.v1`, `.indexing_failed.v1`, `.deleted.v1`, `workspace.web_page.registered.v1`. Consumer pattern to copy: `modules/governance/integration/workspace-governance-event.handler.ts`.
- Authorization: `WorkspaceAccessGuard` (owner / public / `workspace_shares` role `owner|read|readwrite`) + `WritePermissionGuard`; service-level `WorkspaceShareService.assertUserHasAccess`.
- Vectorstore integration (unchanged): `IndexingClientService` → `POST {INDEXING_API_URL}/vectorstores/indexDocumentFromCephStore` with `external_id = documentId`, `brain_id = workspaceId`; completion via `/v1/indexing/webhook` → `indexingStatus`.

**Absent — these gaps shape the runtime design (do not assume otherwise):**

1. **No asset versioning**: one mutable row per `(workspaceId, assetId)`; `assetVersionId` has no equivalent. Runtime must fingerprint content itself (sha256 on preparation) and record `index_observations`.
2. **Checksums are partial**: MD5 `contentHash` only on backend-buffered uploads; presigned uploads leave NULL; no verification on download.
3. **No replace flow** (re-upload creates `name (n)` copy) and **no rename/move events**.
4. **No ACL-change events** (share mutations send notifications only) → the runtime needs periodic re-authorization (plan P9.8) since revocation cannot be observed event-wise today.
5. **No external broker**: outbox delivers to in-process handlers only; a Python runtime cannot subscribe directly — a relay handler (like governance's) or bounded polling is required.
6. **No tenant dimension**: single-tenant deployment; isolation is user + workspace. The plan's `tenantId` maps to workspace-scoped authorization for R1; do not invent a tenant header.

---

## 5. Vectorstore access (P0.4) — EXECUTED 19 Sep 2026 (read-only session)

Method: one-off session over the user-provided connection to the deployed `logicalsearch` PostgreSQL database, forced `SET default_transaction_read_only = on` with a 30 s statement timeout; catalog queries, aggregates and 5-row id-shape samples only — no content or embedding payloads were read. Superuser credentials were used for this inspection only and are **not committed anywhere**; see "Required infra work" below. MCP capability probe: separate streamable-HTTP session.

### 5.1 Deployment facts (verified live; supersedes documentary claims)

| Area | Verified fact |
|---|---|
| Database | PostgreSQL **17.6** (Debian 12), database `logicalsearch`, single `public` schema holds all logical tables |
| Extensions | `vector 0.8.0` (pgvector), `pg_search 0.18.9` (**ParadeDB BM25**, `shared_preload_libraries = pg_search,pg_cron`), `fuzzystrmatch`, `pg_ivm`, PostGIS 3.6 (+tiger/topology, unrelated). **No AGE** (`ag_catalog` absent), **no pg_trgm** |
| AGE | Graph storage is **not** in this database — it lives in the separate semantic PG (`SEMANTIC_PG_*`). The read-only adapter needs only vector + pg_search + tsvector; nothing must be installed here (P4.1 holds) |
| Tables (row estimates) | `logical_documents` 903 · `logical_sections` 132 056 · `logical_blocks` 448 033 · `logical_images` 38 135 · `logical_text_positions` 574 222 |
| Embeddings | `halfvec(2560)` on `logical_sections.embedding` and `logical_blocks.embedding`; HNSW `halfvec_cosine_ops` (m=16, ef_construction=64). Embedding model name is **not stored** in the DB — the dim-2560/halfvec/cosine contract must be pinned in the capability manifest (P4.1/P4.9) |
| Lexical | ParadeDB BM25 on blocks (`content` with English **and** French stemmers, raw `section_id`/`block_type`) and sections (`title` EN/FR); plus GIN `tsvector` (`content_tsv`, `title_tsv`); `fuzzystrmatch` available; no trigram index |
| Section identity | `id` int PK (reindex-fragile) + parser-local `section_id` varchar (`sec_N`), unique per `(document_id, section_id)` (btree). Hierarchy: `parent_section_id` **text** (stringified DB id), `previous_section_id`/`next_section_id` **integer** DB ids, precomputed `ancestors`/`descendants` jsonb |
| Root conventions | **Both** observed: self-referencing root (`id=49 → parent_section_id='49'`, level 0, title "Document") and NULL parents (level-1 sections). P4.16 normalization must handle both; self-reference elsewhere remains an anomaly signal |
| Blocks join | `(document_id, section_id)` varchar join confirmed (btree indexes present); `block_id` varchar (`pN_bM`, **not** unique across documents); block PK `id` int |
| Block types | `text/text` 391 k, `image/table` 34.6 k, `text/text/OCR` 7.8 k, `text/reference_content` 4.5 k, `image/image`, `text/footer`, `image/chart`, `text/footnote`, … — OCR/origin distinction is available at the type level (P4.18) |
| Word coordinates | `logical_text_positions` (words json per `(document_id, block_id, page_number)`, 574 k rows) — word-level highlighting support exists |
| Document scoping | `logical_documents`: `user_id` varchar NOT NULL (uploader; 15 distinct), `workspace_id` **nullable** (97 distinct), `workspace_name` (90), `file_name` (**780 distinct for 903 docs — not unique**). Composite index `(user_id, workspace_id, file_name)` |
| Document correlation | **No external_id / asset-id / content-hash / version column exists.** `(workspaceId, assetId, assetVersionId) → logical_documents.id` has no direct key: resolution must go through `(workspace_id, file_name)` (+ uploader identity) and is ambiguity-capable. Version verification from this DB alone is impossible — the plan's verification ladder (P4 strategy 1–3) and `sourceVersionVerification` enum apply exactly; P4.2 must return multiple candidates rather than guess |

### 5.2 MCP capability probe (verified live)

- Server: **"Logical Indexing MCP" v1.9.4**, protocol `2025-03-26` (streamable HTTP), capabilities: tools/prompts/resources.
- 10 tools: `get_document_strategy` (documented as mandatory-first for workspace+filenames), `read_content`, `search` (hybrid section-level), `summarize`, `search_sections`, `search_blocks`, `read_sections`, `read_blocks`, `expand_context`, `locate_answer_citations`.
- Retrieval is addressed by **(workspace_id, file names)** — consistent with the DB scoping above and with the plan's P8.3 warning that filename grouping must not merge distinct documents; there is no version/asset-id concept anywhere in the MCP surface. Reinforces: source-versioning stays runtime-owned (§8 resolved decision).

### 5.3 Required infra work (before the Phase 4 adapter goes live)

1. **Read-only role — DONE, provisioned and verified 20 Sep 2026.** Created on the `logicalsearch` deployment (previously the only login was the `postgres` superuser):
   - Group role `semantic_model_reader` (NOLOGIN; holds the grants: `USAGE` on `public` + `SELECT` on all current tables, plus `ALTER DEFAULT PRIVILEGES FOR ROLE postgres` so reindex-recreated tables stay readable).
   - Login user `semantic_model_reader_app` (`LOGIN`, `IN ROLE semantic_model_reader`, `CONNECTION LIMIT 4` — matches the plan §6.5 initial global read pool cap). A NOLOGIN role cannot accept connections, so at least one LOGIN user is required; the two-layer split lets Phase 2 add one login per worker family without redoing grants, and lets credentials rotate independently.
   - Session guards on both roles (role GUCs are not inherited at login, so the login user carries its own): `default_transaction_read_only = on`, `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 15s`.
   - Verified from a fresh connection as the new user: reads succeed on all five `logical_*` tables; CREATE TABLE / INSERT / UPDATE / DROP are all denied; guards active. This completes the P0 acceptance item "read-only integration works with a role that cannot write vectorstore tables".
   - Credentials: stored in the gitignored `YellowStorm/back/.env` as `SEMANTIC_INDEX_DATABASE_URL` (user `semantic_model_reader_app`). **Rotate into the deployment secret store before any non-local use.** Rollback: `REVOKE … / DROP ROLE semantic_model_reader_app; DROP ROLE semantic_model_reader;` (additive-only change; nothing else was modified).
2. ~~`idle_in_transaction_session_timeout` is `0` on this deployment~~ — mitigated per-role for the new reader (15 s); deployment-global default remains untouched per the plan's "timeouts on semantic roles, not globally" rule.

## 6. Baseline capture (P0.7) — DEFERRED by product decision (19 Sep 2026)

Deferred at the product owner's direction during Phase 0. No baseline numbers were captured and none are claimed. Method for the team: with the stack running, record Logical Search results and core p95/error rate under representative concurrency (k6 or equivalent against login/navigation/conversation endpoints) **before** enabling `SEMANTIC_MODEL_RUNTIME_ENABLED`. The Phase 10 guardrail (core p95 within 10% of baseline) is defined against this missing baseline — capture it before Phase 3 heavy execution or Phase 10 certification, whichever comes first.

---

## 7. Phase 0 code deliverables

| Task | Delivered | Files |
|---|---|---|
| P0.8 Feature flags | `runtimeEnabled`, `runtimeWritesEnabled`, `contextSearchEnabled`, `llmFallbackEnabled` (all default `false`; schema rejects writes-enabled-without-runtime at boot) + spec | `YellowStorm/back/src/config/semantic-model.config.ts`, `config.schema.ts`, `semantic-model.config.spec.ts` (new; 3 tests pass) |
| P0.9 CI guard | `semantic-r1-guard` job: fails if the change set touches a `Yellowstorm-vectorstore/` path (path-anchored so `yellowstorm-adk/src/routers/vectorstores.py` does not trip it) or adds any line referencing `SEMANTIC_MODEL_NATIVE_SEARCH_URL` / `SEMANTIC_SEARCH_URL` outside `.github`/`docs` | `.github/workflows/ci.yml` |
| P0.6 Contracts + fixtures | v1 JSON Schemas (`asset-ref`, `discovery-profile`, `evidence-envelope`) and the five captured scenario fixtures (XLSX, CSV, indexed document, unindexed document, cross-Workspace selection) | `YellowStorm/semantic-model-runtime/contracts/v1/`, `YellowStorm/semantic-model-runtime/tests/contracts/fixtures/` |
| Runtime configuration seeds (20 Sep 2026) | `SEMANTIC_INDEX_DATABASE_URL` (read-only `semantic_model_reader_app` against `logicalsearch`) and `SEMANTIC_BROKER_URL` (dedicated local RabbitMQ, AMQP 5672 + management UI 15672, verified reachable) stored in the gitignored `YellowStorm/back/.env`. Broker decision resolved: **RabbitMQ, dedicated instance**; the Postgres outbox remains the job source of truth so broker restarts lose nothing (plan P2.6) | `YellowStorm/back/.env` (untracked) |

Rollout state: every new flag defaults to `false`, and nothing reads them yet — merging Phase 0 is behavior-neutral for the running product.

---

## 8. Decisions resolved / still open

**Resolved by inspection (bind later phases):**
- `tenantId` ≡ workspace-scoped authorization (single-tenant deployment); contexts bind user + workspace list, not a tenant header.
- `assetVersionId` provenance ladder: verified fingerprint > hash or upload/index correlation (`partial`) > semantic observation only (`unknown`) — matches `asset-ref.schema.json` and plan P4 verification strategy steps 1–3, using the existing `indexingTaskId`/`lastIndexedAt` correlation where available.
- Legacy-writer fencing inventory (plan P6.21): the writers to fence are the 5 s index worker, the clone rebuild path, the validate-route enqueue, and graph-viewer/Inspector index triggers (§3 rows C, D, E, J).
- Retired-service retirement order (plan §9B): runtime absorbs `/v1/graphs/index` **and** the fused-search handoff at `agent.service.ts:908` before `SEMANTIC_SEARCH_URL` dies.

**Still open (blockers for their phases, not for Phase 0 closure):**
1. ~~Provision the read-only role~~ — **resolved 20 Sep 2026** (`semantic_model_reader` + `semantic_model_reader_app`, verified; §5.3). Remaining follow-up: rotate the generated password into the deployment secret store before non-local use.
2. ~~Baseline p95/error capture (P0.7)~~ — **explicitly deferred by product decision (19 Sep 2026)**; must be captured before Phase 3 heavy execution or Phase 10 certification, whichever comes first.
3. ~~Broker choice for the semantic runtime~~ — **resolved 20 Sep 2026**: dedicated RabbitMQ instance (local for development; AMQP 5672, management UI 15672), Celery broker URL in `SEMANTIC_BROKER_URL` (gitignored `.env`). No other workload's broker is shared; deployment hardening (dedicated host/replicas, `password123` → rotated credentials) required before shared/production use.
4. Whether asset versioning will be added to the workspace module (R2 candidate) or fingerprinting stays runtime-owned (R1 assumption). The MCP/DB probe (§5.1–5.2) confirms nothing in the vectorstore tracks versions, so R1 fingerprinting stays runtime-owned unless this changes.

**Reviewer notes carried into later phases (from the Phase 0 gate):**
- The CI guard freezes every *added* line referencing the retired URL env vars — existing occurrences (e.g. `agent.service.ts:908`, `config.schema.ts`, `semantic-model.config.ts`) may be removed but never re-added without amending the guard. Consistent with §3 row I.
- Phase 2 contract-test harness must register sibling schemas (`addSchema`) and use `ajv-formats` (or `strict: false`) when compiling `discovery-profile.schema.json`; fixtures are scenario wrappers — validate sub-objects (e.g. `expectedResolution.assetRef`) against the matching schema, not the whole wrapper.
