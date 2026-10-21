# semantic-model-runtime

One FastAPI application with separate datasource, population and graph-search Celery worker
processes. PostgreSQL is the durable source of truth; RabbitMQ carries task
references only.

## Phase 2.4 setup

Apply runtime-owned migrations from the required environment:

```powershell
conda run -n meta python scripts/migrate.py
conda run -n meta python scripts/migrate-curated.py
```

Required secret configuration:

- `SEMANTIC_RUNTIME_DATABASE_URL`: semantic PostgreSQL connection for the
  runtime API role. Do not use the logicalsearch reader or a superuser.
- `SEMANTIC_AGEGRAPH_DATABASE_URL`: dedicated Apache AGE connection used only
  for immutable revision projections. The runtime sets
  `search_path = ag_catalog, "$user", public` on every pooled connection.
  The deployed AGE 1.6 service permits graph DDL and Cypher for the application
  role without explicit `LOAD 'age'`; startup/route execution fails closed if
  that server capability is unavailable.

Only `age:v1:pop_*` projection references represent a live, count-validated
graph. Migration `009` invalidates older compile-only references and bindings;
the affected revisions must be projected again before activation.
- `SEMANTIC_RUNTIME_SERVICE_KEY`: private NestJS-to-runtime service key.
- `SEMANTIC_BROKER_URL`: dedicated Phase 0 RabbitMQ URL.
- `YELLOWSTORM_BACKEND_URL`: trusted NestJS origin used by datasource workers.
- `SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN`: dedicated `semantic-runtime`
  credential matching the NestJS verifier, sent only to the configured backend
  origin. No `YELLOWSTORM_INTERNAL_SERVICE_TOKEN`/generic-key fallback exists.
- `YELLOWSTORM_BACKEND_API_PREFIX`: NestJS global API prefix (default `api`).

Workspace asset access additionally requires the backend-signed canonical job
admission and the current claim's private opaque lease proof. A machine key plus
an arbitrary actor/job ID is insufficient. The backend rechecks current rights,
document version and live job/task state for every operation and refresh; a
reclaimed/expired/cancelled attempt cannot reuse its old proof. Keep these proofs
out of logs, model inputs and public job payloads. Source events receive separate
per-sheet candidates; omitted `uploadedAt` uses the backend's UTC millisecond
timestamp format. See the [semantic asset authority contract](../../docs/security/semantic-asset-grant-contract.md)
for replay, dataset/derived storage isolation, evidence and rollout gaps. Deploy
the backend and runtime API/workers together; legacy queued asset jobs without a
valid signed admission fail closed and require authorized resubmission rather
than reconstructing authority from stored actor selectors.

## Autonomous AI extraction

The runtime API and population workers call LiteLLM directly. Extraction prompts,
response validation and configuration live in `app/datasource/attribute_extraction.py`
and `extraction_prompt.py`; document/cell/derived readers retain grounding and typed
value validation. No ADK package, backend inference proxy or agent-library lookup
is needed. Backend credentials above are still used for workspace datasource access.

Set the same extraction configuration on the API and population workers:

| Variable | Purpose / default |
| --- | --- |
| `SEMANTIC_AI_BASE_URL` | Required LiteLLM origin, optionally ending in `/v1` |
| `SEMANTIC_AI_API_KEY` | Required service-specific LiteLLM key; never returned in API/profile/job data |
| `SEMANTIC_AI_MODEL` | Required configured LiteLLM model alias; callers cannot override it |
| `SEMANTIC_AI_MAX_TOKENS` | Response token cap, default `32000` (1–128000) |
| `SEMANTIC_AI_TIMEOUT_SECONDS` | Total inference deadline including capacity waits/backoff, default `240` (1–600) |
| `SEMANTIC_AI_PARALLEL_CALLS` | Maximum inference requests in flight per process/event loop, default `8` (1–64) |

These are independent of `SEMANTIC_EMBEDDING_*` settings. The gateway model must
support OpenAI-compatible chat completions and JSON-object responses.

- `GET /v1/semantic-model-population/ai-extraction/profile` returns the non-secret
  runtime identity: profile, model, contract version, prompt version and token cap.
