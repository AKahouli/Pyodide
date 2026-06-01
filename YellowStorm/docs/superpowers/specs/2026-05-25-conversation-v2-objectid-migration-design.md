# Conversation V2 — Switch to Mongo `_id` as the Canonical Session Id

**Date:** 2026-05-25
**Branch:** `feature/conversation_artifacts`
**Status:** Approved; user opted to skip the review gate, going straight to writing-plans.

## 1. Motivation

V2 currently uses the AI service's UUID `session_id` as the canonical identifier — stored as `ConversationV2Session.sessionId` (string, unique), threaded through every REST route, used as the system workspace's name segment, and used as the `Workspace.conversationId` ObjectId cast that just blew up because UUIDs aren't 24-char hex (commit `c5cfbf63` patched it).

Switching to the Mongo document `_id` as the canonical id:
- Aligns V2 with V1's identity model.
- Lets `Workspace.conversationId` store the real ObjectId cleanly (no `Types.ObjectId.isValid` guard ever-needed for V2).
- Removes the impedance mismatch between "Mongo collection" and "session id" terminology.
- The AI service's id becomes optional metadata used only by the gRPC client.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Mapping Mongo `_id` ↔ AI session id | Dual ids on same document. `_id` canonical (REST, workspace, events, frontend). `aiSessionId: string \| null` for gRPC only. |
| 2 | URL paths | Keep `/conversation-v2/sessions/:id`. Only `:id` content changes (24-char hex). |
| 3 | `conversation_v2_events.sessionId` type | Remain `string`. Holds ObjectId hex now. No schema migration. |
| 4 | Schema field name | Rename `sessionId` → `aiSessionId?: string \| null`. Drop unique index. API response keeps `sessionId` label (mapped from `_id.toString()`). |
| 5 | Creation order | Doc-first. Insert empty pointer → get `_id` → create workspace using `_id` → call gRPC → patch doc with `aiSessionId`. |
| 6 | Existing data | Clean slate. Tombstone script runs on deploy. No data migration. |

## 3. Architecture

### 3.1 Identity model

- **Canonical id:** `ConversationV2Session._id` (Mongo ObjectId). External in every REST route, frontend prop, share token target, event-store row key, workspace `conversationId`.
- **gRPC id:** `ConversationV2Session.aiSessionId` (string). Used only by `ConversationV2GrpcClientService` methods. Never exposed.

### 3.2 Creation flow

```
POST /conversation-v2/sessions
  1. workspaceShare.assertUserHasAccess(userId, workspaceIds)
  2. const draft  = sessions.createDraft(userId, workspaceIds)
                    // inserts empty pointer; returns the doc with new _id
  3. const ws     = workspaceService.createSystemWorkspace(
                      userId, draft._id.toString(), allocatedStorage)
  4. const aiId   = grpcClient.createSession(userId, workspacePaths)
  5. await sessions.attachAiSession(draft._id, aiId, ws.id)
  6. respond { sessionId: draft._id.toString(), workspaceIds, systemWorkspaceId: ws.id }
```

Rollback paths (each catches its corresponding failure and unwinds prior steps):
- Step 3 fails → `sessions.deleteDraft(draft._id)`.
- Step 4 fails → `workspaceService.deleteSystemWorkspace(ws.id)` → `sessions.deleteDraft(draft._id)`.
- Step 5 fails → `grpcClient.stopSession(userId, aiId)` → delete workspace → delete draft.

All rollback calls are fire-and-forget (`.catch(() => undefined)`); the original error rethrows.

### 3.3 Read/write flow

Every controller method (other than `createSession`) accepts `:id` (ObjectId hex), calls `sessions.getOne(userId, id)` to resolve the pointer, then:
- Reads/serves data from the pointer or downstream services.
- For gRPC calls (`Chat`, `Stop`, `Pause`, `Resume`, `GetVncSignedUrl`), reads `pointer.aiSessionId` and passes that to the client.

The frontend continues sending `sessionId` as a URL segment — the value happens to be a 24-char hex now instead of a 36-char UUID. The hash router and api client treat it as an opaque string, so they don't care.

### 3.4 Endpoints (unchanged paths, new id format)

| Method | Path | Notes |
|---|---|---|
| POST | `/conversation-v2/sessions` | Response `sessionId` is the new `_id` hex. |
| GET | `/conversation-v2/sessions` | `lastEventAt` cursor unchanged; `items[].sessionId` is now hex. |
| GET | `/conversation-v2/sessions/:id` | `:id` is hex; response includes all the same fields. |
| GET | `/conversation-v2/sessions/:id/events` | Events table keyed by hex string; same query. |
| PATCH | `/conversation-v2/sessions/:id` | Same. |
| DELETE | `/conversation-v2/sessions/:id` | Same cascade as system-workspace rework. |
| GET | `/conversation-v2/sessions/:id/stream` | Looks up `aiSessionId` from the doc; calls gRPC with it. |
| GET | `/conversation-v2/sessions/:id/stream/live` | Same. |
| POST | `/conversation-v2/sessions/:id/stop\|pause\|resume` | Same. |
| GET | `/conversation-v2/sessions/:id/vnc/signed-url` | Same. |
| GET | `/conversation-v2/share/v2/:token` | Returned session's `sessionId` is `_id` hex. |

