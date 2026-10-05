# Yellowmind logging contract (v1)

Canonical developer contract for the unified logging platform (Grafana + Loki + Alloy).
Normative files (source of truth) live in [`contracts/observability/`](../../contracts/observability/):

| File | Purpose |
|---|---|
| `log-event.v1.schema.json` | The one JSON envelope, validated rigorously in tests and at collector boundaries — not on every production log call. |
| `log-events.v1.json` | Event registry: `event_name` → default message + permitted attribute names. Register an event here before using it. |
| `budgets.v1.json` | Size/memory/shutdown budgets. Relaxing a value requires a reviewed change. |
| `severity.v1.json` | Level ↔ OTel number mapping, legacy maps (Python `WARNING`→`WARN`, `CRITICAL`→`FATAL`, Nest `verbose`→`TRACE`). |
| `redaction.v1.json` | What is stripped before any output. |
| `fixtures/` | Shared conformance fixtures for both SDKs. |
| `service-registry.json` | Every service, its sink, its adoption status. |

## The rules that matter

1. **Use the SDK.** TypeScript: `packages/observability-ts` (Nest facade preserved). Python: `packages/observability-python` (structlog bridge). No direct Pino/structlog construction, no `console.*`/`print` diagnostics in owned code, no custom sinks. CI enforces this (P08).
2. **A log call never blocks.** No remote I/O, DB lookup, disk write, or awaitable delivery on the caller. Under saturation events are rejected, not buffered without bound; ERROR/FATAL has a reserved capacity but no losslessness promise.
3. **Registered events only.** `logger.error('tool.call.failed', {...})` — the name must exist in `log-events.v1.json`, attributes must be in the event's allowlist. Static default message comes from the registry.
4. **Bounded by construction.** Final event ≤ 8 KiB; attributes ≤ 32 (strings ≤ 512 B, arrays ≤ 16 primitives); error message ≤ 1 KiB; stack ≤ 3 KiB/20 frames; cause depth ≤ 2. Truncation order and preserved fields in `budgets.v1.json`; truncations appear in `truncated_fields`.
5. **Redact before output.** Credentials, tokens, full prompts/responses/documents, raw request objects, SQL parameters, arbitrary object graphs — never emitted. URL queries/userinfo, DSNs, bearer tokens in exception messages are stripped.
6. **Context is captured, not invented.** Identity comes from trusted authenticated context (`request_id`, `user_id`, `username`, `actor_type`). Trace context: valid OTel/W3C ids only — never all-zero placeholders, never a fabricated user. Domain ids (`workspace_id`, `conversation_id`, `run_id`, `job_id`, `agent_id`) only when relevant.
7. **One terminal outcome per owner.** A returned failure envelope, MCP `isError`, fallback, deadline expiry, or abnormal stream end is not success. Log the detailed exception at its owning boundary; upstream outcomes stay concise and correlated.
8. **Stderr is the diagnostic stream.** One JSON object per line, all severities; safe for MCP stdio. No protocol payloads on stdout, no second console handler.
9. **Delivery is best-effort.** Loss can occur at admission, process kill, container buffers, collector retry exhaustion, or Loki rejection. `event_id` + occurrence `timestamp` are preserved end-to-end for diagnosis; never claim exactly-once.
10. **Business persistence is untouched.** Nothing in this contract replaces audit, usage accounting, conversation history, ADK session state, workflow checkpoints, or execution records.

## Configuration (canonical env)

`OBS_SERVICE_NAME`, `OBS_SERVICE_VERSION`, `OBS_ENVIRONMENT` — deployment identity.
`LOG_LEVEL` — severity threshold (existing convention, precedence defined once).
`OBS_LOG_QUEUE_MAX_BYTES` / `OBS_LOG_QUEUE_MAX_EVENTS` — admission budgets.
`OBS_LOG_ERROR_RESERVE_BYTES`, `OBS_LOG_MAX_EVENT_BYTES`, `OBS_LOG_SHUTDOWN_TIMEOUT_MS`.
`OBS_LOG_DEBUG_SCOPE` / `OBS_LOG_DEBUG_EXPIRES_AT` — operator-scoped debug (optional, never public parameters).
`OBS_GRAFANA_BASE_URL` / `OBS_GRAFANA_DASHBOARD_UID` — admin navigation only.

Developers do not choose sinks; collectors own remote delivery; the SDK never sees Loki credentials or endpoints.

## Short agent instructions

- Emit events through the SDK with registry names and allowlisted attributes.
- New event names: add to `log-events.v1.json` first, attribute names to its vocabulary.
- Never log payloads, prompts, or credentials; when unsure, log the id, not the object.
- Failures returned as values must still produce a terminal failure event where the value is handled.
- Tests for changed behavior use the shared fixtures; see `fixtures/README.md`.