- `POST /v1/semantic-model-population/ai-extraction/extract` accepts bounded supplied
  evidence and concept attributes for standalone inference, including multiple
  records. It needs no backend assets or database. It returns extraction candidates
  with only supplied evidence references. Preview and population accept the generated
  values after field/type/choice and supplied-citation checks, without requiring literal
  text matches. A citation indicates model-attributed evidence, not independent fact
  verification. Existing cleanup/date settings still apply. Document v3 / prompt v2
  partition old cached results; restart the backend and runtime API/population workers
  together so the new prompt profile is accepted and matches worker execution.
- Both routes use the existing `X-Semantic-Service-Key` authentication and command
  body limit. Missing/invalid extraction configuration returns 503; incompatible
  or changed bound identities return 409 with a rebuild-required code.

Population admission binds the runtime profile when an AI request has no identity
and no precomputed execution fingerprint. Backend-coordinated requests obtain it
from the profile route before fingerprinting. Workers validate it before fetching
sources or reusing extraction caches. Model, token-cap and prompt/contract changes
invalidate AI execution/cache identity; timeout/concurrency changes do not.

Deploy the backend, runtime API and population workers together. Legacy queued
`agentSlug` extraction identities are explicitly rejected: resubmit/rebuild those
runs under the runtime profile. Existing stored revisions and historical cache
entries are preserved; v2 identities cannot reuse v1 extraction results. Rollback
requires a coordinated backend/runtime/worker rollback and compatible job inputs.

Focused verification (from this directory):
`conda run -n meta python -m pytest tests/test_attribute_extraction_client.py tests/test_semantic_ai_runtime.py tests/test_document_population.py tests/test_cell_fields.py tests/test_derived_fields.py -q`.

See [ADR-0015](../../docs/agent-context/decisions/ADR-0015-runtime-owned-semantic-ai-extraction.md)
for the approved ownership decision.

The per-revision tables (`semantic_population.entities`, `entity_identities`, `assertions`,
`assertion_candidates`, `relationships`, and the graph search `entity_documents`, `entity_passages`)
are LIST-partitioned (migration `031`): the store creates a revision's or a search generation's
partitions with it (`app/persistence/partitions.py`) and a purge, a model delete or a generation prune
drops them. Code that inserts rows for a new revision outside the store must call
`ensure_revision_partitions` first. The runtime's database role must own these tables.

Graph search (`/v1/semantic-model-search`, migration `022`, plan in
`docs/graph-search-plan.md`) needs pgvector >= 0.7 and pg_trgm in the runtime
database and an embedding profile; without one, search answers exact keys only:

- `SEMANTIC_EMBEDDING_BASE_URL`: OpenAI-compatible LiteLLM origin (no `/v1`).
- `SEMANTIC_EMBEDDING_API_KEY`: a LiteLLM key for this service.
- `SEMANTIC_EMBEDDING_MODEL`: deployment-configured LiteLLM embedding alias.
- `SEMANTIC_EMBEDDING_DIMENSION`: optional compatibility assertion, not a storage-size
  setting. Omit it or set exactly `3072`. Storage/profile width is fixed at 3072; any
  conflicting value fails with `embedding_dimension_unsupported` before profile creation
  or build admission. Provider responses must match exactly; dimension is part of fingerprints.
- Optional: `SEMANTIC_EMBEDDING_TIMEOUT_SECONDS` (30),
  `SEMANTIC_EMBEDDING_BATCH_SIZE` (32), `SEMANTIC_SEARCH_MIN_SIMILARITY` (0.4).

Migration `038_graph_search_embedding_3072.sql` upgrades the historical 2560-wide
document/passage parents, all attached partitions and embedding cache to fixed `halfvec(3072)`.
Stop runtime API/search workers and other writers, then run from this directory:
`conda run -n meta python scripts/migrate.py` with `SEMANTIC_RUNTIME_DATABASE_URL` set.
The existing runner atomically applies the SQL and checksum; do not edit old migrations.
User-approved disposable search data is cleared: only `semantic_graph_search.entity_documents`,
`entity_passages` and `embedding_cache` (including their partition rows) are truncated,
without CASCADE. Old index generations become failed (`embedding_storage_changed`), with
leases released, so no cleared generation remains READY or eligible as a search fallback.
Population/generated records, mappings, workspace files and population `active_bindings`
are untouched. Those bindings serve data revisions, not search index generations; there
is no separate search current-pointer table to clear. Existing embedding indexes are rebuilt
at the new width, including explicit old-width expression casts. Complete attached index
trees are recreated and reattached bottom-up (replaying a parent `ON ONLY` alone would
leave an invalid index); standalone index names/options/predicates remain intact.
No mixed-dimension storage,
profile routing, vector truncation/padding or automatic rebuild is introduced.

