# semantic-model-runtime

One FastAPI application with separate datasource and population Celery worker
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
- `YELLOWSTORM_INTERNAL_SERVICE_TOKEN`: must match NestJS
  `INTERNAL_SERVICE_SECRET`; sent only to the configured backend origin.
- `YELLOWSTORM_BACKEND_API_PREFIX`: NestJS global API prefix (default `api`).

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
  with only supplied evidence references; population readers perform the stronger
  value-to-text grounding before storing records.
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
- `SEMANTIC_EMBEDDING_MODEL`: `qwen3-embedding` (2560 dimensions).
- `SEMANTIC_EMBEDDING_DIMENSION` (2560): the model's vector size. It must equal the
  `halfvec(...)` width of the embedding columns, so changing it means a migration too.
- Optional: `SEMANTIC_EMBEDDING_TIMEOUT_SECONDS` (30),
  `SEMANTIC_EMBEDDING_BATCH_SIZE` (32), `SEMANTIC_SEARCH_MIN_SIMILARITY` (0.4).

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

## Retry and lease recovery

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

Idempotency is scoped by `(actor_user_id, idempotency_key)`. Reusing a key with
a different canonical command hash returns `409`.

## Rollback

Disable writes and dispatch first. The additive schema can then be removed only
after confirming no queued/running jobs are needed:

```sql
DROP SCHEMA semantic_jobs CASCADE;
```

This does not modify `semantic_model`, AGE, logicalsearch, PostgREST, or the
Realtime control database.
