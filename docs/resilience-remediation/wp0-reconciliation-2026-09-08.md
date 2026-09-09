# WP0 — Resilience Remediation Baseline: HEAD Reconciliation and Finding Classification

**Branch:** `agara-worky-006`
**Tested commit (current HEAD):** `192536f15b03a0ca72ce260c8dbadf2b886ec296` (2026-09-08 00:11 +0200, "feat: implement widget-chat service and associated UI components with citation support")
**Audited revision:** `70e3403927ea3ffe8e0bed840ecddb4cce9c8ddf`
**Recorded:** 2026-09-07 22:40 UTC
**Method:** Static source review with file:line evidence at HEAD. **No tests, builds, or fault injections have been executed yet.** Per the remediation plan guardrails, source review evidence is not test evidence; each disposition below must still be converted into a regression test against the real implementation (WP0 remainder).

## 1. Reconciliation: audited revision → HEAD

27+ commits advanced the branch (140 files, +4030/−436), dominated by widget-chat/citations, semantic-model search, reasoning-effort selection, and admin conversation-name features. Reconciliation of resilience-relevant paths:

**Changed since the audit (re-verified against live code, not audit claims):**

| File | Relevant findings |
|---|---|
| `YellowStorm/front/src/modules/conversation/store.ts` | REC-01/02/03 (partial rework landed in `70e340392` itself, plus later merges) |
| `YellowStorm/front/src/components/ai-elements/ai-message-content.tsx` | MD-01 (`c010b8399` changed math-parity only; split veto logic pre-dates the audit) |
| `YellowStorm/front/src/modules/conversation/components/ConversationInput.tsx` | NET-01 (unrelated changes) |
| `YellowStorm/back/src/modules/conversation/services/stream.service.ts` | RUN-01 (partially reworked: outer lease finally added), RUN-02, SAVE-01, CAP-01, CTX-01 |
| `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-message-store.ts` | lease SQL, turn persistence |
| `yellowstorm-adk/src/grpc_server/chatbot_servicer.py` | ADK-01 adjacent (servicer only; startup path unchanged) |

**Unchanged since the audit (findings verified still live in unchanged code):** `front/src/lib/api/client.ts`, `front/src/modules/auth/AuthContext.tsx`, `back/src/modules/auth/auth.service.ts`, `back/src/modules/auth/strategies/jwt.strategy.ts`, `back/src/modules/auth/auth.controller.ts`, `back/src/modules/rate-limiter/**`, `back/src/modules/database/**`, `back/src/modules/postgres/postgres-*.ts`, `yellowstorm-adk/main.py`, `yellowstorm-adk/src/grpc_server/server.py`, `yellowstorm-adk/src/flow_engine/runtime/checkpointer.py`, `front/src/modules/conversation/stream.ts`, `front/src/components/ai-elements/code-block.tsx`.

Diff of the whole auth + rate-limiter + api-client surface between `70e340392..HEAD` is 3 files, none behavioral (two 1-line spec edits, `front/src/lib/api/config.ts` +4 lines for unrelated endpoints).

## 2. Classification summary

