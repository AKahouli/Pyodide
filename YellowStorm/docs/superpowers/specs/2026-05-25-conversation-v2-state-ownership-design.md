# Conversation V2 — Backend-Owned State, Messages, and Artifacts

**Date:** 2026-05-25
**Branch context:** `feature/conversation_artifacts`
**Status:** Design approved, awaiting spec review before implementation plan.

## 1. Motivation

Conversation V2 today is a thin pointer on top of an AI-service-owned session. The backend persists only `ConversationV2Session` (sessionId, title, status, workspaceIds, share fields). Every page load calls the AI service's `GetSession` rpc to retrieve the full event history (messages, tool calls, plan/step updates, attachments). Live chat streams events from the `Chat` rpc straight to SSE; we write nothing to Mongo except a few pointer fields (`title`, `status`, `lastEventAt`).

This is too thin to evolve on. Concretely, this rework unlocks:

- **Per-message feedback** (like / dislike).
- **Multi-model per session** — each turn records the model that produced it.
- **Resume after disconnect** — a client that reconnects mid-run replays missed events from our own log.

Out of scope (deliberately): edit/regen, branching, an artifact registry as first-class objects, cross-session search, long-term memory/summarization.

## 2. Architectural decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Source of truth for event history | Backend Mongo is canonical |
| 2 | AI service role | Stays stateful per session; we stop calling `GetSession` |
| 3 | Storage granularity | Append-only `events` collection (no separate `messages` table) |
| 4 | Resume mechanics | REST catch-up (`/events?since=`) + SSE live tail; monotonic per-session `sequence` cursor |
| 5 | Feedback / modelId placement | Inline on the assistant `message` event row (only mutable fields) |
| 6 | Migration | Clean cut: soft-delete all existing `conversation_v2_sessions` pointers on deploy |

Rationale for each is captured in §3–§7 below.

## 3. Architecture & data flow

### 3.1 Posture

- The backend Mongo store is the canonical source of truth for all session events.
- The AI service keeps owning `sessionId`, working memory, and the `Chat` rpc — there is no protobuf change.
- `grpcClient.getSession` is marked `@deprecated`; reads come from Mongo.

### 3.2 Collections

1. **`conversation_v2_sessions`** — existing pointer doc, extended with:
   - `eventSequence: number` — last sequence assigned (monotonic int per session, starts at 0).
   - `eventCount: number` — cheap "has any event ever been written" check, `$inc`ed alongside `sequence`.

2. **`conversation_v2_events`** — *new*, append-only.
   - Required: `sessionId`, `sequence`, `eventId`, `type`, `emittedAt`, `payload`, `createdAt`.
   - Mutable only on `type='message' & payload.role='assistant'`: `feedback`, `feedbackAt`, `modelId`.
   - Unique indexes: `(sessionId, sequence)` and `(sessionId, eventId)`.
   - Read index: `(sessionId, type, sequence)`.

3. *(unchanged)* Share semantics remain on the pointer doc.

### 3.3 Write path (live chat)

```
Client → POST /sessions/:id/stream (SSE, message+model in query)
  → gRPC Chat (AI service stateful)
  → for each event from the stream:
       1. EventStore.append(sessionId, event)
            a. atomic findOneAndUpdate({ sessionId }, { $inc: { eventSequence: 1, eventCount: 1 } })
            b. upsert into conversation_v2_events keyed by (sessionId, eventId)
       2. if it's the first assistant `message` event of this stream:
            EventStore.tagModel(sessionId, eventId, query.model)
       3. PointerWriter.apply(sessionId, event) — title/status/lastEventAt
       4. emit SSE frame { sequence, ...event } to the client
  → on disconnect: cancel the gRPC call (unchanged)
```

### 3.4 Read path (page load / reload)

```
Client opens session
  → GET /sessions/:id           → pointer doc (no gRPC GetSession)
  → GET /sessions/:id/events?since=0&limit=N
  → repeat until empty
  → when sending a new message:        GET /sessions/:id/stream?message=…&model=…
  → when tailing an in-flight run:     GET /sessions/:id/stream/live
```

### 3.5 Resume after disconnect

- Client tracks the highest `sequence` it has rendered.
- On reconnect:
  1. `listEvents(since=lastSequence)` until empty.
  2. Open `/stream/live` (or `/stream` if user is sending a fresh message).
  3. On first SSE frame, if `frame.sequence > lastSequence + 1`, treat as gap → step 1 again.