After migration/restart, request fresh indexes through `POST /v1/semantic-model-search/indexes`.
Semantic search needs rebuilt indexes; source/generated data need not be repopulated.
Provider compatibility remains a separate rollout gate: a provider returning 4096 by default
and HTTP 400 for explicit 3072 is not compatible. Responses must contain exactly 3072 finite,
nonzero values; mismatches fail closed, without truncation/padding. Do not claim runtime
compatibility until the provider is corrected. `halfvec` HNSW supports up to 4000 dimensions
(pgvector >= 0.7). A post-commit rollback requires coordinated storage migration/rebuild,
not an environment-only change; the discarded old search vectors are not recoverable from this DB.

Focused migration regression (destructive **only to disposable test schemas**):
`conda run -n meta pytest tests/test_graph_search_embedding_migration.py -q -o pythonpath=.`.
The DB case requires both `SEMANTIC_RUNTIME_TEST_DATABASE_URL` and explicit
`SEMANTIC_RUNTIME_TEST_ALLOW_SCHEMA_RESET=1`; otherwise only the static case runs.

Indexes are built by a third worker on queue `semantic-model-search.index`
(`scripts/start-workers.ps1 -Only search`); a draft build and a publish request
one automatically, and `POST /v1/semantic-model-search/indexes` backfills a
model that was populated before.

Semantic record search and relationship reads return existing source provenance.
Each source reference retains its `workspaceId` and compatible `assetId`, exposes
`documentId` as the corresponding document handle, and includes `filename` when
the source provides `originalName` (including workspace/tabular sources). Derived and merged records carry the deduplicated
references of their source records. `query_records` includes the same provenance
on each returned record; grouped aggregate results have no record rows. MCP
document connectors should use only declared tool arguments: map `workspaceId` to
a declared workspace scope, `filename` to `file_name` when accepted, and
`documentId` to `document_id` only when accepted (`assetId` remains an alias). If
legacy provenance omits `filename`, resolve it with
`list_workspace_files(source_workspace_id=workspaceId)` and match the returned file.
`AssetRef` itself remains unchanged.

AGE record vertices also expose `source_documents` as an array of objects with
`workspaceId`, `documentId` (the source asset ID), and `filename` when present in
provenance. Derived concepts inherit their original document references; multiple
mappings of the same workspace/document are deduplicated. Business fields cannot
overwrite this metadata. Manual records have an empty array. Existing graphs must
be rebuilt (a new data revision or forced re-projection) to acquire the property;
legacy provenance without filenames still supports ID-based lookup.

Direct Cypher can read the array or individual locator fields:

```cypher
MATCH (n)
RETURN n.record_id, n.source_documents,
       n.source_documents[0].workspaceId,
       n.source_documents[0].documentId,
       n.source_documents[0].filename
```

Document locators provide no access grant: use the existing `workspace_ids`
visibility scope and acting-user authorization when retrieving document content.

Feature switches default off:

- `SEMANTIC_MODEL_RUNTIME_WRITES_ENABLED=true` permits durable admission.
- `SEMANTIC_JOB_DISPATCHER_ENABLED=true` permits outbox-to-RabbitMQ dispatch.
  Leave this off until the datasource/population task implementations replace
  the Phase 2A stubs.

## Failure diagnostics in status panels

Datasource, population and search workers capture bounded, sanitized diagnostics
at exception boundaries before reducing an error to a stable code. Existing
task checkpoint/job progress JSON preserves the **first failure** through later
progress updates, retries, recovery exhaustion and terminal completion. No schema
migration is required. Job status exposes optional `errorDetails`; search status
exposes it inside `index`, joined through the selected generation's exact
job/model/revision. Existing actor/model authorization and public codes remain
unchanged.