## 4. Schemas

### 4.1 `ConversationV2Session` (diff)

```ts
@Schema({ timestamps: true, collection: 'conversation_v2_sessions' })
export class ConversationV2Session extends Document {
  @Prop({ required: true })
  ownerId!: string;

  // AI service's session id. Optional because it's set after gRPC.CreateSession
  // succeeds (doc-first creation). Stored only for gRPC routing — never
  // exposed externally; the document's _id is the canonical id.
  @Prop({ type: String, default: null })
  aiSessionId?: string | null;

  // ... title, status, lastEventAt, isShared, shareTokenHash, deletedAt,
  //     workspaceIds, eventSequence, eventCount, systemWorkspaceId
  //     — all unchanged ...
}

ConversationV2SessionSchema.index({ aiSessionId: 1 }, { sparse: true });
// The existing `{ ownerId, deletedAt, lastEventAt }` index stays.
```

Removed: the previous `sessionId: string` `@Prop({ required: true, unique: true })` and its index. Replaced by `aiSessionId` (optional, sparse, no uniqueness enforced at the DB layer).

### 4.2 `conversation_v2_events`

No schema change. The `sessionId: string` column simply stores ObjectId hex going forward.

### 4.3 `Workspace`

No schema change. `conversationId: Types.ObjectId` now always holds a valid ObjectId for V2 system workspaces (it was getting `null` for V2 after the patch in `c5cfbf63`; with the new design, V2 ids are valid ObjectIds, so `Types.ObjectId.isValid(...)` is always true). The guard stays in place to keep V1 callers safe.

## 5. Services

### 5.1 `ConversationV2SessionService` — new methods, updated lookups

```ts
async createDraft(ownerId: string, workspaceIds: string[] = []): Promise<ConversationV2SessionDocument> {
  return this.model.create({
    ownerId,
    aiSessionId: null,
    title: '',
    status: 'active',
    lastEventAt: new Date(),
    isShared: false,
    shareTokenHash: null,
    deletedAt: null,
    workspaceIds,
    eventSequence: 0,
    eventCount: 0,
    systemWorkspaceId: null,
  });
}

async attachAiSession(
  id: Types.ObjectId,
  aiSessionId: string,
  systemWorkspaceId: string,
): Promise<void> {
  await this.model.updateOne(
    { _id: id, aiSessionId: null }, // only patch if still a draft
    { $set: { aiSessionId, systemWorkspaceId: new Types.ObjectId(systemWorkspaceId) } },
  );
}

async deleteDraft(id: Types.ObjectId): Promise<void> {
  // Safety: only hard-delete docs that are still drafts. Real sessions
  // (aiSessionId set OR deletedAt set) are never touched here.
  await this.model.deleteOne({
    _id: id,
    aiSessionId: null,
    deletedAt: null,
  });
}

async getOne(ownerId: string, id: string): Promise<ConversationV2SessionDocument | null> {
  let objId: Types.ObjectId;
  try {
    objId = new Types.ObjectId(id);
  } catch {
    return null;
  }
  return this.model.findOne({ _id: objId, ownerId, deletedAt: null }).lean().exec() as ...;
}

async rename(ownerId, id, title)     // findOneAndUpdate({ _id: ObjectId(id), ownerId, deletedAt: null }, ...)
async setShared(ownerId, id, ...)    // same pattern
async softDelete(ownerId, id)         // same pattern
async getByShareToken(hash)           // unchanged — looks up by hash
async list(...)                       // same query; result.sessionId mapped from doc._id.toString()
```

Removed: `createForUser`. The old fallback call in the stream controller (`this.sessions.createForUser(user.id, sessionId).catch(...)`) is removed entirely — doc-first creation guarantees the pointer exists by the time `/stream` is hit.

The `PointerSummary` returned by `list` adds `sessionId: doc._id.toString()` in the `toSummary` mapper.

### 5.2 `ConversationV2Controller.createSession` — full rewrite with 3 rollback branches

See § 3.2 above; the implementation mirrors that sequence with the three explicit try/catch blocks.

### 5.3 Other controller methods

- `getSession(user, id)` — `sessions.getOne(user.id, id)`; response includes `sessionId: pointer._id.toString()`.
- `deleteSession(user, id)` — `sessions.getOne` → existing cascade → `sessions.softDelete(user.id, id)`. The race-window comment from the system-workspace rework stays.
- `listEvents(user, id, query)` — straight pass-through to `eventStore.listSince(id, since, limit)` (the hex string flows verbatim).
- `getShared(token)` — share token resolves to a pointer; response's `session.sessionId` is `pointer._id.toString()`.

