# Scheduling, email, storage, health and request context

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 16. Scheduling

`@Cron()`, `@Interval()`, `@Timeout()` decorators. Rules:
- Log start/end at `debug`, failures at `error`.
- Jobs must be idempotent (app may run as multiple replicas).
- Long-running jobs should short-circuit if a run is already in flight.

## 17. Email

`EmailService` in `src/modules/email/`. Providers: SMTP (`nodemailer`) or Microsoft Graph (`@azure/msal-node`), selected by `EMAIL_PROVIDER`. Retry up to 3 attempts with exponential backoff. Templates: HTML + text, EN and FR. **Never** send email directly from a controller — go through `EmailService`.

## 18. File Storage (S3/Ceph and Legacy Azure Blob)

Presigned direct browser upload via `DocumentService` (`src/modules/document/`):
1. `POST /.../documents/upload-url` → `{ uploadUrl, blobPath }` or equivalent presigned upload payload.
2. Frontend PUTs directly to object storage (S3/Ceph in current deployments; Azure Blob is legacy/dependency drift unless a module explicitly uses it).
3. `POST /.../documents/confirm` finalises.

**Rules:** Never proxy large uploads through NestJS. Validate MIME + size server-side before issuing a presigned URL. Use the narrowest permissions possible, one object key, and a short expiry.

Postgres-backed features (currently `memory-cards`) use `pg`; do not mix Mongo and Postgres in a feature unless ownership, migrations, and backup semantics are documented.

## Workspace indexing progress

The existing indexing webhook persists provider progress in workspace document
metadata and publishes it through owner notification SSE. File listing exposes
the same progress after reload. Workflow status controls success/failure; step
completion or reaching the final number alone never implies success. Schedules
and totals come from the provider, including conversion/deep-research/Mistral
variations. No new table, service, module or runtime is introduced.

Owners: `src/modules/indexing/indexing-webhook.controller.ts`,
`indexing.service.ts`, `interfaces/indexing.interface.ts`, workspace
`pg-workspace-document-write.adapter.ts`, and classifier `classifier-file.service.ts`.
The [indexing README](../../../YellowStorm/back/src/modules/indexing/README.md)
describes the payload and compatibility. Focused webhook tests cover initial zero,
intermediate completion, final failure, workflow success and malformed progress;
classifier tests cover reload projection. The PG adapter integration test covers
concurrent metadata merges and requires a dedicated `POSTGRES_TEST_DB`.

Provider callbacks currently have no ordering cursor; delivery ordering across
attempts is not guaranteed by this change. Provider `WebhookStep` fields are
`step_number/task_name/task_key/task_id`; the receiver normalizes them to the UI
shape and accepts nullable optional fields from Pydantic `model_dump()`. A
provider-shaped regression failed before this correction and passes afterward.
Verified against the sibling vectorstore `src/schema/workers/base.py` and
`src/helpers/index_notification_webhook.py` on 2026-10-21. Two live documents were
confirmed `COMPLETED` by the provider while local status remained `processing`
with empty progress. After rebuilding/restarting the local backend, the real
provider-shaped probe passed validation and reached document lookup (404 for a
deliberately nonexistent ID, previously 400). The two successful attempts were
rechecked and recovered through authenticated legacy terminal callbacks, producing
local `ready` states. Missing historical steps were not reconstructed. Full fresh
provider-to-browser progress qualification remains separate from these checks.

Repeated progress notifications carry `data.silent: true`; the notification
provider suppresses only their popup, preserving live subscribers/history. First
start/failure/success transitions remain visible. Local submission errors and the
one-hour stale-indexing timeout can mark a file failed without a provider failure
callback. Both paths must notify using the patched failed document; reusing the
old processing snapshot caused incorrect SSE status and missing failure popups.
Focused regressions cover both paths and silent progress versus terminal events.
Workspace rows show the stored failure reason even when detailed steps are absent.
Timeout is a local missing-completion result, not provider-confirmed failure.

## 19. Health Checks

| Route | Purpose |
|-------|---------|
| `GET /api/v1/health` | Full check (503 if unhealthy) |
| `GET /api/v1/health/live` | Kubernetes liveness |
| `GET /api/v1/health/ready` | Kubernetes readiness |
| `GET /api/v1/health/history?minutes=60` | Recent results |
| `GET /api/v1/health/stats?minutes=60` | Aggregated stats |

Add a health indicator for each new external dependency.

**Note:** The health module uses a **custom implementation** (not `@nestjs/terminus`, despite the dependency being in `package.json`). It performs direct checks on memory, event loop, database, storage, email, LiteLLM, and gRPC connections. History is persisted in MongoDB for observability (`HealthHistory` schema). Do not migrate to Terminus without a documented rationale — the custom path provides richer per-check history and stats.

## 13. Request Context & Logging

For new or changed instrumentation, the [logging contract](../../observability/logging-contract.md) governs SDK/event usage, redaction and error ownership. The following module descriptions are navigation context, not permission to bypass that contract.

`RequestIdMiddleware` extracts/generates `X-Request-ID`, `X-Correlation-ID`, stores in AsyncLocalStorage. Read via `RequestContextService` — don't thread the request object through the call stack.

`LoggerService` (`src/modules/logger/`, `@Global()`): structured JSON, optional MongoDB sink (buffered, 30-day TTL). Use scoped loggers per class. **Never `console.log`.** Never log secrets, tokens, full user objects, or PII beyond user id.
