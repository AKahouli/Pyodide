# Migration inventory — unified logging

Generated during P00 on branch `adk11-migration`, HEAD `35741c2d1b03199eea0923e9bc379a2cd56d1a49`.
The plan document was reviewed against commit `923d5c72`; findings below are re-verified against the actual checkout. In-flight unrelated changes (root delegation work) were present and are preserved.

## Existing logging implementations

### Backend (`YellowStorm/back`, NestJS, CJS)

| Concern | Location | Verified behavior |
|---|---|---|
| Facade | `src/modules/logger/logger.service.ts` | `LoggerService` (TRANSIENT scope) implements Nest `LoggerService`. `log/warn/debug/verbose/error` overloads → `writeLog(level, message, data?, context?)`. Level gate from `app.logLevel` (`LOG_LEVEL`, valid: error/warn/info/debug/verbose). `display` → JSON line to stderr (ERROR) / stdout (others) in production, colored text in dev. `save` + `LOGGING_PERSISTENCE_ENABLED` + `LogBufferService` → DB write. Automatic context: `requestId` from `RequestContextService`. Key sanitization (`password`, `token`, `secret`, `authorization`, `apikey`, …), depth 10, arrays sliced to 100. Legacy `error(message, traceString)` supported. |
| SQL sink | `src/modules/logger/log-buffer.service.ts` | In-memory `BufferedLog[]` (default cap 100, `LOGGING_BUFFER_SIZE`), flush every 60 s (`LOGGING_FLUSH_INTERVAL_MS`) or on overflow via `setImmediate`. Drizzle insert into `ops.logs` (migration 0036) in chunks of 500 rows, `newObjectId()` ids, NUL stripped. While pool unavailable, holds newest 5000. Uses the **application** `DRIZZLE_DB` pool. Failure path: raw `console.error` (3×), `console.log` (2×). Implements read APIs: `findLogs`, `findLogById`, `getDistinctValues`, `getCountsByLevel` (buffer + DB merged). |
| Historic read consumers | `src/modules/authorization/controllers/admin-logs.controller.ts` | list/filter/count/distinct routes under `ADMIN_LOGS_READ`, backed by `LogBufferService`. |
| Config | `src/config/logging.config.ts` | `logging.*`: `buffer.maxSize`, `buffer.flushIntervalMs`, `persistenceEnabled`, `defaultSave`, `defaultDisplay`, `displayOnlyContexts` (startup contexts), `retentionDays` (30, hourly TTL sweep of `ops.logs`). |
| Env schema | `src/config/config.schema.ts` | `LOG_LEVEL`, `LOGGING_BUFFER_SIZE`, `LOGGING_FLUSH_INTERVAL_MS`, `LOGGING_PERSISTENCE_ENABLED`, `LOGGING_DEFAULT_SAVE`, `LOGGING_DEFAULT_DISPLAY`, `LOGGING_DISPLAY_ONLY_CONTEXTS`, `LOGGING_RETENTION_DAYS`. |
| Request context | `src/modules/request-context/request-context.service.ts` | `AsyncLocalStorage<RequestContext>` with `run/getContext/getRequestId/getCorrelationId/getUserId/setUserId/getElapsedTime/getLogOptions`; set by `middleware/request-id.middleware.ts`. |

Call-site scale: `LoggerService` referenced in 364 non-spec files (451 references incl. specs); `logger.` ~1456 occurrences (top: `stream.service.ts` 71, `indexing.service.ts` 34, `worky-electric-consumer.service.ts` 32). Raw `console.log/error` in backend src: 7 hits, of which 6 are inside `log-buffer.service.ts` itself (the sink), 1 in `crypto.service.ts`.

### ADK (`yellowstorm-adk`, Python 3.11 in image / conda `meta` 3.11.14, structlog 25.4.0)