### 5.4 `ConversationV2StreamController.stream`

```ts
async stream(user, sessionId /* hex */, query, res) {
  const pointer = await this.sessions.getOne(user.id, sessionId);
  if (!pointer) throw new NotFoundException('Session not found');
  if (!pointer.aiSessionId) throw new BadRequestException('Session not ready');

  const aiId = pointer.aiSessionId;
  const systemWorkspaceId = pointer.systemWorkspaceId?.toString() ?? null;
  // ... rest of the existing flow.
  // gRPC calls use aiId.
  // EventStore calls use sessionId (the hex string).
  // workspaceDocuments.createFromAiArtifact uses systemWorkspaceId.
}
```

`streamLive` follows the same pattern.

### 5.5 `OwnerGuard`

The guard currently calls `sessions.getOne(userId, sessionId)`. Behavior unchanged externally, but now wraps the lookup against malformed hex:

```ts
async canActivate(context) {
  const req = context.switchToHttp().getRequest();
  const userId = req.user?.id;
  const id = req.params.id;
  if (!userId || !id) throw new NotFoundException('Session not found');
  const pointer = await this.sessions.getOne(userId, id); // returns null on malformed hex
  if (!pointer) throw new NotFoundException('Session not found');
  if (pointer.ownerId !== userId) throw new ForbiddenException('Not the owner');
  return true;
}
```

`sessions.getOne` already handles malformed hex internally (returns null), so the guard transparently turns it into 404.

### 5.6 EventStore

No signature changes. Every method already takes `sessionId: string` and operates on hex strings — only the source of those strings changes (was the AI's UUID, now the doc's `_id` hex).

### 5.7 `WorkspaceService.createSystemWorkspace`

No signature change. The `Types.ObjectId.isValid(conversationId)` guard from `c5cfbf63` stays. V2 now always passes a valid ObjectId hex, so the `null` fallback path is no longer exercised by V2 callers — only V1 and any future caller that might pass a non-ObjectId.

## 6. Frontend changes

**None.** The wire-side field name `sessionId` is unchanged. The URL segment is parsed as an opaque string. All frontend tests use mock ids that are format-agnostic. `clientEventId` for optimistic echo stays a UUID — that's a message event id, not a session id.

## 7. Migration & rollout

- Clean slate. Run the existing `back/scripts/migrations/2026-05-25-tombstone-conversation-v2-sessions.ts` on deploy if any V2 sessions exist.
- No proto change. No AI service change.
- No `conversation_v2_events` migration (legacy rows would be orphaned anyway since their pointers are tombstoned).
- Rollback path: `git revert` the implementation commits.

## 8. Error handling & edge cases

- **Draft pointer leak after a crash mid-creation.** A doc with `aiSessionId: null` and `systemWorkspaceId: null` is left behind. A future cron could sweep `{ aiSessionId: null, createdAt: { $lt: now - 5min } }`. Not built now.
- **`/stream` against a draft pointer.** `BadRequestException('Session not ready')` if `pointer.aiSessionId` is null.
- **Malformed `:id` hex.** `sessions.getOne` returns null silently; guard returns 404. No 500.
- **Concurrent `attachAiSession` calls.** Filter is `{ _id, aiSessionId: null }` so the second writer no-ops. Idempotent enough.
- **EventStore reads with mismatched format.** Hex string lookup against UUID-keyed rows returns empty. Tombstoned data is unreachable anyway.

## 9. Testing strategy

### Backend

- `ConversationV2SessionService` — new tests for `createDraft`, `attachAiSession`, `deleteDraft`, and updated lookups (`getOne` by hex, `getOne` returns null on malformed hex, `softDelete` by hex, etc.).
- `ConversationV2Controller.createSession` — happy path + three rollback branches (workspace fail, gRPC fail, attach fail). Each branch asserts the right cleanup calls were made.
- `ConversationV2Controller.getSession` / `deleteSession` / `getShared` — assertions updated: pointer mocks return `_id`; response `sessionId` is the hex.
- `ConversationV2StreamController.stream` — pointer mock returns `aiSessionId`; assert `grpcClient.chat` is called with `aiSessionId`, not the URL `:id`. New test for "rejects when aiSessionId is null".
- `OwnerGuard` — new test "returns 404 on malformed id".
- `WorkspaceService.createSystemWorkspace` — keep existing `Types.ObjectId.isValid` test; add one asserting V2 paths now hit the typed branch.

### Frontend

- No new tests. Existing tests continue passing unchanged.

### Out of scope

- E2E against real AI service.

## 10. Open / deferred items

- Orphan draft sweeper cron (sessions with `aiSessionId: null` older than 5 min).
- Eventually retiring the `sessionId` wire-side label in favor of `id` to match V1's response shape. Out of scope for this rework.
