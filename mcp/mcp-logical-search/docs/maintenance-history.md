# Maintenance history

> Historical script commands below may refer to retired investigations. Use
> [current maintenance scripts](../scripts/README.md) for supported commands.

These dated reports are preserved together for traceability. They describe the
implementation and database at the time of each audit; they are not the current
API or configuration specification. Some recommendations are open, and some
have already been implemented. In particular, embedding caches were removed on
2026-10-07, and historical cache measurements do not describe current searches.

For current behavior, use [architecture and functions](logical-search.md) and
[operations](operations.md). Original report contents are retained below rather
than discarded during documentation consolidation.

- [Production readiness roadmap](#production-readiness-roadmap)
- [Database column audit](#database-column-audit)
- [Search preparation validation](#search-performance-validation)
- [Search review implementation](#search-review-implementation)
- [Query translation comparison](#query-translation-comparison)
- [Receiving agent context cost](#receiving-agent-context-cost)
- [Navigation implementation notes](#navigation-implementation-notes)

<a id="production-readiness-roadmap"></a>

## Smart Navigation MCP: production-readiness implementation plan

Created: 2026-10-05  
Audit baseline: `69a69f02f3c717707b912eedfdc7caa943c7cd40`  
Status: citation fixes implemented; MCP entitlement source pending

### Implementation update — 2026-10-05

The current change preserves search/ranking, embeddings, and indexing. Per the
requested scope, standalone HTTP endpoints continue to accept their existing
body/file scopes without `Workspace-Id` verification. Keep their compatibility
tests; the original P0.1 proposals below to change that behavior are deferred.
These endpoints remain trusted-service capabilities, not tenant-isolated APIs.

Citation lookup now rejects ambiguous block aliases, scopes text positions to
the owning document, and requires submitted evidence to match stored text
(case and whitespace differences are allowed). Image evidence must match the
stored description or OCR. Unsupported items are omitted using the existing
response contract; claim entailment and source-version provenance remain open.

The shared bearer-key comparison is hardened. Independent MCP workspace
authorization still requires a trusted entitlement source; the current
caller-supplied header does not establish one. No new entitlement model has
been selected or enabled.

Validation: 222 tests passed and 13 PostgreSQL integration tests were skipped
without an isolated test database. Eight new citation regression tests passed;
an additional PostgreSQL regression is present but has not run. Existing
retrieval function bodies are unchanged. Packages below remain open until
their remaining acceptance criteria are met.

This checklist turns the technical audit into reviewable changes. Complete P0
before exposing the service to sensitive enterprise data. Complete P1 before
production approval. P2 and P3 improve performance and maintainability after the
security and correctness contracts are established.

The repository implements retrieval and citation services. The calling agent,
indexing pipeline, identity provider, and deployment infrastructure have separate
responsibilities; tasks involving those systems need an explicit owner.

### How to use this plan

- [ ] Assign an owner to each work package.
- [ ] Create one issue or pull request per work package where practical.
- [ ] Add regression tests for each confirmed defect before fixing it.
- [ ] Record validation results and any remaining deployment dependencies in the PR.
- [ ] Mark a package complete only when its acceptance criteria pass.

Recommended sequence:

1. P0.1 authorization and P0.4 build/log containment.
2. P0.2 canonical citation identity, then P0.3 citation evidence validation.
3. P1.1 shared execution controls, then P1.2 bounded retrieval work.
4. P1.3 database contract and P1.4 source-version provenance.
5. P1.5 observability and P1.6 receiving-agent safeguards.
6. P1.7 end-to-end evaluation and the production release gate.
7. P2 optimizations supported by measurements, then P3 cleanup.

The audit ran 226 tests: 214 passed and 12 PostgreSQL integration tests were
skipped because no isolated test database was configured. Synthetic probes
reproduced authorization and citation defects. Live database permissions,
deployed indexes, gateway policy, and receiving-agent behavior remain unverified.

### P0 — Must fix immediately

#### P0.1 — Establish real authorization across every entry point

**Problem:** The shared bearer key authenticates a caller, but the caller supplies
the workspace entitlement through `Workspace-Id`. Several HTTP endpoints also
bypass the MCP scope check. `/search_documents` searches matching filenames
without a workspace restriction.

**Primary files:**

- [router.py](../src/mcp_server/router.py): `APIKeyAuthMiddleware`, HTTP handlers.
- [logical_indexing_server.py](../src/mcp_server/logical_indexing_server.py):
  `_get_effective_workspace_ids`, `_require_search_scope`,
  `search_documents_grouped`, `search_native`, MCP tools/resources.
- [db_helpers.py](../src/mcp_server/db_helpers.py): `_apply_document_filters`.
- [test_document_resume_endpoint.py](../tests/test_document_resume_endpoint.py).
- [test_multi_file_read_tools.py](../tests/test_multi_file_read_tools.py).

**Steps:**

- [ ] Define the trusted caller identity and entitlement source. Use the existing
  identity system, a server-side entitlement lookup, or a verified signed service
  assertion. A caller-controlled header alone is insufficient.
- [ ] Define whether access is workspace-wide or also requires document/user ACLs.
- [ ] Treat requested workspace/file values only as narrowing filters.
- [ ] Create one authorization path that resolves permitted scope and rejects
  requests outside it before database access or model calls.
- [ ] Apply that path to all MCP tools and resources and to `/search_documents`,
  `/search_native`, `/search_native/batch`, `/summarize`, and `/routing-profile`.
- [ ] Remove the unscoped `workspace_ids = None` behavior from ordinary document
  search. If cross-workspace service search is required, give it explicit
  privileged entitlement and a distinct policy.
- [ ] Ensure the gateway strips untrusted identity headers if it supplies trusted
  identity assertions. Verify direct access to the service cannot bypass policy.
- [ ] Replace tests that expect mismatched body/header scopes to succeed with tests
  for the new authorization contract.

**Acceptance criteria:**

- [ ] A principal authorized only for workspace A cannot retrieve workspace B by
  changing a header, body, filename, section ID, block ID, image ID, or resource URI.
- [ ] All items in a batch are checked; one unauthorized item cannot bypass policy.
- [ ] Missing/invalid identity fails closed with a consistent error contract.
- [ ] Rejected requests make no retrieval or model calls and emit an audit event.
- [ ] Legitimate authorized multi-workspace requests still work.

#### P0.2 — Fix cross-document citation identity collisions

**Problem:** Parser block aliases such as `p1_b1` can recur across documents.
Citation position lookup groups by that alias without preserving document identity.
The audit reproduced a numeric block ID from document A resolving to evidence in B.

**Primary files:**

- [db_helpers.py](../src/mcp_server/db_helpers.py): `_get_block_metadata_batch`,
  `_get_candidate_text_positions_batch`, `_locate_single_citation`.
- [models.py](../src/db/models.py): block and text-position identity contracts.
- [logical_indexing_server.py](../src/mcp_server/logical_indexing_server.py):
  citation input/output contracts.

**Steps:**

- [ ] Add a fixture with two documents sharing a parser alias and containing
  different evidence. Verify citing A cannot return B.
- [ ] Resolve citation targets to canonical internal block IDs first.
- [ ] Match position rows using the owning document and parser alias together.
- [ ] Reject ambiguous external aliases; require canonical IDs or an explicitly
  namespaced external-ID contract.
- [ ] Prevent collisions between numeric internal IDs and numeric external aliases.
- [ ] Preserve canonical document, block/image, and section identity in output.
- [ ] Apply the same identity rules to readers that accept external aliases.

**Acceptance criteria:**

- [ ] Standard and Mistral paths reject ambiguous aliases consistently.
- [ ] A citation never changes its resolved document during position matching.
- [ ] Tests cover repeated aliases, numeric alias collisions, missing positions,
  and multiple authorized workspaces.
- [ ] At least one isolated PostgreSQL test exercises the actual joins.

#### P0.3 — Separate source location from evidence validation

**Problem:** The Mistral path can echo invented evidence as a highlight. The image
path returns a whole-image reference even when text matching fails. Standard text
matching also permits fuzzy matches without exposing match quality to the caller.

**Primary files:**

- [db_helpers.py](../src/mcp_server/db_helpers.py): `_block_bbox_citation_result`,
  `_image_citation_result`, `_match_words`, citation result builders.
- [logical_indexing_server.py](../src/mcp_server/logical_indexing_server.py):
  both citation tools and their schemas/descriptions.
- [Agent skills](../skills/): citation handling instructions.

**Steps:**

- [ ] Add a regression where stored text says `The limit is 10.` and the submitted
  evidence says `The limit is 999.`; it must not be verified.
- [ ] Require exact or explicitly documented normalized correspondence for text
  evidence, including the Mistral path.
- [ ] Return actual matched source text, never unchecked caller text as a match.
- [ ] Expose match status, match method, and location granularity.
- [ ] Distinguish a whole-image location from verified textual evidence.
- [ ] Define conservative behavior for fuzzy OCR matches, especially changes in
  numbers, negation, dates, units, and entity names.
- [ ] Return per-item failures for unmatched evidence rather than silently making
  all returned references appear equally verified.
- [ ] Update the receiving-agent contract to use verified matches appropriately
  and report unsupported claims. Citation matching does not prove entailment.

**Acceptance criteria:**

- [ ] Invented numbers, changed negation, and unrelated evidence are rejected.
- [ ] Valid OCR normalization cases remain supported and identifiable.
- [ ] Image-location fallback is explicitly unverified as textual support.
- [ ] Tests cover missing words/bboxes, partial matches, duplicate references,
  and mixed valid/invalid citation batches.

#### P0.4 — Contain build artifacts and sensitive logging

**Problem:** `COPY . .` includes local logs because `.dockerignore` does not exclude
them. Diagnostic artifacts can contain query parameters and corpus excerpts.

**Primary files:**

- [Dockerfile](../Dockerfile) and [.dockerignore](../.dockerignore).
- [file_request_logging.py](../src/logger/file_request_logging.py).
- [session.py](../src/db/session.py): SQL parameter/error logging.
- [query_translation.py](../src/modules/query_translation.py): query-variant logging.

**Steps:**

- [ ] Use an explicit build allowlist or exclude logs, diagnostics, local caches,
  and other non-runtime artifacts while preserving required model provisioning.
- [ ] Build a test image with harmless marker files under excluded paths and verify
  they are absent from the image filesystem and layers.
- [ ] Inspect existing distributed images for diagnostic data. Decide remediation
  and credential rotation from actual exposure evidence.
- [ ] Remove full query variants from ordinary INFO logs.
- [ ] Define default redaction for evidence, highlights, query parameters, filenames,
  source URLs, and credentials. Truncation is not redaction.
- [ ] Keep content-bearing debug logs opt-in, access-controlled, and time-limited.

**Acceptance criteria:**

- [ ] Images contain no local logs, credentials, or corpus diagnostic artifacts.
- [ ] Default logs preserve diagnostic IDs and timings without sensitive payloads.
- [ ] Redaction tests cover nested payloads and exception paths.

### P1 — Before production

#### P1.1 — Apply shared execution controls to every handler

**Primary files:** [logical_indexing_server.py](../src/mcp_server/logical_indexing_server.py),
[document_resume.py](../src/modules/document_resume.py),
[session.py](../src/db/session.py),
[model_requests.py](../src/modules/model_requests.py),
[operations.py](../src/modules/operations.py).

**Steps:**

- [ ] Convert synchronous MCP resource handlers into async wrappers using
  `run_sync_db`; installed FastMCP calls the current synchronous handlers directly.
- [ ] Give citation, strategy, summary, resource, and routing-profile requests an
  overall deadline that includes admission, database work, and model work.
- [ ] Route routing-profile database work through shared database admission.
- [ ] Replace per-request-only model limits with shared model admission, retaining
  a smaller per-request limit if it is useful for fairness.
- [ ] Close routing-profile clients reliably on success, failure, and cancellation.
- [ ] Include all admitted work in shutdown draining.
- [ ] Add bounded admission/overload responses and per-principal quotas where needed.
- [ ] Return structured degraded-mode information when retrieval falls back.

**Acceptance criteria:**

- [ ] A slow resource read does not block an unrelated lightweight request.
- [ ] Concurrent routing-profile calls cannot exceed the configured shared limit.
- [ ] Cancellation retains worker capacity until the underlying work finishes.
- [ ] Every public operation has a bounded total wait and predictable error result.
- [ ] Shutdown closes resources only after tracked work drains or the documented
  process termination policy takes effect.

#### P1.2 — Bound retrieval work before materialization

**Primary files:** [db_helpers.py](../src/mcp_server/db_helpers.py),
[context_navigation.py](../src/mcp_server/context_navigation.py),
[logical_indexing_server.py](../src/mcp_server/logical_indexing_server.py).

**Steps:**

- [ ] Add large-document fixtures and measure rows fetched, bytes loaded, peak
  memory, and elapsed time for each read/expansion path.
- [ ] Replace full-subtree loading on every continuation with bounded, versioned
  incremental retrieval. Preserve explicit completeness and omission semantics.
- [ ] Bound native-search output and expose a continuation or explicit truncation.
- [ ] Avoid loading the entire section batch before applying the delivery budget.
- [ ] Paginate or remove redundant full-document resources.
- [ ] Limit citation text length, total input bytes, candidate positions, and work.
- [ ] Define request-body and scalar-string limits consistently across transports.
- [ ] Preserve exact Unicode reconstruction and source order.

**Acceptance criteria:**

- [ ] Small responses cannot require unbounded corpus content in memory.
- [ ] Continuation cost is related to the next page rather than the entire subtree.
- [ ] Large images/blocks produce actionable continuation or omission results.
- [ ] Load tests demonstrate bounded memory and predictable overload behavior.

#### P1.3 — Verify the database and deployment contract

**Owners:** MCP service, indexing service, database/platform team.

**Primary files:** [session.py](../src/db/session.py),
[settings.py](../src/config/settings.py), [router.py](../src/mcp_server/router.py),
[database ownership documentation](logical-search.md#database-ownership),
[retired runtime investigation](../scripts/README.md#retired-investigations).

**Steps:**

- [ ] Verify the runtime role has only required read permissions; keep migration
  privileges separate. Consider read-only transactions as defense in depth.
- [ ] Verify TLS/certificate policy for PostgreSQL and the model gateway.
- [ ] Document and test any gateway, network, and document ACL enforcement.
- [ ] Verify required extensions, indexes, tokenizer fields, schema version, and
  consistency between document and child-row workspace IDs.
- [ ] Verify actual query plans and partition/index behavior on representative data.
- [ ] Add bounded schema/dependency compatibility checks at startup or readiness.
- [ ] Validate query/index embedding model, dimensions, preprocessing, and gateway
  wire behavior. Do not infer compatibility from dimensions alone.
- [ ] Validate missing configuration domains, including RRF parameters and limits.
- [ ] Remove or clearly deprecate unused settings; document effective limits.
- [ ] Keep one replica until streaming/session routing is tested behind the intended
  load balancer. Validate multi-replica behavior before enabling it.

**Acceptance criteria:**

- [ ] Runtime credentials cannot mutate corpus data or schema.
- [ ] Incompatible schema/model configuration is detected before serving searches.
- [ ] Invalid settings such as `HYBRID_RRF_K=-1` fail at startup.
- [ ] Deployment evidence records the actual security and database controls.

#### P1.4 — Preserve canonical identity and source versions

**Dependencies:** P0.1, P0.2, P0.3; indexing-team coordination.

**Steps:**

- [ ] Define canonical document, section, block, and image IDs in the public contract.
- [ ] Reject ambiguous filename resolution instead of choosing `.first()` or the
  first workspace match. Allow explicit document selection where needed.
- [ ] Add or consume a source/index version that changes on reindexing.
- [ ] Carry source version and exact evidence identity through search, reads, and
  citation results.
- [ ] Reject stale continuations or return an explicit restart requirement.
- [ ] Bind citations to evidence returned in the request using an evidence ledger
  or verifiable receipt appropriate to the receiving application.
- [ ] Preserve source identity in final citation output for auditing.

**Acceptance criteria:**

- [ ] Same-named documents are distinguishable and cannot be silently substituted.
- [ ] Reindexing between retrieval and citation cannot silently change provenance.
- [ ] A final cited passage can be traced to a specific returned source/version.

#### P1.5 — Add end-to-end observability without content leakage

**Primary files:** [file_request_logging.py](../src/logger/file_request_logging.py),
[setup_logging.py](../src/logger/setup_logging.py), [session.py](../src/db/session.py),
model-call modules, and the receiving-agent integration.

**Steps:**

- [ ] Propagate request/session IDs across HTTP, MCP, database, and model calls.
- [ ] Record principal, authorization decision, tool, source IDs, outcome, and timing
  without putting sensitive source text in default logs.
- [ ] Distinguish success, partial/degraded results, validation errors, timeouts,
  cancellation, and returned error dictionaries.
- [ ] Record provider-reported token usage and model identity for every model call.
- [ ] Export admission wait, active work, saturation, dropped logs, fallback count,
  timeout count, and request latency metrics.
- [ ] Keep security audit events independently of sampled diagnostic logging.
- [ ] Add alerts and a short incident runbook for DB/model failure and overload.

**Acceptance criteria:**

- [ ] An operator can reconstruct one answer's tool sequence, evidence IDs,
  citations, errors, latency, and usage through a common request identifier.
- [ ] Saturation and dropped diagnostics are visible.
- [ ] Default logs pass the P0.4 redaction checks.

#### P1.6 — Define and test receiving-agent safeguards

**Owners:** Agent application and MCP service maintainers.

**Primary files:** [Agent skills](../skills/) and the external agent runner.

**Steps:**

- [ ] Enforce total step, wall-clock, and spending budgets in the agent runner.
- [ ] Preserve immutable authorization scope across reformulation and follow-ups.
- [ ] Track repeated queries/sections and stop cycles with an explicit unresolved
  evidence result rather than endlessly retrying.
- [ ] Maintain a claim-to-evidence ledger, including missing/conflicting evidence.
- [ ] Treat all retrieved text, filenames, and metadata as untrusted data.
- [ ] Test poisoned documents that request broader search, forged evidence markers,
  or disclosure of other documents.
- [ ] Verify citation ordering and handling of rejected/unverified citations in code
  where practical; do not rely exclusively on skill instructions.
- [ ] Compare lighter and stronger models using identical tasks and tool contracts.

**Acceptance criteria:**

- [ ] Malicious retrieved text cannot widen permissions or exceed runner budgets.
- [ ] Repeated tool failures and empty results terminate predictably.
- [ ] Every material document-specific claim is supported or explicitly unverified.
- [ ] Smaller-model suitability is supported by measured results.

#### P1.7 — Establish evidence-aware evaluation and a release gate

**Primary files:** [tests](../tests/), [measurement script](../scripts/measure_search_review.py),
[CI workflow](../.github/workflows/ci-cd.yml), and a new versioned evaluation dataset.

**Steps:**

- [ ] Run the existing suite against an isolated PostgreSQL/ParadeDB database using
  `TEST_DATABASE_URL`; never point integration tests at a production database.
- [ ] Add citation correctness and cross-transport authorization integration tests.
- [ ] Create a versioned benchmark manifest recording source versions, accepted
  evidence spans, equivalent sources, and expected answer constraints.
- [ ] Include tables, entity/date/unit ambiguity, multilingual queries, duplicates,
  stronger alternate sources, conflicting versions, and unanswerable questions.
- [ ] Include poisoned documents and malformed model/tool outputs.
- [ ] Score answer correctness, evidence correctness/sufficiency, citation fidelity,
  claim coverage, retrieval recall/precision, and navigation efficiency separately.
- [ ] Accept equivalent valid evidence; do not equate a different filename with a
  retrieval failure.
- [ ] Report attempted and successful session costs, failure rates, tool counts,
  p50/p95 latency, and missing usage data.
- [ ] Add sustained concurrency, overload, dependency outage, cancellation, and
  shutdown scenarios using representative corpus sizes.
- [ ] Agree quantitative acceptance thresholds before tuning on benchmark results.

**Acceptance criteria:**

- [ ] Evaluation is reproducible from a code revision and dataset/model manifest.
- [ ] Security/citation regressions block release.
- [ ] Quality and latency thresholds pass on held-out representative tasks.
- [ ] Cost includes failed attempts and retries, with no fabricated token estimates.
- [ ] No production-readiness claim depends only on a synthetic microbenchmark.

### P2 — Optimization

Implement these after P1.7 provides a baseline. Keep changes only when they improve
the intended metric without unacceptable quality or security regressions.

#### P2.1 — Improve candidate recall and source selection

- [ ] Diagnose failures separately at candidate discovery, section selection,
  evidence selection, agent interpretation, and citation stages.
- [ ] Evaluate candidate pool size independently of returned `top_k`; public
  `top_k=1..10` currently produces a minimum pool of 30.
- [ ] Replace implicit filename-based issuer filtering with explicit structured
  scope or measured soft boosts.
- [ ] Add indexed entity, reporting period, units, metric, source authority, and
  table-header context through the indexing owner.
- [ ] Evaluate near-duplicate-aware candidate allocation without suppressing
  independent corroborating or conflicting evidence.
- [ ] Measure multilingual rank fusion and local evidence scoring consistency.
- [ ] Improve global discovery of image-only evidence where corpus demand warrants it.
- [ ] Consider a reranker only after measuring candidate recall and its cost/benefit.

**Done when:** Held-out evidence recall improves, wrong-period/entity/metric matches
decline, and valid alternate sources remain accepted.

#### P2.2 — Reduce database and model round trips

- [ ] Replace repeated whole-workspace metadata materialization and large ID lists
  with measured database-side scoped queries.
- [ ] Compare filename semantics enabled/disabled; its enabled default final weight is 2% (3% text); disabling gives text 5%.
- [ ] Prefer indexed filename vectors or a justified cache over repeated cold
  runtime embeddings. Include model identity and authorization concerns in caching.
- [ ] Cache routing profiles by document/index version or generate them during indexing.
- [ ] Evaluate safe query-embedding/translation caching with explicit retention rules.
- [ ] Parallelize only genuinely independent stages within shared capacity limits.

**Done when:** End-to-end latency and actual model cost improve under representative
concurrency, with unchanged authorization and evidence quality.

#### P2.3 — Reduce receiving-agent context and navigation cost

- [x] Shorten repeated tool-description instructions while retaining clear schemas,
  ID semantics, omission handling, and security boundaries.
- [ ] Measure evidence sufficiency before changing excerpt or byte budgets.
- [ ] Avoid repeated complete reads and expansions through agent-side evidence reuse.
- [ ] Compare model sizes on complete-session success, citation fidelity, latency,
  and cost, including retries.

Initial implementation and eight live mini/Sol sessions are recorded in
[maintenance-history.md#receiving-agent-context-cost](maintenance-history.md#receiving-agent-context-cost). The compact
policy guides evidence reuse for both models; external agent adoption and broader
evaluation remain open. Evidence budgets were preserved. Matched successful
sessions used 42–54% fewer input tokens; latency did not consistently improve.

**Done when:** Cost per successful grounded answer improves; fewer bytes or calls
alone are not sufficient evidence.

### P3 — Developer experience and maintainability

- [ ] Remove confirmed unused search helpers and obsolete configuration settings.
- [ ] Centralize duplicated citation argument validation.
- [ ] Separate retrieval SQL, canonical source resolution, citation matching, and
  response shaping into focused modules without a broad rewrite.
- [ ] Standardize typed success, partial-result, and error envelopes.
- [ ] Replace private framework overrides with supported extension points where available.
- [ ] Update stale Celery, transport, identity, and filename-uniqueness documentation.
- [ ] Make local test setup reproducible and document isolated DB/model stubs.
- [ ] Add an optional inspection view for candidate ranks, omissions, provenance,
  and evaluation judgments.

### Production release gate

- [ ] P0 complete, including negative authorization and citation regression tests.
- [ ] P1 complete, with owners signing off external agent/indexing/platform work.
- [ ] No authorization or citation identity failures in the release evaluation.
- [ ] Database role, TLS, indexes, schema, model compatibility, and network policy verified.
- [ ] Large-corpus quality, sustained-load, outage, and shutdown thresholds passed.
- [ ] Logs/images checked for unintended sensitive data.
- [ ] End-to-end traces and operational alerts demonstrated.
- [ ] Remaining limitations documented for users and operators.
- [ ] Release approval records revision, dataset version, model configuration,
  deployment configuration, and validation results.

### Work log

| Package | Owner | Issue / PR | Validation evidence | Status |
|---|---|---|---|---|
| P0.1 Authorization | | | Existing auth/HTTP compatibility tests pass | Key comparison hardened; MCP entitlement source pending; HTTP scope changes deferred |
| P0.2 Citation identity | | | Unit regressions pass; PostgreSQL regression added but skipped | Citation resolver fixed; remaining acceptance criteria open |
| P0.3 Citation validation | | | Unsupported text/image evidence regressions pass | Source matching fixed; response/provenance enhancements remain open |
| P0.4 Build/log containment | | | | Not started |
| P1.1 Execution controls | | | | Not started |
| P1.2 Bounded work | | | | Not started |
| P1.3 Database/deployment | | | | Not started |
| P1.4 Provenance | | | | Not started |
| P1.5 Observability | | | | Not started |
| P1.6 Agent safeguards | | | | Not started |
| P1.7 Evaluation | | | | Not started |

<a id="database-column-audit"></a>

## Database column and MCP contract audit

Reviewed 2026-10-06 against the current working tree and the configured PostgreSQL database. This is a recommendation: no columns, indexes, triggers, or stored records were changed. Existing working-tree changes were preserved.

Follow-up: after the ingestion project's removal of document `workspace_name`/`title_tsv`, section `bbox`, and image `source`, this service's document `title_tsv` ORM mapping was removed. The other three fields were already absent from its runtime mappings and queries. The inventory below records the original audit snapshot; it does not describe the post-cleanup schema. Section `title_tsv` remains a separate field used by legacy section-search helpers.

### Recommendation

Six columns have no functional consumer in this repository's current MCP tools, resources, or HTTP document endpoints:

| Table | Column | Why it is a removal candidate | Required accompanying work |
|---|---|---|---|
| `logical_text_positions` | `content` | Citation matching builds its text from `words`; authoritative block evidence comes from `logical_blocks.content`. This column is not mapped or read here. | Stop the external ingestion writer from supplying it. |
| `logical_text_positions` | `source` | Citation queries join the owning document and return `logical_documents.source`. This column is not mapped or read here. | Check historical values against the document source before discarding any distinct provenance; update ingestion. |
| `logical_images` | `source` | Image citations join the owning document for source. This column is not mapped or read here. | Check distinct provenance and update ingestion. Its `idx_logical_images_source` index becomes unnecessary. |
| `logical_sections` | `bbox` | Section navigation uses IDs, titles, hierarchy and page numbers. Highlight geometry comes from blocks, images and words. This column is not mapped or read here. | Update ingestion; check whether another application uses section geometry. |
| `logical_documents` | `workspace_name` | Scope and responses use `workspace_id`. No query or response in this repository consumes the display name. | Update ingestion, which currently must satisfy this live `NOT NULL` column. Its `idx_logical_docs_workspace_name` index becomes unnecessary. |
| `logical_documents` | `title_tsv` | Filename scoring uses filename text and `file_name_embedding`. No explicit query uses the stored document title vector; full ORM document loads still select it. | Remove the ORM field and `idx_documents_title_tsv`; rewrite the title-vector trigger while preserving filename-embedding invalidation. |

These are service-local candidates, not a claim that every other database client ignores them. The ingestion implementation is outside this repository, so its insert/update contracts must be checked before executing a migration. PostgreSQL dependency metadata does not establish absence of external consumers or all dynamically referenced function dependencies.

**Keep `created_at`, `updated_at`, and `user_id`**, as requested. All three currently exist on `logical_documents`. Child records retain document-level traceability through `document_id`; no audit fields were proposed for removal.

#### Conditional cleanup

| Table | Column | Current use | Condition for removing it |
|---|---|---|---|
| `logical_blocks` | `content_tsv` | Explicitly used by `hybrid_search_blocks`, `global_hybrid_search_blocks`, and `get_blocks_from_sections`. None has a caller in the inspected repository. Current global search uses ParadeDB BM25; focused section search constructs a vector from title/content at query time. | Retire these legacy helpers and update ingestion; remove `idx_blocks_content_tsv` and `trg_blocks_content_tsv` deliberately. Remove the trigger function only after checking other users. |
| `logical_sections` | `title_tsv` | Explicitly used by `search_sections_fulltext` and `global_search_sections_fulltext`. Neither has a caller in the inspected repository. Current section discovery uses BM25. | Retire both helpers and update ingestion; remove `idx_sections_title_tsv` and `trg_sections_title_tsv` deliberately. Check trigger-function users. |
| `logical_sections` | `position` | Loaded by hierarchy inspection, but current traversal/content order uses page number and primary ID. It is not returned as a meaningful public field or used to order current hierarchy traversal. | Remove the unnecessary hierarchy projection and legacy context-ref support, then verify no ingestion or other reader relies on sibling ordering. Review `idx_logical_sections_doc_position`. |
| `logical_sections` | `level` | Loaded by hierarchy inspection; older level/sibling helpers use it. Current `Hierarchy` traversal derives relationships from parent/ancestor/descendant references. | Retire legacy level/sibling helpers and remove the projection first. Review `idx_logical_sections_doc_parent_level`; do not drop the column while those helpers remain. |
| `logical_documents` | `processing_time_ms` | Returned by `logical://document/{document_id}`. | Remove only if that resource's timing metadata is intentionally retired. It is not unused today. |

The two TSV columns are the next cleanup stage after the six direct candidates. `fts_config` stays: current BM25 field selection and query translation still use it. Removing TSV storage does not make `fts_config` obsolete.

#### Important trigger dependency

The live `trg_documents_title_tsv` calls `update_document_title_tsv()`. That function does two things:

1. Populates `NEW.title_tsv` from `file_name` and `fts_config`.
2. Sets `NEW.file_name_embedding = NULL` when `file_name` changes.

Deleting the trigger outright would lose the second behavior and leave stale filename embeddings. A cleanup migration must replace it with a filename-change trigger that preserves invalidation before dropping `title_tsv`.

### Complete column inventory

The live schema contains **58 columns in five logical tables**. There is no separate logical table-content table: parsed tables are records in `logical_blocks`, distinguished by `block_type` and represented by `content`.

#### `logical_documents` — 14 columns

| Columns | Decision | Use |
|---|---|---|
| `id` | Keep | Canonical document identity and child joins. |
| `file_name`, `workspace_id` | Keep | Request resolution, authorization scope, result grouping. |
| `user_id`, `created_at`, `updated_at` | Keep | Requested traceability; user-filter support and document metadata. Public tool responses deliberately omit `user_id`. |
| `source` | Keep | Citation source and document resource metadata; hidden in ordinary retrieval responses. |
| `total_pages` | Keep | Reading strategy, page metadata, outline/routing endpoints. |
| `overview` | Keep | Document and overview resources; metadata-search helpers. Not used by every MCP tool, but still exposed. |
| `file_name_embedding` | Keep | Semantic filename ranking; absence from responses does not mean unused. |
| `fts_config` | Keep | Language grouping, query variants and BM25 language-specific fields. |
| `workspace_name`, `title_tsv` | Candidate | Reasons above. |
| `processing_time_ms` | Keep unless resource contract changes | Returned by document resource. |

#### `logical_blocks` — 11 columns

| Columns | Decision | Use |
|---|---|---|
| `id` | Keep | Public numeric block identity, search results, citation lookup, source ordering. |
| `document_id`, `workspace_id` | Keep | Document joins, scope and explicit workspace filtering. Workspace is deliberately denormalized for search/partition filtering. |
| `section_id` | Keep | Document-local section key linking blocks with sections and images. |
| `block_id` | Keep | Parser/external alias; citation-to-word-position matching and compatible block resolution. Distinct from numeric `id`. |
| `block_type`, `content` | Keep | Text, headings, parsed tables, image descriptions, search evidence and readers. |
| `embedding` | Keep | Semantic retrieval. |
| `page_number`, `bbox` | Keep | Page grouping, image-to-block matching, citation location and Mistral highlights. |
| `content_tsv` | Conditional candidate | Legacy helpers only; remove those first. |

#### `logical_sections` — 16 columns

| Columns | Decision | Use |
|---|---|---|
| `id` | Keep | Public numeric section identity accepted by tools. |
| `document_id`, `workspace_id` | Keep | Scoped section discovery and workspace filtering. |
| `section_id` | Keep | Local/parser identity linking blocks, images and text positions; distinct from numeric `id`. |
| `title`, `embedding` | Keep | Section lexical/semantic discovery, focused evidence context, headings and navigation. |
| `page_number` | Keep | Stable navigation order and fallback page information. |
| `parent_section_id`, `ancestors`, `descendants` | Keep | Hierarchy traversal, recovery of incomplete parent chains and search navigation. These fields are consumed through raw SQL despite being absent from the ORM model. |
| `previous_section_id`, `next_section_id` | Keep | `expand_context.boundary` navigation. |
| `bbox` | Candidate | No reader here consumes section geometry. |
| `title_tsv`, `position`, `level` | Conditional candidates | Legacy/projection cleanup described above. |

Parent/ancestor/descendant storage can eventually be normalized, but it is not safe to remove arrays just because they look redundant: the current traversal explicitly uses them to restore reachability and incomplete parent chains.

#### `logical_images` — 9 columns

| Columns | Decision | Use |
|---|---|---|
| `id` | Keep | Public `image_id`, reader payload association and standard image citations. |
| `document_id`, `section_id` | Keep | Scoped joins, section readers and image grouping. |
| `image_base64` | Keep | Actual MCP image payloads, image dimensions and image-coordinate conversion. |
| `content` | Keep | Image-only lexical candidates, reader descriptions, image/block deduplication and citation evidence validation. |
| `words` | Keep | OCR evidence validation and word-level image highlights. |
| `page_number`, `bbox` | Keep | Source location, image/block matching and page-coordinate conversion. |
| `source` | Candidate | Standard image citations use document source. |

Image descriptions and searchable image blocks can overlap, but `logical_images.content` cannot simply be dropped: image-only records participate in retrieval and citation validation.

#### `logical_text_positions` — 8 columns

| Columns | Decision | Use |
|---|---|---|
| `id` | Keep | Stable position-record identity, deduplication and deterministic ordering. |
| `document_id` | Keep | Document-scoped citation matching and source join. |
| `section_id` | Keep | Fallback citation-position lookup by document/section/page. |
| `block_id` | Keep | Parser alias matching; scoped by document to avoid alias collisions. |
| `page_number`, `words` | Keep | Exact evidence matching, word coordinates and page highlights. |
| `content`, `source` | Candidates | Block content, words and document source supply the required values. |

The standard citation locator needs text positions. The Mistral locator uses block content and whole-block geometry, which does not make text positions obsolete for the other locator.

### MCP arguments and responses

All nine registered tools were inspected through their Python declarations, published input schemas, argument normalization, helper queries and serialized responses. A normal request exposes eight tools because request headers choose the active citation locator.

Common scope: `workspace_id` is operationally required, accepts one string or a bounded list, and must be authorized by the `Workspace-Id` header. `user_id` is not a public tool argument. Public output omission is not evidence of an unused database column: `_tool_response` hides `user_id` and normally `source`; locators preserve source.

| Tool | Arguments | Response and storage dependencies |
|---|---|---|
| `get_document_strategy` | `workspace_id`, `file_name` (string/list) | Follow-up calls and missing filenames; document filename/workspace/page count. |
| `read_content` | `workspace_id`, `file_name`, nonnegative `block_offset`/`image_offset` | Page-grouped blocks/images, stable IDs, delivery and pagination metadata; document/section metadata, block content and image payloads. Continuation requires one filename. |
| `search` | `query`, `workspace_id`, optional `file_name`, `top_k` 1–10 (default 5), optional `exclude_section_ids` array of positive numeric section IDs, `include_hierarchy` default false | Ranked document/section groups with exact evidence, IDs, scores, omission flags and optional hierarchy. Uses block/section vectors, BM25, filename signals and hierarchy fields; no image bytes. |
| `search_in_sections` | `query`, numeric public `section_id` string/list (up to configured maximum, default 10), `workspace_id`, `top_k` 1–10 (default 3), `include_neighbors` default true | Bounded block/image descriptions and neighboring evidence; section titles, block vectors and lexical title/content ranking. No `file_name`. |
| `read_sections` | `section_id`, `workspace_id`, `include_blocks` default true, offsets, optional `query`, `include_images` default true | Section blocks and descriptions; requested image bytes become separate MCP image items linked by `image_content_index`. Continuation requires one section. No `file_name`. |
| `read_blocks` | `block_id` string/list, `workspace_id`, nonnegative `content_offset` | Exact selected block text or errors, with truncation/continuation flags when necessary. Resolves numeric IDs and unambiguous external aliases. Continuation requires one block. |
| `expand_context` | `section_id`, `workspace_id`, `include_content` default true, nonnegative `content_offset`, optional `context_version` | Selected subtree and ancestor content, boundary links, hierarchy issues and completeness/version metadata. Descriptions only; no image bytes. Continued content requires one root and returned version. |
| `locate_answer_citations` | `workspace_id`, native `citations` array | Text targets use `block_id`; image targets use `image_id`. Exact `evidence_text` and positive `reference` required. Returns verified source/page/text/bbox and omits unsupported evidence. Uses block metadata, image description/OCR and text positions. |
| `locate_answer_citations_mistral` | Same top-level shape | Both text and image targets resolve against blocks. Returns verified stored text and whole-block PDF-coordinate bbox. Does not use word-position storage. |

No tool accepts a table-specific argument: parsed tables follow block retrieval and citation contracts.

#### Contract observations

- Published schemas allow omitted operationally required fields because their function defaults are `None`; the tool body returns an argument error when they are missing. Callers must follow the documented required arguments rather than relying solely on the schema's top-level `required` list.
- Citation documentation requires explicit `type`, but normalization can infer it from `block_id`/`image_id`. This is compatibility behavior, not proof that input fields are unused.
- Some readers resolve legacy section keys although their documentation directs callers to public numeric section IDs. Keep the distinction between public and parser identities when cleaning storage.

### Verification and limits

- Read-only live catalog inspection succeeded: 58 columns, indexes, non-internal triggers and column dependencies captured in `logs/database-column-audit.json`. The reusable command is `.venv/Scripts/python.exe -m scripts.audit_database_columns`.
- In-process FastMCP `tool.run` checks exercised argument validation and response serialization for all nine tools against stored live rows. Every call returned with zero explicit tool error fields. Shapes, schemas and counts are saved in `logs/database-tool-audit.json`; corpus text and input identifier values are omitted.
- The representative `read_content` call returned two separate MCP image items; `read_sections` returned one. Search and focused search returned block evidence.
- Search preparation used an existing stored vector and bypassed model-provider calls. Focused section search exercised lexical retrieval. This verifies local tool/database paths, not network transport or embedding/translation providers.
- The standard locator omitted the sampled text citation and returned a verified image citation. The Mistral locator returned the sampled text citation. The smoke test does not establish complete word-position coverage for all stored documents.
- The sampled context response contained a hierarchy issue. A returned response without an `error` field does not mean `context_complete=true`; callers still need to inspect hierarchy/completeness flags. This audit did not repair corpus hierarchy.
- `.venv/Scripts/python.exe -m unittest discover -s tests -q`: **249 tests run, 236 passed, 13 skipped**. Skipped integration tests require a separately configured isolated database; no write-based integration tests were pointed at the live database.
- Representative calls and source tracing are not exhaustive verification of every record, query, continuation branch, client or external ingestion writer.

Live table sizes, including indexes and TOAST, at audit time:

| Table | Estimated live rows | Total bytes |
|---|---:|---:|
| `logical_documents` | 575 | 11,100,160 |
| `logical_blocks` | 408,740 | 6,137,757,696 |
| `logical_sections` | 118,668 | 1,296,957,440 |
| `logical_images` | 33,813 | 7,805,657,088 |
| `logical_text_positions` | 524,283 | 2,175,270,912 |

These figures are not estimates of removable-column savings. Dropping columns does not immediately reclaim all table-file space.

### Applying cleanup later

1. Confirm and update external ingestion and any other database clients for the six direct candidates.
2. Update ORM mappings and the document filename-invalidation trigger in a coordinated migration. Use explicit dependencies; avoid a broad `CASCADE` deletion.
3. Retire the five unused legacy TSV-query helpers before removing the two additional TSV columns, their GIN indexes and maintenance triggers.
4. Treat hierarchy normalization and timing-resource removal as separate contract changes.
5. Verify inserts/updates, filename changes, both citation locators, table/text/image retrieval, authorization and continuations in an isolated database before deploying the migration.

Additional schema drift: live `document_id` is nullable in blocks, sections and text positions, although their ORM columns declare it non-nullable. Several live hierarchy fields are intentionally read via raw SQL rather than ORM attributes. Review constraints and mappings when building the migration; do not infer unused status from ORM absence.

<a id="search-performance-validation"></a>

## Search preparation optimizations: validation

Note (2026-10-07): query and filename embedding caches have been removed.
Cache descriptions and measurements below describe the earlier implementation.
Current searches compute fresh embeddings on each call.

Date: 2026-10-06

### Implemented

1. Main MCP search and native search prepare the content-query embedding,
   translation variants, and filename semantic scores concurrently after scope
   validation and the scoped document lookup.
2. These paths load document metadata once per request, reusing it for language
   selection, filename scoring, and retrieval. This replaces three metadata
   reads when filename semantics are enabled. The snapshot is not shared between
   requests. Direct helper callers retain their own scoped database lookup.
3. Query embeddings have a bounded workspace-specific cache (256 entries,
   five-minute TTL by default) and concurrent identical calculations are shared.
   Exact query, provider/model identity, credential fingerprint, and embedding
   call purpose are included in the key. Each caller keeps its own wait deadline.
4. Translation requests reuse one connection pool per event loop. Shutdown waits
   for admitted work before closing the translation client and clearing vectors.

Search weights, candidate limits, query text, embedding model/dimensions,
workspace predicates, HTTP header behavior, citation behavior, and indexing
schema are unchanged. No document parsing, chunking, or stored-vector changes
are required. The earlier preparation schedule can change which optional stages
finish before a deadline; dependency timing has always affected fallback results.

### Automated checks

`python -m unittest discover -s tests`: 245 tests, 232 passed, 13 PostgreSQL
fixture tests skipped because no isolated `TEST_DATABASE_URL` was configured.
External dependencies were replaced by mocks or unreachable test settings.

New checks cover overlapping preparation, one metadata load, unchanged candidate
SQL/results for fixed inputs, scope filters, empty scopes, cache hits and expiry,
eviction, disabled caching, model/workspace separation, failure retry, cancellation,
independent caller deadlines, and translation-client reuse/cleanup. Existing
search, fallback, citation, and HTTP scope compatibility checks also pass.

### Step 5: deployed database preflight, before any database changes

Command: `python -m scripts.check_search_database`.
The diagnostic uses read-only transactions and a five-second statement timeout;
it creates no indexes, tables, extensions, or persisted settings and calls no model.

- Inspected PostgreSQL extensions: pgvector 0.8.0 and pg_search 0.18.9.
- Sampled workspace contained 368 documents.
- Required workspace indexes and block/section HNSW and BM25 indexes were present,
  valid, and ready. Candidate plans used HNSW index scans and ParadeDB custom scans.
- Latest warm execution times: section vector 8.548 ms, section lexical 29.494 ms,
  block vector 10.229 ms, block lexical 76.830 ms. Planning added about 4–8 ms each.
- Fixed-candidate replay preserved the candidate SQL, parameters, and complete
  returned results while removing the metadata SELECT from retrieval.
- Repeating the unchanged baseline five times produced two different leading
  section orders. Live baseline/optimized comparisons can therefore differ even
  though replaying the same candidates is identical. Tie ordering or parallel
  candidate execution is a hypothesis; the precise cause has not been isolated.
  This patch does not change ranking tie rules.

The detailed local artifact is `logs/search-database-preflight.json`. These are
single-workspace, stored-vector probes with an original lexical query, not a
production latency percentile benchmark or a retrieval-recall evaluation.
No database optimization was applied: the probe does not justify new indexes.
End-to-end cold/warm and concurrent workload benchmarks remain necessary to
quantify the overall latency benefit of the four code changes.

<a id="search-review-implementation"></a>

## Search review implementation and validation

Implemented against the review of `6bc9847`, preserving existing working-tree
changes to child-section navigation and retrieval guidance.

### Changes

1. Regression fixtures cover response starvation, neighboring exceptions,
   preferred discovered hits, image-only global discovery, single-document
   limits, workspace isolation, overlapping roots, Unicode pagination, and
   updates between discovery and evidence hydration.
2. Discovery passes a request-local text cache with PostgreSQL row transaction
   versions to evidence hydration. Unchanged rows reuse their exact text; changed
   rows return fresh text. Ranking, winner metadata, and citation aliases remain.
   Batch expansion loads each document hierarchy once and each selected section
   payload once, while retaining every root's complete context and continuation.
3. Evidence allocation prioritizes primary hits across sections, then additional
   hits and neighbors, with source order restored for delivery. It preserves
   omission flags and uses fragment byte accounting with a final JSON size check.
   Pagination bounds serialization probes to the next page's maximum possible
   character count. It retains source hashing, exact offsets, and fingerprints.
4. Added retrieval-phase timing and a reproducible CPU/SQL benchmark. The optional
   complete-session usage summarizer uses actual model usage and evaluated answer
   success, reports missing usage, and rejects duplicate session records.
5. Measurements do not justify skipping exact local ranking, changing candidate
   pools, terminating search solely on output size, or replacing the continuation
   protocol. These algorithms remain intact.

Two deliberate selection-policy fixes apply: image-only sections can survive
global title-candidate validation, and the diversity quota no longer restricts a
single scoped document. Image descriptions without matching section-title
candidates still require existing block indexing or local section retrieval.

### Validation

Final command: `python -m unittest discover -s tests -q` with `TEST_DATABASE_URL`
pointing only to a temporary local ParadeDB 0.18.9 / PostgreSQL 17 container.
**209 tests passed, including all 12 PostgreSQL integration tests; none skipped.**
`git diff --check` passed. No production database or model API was used.

Earlier runs exposed two pre-existing intermittent tests: Windows concurrent
model-file replacement and a translation test with a 20 ms wall-clock deadline.
They passed on the final full run; their implementation was left unchanged.

### Measurements

See [machine-readable results](../logs/search-review-measurements.json) and
[reproduction instructions](logical-search.md#navigation-with-direct-evidence).
Thirty warm synthetic samples, medians in milliseconds:

| Operation | Baseline | Updated |
|---|---:|---:|
| Packing ten sections / ninety excerpts | 9.59 | 1.34 |
| First-page serialization of long context | 18.41 | 3.94 |
| SQL retrieval without / with text reuse | 84.03 | 84.58 |

At the 24,000-byte budget, sections receiving their primary hit increased from
2 to 10. The pagination probe returned the same 15,723 source characters.
The SQL probe verified identical selected evidence with and without reuse. Its
latency was effectively unchanged in this small local fixture; it does not
establish a database speedup. Text reuse reduces duplicate result transfer but
adds a row-version check.

These results are not production estimates. Complete-session token savings
remain unmeasured because receiving-agent usage traces were not supplied.
The saved report records `session_measurements: null` rather than estimating
tokens from characters or bytes. Initial full-context loading and hashing are
still present and should be measured on representative large documents before
considering a new continuation design.

<a id="query-translation-comparison"></a>

## Query translation enabled versus disabled

Note (2026-10-07): query and filename embedding caches have been removed.
Cache descriptions and measurements below describe the earlier implementation.
Current searches compute fresh embeddings on each call.

Test date: 2026-10-06. This is a live diagnostic over the configured database and
model gateway, using the current repository implementation. Translation was
disabled temporarily inside the test process; runtime configuration and service
code were not changed.

### Results

Times are median complete search latency for three warm-cache runs per mode.
Evidence counts indicate that a returned excerpt contained the target value and
relevant subject. Supporting passages were manually inspected. These are
retrieval measurements, not generated-answer accuracy scores.

| Question → document language | Translation enabled | Translation disabled | Supporting evidence, enabled / disabled |
|---|---:|---:|---:|
| English → English | 2.42 s | 2.26 s | 3/3 / 2/3 |
| French → English | 4.57 s | 2.29 s | 3/3 / 0/3 |
| French → French | 2.11 s | 1.89 s | 3/3 / 3/3 |
| English → French | 4.06 s | 2.00 s | 3/3 / 3/3 |

Disabling translation saved about 2.28 seconds (50%) for French → English and
2.06 seconds (51%) for English → French in this small sample. The difference
includes translation and the additional lexical query workload, not just LLM
execution time.

No translation LLM was called for either same-language control. Both modes used
identical lexical variants in those controls. Their timing/evidence differences
therefore do not demonstrate a benefit from translation; the current search
already exhibits run-to-run candidate/ranking variability.

### Questions and evidence

The English and French questions about the English corpus were equivalent:

- “How much did 3M spend on capital projects to protect the environment in 2018?”
- “Quel montant 3M a-t-elle investi dans des projets pour protéger l'environnement en 2018 ?”

Reference evidence was inspected before the test: `3M_2018_10K.pdf`, block
`451276`, section `100908`, explicitly states that in 2018 3M spent approximately
$27 million on capital projects related to protecting the environment. The
French query retrieved this passage in every translated warm run and none of
the untranslated warm runs. Retrieving the same filename alone was not counted
as success: some untranslated results included that file without the required
passage.

The French and English questions about the French corpus were equivalent:

- “Quel est le volume annuel total de commandes prévu pour OMNI-RETAIL en 2026-2027 ?”
- “What is the total annual order volume forecast for OMNI-RETAIL in 2026-2027?”

`Previsions_de_Ventes_Omni_Retail.pdf`, section `143263`, blocks `579800` and
`579801`, supports an annual forecast of 1,600,000 orders for 2026–2027. Both
languages and both modes returned supporting evidence in all warm runs. The
English query therefore did not need translation to retrieve this particular
French passage.

The automated evidence screen searched every returned file, rather than
requiring a particular expected filename. Value/topic matching is only a screen;
it does not establish general claim entailment or retrieval recall.

### Model and timing details

- Configured translation model: `gpt-5.6-luna`.
- Configured embedding model: `qwen3-embedding`.
- Translation timeout: 5 seconds; no translation failures occurred.
- Local FastText detection: median 3.08 ms across enabled runs.
- Warm translation-stage medians: 1.62 s for French → English and 1.37 s for
  English → French; same-language stages took about 2–14 ms and made no LLM call.
- Across all cold/warm trials: eight translation API requests, reporting 1,152
  input tokens and 546 output tokens. This excludes embedding API usage. No
  monetary estimate was made.

### Method and limits

Four questions, two modes, one cold-cache trial and three warm-cache trials per
mode produced 32 searches. Mode order alternated between trials. Both modes used
the same question, workspace, `top_k=5`, ranking settings, and original-query
embedding pipeline. File filtering was omitted in both modes. Hierarchy was off.
Disabling translation supplied only the original query for each document
language and skipped translation-stage language detection.

Cold here means query/filename vector caches were cleared; it does not mean a
restarted database or new gateway deployment. The first cold enabled search took
6.67 s, whereas the cold disabled control took 3.41 s; this single ordered pair
includes startup and warming effects and is not a clean translation-overhead
estimate. Warm medians are used above.

PostgreSQL connections were read-only. No corpus data, indexes, schema, or
service settings were modified. The test did not run an answer-generation agent
or citation resolution. It did not measure p95 latency or concurrent traffic.
Three repeats over two underlying facts are insufficient to generalize retrieval
quality to the full corpus.

### Recommendation from this sample

Keep conditional translation for cross-language requests for now. Removing it
globally would save latency but lost the supporting passage in one of the two
cross-language cases tested. Same-language requests already avoid the LLM call.
Broader multilingual evaluation is needed before deciding to disable it or add
an adaptive fallback policy.

Reproduce with:

```powershell
.\.venv\Scripts\python.exe -m scripts.compare_query_translation --repeats 3
```

The test makes real configured model API calls. Detailed queries, variants,
token usage, timings, and retrieved evidence are stored locally in
`logs/query-translation-comparison.json`. Credentials are not written there.

<a id="receiving-agent-context-cost"></a>

## Receiving-agent context and navigation cost

Implemented on 2026-10-06 for both `gpt-5.4-mini` and `gpt-6-sol`.

### What changed

The MCP tool descriptions now explain tool choice, argument shapes, ID meanings,
partial-result handling, scope, and citations without repeating the internal
retrieval pipeline. Parameter schemas and executable tool bodies are unchanged.

The existing [mini policy](../skills/smart-navigation-search-gpt5.4mini.md) is now
a compact policy for either model size. Its filename is retained for integration
compatibility. It instructs agents to start targeted questions with search, use
sufficient evidence immediately, batch selected IDs, reuse already-read evidence,
and navigate again only to close a material gap. Complete procedures and selected
subtrees still require relevant continuation pages and coverage checks. Citation
lookup remains mandatory before a document-grounded final answer.

This changes the receiving model's guidance. It does not change search SQL,
ranking, query translation, embeddings, indexing, workspace/file authorization,
HTTP header behavior, tool result fields, or evidence byte/excerpt budgets.
Navigation decisions remain model-dependent; the MCP does not enforce an agent
step budget. The receiving application must enforce its own budget.

### Static context comparison

Eight active tools, with the same parameter schemas in both catalogues:

| Measure | Before | After | Reduction |
|---|---:|---:|---:|
| Tool-description characters | 27,394 | 8,677 | 68.3% |
| Compact JSON tool-catalogue bytes | 36,923 | 17,663 | 52.2% |
| Policy characters | 5,641 | 3,929 | 30.3% |
| Catalogue plus policy token proxy | 9,098 | 4,606 | 49.4% |

The last row uses `cl100k_base` only as a comparison proxy. It is not the exact
tokenizer of either receiving model. Real provider usage is below.

### Live complete-session comparison

Eight sessions: two models, two questions, original versus compact guidance.
Both arms executed the same current search implementation against read-only
PostgreSQL. Known filenames and authorized workspaces were supplied. Questions
covered a localized financial fact and a French table with a derived percentage.
Source evidence and final answers were manually reviewed alongside automatic
numeric-value and resolved-reference checks.

Input/output totals are provider-reported tokens summed across all model calls;
they include repeated context. Time includes model calls and in-process MCP tool
execution, but excludes an HTTP MCP transport. One run per combination is too
small for latency percentiles or a general model-quality claim.

| Model | Question | Guidance | Input tokens | Output tokens | Calls | Seconds | Grounded success |
|---|---|---|---:|---:|---:|---:|---|
| GPT-5.4-mini | Localized fact | Original | 41,449 | 223 | 2 | 14.19 | Yes |
| GPT-5.4-mini | Localized fact | Compact | 19,055 | 206 | 2 | 12.69 | Yes |
| GPT-5.4-mini | Table + calculation | Original | 35,488 | 668 | 3 | 14.69 | No |
| GPT-5.4-mini | Table + calculation | Compact | 17,714 | 353 | 2 | 13.70 | Yes |
| GPT-6-sol | Localized fact | Original | 32,993 | 178 | 2 | 8.93 | Yes |
| GPT-6-sol | Localized fact | Compact | 17,917 | 173 | 2 | 12.29 | Yes |
| GPT-6-sol | Table + calculation | Original | 30,747 | 315 | 2 | 12.38 | Yes |
| GPT-6-sol | Table + calculation | Compact | 17,899 | 311 | 2 | 15.78 | Yes |

The original mini table session mistyped the workspace ID and made three rejected
calls before reporting that it could not retrieve evidence. It is included as a
failure, not silently retried or excluded. This single event does not establish a
general reliability difference.

Matched successful sessions reduced input tokens by **54.0% for mini**, and
**45.7% / 41.8% for Sol**. All four compact sessions used search then citation
lookup, without extra reads or expansions. Successful original sessions also
used two calls, so this test does not demonstrate a general tool-count reduction.
Original mini requested hierarchy for the localized fact; compact mini did not,
reducing that search response from 36,240 to 14,293 bytes. Retrieval variability
and model choices mean payload differences cannot all be attributed to guidance.

The answers supported $27 million in environmental capital spending, and
1,600,000 annual orders / 500,000 Click & Collect 1h orders / 31.25%, respectively.
Citations resolved to the retrieved source blocks/images. Sol was slower with
compact guidance in this sample: reduced tokens do not guarantee reduced latency.
No monetary cost estimate was made; gateway billing and cached-input rates matter.

### Reproduce and adopt

#### Detailed standalone skills: conservative follow-up

The general [retrieval skill](../skills/smart-navigation-search-skill.md) was
reduced from 29,496 to 24,097 characters (**18.3%**). Repeated entry-point,
workflow, scope, and prohibition paragraphs were consolidated. Seven detailed
sections remain verbatim: general instructions, tool selection, hierarchy
navigation, answer completeness, ID/citation inputs, answer formatting, and
citation protocol. Frontmatter and the full-reading versus search-only workflow
distinction were retained. Each skill remains standalone; agents need not fetch
another policy to understand it. No answer-length, navigation-step, or reading
limit was added to the skill.

Twenty-four additional live sessions covered original policies, preliminary
compactions, and final candidates for both variants and both models. The exact
final general policy's text hash matches its evaluated input. All four final
general sessions supported the expected answers and resolved citations, with
no retrieval after citation lookup:

| Model | Question | Input tokens | Calls | Seconds |
|---|---|---:|---:|---:|
| GPT-5.4-mini | Localized fact | 69,967 | 4 | 21.58 |
| GPT-5.4-mini | Table + calculation | 30,141 | 2 | 12.93 |
| GPT-6-sol | Localized fact | 45,382 | 3 | 16.45 |
| GPT-6-sol | Table + calculation | 30,417 | 2 | 14.23 |

These detailed skills did **not** show consistent end-to-end token or latency
savings: query choices, evidence returned, and follow-up counts varied. Static
instruction reduction is not a complete-session cost guarantee. The earlier
42–54% input-token reductions belong to the mini-named compact-policy experiment,
not this more conservative general-skill change. These two questions do not
establish quality equivalence across every corpus/task; the detailed completeness
and citation requirements were kept rather than relying on this small sample.

The search-only candidate was **rejected and the original file restored**.
One final mini session called search → citation lookup → read_sections → citation
lookup. Its numeric answer was supported, but it violated the terminal-citation
workflow. This observation does not prove shortening caused the failure; it is
sufficient to withhold that candidate under the requested conservative gate.

The harness now checks that no retrieval occurs after the first citation lookup,
in addition to checking that the last call is citation lookup. Earlier raw traces
predate that stricter check: their `success_screen=true` alone does not establish
protocol compliance. The rejection above follows review of the complete sequence.
Local traces are `logs/skill-general-final-sessions.json` and
`logs/skill-search-only-final-sessions.json`; preliminary comparisons use
`logs/skill-*-compaction-sessions.json`. They contain corpus data and are ignored.

[retired receiving-agent investigation](../scripts/README.md#retired-investigations)
uses the configured database and model gateway. It makes billable model requests
and real searches, with read-only DB sessions, provider retries disabled, low
reasoning effort, and bounded session steps. Run from the repository root:

```powershell
.venv\Scripts\python.exe -m scripts.compare_receiving_agent_context --baseline logs/receiving-agent-context-baseline.json
```

Use `--policy skills/smart-navigation-search-skill.md` to evaluate another
standalone policy, with a matching pre-change `--baseline` snapshot. `--arm current`
runs only the candidate arm. Reports record instruction hashes to identify the
exact text evaluated. An original-policy snapshot is still required for schema
compatibility validation even for a candidate-only run.

The pre-change baseline snapshot was captured before editing and is local under
ignored `logs/`; it is not supplied by a fresh checkout. A baseline snapshot must
contain `instructions` and an OpenAI-format `tools` array. The script generates
the current catalogue from registered tools and checks that parameter schemas
match the baseline before comparison. Its default cases require these exact
corpus documents/workspaces; adapt `CASES` for another corpus.

Local full traces are in `logs/receiving-agent-context-sessions.json`. These include
questions, tool arguments, retrieved text, and answers: handle them as corpus data
and do not commit them. The committed report contains aggregate results only.

Restart the MCP server and refresh clients' cached tool catalogues to receive the
new descriptions. Configure the receiving application to use the compact policy;
do not append every extended repository guide to each request. This repository
does not automatically update external agents' system prompts.

Validation: executable AST comparison excluding docstrings, unchanged parameter
schemas, and full unit suite: 245 tests, 232 passed, 13 skipped. An initial Windows
atomic-replacement race in the provisioning test passed in isolation and on the
full rerun. No production deployment or indexing changes were performed.

Before lowering evidence budgets, expand evaluation to ambiguous queries,
cross-document conflicts, long procedures, pagination, failed tools, and injected
documents. Measure supported claims, omissions, complete-session success,
navigation calls, input/output tokens, and repeated-run latency for both models.

<a id="navigation-implementation-notes"></a>

## Navigation implementation notes

- Discovery and exact local ranking retain their scoring formulas and preferred
  discovered hit. Local hydration reuses text already loaded by discovery while
  still fetching authorized winner metadata and image aliases. PostgreSQL row
  transaction versions are checked during hydration; an intervening update
  fetches fresh text instead of reusing the cached version.
- Global discovery accepts a section with blocks **or images**. Image-only
  sections still need a matching section-title candidate; this does not introduce
  a new global image-description search channel.
- The per-document diversity quota applies only when multiple documents are in
  scope. A single scoped document can supply up to `top_k` sections per pass.
- Packing allocates primary hits across sections before secondary hits and
  optional neighbors. Within each section, preferred/local rank determines
  selection; the delivered blocks retain source order. Missing neighbors remain
  omissions, not evidence that no exception exists. Hierarchy navigation metadata
  can be trimmed before dropping evidence; its count and truncation flag remain.
- Expansion reuses each document hierarchy and each selected section payload
  within one authorized batch. Every root still delivers its complete selected
  context, including overlap. Separate calls and continuations reauthorize and
  reload data; there is no cross-request evidence suppression or stale cache.
- Packing counts serialized block fragments once. Pagination probes at most a
  page-sized source slice instead of serializing the entire remaining suffix.
  Full source hashing and initial context loading still occur. Character offsets,
  fingerprints, and exact reconstruction are unchanged.

The measurements do not justify an ANN rewrite, skipping local ranking, stopping
search solely because output is full, or a new continuation protocol. Those
changes are intentionally deferred. No schema migration is needed.

#### Reproduce measurements

```powershell
python -m scripts.measure_search_review --baseline-ref 6bc9847 --repeat 30 --output docs/search-review-measurements.json
```

Add `--database` only with an isolated `TEST_DATABASE_URL` to measure synthetic
SQL retrieval with and without text reuse. This creates and removes a temporary
test schema; it never uses the application `DATABASE_URL`. The SQL probe checks
that both modes return identical evidence. CPU timings are warm synthetic probes,
not production latency estimates. The saved JSON records scope and sample count.
Service logs also include discovery, hierarchy, and evidence-hydration milliseconds.

For actual receiving-agent measurements, add `--sessions path/to/sessions.jsonl`.
Each line must represent one complete session, including all model turns, retries,
and citation calls. Use provider usage counts, not byte-to-token estimates:

```json
{"session_id":"example","success":true,"duration_ms":1800,"model_calls":[{"input_tokens":2100,"cached_input_tokens":1000,"output_tokens":300}],"retrieval_calls":[{"duration_ms":80}]}
```

`success` must reflect evaluated answer correctness, not HTTP success. Cached
input tokens are already included in input tokens; reasoning tokens reported
inside output tokens must not be added again. The summarizer reports missing
usage separately and rejects duplicate sessions. Without supplied session traces,
`session_measurements` remains null; no end-to-end token saving is claimed.