- AI-service-restart resurrection is **not** supported. If the AI service dies mid-run, the gRPC stream errors out, we mark `status=error`, and the UI shows a stalled state with a "send a new message to continue" affordance.

### 3.6 Endpoints

| Method | Path | Status | Purpose |
|---|---|---|---|
| POST | `/conversation-v2/sessions` | unchanged | create session |
| GET | `/conversation-v2/sessions` | unchanged | list |
| GET | `/conversation-v2/sessions/:id` | **changed** | pointer + metadata only, no events |
| GET | `/conversation-v2/sessions/:id/events?since=&limit=` | **new** | paginated events from Mongo |
| PATCH | `/conversation-v2/sessions/:id` | unchanged | title / share toggle |
| DELETE | `/conversation-v2/sessions/:id` | unchanged | soft delete |
| GET | `/conversation-v2/sessions/:id/stream?message=&model=` | unchanged | send + stream |
| GET | `/conversation-v2/sessions/:id/stream/live` | **new** | tail in-flight run, no new message |
| PATCH | `/conversation-v2/events/:eventId/feedback` | **new** | `{ feedback: 'like'\|'dislike'\|null }` |
| POST | `/conversation-v2/sessions/:id/stop\|pause\|resume` | unchanged | run control |
| GET | `/conversation-v2/share/v2/:token` | **changed** | returns `{ session, events }` inline from Mongo (no gRPC) |
| POST | `/conversation-v2/files/signed-url` | unchanged | signed URL for attachments |
| GET | `/conversation-v2/sessions/:id/vnc/signed-url` | unchanged | VNC |

### 3.7 Sequence assignment and idempotency

- Sequence is assigned by `findOneAndUpdate({ sessionId }, { $inc: { eventSequence: 1, eventCount: 1 } })`. Mongo guarantees atomicity per document, so concurrent appends never collide.
- Event insert is `updateOne({ sessionId, eventId }, { $setOnInsert: {...} }, { upsert: true })`. A retried gRPC chunk can't duplicate a row; the `(sessionId, eventId)` unique index is the backstop.

## 4. Schemas

### 4.1 `ConversationV2Session` (diff)

```ts
@Schema({ timestamps: true, collection: 'conversation_v2_sessions' })
export class ConversationV2Session extends Document {
  // existing fields preserved unchanged

  @Prop({ type: Number, default: 0 })
  eventSequence!: number;

  @Prop({ type: Number, default: 0 })
  eventCount!: number;
}
```

No backfill needed; per §7 we clean-cut, so existing pointers are tombstoned.

### 4.2 `ConversationV2Event` (new)

```ts
export type ConversationV2EventType =
  | 'message' | 'tool' | 'step' | 'plan'
  | 'title'   | 'done' | 'wait' | 'error';

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'conversation_v2_events',
})
export class ConversationV2Event extends Document {
  @Prop({ required: true, index: true })
  sessionId!: string;

  @Prop({ required: true })
  sequence!: number;

  @Prop({ required: true })
  eventId!: string;

  @Prop({
    type: String, required: true,
    enum: ['message', 'tool', 'step', 'plan', 'title', 'done', 'wait', 'error'],
  })
  type!: ConversationV2EventType;

  @Prop({ type: Number, required: true })
  emittedAt!: number;                  // AI service's wire timestamp (epoch seconds)

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload!: Record<string, unknown>;

  // Mutable, only on type='message' & payload.role='assistant':
  @Prop({ type: String, enum: ['like', 'dislike'], default: null })
  feedback?: 'like' | 'dislike' | null;

  @Prop({ type: Date, default: null })
  feedbackAt?: Date | null;

  @Prop({ type: String, maxlength: 200, default: null })
  modelId?: string | null;

  createdAt!: Date;
}

ConversationV2EventSchema.index({ sessionId: 1, sequence: 1 }, { unique: true });
ConversationV2EventSchema.index({ sessionId: 1, eventId: 1 }, { unique: true });
ConversationV2EventSchema.index({ sessionId: 1, type: 1, sequence: 1 });
```

### 4.3 Payload shapes

Stored verbatim from `normaliseEvent` in `conversation-v2.grpc-client.service.ts`, minus the outer `type`, `event_id`, and `timestamp` (which become columns):