| Concern | Location | Verified behavior |
|---|---|---|
| Bootstrap | `src/logger/setup_logging.py` | `setup_logging(json_logs, log_level, color_logs)` adds a `StreamHandler` with `structlog.stdlib.ProcessorFormatter` to the **root** logger (append; not idempotent by itself), configures structlog with `merge_contextvars`, `ExtraAdder`, ddtrace `tracer_injection` (writes `dd.trace_id`/`dd.span_id`, `"0"` placeholders when no span), optional `rename_event_key` for Datadog JSON. Clears uvicorn handlers; silences `uvicorn.access`; raises noise-loggers to WARNING/CRITICAL. Installs `sys.excepthook`. |
| SQL sink | `src/logger/postgresql_handler.py` | `PostgreSQLHandler(logging.Handler)` with its **own** `psycopg_pool.ConnectionPool` (independent of app DB usage), `queue.Queue()` **unbounded**, filters to INFO/ERROR/CRITICAL only (WARNING and DEBUG silently dropped from persistence), background worker thread, batch insert into `application_logs` (CREATE TABLE IF NOT EXISTS + 7 indexes), worker errors logged via root `logging.error` (recursion risk). `ENABLE_POSTGRESQL_LOGGING` (default **True**) gates it. `close()` joins worker (10 s) and closes pool. |
| Correlation | `src/middleware/correlation.py` | ContextVars `correlation_id_ctx`, `user_ctx`, `user_id_ctx` + `CorrelationIdMiddleware`; imports `opentelemetry.trace` for span annotation (no OTEL SDK installed; only ddtrace). |
| Entry | `main.py` | `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false` set at line 18 **before** ADK imports; multiple logging init paths. |

Call-site scale: ~170 `logging.getLogger|get_logger` sites in `yellowstorm-adk/src`.

### MCP services (`mcp/mcp-agent`, `mcp/mcp-playbook`, `mcp/mcp-semantic-model`)

FastMCP `streamable-http` servers on ports 8026/8025/8027. **Zero logging today**: no `import logging`, no handlers, no log env vars; errors surface only through FastMCP defaults. `mcp-agent/server.py` converts caught `AgentBackendError` into structured tool failure results (`isError`), which are not logged anywhere. Empty stub dirs `mcp-agent/` and `mcp-playbook/` exist at repo root and are NOT the services.

### Code runtime (`yellowstorm-code-runtime`, Node 20, ESM)

No structured logging integration to migrate; hand-rolled Prometheus text `/metrics` (`src/telemetry/metrics.ts`, no prom-client): `run_code_requests_total`, `run_code_success_total`, `run_code_active_executions`, `run_code_queue_depth`, `run_code_failure_total{code}`.

### Other

- `YellowStorm/semantic-model-runtime`: uvicorn app + Celery workers; no Dockerfile, no deploy workflow. Adoption target (P06).
- `yellowstorm-agentic-runtime`: source-less (pycache only) — out of scope.
- Frontend: out of scope this release (no new browser telemetry ingestion).

## Database log writers vs business persistence

| Writer | Table | Classification |
|---|---|---|
| `LogBufferService` (backend) | `ops.logs` | **Operational log writer — to be retired at cutover.** Read path extracted for history. |
| `PostgreSQLHandler` (ADK) | `application_logs` (self-created, no migration) | **Operational log writer — to be replaced.** |
| Conversation/ADK session/audit/usage/workflow checkpoints | various | Business persistence — untouched. |

Retention: backend hourly sweep deletes `ops.logs` older than `LOGGING_RETENTION_DAYS` (default 30).

## Metrics state

Only code-runtime exposes metrics. Backend/ADK/MCP have none. Per plan §8.2, SDK counters will be exposed via each service's existing metrics surface where it exists; a minimal Prometheus profile under `infra/observability/metrics/` covers services without one.

## Baselines (P00)

Representative application baselines (TTFT, stream behavior, request latency) require the running stack and are recorded as NOT_RUN pending a controlled environment; see `implementation-status.md` and `performance-baseline.md`. No production volume claims are made.