The error projection contains exception type, safe summary, time, available
phase/attempt and job/task/index IDs, database SQLSTATE or upstream HTTP status,
up to eight source locations and three cause summaries. These are authenticated
diagnostic metadata, not raw HTTP stack traces: no source lines, local variables,
SQL/parameters, credentials, response bodies, prompts or document text are
returned. Public reads revalidate the allowlisted shape after JSON round-trip.
The owning implementation is `app/jobs/error_details.py`.

The editor's **Search index** status button remains available after an index
fails, including after reload. Failed population, index, expanded run-history and
My jobs entries expose **Failure details → Technical details** in EN/FR/AR.
Cancelled runs retain their stopped treatment. Deploy/restart the runtime API
and all worker roles together to enable capture and readback; updating only the
frontend cannot restore information discarded by an older worker.

Historical exhausted search generations fall back to their saved outbox error
identifier and correlation IDs, explicitly marked as legacy. Missing exception
messages/source locations are not reconstructed or invented. Regression coverage
is in `test_error_details.py`, `test_runtime_error_status.py` and the repository
retry/exhaustion integration cases, all included by `scripts/run_p0_gate.py`.

## Retry and lease recovery

The failed search-index panel offers **Retry search indexing** independently of
population. It uses the existing `/v1/semantic-model-search/indexes` command with
optional `expectedDataRevisionId` and `expectedIndexId` expectations. A changed
active revision or effective embedding/index identity rejects the request before
retry admission; the editor explains the conflict and offers a status refresh.
Existing callers without expectations keep their normal index-admission behavior.
Owner/editor authorization remains at the backend boundary.

Recovery keeps the populated revision and reuses compatible committed index
batches and cached vectors. It never rereads population sources. The panel guards
duplicate submissions, follows the admitted attempt's progress, and retains the
previous failure details while mounted; this panel-local view does not survive
reload. Historical job diagnostics remain stored independently. A changed profile
that yields a missing index is not silently treated as a retry of the old index.
Instead, the status panel offers **Build search index** for a populated current
revision. This explicit command carries the expected data revision, without an
index ID, and creates the index for the current configuration from stored records.
Loading, unavailable and missing states keep the status entry reachable; unreadable
status exposes refresh and blocks build/retry commands until status recovers.

All three worker families renew task ownership independently through
`TaskLeaseGuard`. Its private renewal loop serializes PostgreSQL queries,
reconnects and connection shutdown; an explicit ownership assertion must complete
a real fenced DB check. Timed-out checks do not authorize effects, and a lost or
stopped attempt cannot restart. Common task windows are
`SEMANTIC_TASK_LEASE_SECONDS` (default 180) and
`SEMANTIC_TASK_LEASE_RENEW_SECONDS` (default 20, clamped to at most one third
of the lease). These are configuration defaults, not measured takeover SLAs.

Search retains a separate **progress-based generation lease** and stall watchdog.
A healthy task heartbeat does not refresh that generation lease. Search mutations
lock task then generation then batch/cache rows, checking current ownership and
PostgreSQL wall-clock expiry inside the transaction. Standalone index builds use
generation ownership fencing. A retry may reconcile an already-ready generation;
only a current task can fail an abandoned generation on retry exhaustion.

Broker delivery is only a hint; PostgreSQL stays authoritative. Under Celery
5.3.6 a failed task is rejected with `requeue=False`, so a bare raise would
discard the delivery; the worker therefore retries through Celery's retry path,
bounded by `SEMANTIC_TASK_MAX_ATTEMPTS`. Independently, the dispatcher runs
`recover_stalled_tasks` every iteration, covering the two ways a delivery is
lost without a worker finishing:

- **Expired running lease** — a worker claimed the task and then died. Bounded
  by the task attempt count, which only real claims increment, so queue latency
  can never exhaust a task no worker attempted. Past the cap the task and job
  are fenced to `failed` with `attempts_exhausted`.
- **Published but never claimed** — the worker failed before claiming, or the
  broker dropped the delivery. Past `SEMANTIC_DISPATCH_GRACE_SECONDS` it is
  republished with capped backoff and is never marked failed, so a healthy but
  backlogged queue cannot terminate a job.

No operator action is required after a worker or broker death.

A concept refresh first reads the current draft revision to retain the other
concepts and rerun derived sources against their existing records. These bulk
carry-over queries have a bounded 120-second client/server timeout per query,
scoped to one transaction. Job-control queries keep their 10-second timeout;
the normal server timeout is restored automatically when the transaction ends.

