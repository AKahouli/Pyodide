# Conversation V2 — Per-Session System Workspace

**Date:** 2026-05-25
**Branch context:** `feature/conversation_artifacts`
**Status:** Design approved, awaiting spec review before implementation plan.

## 1. Motivation

Every V2 conversation should have a dedicated workspace that owns the files attached to that session — both files the user uploads to ask about, and files the AI service generates during a run. V1 already has this concept (`Conversation.systemWorkspaceId`, `WorkspaceService.createSystemWorkspace`, cascade-delete on conversation deletion), and the same pattern is the natural fit for V2.

The workspace lets us:
- Surface "all files in this conversation" as a dedicated UI panel.
- Reuse the existing workspace upload flow for user-uploaded files (no new endpoints).
- Track AI-generated artifacts as first-class `WorkspaceDocument` rows so they appear in the listing alongside user uploads.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Purpose | Both user uploads and AI-generated artifacts |
| 2 | Lifecycle | Eager-create at `POST /sessions`, cascade-delete at `DELETE /sessions` |
| 3 | AI service integration | None — AI keeps writing to its current path; backend creates `WorkspaceDocument` rows pointing at AI-emitted paths |
| 4 | When to register AI files | Only assistant `message` events with `attachments[]` — AI's no-dup contract means no dedupe needed |
| 5 | Frontend exposure | Hidden from global workspace selector (existing `isSystem` filter); dedicated "Files in this conversation" panel in the V2 session UI |

## 3. Architecture & data flow

### 3.1 Lifecycle

```
POST /conversation-v2/sessions
  1. assertUserHasAccess(userId, workspaceIds)
  2. grpcClient.createSession(userId, workspaceIds)  → sessionId
  3. workspaceService.createSystemWorkspace(
       userId, sessionId, allocatedStorage)          → systemWorkspace
  4. sessions.createForUser(
       userId, sessionId, workspaceIds, systemWorkspace.id)
  5. respond { sessionId, workspaceIds, systemWorkspaceId }
```

Step 3 failure rolls back step 2 with a best-effort `grpcClient.stopSession`, then the controller throws so the client sees a failed `POST /sessions`. Step 4 failure is rare (idempotent upsert on `sessionId`) but accepted as a small orphan-leak risk.

```
DELETE /conversation-v2/sessions/:id
  1. owner guard + fetch pointer
  2. if pointer.systemWorkspaceId:
       workspaceDocumentService.deleteAllByWorkspace(systemWorkspaceId)
       workspaceService.deleteSystemWorkspace(systemWorkspaceId)
  3. sessions.softDelete(...)
  4. respond { deleted: true }
```

### 3.2 AI artifact harvest

Inside the `ConversationV2StreamController` per-event `processEvent` closure, after the existing `eventStore.append` + `tagModel` block:

```
if event.type === 'message'
   and payload.role === 'assistant'
   and payload.attachments is a non-empty array
   and systemWorkspaceId is set:
  for each FileInfo in attachments:
     workspaceDocumentService.createFromAiArtifact(systemWorkspaceId, fileInfo)
       .catch(log)
```

Fire-and-forget — a DB hiccup never fails the SSE write. The AI's no-dup contract is the only correctness guarantee; we add no `upsert` logic.

### 3.3 User uploads

Reuse the existing workspace upload pipeline (`/workspace/.../initiate-bulk-upload`, `/workspace/.../request-upload-url`, `/workspace/.../confirm-upload`). Frontend passes `pointer.systemWorkspaceId` as the workspace target. No new backend endpoints.

### 3.4 Endpoint shape changes

| Method | Path | Change |
|---|---|---|
| POST | `/conversation-v2/sessions` | Returns `systemWorkspaceId` in addition to existing fields |
| GET | `/conversation-v2/sessions/:id` | Includes `systemWorkspaceId` in the pointer response |
| DELETE | `/conversation-v2/sessions/:id` | Cascade-deletes the system workspace + documents + S3 objects |
| GET | `/conversation-v2/share/v2/:token` | Session sub-object includes `systemWorkspaceId` |

All other V2 endpoints are unchanged. Existing workspace endpoints are reused as-is.

## 4. Schemas

### 4.1 `ConversationV2Session` (diff)

Add `systemWorkspaceId` to the pointer.