| `type` | `payload` shape |
|---|---|
| `message` | `{ role, content, attachments[] }` |
| `tool` | `{ tool_call_id, name, status, function, args, content }` |
| `step` | `{ id, status, description }` |
| `plan` | `{ steps: StepEvent[] }` |
| `title` | `{ title }` |
| `done` / `wait` | `{}` (preserved for ordering) |
| `error` | `{ error }` |

### 4.4 Chunked message rule

If the AI service emits multiple events sharing one `event_id` (chunked assistant content), the writer **upserts** the row (`$set: { payload, emittedAt }`). Today's contract appears to be one final `message` per turn; the upsert covers chunked emission without a schema change.

### 4.5 ModelId capture

On the `/stream` controller (the only place model is known), the writer tags `modelId = query.model` on the **first** assistant `message` event of that stream. A stream is one `Chat` call = one turn = one model.

## 5. Services and module wiring

### 5.1 New: `ConversationV2EventStoreService`

`services/conversation-v2-event-store.service.ts`

- `append(sessionId, event): Promise<{ sequence: number; inserted: boolean }>`
  Atomic sequence assignment + idempotent upsert. Returns `inserted: false` on dup so callers can still emit the SSE frame.
- `listSince(sessionId, since, limit): Promise<EventRow[]>`
  `find({ sessionId, sequence: { $gt: since } }).sort({ sequence: 1 }).limit(limit).lean()`.
- `setFeedback(sessionId, eventId, value)` — guards `type='message' & payload.role='assistant'`.
- `tagModel(sessionId, eventId, modelId)` — internal, called by stream controller.
- All methods log; none throws on idempotency races.

### 5.2 Refactor: `ConversationV2PointerWriterService`

Responsibility narrows to pointer mutations only (`title`, `status`, `lastEventAt`). Sequence + event persistence move to `EventStoreService`. Call order in the stream controller: `EventStore.append` → optional `tagModel` → `PointerWriter.apply` → SSE write.

### 5.3 Refactor: `ConversationV2StreamController`

- Tracks `firstAssistantMessageEventId` for the duration of one `/stream` request.
- New route `GET /sessions/:id/stream/live` — no message, no gRPC call. Polls `listSince` on a 1-second interval and pushes any new events. Closes when the pointer's `status` reaches a terminal state (`completed`, `stopped`, `error`) or the client disconnects. Polling load is negligible for the single-active-run-per-session case; we can swap in pub/sub later if needed.

### 5.4 Refactor: `ConversationV2Controller`

- `GET /sessions/:id` — drops `grpcClient.getSession`. Returns `{ sessionId, title, status, isShared, workspaceIds, eventCount, lastEventAt }`.
- `GET /sessions/:id/events?since=&limit=` — new. `OwnerGuard`. DTO: `since: int >= 0`, `limit: int 1..500, default 200`.
- `PATCH /events/:eventId/feedback` — new. Body `{ feedback: 'like'|'dislike'|null }`. Owner check derived from the event's `sessionId`.
- `GET /share/v2/:token` — drops `grpcClient.getSession`; returns `{ session, events }` with events loaded inline from Mongo (`EventStore.listSince(sessionId, 0, MAX)`). Inline keeps the existing Public-auth contract; we avoid carving a separate public `/events`-with-token endpoint. Shared sessions are read-only and typically short, so inlining is acceptable.

### 5.5 Unchanged

`ConversationV2ShareService`, `ConversationV2SessionService` (pointer CRUD), guards, exceptions, the gRPC client itself (we still call `Chat`, `Stop`, `Pause`, `Resume`, `GetVncSignedUrl`), workspace integration, file signed URLs, VNC.

### 5.6 Module wiring

`conversation-v2.module.ts`: register `ConversationV2Event` schema in `MongooseModule.forFeature(...)`, add `ConversationV2EventStoreService` to providers and exports.

## 6. Frontend changes

### 6.1 API client

- `getSession(id)` — pointer only.
- `listEvents(id, since, limit)` — new.
- `setFeedback(eventId, value)` — new.
- `openLiveStream(id)` — new SSE wrapper for `/stream/live`.
- `sendMessage(id, message, model)` — unchanged shape; frames now carry `sequence`.

### 6.2 Store