- `SEMANTIC_TASK_MAX_ATTEMPTS` (default 3) bounds worker redelivery and the
  expired-lease cap.
- `SEMANTIC_TASK_RETRY_SECONDS` (default 30) delays the retry and is the base
  of the republish backoff (capped at 600 s). A requeued task's grace clock
  starts at `now() + retry_seconds`, so recovery can never republish ahead of
  an already-scheduled retry regardless of how grace and retry compare.
- `SEMANTIC_DISPATCH_GRACE_SECONDS` (default 60) is how long a published
  dispatch may stay unclaimed before it counts as lost, so normal
  publish -> claim latency never triggers a spurious republish.

Datasource discovery requires the canonical top-level `workspaceId` at
admission (`DiscoveryCommand`); it is never inferred from the payload, and
ready tabular assets are authorized at execution time by the identity-bound
NestJS stream. Other cross-workspace source kinds remain fail-closed until
their execution adapters are wired.

Recovery uses `FOR UPDATE SKIP LOCKED`, so multiple API replicas and dispatcher
instances never recover the same task twice. Migration `002` adds the partial
indexes these two recovery queries rely on.

The migration owns only `semantic_jobs`. It creates jobs, tasks, dispatch
outbox, and durable replay events. It does not create PostgREST schemas,
Realtime tables, publications, replication slots, triggers, or CDC.

## Transaction boundaries

- Admission: job + initial task + dispatch outbox + `job.queued` event.
- Claim: task lease epoch + job running state + `task.started` event.
- Checkpoint: fenced task checkpoint + job progress.
- Requeue: fenced task back to `queued` (outbox row stays published).
- Recovery: fenced task/job terminal state, or outbox row reset to unpublished.
- Completion: fenced task + terminal job state + terminal event.
- Population activation: task → job → short per-model cutover advisory lock →
  current specification/correction checks → binding CAS → task/job terminal event,
  in one commit. Ownership is checked against PostgreSQL wall time after lock
  waits and again at the terminal update; expiry rolls back the binding too.

Correction INSERTs, selected-specification writes and binding-changing flows
share `semantic:model:cutover:{model_id}` as a short transaction advisory mutex.
This complements the existing long population staging/finalization lock; it is
not held while parsing or projecting candidate graphs. Corrections retain their
existing optimistic API sequence precheck: already accepted concurrent requests
may both insert. Different models have independent cutover mutexes.

Idempotency is scoped by `(actor_user_id, idempotency_key)`. Reusing a key with
a different canonical command hash returns `409`.

## Rollback

The P0 concurrency changes require no migration or destructive schema rollback.
Before rollout record the deployed image digest and migration version. Stop new
admissions, drain writes and let owned work finish or expire before changing
worker versions. Reconcile durable task leases and the outbox before restoring
the previously validated version/topology; do not mix incompatible ownership
implementations on the same queues or manually mark unfinished work completed.
Failed/rejected cutovers leave existing bindings and immutable sources unchanged.

## P0 verification and release gate

Use an isolated disposable PostgreSQL instance with pgvector >= 0.7 and pg_trgm.
The following command deliberately runs schema-resetting fixtures; it accepts only
the loopback database `semantic_p0_test` with explicit disposable opt-in:

```powershell
$env:SEMANTIC_P0_DISPOSABLE = '1'
$env:SEMANTIC_RUNTIME_TEST_DATABASE_URL = '<disposable-local-test-DSN>/semantic_p0_test'
$env:SEMANTIC_RUNTIME_GUARD_TEST_DATABASE_URL = $env:SEMANTIC_RUNTIME_TEST_DATABASE_URL
conda run -n meta python scripts/run_p0_gate.py
```

The runner binds all included runtime/test connections to that validated target,
does not load deployment `.env`, fails on missing prerequisites or any skipped
test, and writes JUnit plus revision/source-digest evidence under
`qa-artifacts/semantic-runtime-p0/` at the repository root. CI runs the same gate
in `.github/workflows/semantic-runtime-p0.yml` using repository requirements.
The local/CI database gate does not establish live broker/provider/AGE chaos
behavior. See the [invariant checklist and M1–M10 staging evidence](../../docs/agent-context/testing/semantic-runtime-p0-release-gate.md).
Production multi-worker scale-out remains gated on that complete evidence.
