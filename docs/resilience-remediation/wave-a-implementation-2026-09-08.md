# Resilience Wave A+B implementation — status 2026-09-08

Branch: `agara-worky-006`, base `137b81f19ab9d0b21262989481c814f08d26c46c` (uncommitted working tree).
Scope reference: `yellowmind_resilience_implementation_plan_no_conversation_v2.md`.
Conversation V2 protected paths: **untouched** (verified by git status/diff); `conversationV2StreamService.reconnectWithNewToken()` preserved in the shared API client.

## Deployment decision recorded (user, 2026-09-08)

The deployment runs standalone MongoDB (no replica set). Consequence: multi-document rotation transactions are unavailable, and the rotation path automatically falls back to **ordered single-document rotation** after the first unsupported-transaction error (then skips the doomed transaction path entirely). Guarantees kept: one successor per predecessor (unique sparse index on `rotatedFromSessionId`), predecessor invalidated before successor creation, receipt/conflict/reuse policies unchanged. Residual risk: a crash between the two writes dead-ends the old refresh token (user signs in again) — it cannot duplicate sessions or weaken reuse detection.

## Wave B additions (implemented and unit-tested)

| Package | What was done | Verification |
|---|---|---|
| WP06.3 durable run state | `conversation.messages` gains additive execution columns (`execution_status`, `execution_attempt_id`, `execution_owner_replica_id`, `execution_started_at`, `last_progress_at`, `execution_terminal_at`, `interruption_reason`) + lease-expiry index. The stream lease remains the sole ownership authority; the lease token doubles as the execution attempt id. Lifecycle written transactionally with claim/renew/complete/fail/release; release without terminal marks `cancelled`. Migration `drizzle/0010_conversation_execution_state.sql` (hand-written, additive-only, `IF NOT EXISTS`). | Build + store coverage via module suites |
| WP06.5 recovery coordinator | New `ConversationRecoveryService` (registered in `ConversationModule`): single-flight pass every 30s (config `CONVERSATION_RECOVERY_*`), grace 60s, bounded batch 100. Settles expired-lease streaming attempts as `interrupted` via atomic conditional update (never `completed`; two replicas race to one write), broadcasts a `stream_error` convergence event to conversation members, and reclaims expired fleet admission rows. The old 30-minute sweeper is now lease-based (`COALESCE(lease_expiry, updated_at) < cutoff`) so a healthy long-running run is never swept. | `conversation-recovery.service.spec.ts` 4 tests |
| WP07 fleet admission | New shared `conversation.conversation_executions` table (migration `drizzle/0011_conversation_executions.sql`): partial unique index `(conversation_id) WHERE status='running'` enforces same-conversation exclusivity across actors AND replicas at the DB level; unique `(message_id)`; per-user/fleet capacity gates in one atomic `INSERT .. SELECT`. `PostgresConversationExecutionStore` degrades safely when the table is missing (migration not yet applied) instead of breaking streams. Wired into `StreamService`: admission after the durable lease claim (capacity → 429, conflict → 409), heartbeat extends row expiry and observes cross-replica stop requests (owner settles via its normal stop terminal), `finally` finalizes the row from the message's durable state, remote stop records `cancel_requested_at`. Recovery worker reclaims expired rows. Config: `CONVERSATION_FLEET_ADMISSION_ENABLED` (default true), `CONVERSATION_FLEET_MAX_ACTIVE_RUNS` (50), per-user cap stays `CONVERSATION_MAX_CONCURRENT_STREAMS` (5). | `stream.service.cleanup.spec.ts` (+3 admission tests), recovery suite; 538 tests across conversation+auth+postgres pass |
| WP08 shared replay | **Deferred with rationale.** The frontend already converges correctly after `stream_resync_required` by refetching canonical state via REST, which works across replicas today; the durable delta event log would improve efficiency for long streams and background reconciliation but was not half-implemented. Foundation present: durable message execution state + recovery settlement + interrupted convergence events. | n/a (documented deferral) |
| WP09-lite | New env keys Joi-validated (`CONVERSATION_RECOVERY_*`, `CONVERSATION_FLEET_*`, `AUTH_ROTATION_RECEIPT_*`); effective scopes documented here. Full metrics/fleet connection budget remains future work. | config schema compiles; app boots against validated env |