| ID | Priority | Disposition at HEAD | Key evidence |
|---|---|---|---|
| AUTH-01 | P1 | **STILL PRESENT** | `auth.service.ts:613-623` `catch { return false }`; `jwt.strategy.ts:45-49` DB outage → 401 `AUTH_SESSION_REVOKED`; `client.ts:187-192,213-219` any refresh failure → `clearAuthData()` + redirect; `AuthContext.tsx:48-70` `/me` failure → `clearLocalAuthData()`; no unverified/reconnecting state |
| AUTH-02 | P1 | **STILL PRESENT** | `auth.service.ts:392-393` + `403-412` two non-atomic saves, no txn/CAS; lost-response replay hits family invalidation (`345-356`); no `X-Refresh-Operation-ID` anywhere; tab-local single-flight only (`client.ts:40-46`); cookie maxAge hardcoded 7d (`auth.controller.ts:230-231`) vs `jwt.refreshExpiry` config |
| RUN-01 | P1 | **PARTIALLY ADDRESSED** | Outer finally (`stream.service.ts:860-866`) now releases the Postgres lease + `streamExecutionLeases` on any post-claim failure; but preparation throws at `774/782/807` never reach `cleanupStream` (`1893-1906`), leaking the per-user `activeStreams` slot, `componentBuffers`, revision state; conversation stuck "streaming" until restart (`709-716`, `881-883`; stale-stream cron `2144-2155` sweeps DB only) |
| RUN-02 | P1 | **STILL PRESENT** | `stream.service.ts:731-748` heartbeat: any renewal rejection (or `false`) → immediate `leaseLost = true` + `call.cancel()`; no retry/backoff, no typed outcomes, ~60 s of unexpired lease unused; lease 90 s (`:666`), heartbeat 30 s (`:748`); renewal is a single UPDATE (`postgres-message-store.ts:403-416`) |
| SAVE-01 | P1 | **STILL PRESENT** | Terminal `end` handler `stream.service.ts:1497-1648`: `completeAIMessage` failure → `cleanupStream` (`1635-1646`) deletes `componentBuffers` (`1895`), rethrow; no pending-finalization structure exists (grep: none); no persisting/persisted lifecycle (`message.interface.ts:337-338` only `isStreaming`/`isComplete`); `stream_complete` currently means "durably persisted" and is sent after persist (`1594-1607`) — on this path the client gets neither `stream_complete` nor `stream_error` |
| ADK-01 | P1 | **STILL PRESENT** | `main.py:153-155` fire-and-forget `asyncio.create_task(start_grpc_server(...))`; `158-168` done-callback logs once; `server.py:117` unguarded `await init_checkpointer()` → checkpointer failure kills the task permanently; process never exits so docker `restart: always` never fires; no retry/backoff/supervision in `main.py`/`server.py` |
| NET-01 | P1 | **STILL PRESENT** | `store.ts:2554-2561` `onConnectionFailed` sets `inputDisabled: true`; `onSSEConnected` clears `sseError` only; single shared boolean (`store.ts:745`), no disable-reason ownership; cleared only by dismiss/retry/`stream_start`/`clearAll` |
| NET-02 | P1 | **PARTIALLY ADDRESSED** | Budget unchanged 10 attempts, 1–60 s (`stream.ts:60-63`, `292-308`); exhaustion → `connection_failed` and stop; no degraded low-cadence retry, no `online` listener; recovery paths that do exist: dialog Reconnect button, visibilitychange refocus (`useConversationStream.ts:23-30`), auth-refresh hook (`client.ts:174-177`); token-freshness and duplicate-connection prevention verified present (`stream.ts:69,75,161-164,310-319`) |
| REC-01 | P1 | **ALREADY FIXED (residual in-flight edge self-heals at completion)** | Caps 500 (`store.ts:47-48`); overflow clears backlog *then* recovery fetches snapshot after the clear (`1884-1893`, `1848-1852`); snapshot install applies only `chunk.revision > snapshotRevision` (`338-373`, esp. `353`); residual: overflow while an older fetch is in flight can install older revision until `stream_complete`/reconcile |
| REC-02 | P1 | **PARTIALLY ADDRESSED** | Run-identity guards added in `recoverMissingStreamStart` (`store.ts:399-416`: view moved / terminal settled / different tracked message → drop); per-run re-keying + watermark at ingestion (`1856-1866`); backlog itself still conversation-scoped, chunks carry no messageId (`store.ts:56-60`) — correct only while revisions are monotonic per conversation across runs |
| REC-03 | P1 | **PARTIALLY ADDRESSED** | (a) Snapshot epoch guard exists (`store.ts:241-248,271,284-288,363`); local-only components preserved (`297-301,355-360`); residual: snapshot content unconditionally wins for ids present in both, no per-component revision comparison. (b) **Navigation race STILL PRESENT**: overflow-repair fallback `store.ts:278-283` fires `fetchMessages(oldConversationId)` after A→B navigation; `fetchMessages` resets `messages`/`messagesLoading` (`1247-1255`) and wipes the new conversation's streaming tracking (`1241-1246`) before its own stale guard discards the result. Forced-resync path IS guarded (`451`) |
| CTX-01 | P1 | **STILL PRESENT** | `stream.service.ts:422-428` (`buildWorkspaceContexts` → `return []` on error), `554-560` (`buildAttachedFiles`), `614-620` (`buildPreviousAttachedFiles`); brain contexts via `Promise.allSettled` drop failures (`466-479`); call sites proceed unconditionally (`926-930`, `957-963`) |
| CAP-01 | P1 | **STILL PRESENT** | In-process `activeStreams` Map (`stream.service.ts:121`, check `678-706`), local SSE Map (`stream-gateway.service.ts:52-53,115-125`); Postgres per-message lease exists but is not a capacity reservation; no shared admission anywhere |
| CAP-02 | P1 | **STILL PRESENT** | Public routes have no `request.user` → key degrades to IP-only (`rate-limit.guard.ts:60-67`, `rate-limiter.service.ts:89-105`); in-memory per-process Map store, no Redis (`stores/memory.store.ts:6`, hardwired `rate-limiter.service.ts:18-20`); 10 login/min, 30 refresh/min shared per IP |
| IDEM-01 | P1 | **STILL PRESENT** | Standard create rejects `creationRequestId` (`conversation.service.ts:68-72`); unique partial index exists for copilot only (`postgres/schema/conversation.schema.ts:109-110`); frontend sends no stable operation ID (`front/src/modules/conversation/api.ts:48-51`); note: message-send turns DO have request-id/fingerprint dedupe (`message.service.ts:655-667`) — reuse that pattern |
| OPS-01 | P1 (verify) | **MOSTLY VERIFIED — see §4** | Postgres pool protections verified present; Mongo custom `reconnect` config block exists but is consumed by nothing (dead config); health module is custom (terminus unused dep), live/ready distinguished; ADK pool auto-scale confirmed; `MAX_CONCURRENCY`/`MAX_QUEUE_LENGTH` confirmed dead on the gRPC path (hardcoded `ThreadPoolExecutor(max_workers=10)` in `server.py:71`) |
| MD-01 | P2 | **PARTIALLY ADDRESSED** | Container-aware boundary veto exists (`ai-message-content.tsx:547-630`) and the top-level definition veto is intact; residual gaps are explicit: blockquote-nested definitions (`> [ref]: url`) invisible to the regex (`:545,587`) — and `paragraph + quoted block` is an explicitly tested *safe* split (`hot-tail.test.ts:91-98`), reproducing the artifact; definitions indented ≥4 spaces in nested lists escape (acknowledged in-source `:541-545`); no test covers containers (`hot-tail.test.ts:135-167` top-level only). `c010b8399` changed math parity only |