```ts
@Schema({ timestamps: true, collection: 'conversation_v2_sessions' })
export class ConversationV2Session extends Document {
  // ... existing fields preserved ...

  @Prop({ type: Types.ObjectId, ref: 'Workspace', default: null })
  systemWorkspaceId?: Types.ObjectId | null;
}
```

Optional so sessions created before this rework remain valid.

### 4.2 `Workspace` (no change)

- `isSystem: boolean` (already exists) is set `true` by `createSystemWorkspace`.
- `conversationId?: Types.ObjectId` (already exists, `ref: 'Conversation'`) is **left null** for V2 system workspaces. V2 session ids are strings (UUIDs from the AI service), not Mongo ObjectIds, so we don't put them in this field. The link is unidirectional pointer → workspace via `systemWorkspaceId`; no V2 use case requires the reverse lookup.

### 4.3 `WorkspaceDocument` (no change)

Existing schema accommodates AI-emitted file metadata. The new service method (§5.1) creates rows with `status: COMPLETED` since the file already lives in S3 — no upload pipeline involvement.

### 4.4 Config (no change)

Reuse `conversation.systemWorkspaceStorageBytes` (50 MB default, `CONVERSATION_SYSTEM_WORKSPACE_STORAGE_BYTES`).

## 5. Services & module wiring

### 5.1 New: `WorkspaceDocumentService.createFromAiArtifact`

```ts
async createFromAiArtifact(
  systemWorkspaceId: string,
  fileInfo: { id: string; name: string; content_type: string; path: string },
): Promise<void> {
  await this.workspaceDocumentModel.create({
    workspaceId: new Types.ObjectId(systemWorkspaceId),
    name: fileInfo.name,
    path: fileInfo.path,
    contentType: fileInfo.content_type || 'application/octet-stream',
    status: DocumentStatus.COMPLETED,
    size: 0,                  // unknown; backend doesn't HEAD the object
    // Any other fields the existing `create` method sets as defaults (chunk
    // size, language, etc.) copy as-is. The implementer should open the
    // existing `WorkspaceDocumentService.create` method and mirror its
    // default-value choices for fields not explicitly set here. Required
    // fields on the schema that have no sensible AI-side value (e.g.
    // `uploadedBy`) should use the workspace's `createdBy` user id.
  });

  await this.workspaceService.incrementDocumentCount(systemWorkspaceId);
}
```

The size defaults to 0 because the backend doesn't have the actual byte count — accurate sizes would require a HEAD request to S3 and aren't needed for the listing UI. If/when accurate sizes matter, add a HEAD probe in this method later.

### 5.2 `ConversationV2Controller.createSession` (diff)

```ts
async createSession(...): Promise<{
  sessionId: string;
  workspaceIds: string[];
  systemWorkspaceId: string;
}> {
  const workspaceIds = body.workspaceIds ?? [];
  await this.workspaceShare.assertUserHasAccess(user.id, workspaceIds);

  const sessionId = await this.grpcClient.createSession(user.id, workspaceIds);

  let systemWorkspaceId: string;
  try {
    const ws = await this.workspaceService.createSystemWorkspace(
      user.id,
      sessionId,
      this.config.get<number>('conversation.systemWorkspaceStorageBytes', 52428800),
    );
    systemWorkspaceId = ws.id;
  } catch (err) {
    this.grpcClient.stopSession(user.id, sessionId).catch(() => undefined);
    throw err;
  }

  await this.sessions.createForUser(user.id, sessionId, workspaceIds, systemWorkspaceId);
  return { sessionId, workspaceIds, systemWorkspaceId };
}
```

### 5.3 `ConversationV2SessionService.createForUser` (signature change)

