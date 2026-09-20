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

The migration owns only `semantic_jobs`. It creates jobs, tasks, dispatch
outbox, and durable replay events. It does not create PostgREST schemas,
Realtime tables, publications, replication slots, triggers, or CDC.

## Transaction boundaries

- Admission: job + initial task + dispatch outbox + `job.queued` event.
- Claim: task lease epoch + job running state + `task.started` event.
- Checkpoint: fenced task checkpoint + job progress.
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
