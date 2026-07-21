# Worky Rework: gRPC Manager + Electric SQL Sync — Design

**Date:** 2026-07-03
**Status:** Design — pending implementation plan
**Modules:** `back/src/modules/worky`, `back/src/modules/conversation-v2`, `front/src/modules/worky`

## 1. Summary

Worky today talks to an external `worky-adk-runtime` FastAPI service over `fetch`/SSE.
The runtime pushes state back through `POST /worky/internal/*` callbacks, which mutate
MongoDB, and an in-memory `WorkyEventService` fans SSE frames out to the browser.

We are switching the engine. Worky will now:

1. **Kick off work over gRPC** — call the `Worky` RPC on the conversation-v2 gRPC server
   (the "manager"), instead of the adk runtime HTTP API.
2. **Receive results over Electric SQL** — the manager writes tasks / task updates /
   messages / interactions into **its own Postgres**; Electric exposes those tables as a
   resumable shape log; **Nest is the Electric consumer**.

The motivation is that worky runs **long-running tasks** (minutes to hours). A push channel
that requires an always-on connection (the current runtime→Nest SSE + callbacks) loses
updates whenever either side restarts or disconnects. Electric's shape log is durable and
**resumable by offset/handle**, so Nest can drop, restart, and catch up to the exact point
it left off without the manager holding a connection open.

## 2. Ownership & boundaries (decided)

- **The conversation-v2 AI service ("manager") owns the Postgres** that Electric syncs.
  This repo does **not** provision or migrate that Postgres.
- **Electric is transport, not the system of record.** The manager's Postgres is treated as
  an ephemeral live window; the **durable record is MongoDB**, owned by Nest.
- **The frontend only ever talks to the Nest backend.** It never contacts Electric,
  Postgres, or the manager directly. Nest handles persistence and broadcast.
- **Nest broadcasts to the frontend over the existing SSE channel** (`WorkyEventService`).
  The frontend is essentially unchanged.

## 3. Target architecture

```
Frontend ──POST /worky/streams/:id/messages──> Nest ──gRPC Worky()──> manager
                                                        (fire-and-forget; returns { accepted })

manager ──writes tasks/results/messages/interactions──> Postgres (manager-owned)
                                                            │
                                                   Electric shape (resumable log)
                                                            │
                                                            ▼
                                        Nest server-side ShapeStream consumer
                                             ├──> idempotent upsert into Mongo (durable record)
                                             └──> WorkyEventService.emit ──SSE──> Frontend (existing channel)

Frontend cold-load / reconnect ──GET /worky/streams/:id/board──> Nest ──> Mongo (snapshot)
```

**The join key** across all four surfaces (gRPC ↔ Postgres rows ↔ Electric shape filter ↔
Mongo) is the conversation-v2 **session id**, stored on the worky stream as `aiSessionId`
(the same pattern conversation-v2 already uses).

## 4. Components

### 4.1 gRPC kickoff (backend)

- **Proto fix (blocker):** `back/src/modules/conversation-v2/proto/conversation.proto` has a
  stray `"` on line 40 (between `WorkyResponse` and `message ChatRequest`). It is invalid
  proto3 and makes `protoLoader.loadSync` throw at `onModuleInit`, breaking the whole gRPC
  client. Must be removed first.
- **Add `worky()` to `ConversationV2GrpcClientService`** — unary call, following the exact
  `createSession` pattern (positional `grpc.Metadata` from `createGrpcMetadata`, `unaryDeadline`):
  `Worky({ user_id, session_id, message, model, skills, connectors })` → `{ session_id, accepted }`.
- **Stream ↔ session mapping.** Creating a worky stream calls gRPC `CreateSession` and stores
  the returned `aiSessionId` on the `worky_streams` document. Sending an owner message calls
  gRPC `Worky(message)` for that session. The `accepted` ack returns immediately; **all**
  results (plan, tasks, updates, manager replies) arrive asynchronously via Electric.

### 4.2 Electric consumer (backend, new)

A new Nest service subscribes to the manager's Postgres tables through Electric shapes:
`worky_tasks`, `worky_task_results`, `worky_messages`, `worky_interactions`.

For each row change the consumer:

1. **Persists** to Mongo via **idempotent upsert** — keyed on the natural unique keys that
   already exist (`worky_tasks.id`, `worky_task_results.{taskId, version}`). Idempotency makes
   reprocessing and multi-instance overlap harmless.
2. **Routes and broadcasts** — resolves `session_id → worky_stream → ownerUserId`, then calls
   `WorkyEventService.emit(userId, streamId, event)` with the appropriate existing
   `WorkyEventType` frame (`task.updated`, `task.completed`, `message.appended`,
   `interaction.requested`, …). The frontend's existing SSE handling reacts unchanged.

**Resumability.** The consumer persists the Electric **shape `handle` + `offset`** (in Mongo)
and resumes from it on startup, so a Nest restart neither misses rows nor reprocesses the
entire log.