Add optional `systemWorkspaceId` parameter; persist it via `$setOnInsert` so re-calls (the stream controller's best-effort safety net) don't overwrite.

```ts
async createForUser(
  ownerId: string,
  sessionId: string,
  workspaceIds: string[] = [],
  systemWorkspaceId?: string,
): Promise<ConversationV2SessionDocument> {
  return this.model
    .findOneAndUpdate(
      { sessionId },
      {
        $setOnInsert: {
          ownerId,
          sessionId,
          title: '',
          status: 'active',
          lastEventAt: new Date(),
          isShared: false,
          shareTokenHash: null,
          deletedAt: null,
          workspaceIds,
          systemWorkspaceId: systemWorkspaceId ?? null,
        },
      },
      { upsert: true, new: true },
    )
    .lean()
    .exec() as unknown as ConversationV2SessionDocument;
}
```

The legacy call from `ConversationV2StreamController.stream` (`this.sessions.createForUser(user.id, sessionId).catch(...)`) passes no `systemWorkspaceId` — that's intentional, and the `$setOnInsert` semantics mean it never clobbers a real value.

### 5.4 `ConversationV2Controller.deleteSession` (diff)

```ts
async deleteSession(...): Promise<{ deleted: true }> {
  const pointer = await this.sessions.getOne(user.id, id);
  if (pointer?.systemWorkspaceId) {
    const wsId = pointer.systemWorkspaceId.toString();
    await this.workspaceDocuments.deleteAllByWorkspace(wsId);
    await this.workspaceService.deleteSystemWorkspace(wsId);
  }
  await this.sessions.softDelete(user.id, id);
  return { deleted: true };
}
```

### 5.5 `ConversationV2StreamController.stream` — AI artifact harvester

Resolve `systemWorkspaceId` once at the top of the stream handler (one Mongo read from the pointer). Inside the existing `processEvent` async closure, after the `tagModel` block and before `pointerWriter.apply`:

```ts
if (
  event.type === 'message' &&
  (event.payload as { role?: string }).role === 'assistant' &&
  Array.isArray((event.payload as { attachments?: unknown[] }).attachments) &&
  systemWorkspaceIdForThisStream
) {
  const attachments = (event.payload as { attachments: FileInfo[] }).attachments;
  for (const fileInfo of attachments) {
    this.workspaceDocuments
      .createFromAiArtifact(systemWorkspaceIdForThisStream, fileInfo)
      .catch((e) => this.logger.warn(`Artifact registration failed: ${(e as Error).message}`));
  }
}
```

`systemWorkspaceIdForThisStream` is `null` for legacy sessions; the block is skipped.

### 5.6 Controller response shapes

`GET /sessions/:id` and `GET /share/v2/:token` include `systemWorkspaceId` in their returned objects. The frontend `SessionPointer` type gains the same field.

### 5.7 Module wiring

`ConversationV2Module` already imports `WorkspaceModule` (`forwardRef`). Add `WorkspaceService` to the controllers' constructor injection list. `ConfigService` is already injected globally. No new module configuration.

`WorkspaceModule` exports `WorkspaceService` (verify; V1's conversation module already imports it).

### 5.8 Unchanged

- `ConversationV2EventStoreService` — no change.
- `ConversationV2PointerWriterService` — no change.
- gRPC client + proto file — no change.
- Auth guards, share service — no change.

## 6. Frontend changes

### 6.1 Types

```ts
// front/src/modules/conversation-v2/api.ts
export interface SessionPointer {
  // ... existing ...
  systemWorkspaceId: string | null;
}
```

`ConversationV2PointerSummary` (list endpoint shape) does NOT gain the field — the list view doesn't need it.

### 6.2 Store

```ts
interface State {
  // ... existing ...
  systemWorkspaceId: string | null;
  rightPanelMode: 'closed' | 'tool' | 'files'; // extend existing union
}

interface Actions {
  setSystemWorkspaceId: (id: string | null) => void;
  openFilesPanel: () => void;
  // closeRightPanel already exists; same semantics
  // ... existing ...
}
```

`reset()` clears `systemWorkspaceId` and resets `rightPanelMode` to `'closed'`.

### 6.3 Page load

`ConversationV2SessionPage` and `SharedConversationV2Page` add:

```ts
store.setSystemWorkspaceId(pointer.systemWorkspaceId);
```

immediately after `setSessionId(pointer.sessionId)`.

### 6.4 Right-panel `'files'` mode

Extend `RightPanel.tsx`: when `rightPanelMode === 'files'`, render a new `FilesPanel` component instead of the tool-detail body. Tabs/modes are mutually exclusive (existing pattern).

New `front/src/modules/conversation-v2/components/FilesPanel.tsx`:

- Reads `systemWorkspaceId` from the store.
- Fetches via `apiClient.get('/workspace/' + id + '/documents')` (existing endpoint).
- Renders a list of file chips; click → resolves a signed URL via the existing `conversationV2Api.getFileSignedUrl(path)` flow and opens the `FileViewerSidebar`.
- Refreshes on a counter bumped whenever the store's `events` array gains an assistant `message` event with `attachments[]`.

### 6.5 Composer entry point

In `Composer.tsx`, add a "📎 Files (N)" button alongside the model selector / pause / stop buttons. Toggles `rightPanelMode` between `'files'` and `'closed'`. Disabled when `systemWorkspaceId` is null (legacy sessions).

`N` derives from a memoized selector over `events` counting assistant attachments — cheap, no extra request.

### 6.6 i18n

New keys in the existing `conversation-v2` namespace: `files.button`, `files.title`, `files.empty`, `files.unavailable`. EN + FR.

### 6.7 Out of scope (frontend)

- User-upload UI (drop zone in composer). The backend endpoints already work; only the surface is missing. Follow-up effort.
- File deletion from the panel. Read-only for v1 of this rework.
- Cross-tab synchronization. The panel refreshes from event-counter heuristics; a user uploading from another tab won't see changes until they trigger a refresh in this one.

## 7. Migration & rollout

- No proto change. No AI service change. No migration script.
- Existing post-tombstone V2 sessions don't have `systemWorkspaceId` and continue to work read-only: files button is disabled, AI artifacts are not registered. Assistant attachments still render inline on message bubbles via the existing `FileInfo` chip pattern.
- New sessions get the full flow from day one.
- Rollback path: `git revert` the implementation commits. Newly-created system workspaces from the deployed period become orphans. A future cron sweep can match `Workspace.isSystem=true` rows against active session pointers and delete unreferenced ones.

## 8. Error handling & edge cases

- **Workspace creation fails mid-POST.** Rollback via best-effort `grpcClient.stopSession`. Original error propagates as 500. No orphan pointer.
- **Pointer write fails after workspace creation.** Accept the small leak (gRPC session + system workspace both orphaned). Idempotent upsert on `sessionId` makes this rare.
- **AI artifact registration fails mid-stream.** Logged, swallowed. SSE frame still emitted; the user sees the attachment chip on the message bubble. Only the workspace-listing UI misses the entry. Acceptable.
- **DELETE during a live chat.** OwnerGuard permits. Cascade fires. The in-flight gRPC stream's subsequent `createFromAiArtifact` calls fail silently. Pointer is soft-deleted. UI stops listing the session. No orphaned bytes.
- **Legacy sessions (no `systemWorkspaceId`).** Every backend branch gates on `if (pointer.systemWorkspaceId)`. Frontend disables/hides the files button.
- **Workspace selector exposure.** Verify existing V1 listing endpoints filter `isSystem: true`. If V2 ever adds its own listing endpoint, mirror the filter.

## 9. Testing strategy

### 9.1 Backend (Jest)

- `WorkspaceDocumentService.createFromAiArtifact` — unit test the new method with a mocked model.
- `ConversationV2Controller.createSession` — assert the system workspace is created and its id is returned + persisted; assert gRPC rollback on workspace creation failure.
- `ConversationV2Controller.deleteSession` — assert cascade delete of documents + workspace when pointer has `systemWorkspaceId`; assert no-op cascade when it's null.
- `ConversationV2StreamController` — extend the existing spec with a "harvests AI attachments into the system workspace" test (mock `createFromAiArtifact`, drive an assistant `message` event with attachments, assert one call per `FileInfo`).

### 9.2 Frontend (Vitest)

- Store: `setSystemWorkspaceId` updates state; `openFilesPanel` / `closeRightPanel` toggle `rightPanelMode` between `'files'` and `'closed'`.
- `FilesPanel.test.tsx`: mounts with a `systemWorkspaceId`, mocks the documents endpoint, asserts list rendering and click → file viewer flow.
- `Composer` test: files button renders with the right counter; disabled state when `systemWorkspaceId` is null.

### 9.3 Out of scope

- E2E against real S3 / Ceph.
- AI service contract tests (the no-dup file path guarantee is contractual).

## 10. Open / deferred items

- User-upload UI in the composer (drop zone, paste). Backend endpoints already work; only the surface is missing.
- File deletion from the panel.
- Cross-tab live synchronization for the files panel.
- Orphan workspace cleanup cron.