- Events kept in a `Map<eventId, EventRow>` + sorted `sequence[]` index.
- Track `lastSequence` per session.
- On open: `getSession` → loop `listEvents(since=lastSequence)` until empty → if `status` is non-terminal (`active` or `waiting`), open `/stream/live`.
- On send: open `/stream` with message+model (today's path).
- On reconnect (single helper):
  1. Close any active SSE.
  2. Loop `listEvents(since=lastSequence)` until empty.
  3. Open `/stream/live` or `/stream`.
  4. On first SSE frame: if `frame.sequence > lastSequence + 1`, gap → step 2.
- Feedback: optimistic update, PATCH, revert on error.

### 6.3 Components

Render selectors derive turns from the event list (same grouping logic V2 uses today, but fed from the store instead of an SSE-only buffer). Feedback UI binds to the assistant `message` event row. Model badge reads `modelId` off the same row.

### 6.4 Out of scope (frontend)

SSE leader/BroadcastChannel coordination is not added by this rework.

### 6.5 i18n

No new namespace; new strings (feedback labels, gap-recovery status) added to the existing `conversation-v2` locale files.

## 7. Migration & rollout

- **Single deploy.** Add the new collection, new endpoints, refactored stream writer, frontend changes.
- **Existing sessions:** one-shot script on deploy sets `deletedAt = now` on all rows in `conversation_v2_sessions` where `deletedAt is null`. Users start fresh.
- **No proto change. No AI-service-side change.** We just stop calling `GetSession`; `grpcClient.getSession` is `@deprecated`.
- **No feature flag.** Rollback path is `git revert` + restoring the tombstoned pointers (cleanup script outputs the list of soft-deleted ids for this purpose).

## 8. Error handling and edge cases

- **Concurrent appends** — atomic `$inc` on the pointer guarantees distinct sequences; `(sessionId, sequence)` unique index is the backstop.
- **Duplicate `event_id` from gRPC retry** — `(sessionId, eventId)` unique index + upsert makes append idempotent. `inserted: false` returned; SSE frame still emitted.
- **AI service crash mid-run** — gRPC stream errors → SSE emits `error` → pointer flips to `error`. No automatic resurrection.
- **`/stream/live` on a finished run** — controller checks pointer status; on terminal, returns the tail via `listSince` and closes.
- **Gap on resume** — client-side detector (`frame.sequence > lastSequence + 1`) triggers re-fetch. Server-side writes are linearized, so the gap should never originate there.
- **Feedback on a non-assistant-message event** — `setFeedback` returns 400 with a clear message; controller validates `type==='message' && payload.role==='assistant'` from the stored row.
- **Stream against a dead session** — gRPC `NOT_FOUND` translates to `Session not found` via the existing `translateGrpcError`.
- **Share read post-rework** — only sessions with events in Mongo are visible. Per §7, all post-rework sessions qualify; pre-rework sessions are tombstoned.

## 9. Testing strategy

### 9.1 Backend (Jest)

- `ConversationV2EventStoreService` — atomic sequence assignment under concurrency, idempotent upsert on duplicate `eventId`, `listSince` ordering and limit, `setFeedback` type/role guard, `tagModel` first-event behavior.
- `ConversationV2PointerWriterService` — existing behavior preserved after responsibility split.
- `ConversationV2StreamController` — first assistant `message` tags modelId; event written before SSE frame; gRPC error translation unchanged; new `/stream/live` polling loop honors terminal status.
- `ConversationV2Controller` — new `/events`, `/feedback`, updated `/sessions/:id`, updated share endpoint.

### 9.2 Backend (integration)

One end-to-end spec: boots the module against in-memory Mongo, mocks the gRPC client to emit a canned event sequence, asserts events persisted in order, sequences contiguous from 1, `listSince` paginates, share endpoint reads from Mongo, feedback PATCH mutates the row.

### 9.3 Frontend (Vitest)

- Store: catch-up loop terminates on empty, gap detector triggers refetch, feedback optimistic update reverts on error.
- Mock SSE via the existing V2 test setup.

### 9.4 Out of scope

No end-to-end test against a real AI service; the gRPC client is the seam.

## 10. Open / deferred items

- Pub/sub for `/stream/live` (currently polled at 1Hz). Revisit if write load grows.
- SSE leader/BroadcastChannel coordination on the frontend.
- Edit/regen, branching, artifact registry, cross-session search, summarization — future reworks, each with its own spec.
