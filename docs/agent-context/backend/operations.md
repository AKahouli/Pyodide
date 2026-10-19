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
