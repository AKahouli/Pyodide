# semantic-model-runtime

One FastAPI application with separate datasource and population Celery worker
processes. PostgreSQL is the durable source of truth; RabbitMQ carries task
references only.

## Phase 2.4 setup

Apply runtime-owned migrations from the required environment:

```powershell
conda run -n meta python scripts/migrate.py
```

Required secret configuration:

- `SEMANTIC_RUNTIME_DATABASE_URL`: semantic PostgreSQL connection for the
  runtime API role. Do not use the logicalsearch reader or a superuser.
- `SEMANTIC_RUNTIME_SERVICE_KEY`: private NestJS-to-runtime service key.
- `SEMANTIC_BROKER_URL`: dedicated Phase 0 RabbitMQ URL.

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
cross-workspace access is authorized at execution time (fail-closed until the
NestJS authorization client is wired).

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