## Wave A (unchanged from previous pass)

| Package | Finding | What was done | Verification |
|---|---|---|---|
| WP01 auth classification | F01 | `isSessionValid` throws typed 503 `AUTH_DEPENDENCY_UNAVAILABLE` (ERR_1130) on transient Mongo errors (`utils/session-store-errors.ts` classifier); unexpected errors rethrown, never mapped to revocation. JWT-verify catch narrowed in 4 SSE guards (conversation, notifications, playbook-flow, legacy playbook) so dependency failures propagate as 503. | `auth.service.session-validation.spec.ts` 9 tests; auth module 96 tests pass |
| WP02 frontend auth recovery | F02 | `lib/api/authRecovery.ts`: recovery state machine, transient-vs-definitive classifier, auth generation counter, foreground recovery probe loop. `AuthContext` bootstrap preserves credentials on transient failure (`isAuthTemporarilyUnavailable` + `retryRecovery()`); logout bumps generation. | `authRecovery.test.ts` + `AuthContext.test.tsx`; frontend lib+auth 129 tests pass |
| WP03 rotation | F03 | Transactional rotation with receipt + `X-Refresh-Attempt-Id`, conflict 409 ERR_1131, reuse policy preserved; standalone-Mongo ordered fallback per deployment decision above. Frontend Web Locks + BroadcastChannel coordination, persisted attempt id, budget renews on any HTTP response, probe exempt. | `auth.service.rotation.spec.ts` 9 tests; `client.refreshBudget.test.ts` 2 tests |
| WP04 stream lifecycle | F04 | Terminal coordinator from admission, stop-during-bootstrap blocks dispatch, non-fatal durable cleanup, ownership flag for local maps, conversation-level cross-actor exclusivity (now also durable via WP07 admission). | `stream.service.cleanup.spec.ts` 7 tests; `stream.service.spec.ts` 28 tests |
| WP05 ADK supervision | F06 | `GrpcSupervisor` (transient retry w/ capped backoff, fatal re-raise, true readiness, prompt shutdown); `server.py` on_ready + fatal protobuf; `/health/live` + `/health/ready`. | `tests/grpc_supervisor_test.py` 9 pass (conda meta) |
| WP06.1 DB recovery | F07/F09 | Single-flight PG probe chain, pool handler attached once, statement_timeout-leak client discard, non-secret episode diagnostics. | `postgres-connection.service.spec.ts` 16 tests |

## Migrations to deploy (in order)

1. `0010_conversation_execution_state.sql` — additive message execution columns + lease-expiry index.
2. `0011_conversation_executions.sql` — shared admission table + partial unique indexes.

Both are additive and safe to run before or after the app rollout; the app degrades gracefully if 0011 is missing (fleet admission disabled with a one-time ERROR log at boot). **Migrations were applied to the poc `agentstore` database on 2026-09-09 and verified** (columns, table, indexes, and the previously failing query shapes all confirmed working). Deploy-order rule: code that selects the new columns requires 0010 — run `db:migrate` before or with the rollout, otherwise message listing returns 500s.

Operational note: `drizzle-kit migrate` fails silently (exit 1, no error text) on the now()-in-index-predicate class of mistakes; the fix was found via `drizzle-orm/node-postgres/migrator`, which reports the real error. Also, `drizzle-kit migrate` only sees `.env` if the environment is loaded — prefer the app's own dotenv-loaded runtime or export the POSTGRES_* vars first. The recovery worker additionally latches a missing-recovery-schema error (42703/42P01) to a single actionable ERROR log instead of repeating every 30s.