Closed-at-source-review items verified still fixed: cursor reuse after buffer expiry (watermark `store.ts:1856-1866`), blank code while highlighting pending/failed (fallback preserved in `code-block.tsx`), top-level reference veto (intact). Add regression protection but do not reimplement.

## 3. Priority reading for implementation order

The classification confirms the plan's PR order is still correct, with two adjustments:

1. **WP3 (RUN-01)** is cheaper than the audit implied: the durable-lease half of the fix already landed; the remaining defect is narrow — extend the outer guard so preparation failures also run `cleanupStream` (idempotently) for the *exact* `streamKey`, without letting an admission loser delete a winner's entry.
2. **WP5 (REC family)** should start from the one unguarded refetch (`store.ts:278-283`) — smallest real defect first — then run-identity on buffered chunks, then per-component revisions on snapshot merge.

## 4. OPS-01 verification detail (sanitized, from source + installed versions)

- Runtime: Node v25.5.0, npm 11.8.0, Python 3.12.2, Poetry 1.8.2. Mongoose ^8.21.0 installed, React ^18.2.0.
- Postgres (NestJS): pool max 10, idle 30 s, connect 10 s, statement_timeout 30 s, idle-in-txn 30 s, keepalive on; `pool.on('error')` logs (pg destroys broken idle clients itself); `ping()` releases in `finally` (`postgres.module.ts:20-37`, `postgres-connection.service.ts:30-42`).
- Mongo: `reconnectTries`/`reconnectInterval` are gone; a custom `database.reconnect.*` block (`database.config.ts:23-30`) is passed to nothing (grep: zero consumers; only `email.reconnect.*` is consumed). `database-connection.service.ts:50` hardcodes `reconnectAttempts: 0`. Mongoose 8 handles reconnection internally → **deprecate the dead block or implement it; do not leave silent fallback config**.
- Health: custom module (`health.service.ts`), `/health/live` always ok, `/health/ready` 503-gated; Mongo admin ping, Postgres ping; ADK gRPC checked via cached `waitForReady` cron every 10 s (`stream.service.ts:2099-2142`). `@nestjs/terminus` is an unused dependency.
- ADK: `DB_MAX_CONNECTIONS=3000` feeds `get_effective_pool_size()` validation (auto-scale splits 70/30 under `safe_limit = 0.8 × DB_MAX_CONNECTIONS`); session pool `pool_pre_ping=True`, recycle 1800 s, timeout 5 s, statement_timeout 10 s (`manager.py:48-58`); checkpointer pool min 1 / max 5 (`settings.py:195-199`, `checkpointer.py:71-130`).
- `MAX_CONCURRENCY=50` / `MAX_QUEUE_LENGTH=500` (`settings.py:86-87`): zero consumers outside test schema. gRPC server hardcodes `ThreadPoolExecutor(max_workers=10)` (`server.py:71`).

## 5. Environment baseline and unverified values

- Deployment topology (replica count, reverse-proxy SSE behavior, actual DB server `max_connections`, real restart policies): **not available in this environment — unverified.** Load/fault testing and production capacity statements are blocked on an authorized staging environment.
- No commands producing test evidence have been run yet. First executable verification should be: focused backend `npm test` for conversation/auth, frontend Vitest for store/stream, `poetry run pytest` (conda `meta` env) for ADK — after the WP0 fault harness exists.

## 6. WP0 remainder (before PR 1)

1. Convert each STILL PRESENT disposition into a failing-then-passing reproducer against real code (A2 scenario seeds are not the final tests).
2. Fault harness: injectable adapters for unit tests + real Mongo/Postgres integration with controllable fault injection; distinguish fail-fast disconnect vs blackhole vs lost-response.
3. Deterministic fake model/tool workload (numbered deltas, known final text, observable idempotent side effect).
4. Capture baseline click-to-first-token and recovery timings once the harness runs.