**Subscription strategy.** One shape per table covering active (non-archived) streams; the
consumer fans rows to the right user by `session_id`. (Per-stream subscriptions are an
alternative but add lifecycle churn; start with per-table.)

**Config.** A single configurable Electric base URL (e.g. `WORKY_ELECTRIC_URL`) plus the
exact manager table/column names, resolved via `ConfigModule` like the other worky settings.

### 4.3 Removal of the adk-runtime path (backend)

Because this is the new engine (no dual-mode config switch), the old path is removed:

- `WorkyRuntimeClient` (`services/worky-runtime.client.ts`) — deleted.
- `WorkyRuntimeDispatchService` — deleted; execution dispatch now originates from the manager.
- The HTTP planning-turn call in `WorkyPlanningService` (`fetch` to `/runtime/.../planning-turn`)
  — replaced by the gRPC `Worky` kickoff; planning results arrive via Electric.
- `WorkyInternalController` (`/worky/internal/*`) + `WorkyServiceAuthGuard` — deleted; the
  manager no longer calls back into Nest (it writes Postgres instead).
- Related config: `WORKY_RUNTIME_BASE_URL`, `WORKY_SERVICE_TOKEN`, and the outbound runtime
  wiring in `worky.module.ts` — removed.
- `WorkyIdempotencyService`: re-evaluate. Callback idempotency is gone, but the Electric
  consumer needs its own idempotency (covered by keyed upserts + persisted offset); reuse or
  retire per what the consumer needs.

### 4.4 Frontend (minimal change)

- **No Electric client, no Postgres, no new transport.** The frontend keeps talking only to Nest.
- `POST /worky/streams/:id/messages` still kicks off; the existing SSE channel
  (`GET /worky/streams/:id/events`) still delivers invalidation/broadcast frames; the board
  still loads from `GET /worky/streams/:id/board` (Mongo snapshot) and refetches on SSE
  invalidation. Zustand mirror and React Query stay as-is.
- **Behavior change:** manager messages arrive as **complete rows**, not token-by-token.
  The live `assistant_token` typing effect for worky is dropped (worky is async/long-running;
  message-level granularity is sufficient). `ChatMessageThread`'s streaming-bubble path for
  worky is simplified accordingly.

## 5. Data flow, end to end

1. User sends a message → `POST /worky/streams/:id/messages`.
2. Nest appends the owner message to Mongo, resolves `aiSessionId`, calls gRPC `Worky(...)`.
   Returns `202 Accepted` to the browser.
3. Manager plans/executes over time, writing rows into its Postgres.
4. Electric surfaces those rows; the Nest consumer receives them (resuming from stored offset
   if it restarted).
5. Consumer upserts Mongo and emits SSE frames to the owner.
6. Browser receives SSE → invalidates React Query → refetches `GET /board` from Mongo.
7. If the browser was closed, on reopen it loads the current snapshot from Mongo; it missed no
   durable state because Nest captured everything from the resumable shape log.

## 6. Out of scope / known limitations (this pass)

- **Task-mutation authority.** With the manager owning task state, the existing
  `POST /worky/tasks/:id/{move,pause,resume,cancel,review}` endpoints can drift from the
  manager's Postgres. Routing these through gRPC to the manager (or disabling them) is
  **explicitly out of scope for now** and must be revisited before this is production-facing.
- **Multi-instance SSE.** Every Nest instance runs the consumer so the instance holding a
  user's SSE connection can emit; idempotent Mongo upserts absorb duplicate processing. This
  is the same single-instance-fan-out limitation worky has today (in-memory `WorkyEventService`,
  no Redis/pub-sub). Not fixed here — flagged.
- **Manager message token streaming** is dropped (see 4.4).

## 7. External dependencies to confirm with the conversation-v2 team

1. The manager runs Postgres + an Electric sync service; provide the **Electric base URL**.
2. The **exact table and column names** the manager writes (tasks / results / messages /
   interactions) and the **`session_id` column** used for scoping.
3. Postgres has **logical replication** enabled (Electric prerequisite) — their responsibility.
4. Confirmation that the `Worky` gRPC RPC returns promptly (`{ session_id, accepted }`) and
   does not block for the duration of the run.

## 8. Testing

- **gRPC client** — unit-test `worky()` mirrors the `createSession` unary pattern (positional
  metadata, deadline, error mapping), following existing `*.grpc-client.service.spec.ts`.
- **Electric consumer** — unit-test row→Mongo upsert idempotency (same row twice = one write),
  row→SSE mapping, `session_id→owner` routing, and offset persistence/resume. Mock the
  `ShapeStream`.
- **Message controller** — `POST /messages` calls gRPC `Worky` and returns `202`; no runtime
  fetch remains.
- **Removal regression** — assert the `/worky/internal/*` routes and runtime client are gone
  and nothing references them.
- **Frontend** — existing SSE/board tests keep passing; adjust `ChatMessageThread` tests for
  complete-row (non-streaming) manager messages.