## New configuration (all Joi-validated)

- `CONVERSATION_RECOVERY_ENABLED` (true) / `CONVERSATION_RECOVERY_INTERVAL_MS` (30000) / `CONVERSATION_RECOVERY_GRACE_MS` (60000)
- `CONVERSATION_FLEET_ADMISSION_ENABLED` (true) / `CONVERSATION_FLEET_MAX_ACTIVE_RUNS` (50) / `CONVERSATION_FLEET_MAX_QUEUED_PER_USER` (5, reserved) / `CONVERSATION_FLEET_QUEUE_WAIT_MS` (60000, reserved)
- `AUTH_ROTATION_RECEIPT_KEY` (optional) / `AUTH_ROTATION_RECEIPT_KEY_ID` / `AUTH_ROTATION_RECEIPT_WINDOW_SECONDS`
- ADK: `GRPC_STARTUP_READY_TIMEOUT_SECONDS` (10)
- Error codes mirrored backend/frontend: ERR_1130, ERR_1131 (EN/FR locales).

## Review gate

- Wave A round 1: FAIL — 2 majors fixed (refresh burst-budget lockout; ERR_1131 misclassification) plus minors. Round 2: **PASS**.
- Wave B round 1: FAIL — 1 major (a concurrent racer hitting the standalone claimed-but-unattached rotation window could invalidate the whole token family, killing a successor another request already received) plus 2 minors. Fixed with a time-bounded fresh-claim grace (30s): inside it, a correct predecessor credential yields retryable 409 AUTH_ROTATION_CONFLICT — never family invalidation; a stale (>30s) claimed-but-unattached rotation is treated as dead and follows the reuse policy (re-login), avoiding an endless-409 livelock after a mid-rotation crash. Minors fixed: recovery broadcast awaited; missing-admission-table (42P01) now probed at startup and logged at ERROR with an actionable message. Round 2: **PASS**, no findings; the reviewer traced the two-tabs race end-to-end and confirmed it is closed with no livelock.

## Verification actually run

- Backend: `npx jest` conversation+auth+postgres = 540/540 pass (after the round-3 fix specs; 12 auth suites, 64 conversation/postgres suites); `npx tsc --noEmit` clean for all touched files; `npm run build` succeeds.
- Frontend (Wave A, unchanged in Wave B): `tsc --noEmit` clean; vitest lib+auth 129 pass; `npm run build` succeeds.
- ADK: `conda run -n meta python -m pytest tests/grpc_supervisor_test.py` 9/9 pass; import check passes.

## Pre-existing failures (baseline, not caused by this change)

`agent.repository.spec.ts`, `platform-copilot-identity.migration.spec.ts`, `agent.service.spec.ts`, `semantic-graph-command.service.spec.ts`, `semantic-model-native-search-client.service.spec.ts` — constructor-arity mismatches in untouched spec files. Recorded per plan §1.2.

## Remaining work (future passes)

- WP08 full durable delta event log + efficient cross-replica replay (current resync path is correct but heavier).
- WP07 queue table with fair user-dispatch (current pass enforces caps + conflict rejection; overflow returns retryable 429 rather than queuing). `CONVERSATION_FLEET_MAX_QUEUED_PER_USER` / `CONVERSATION_FLEET_QUEUE_WAIT_MS` are provisioned in config for that pass.
- WP06.4 terminal journal on object storage (no journal: interrupted — never false completion).
- WP09 full metrics + fleet connection budget; WP10 fault/load evidence (requires staging topology with real services).
- Maintenance note: `drizzle/meta` snapshots are stale (only 0000/0005 exist); migrations 0006+ are hand-written by convention. Do NOT run `drizzle-kit generate` until snapshots are reconciled — it will re-emit a dangerous diff (app_data recreation, live index drops).
- If a Mongo replica set is adopted later, the transactional rotation path takes over automatically on the next process start (the standalone fallback latch is in-memory only).

