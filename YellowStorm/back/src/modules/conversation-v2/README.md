# Conversation V2 — Backend

NestJS module that bridges YellowStorm to the APImanus gRPC
`ConversationV2` service: sessions, streaming chat, event persistence, SSE
fan-out, deploy, in-browser app preview, **Runtime MCP broker**, **source
revision management**, and **Nodepod browser runtime** orchestration.

Related docs in this folder: 

- [`SKILLS.md`](SKILLS.md) — skill selection → gRPC
- [`CONNECTORS.md`](CONNECTORS.md) — connector bindings → gRPC

The App Builder runtime lives in the sibling module
[`../app-runtime/`](../app-runtime/README.md); conversation-v2 is the
**session & streaming** layer that consumes its services.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Session lifecycle](#session-lifecycle)
- [Streaming chat](#streaming-chat)
- [Event persistence](#event-persistence)
- [Event data flow](#event-data-flow)
- [SSE fan-out](#sse-fan-out)
- [Application preview / Nodepod](#application-preview--nodepod)
- [App Builder runtime integration](#app-builder-runtime-integration)
  - [Runtime ticket](#runtime-ticket)
  - [Runtime MCP endpoint](#runtime-mcp-endpoint)
  - [Socket.IO protocol](#socketio-protocol)
  - [Runtime MCP tools](#runtime-mcp-tools)
  - [Capabilities](#capabilities)
  - [Consistency guarantees](#consistency-guarantees)
- [Source revisions](#source-revisions)
- [Deploy](#deploy)
- [App sharing / Marketplace](#app-sharing--marketplace)
- [RBAC / guards](#rbac--guards)
- [API reference](#api-reference)
- [Key files](#key-files)
- [Environment variables](#environment-variables)

---

## Overview

| Concern | Behaviour |
|---|---|
| Sessions | Create / list / get / rename / delete pointers in Mongo |
| Chat | Background gRPC `Chat` stream → persist events → SSE to the user |
| Tools / plan / steps | Forwarded as typed SSE events |
| App preview | `application_component` carries preview URL **and** Ceph source metadata for Nodepod |
| **Runtime MCP** | **Streamable HTTP JSON-RPC endpoint serving 12 tools (list, read, search, write, apply_patch, delete, diff, run, dev_server, preview_inspect, preview_action, finalize)** |
| **Browser runtime** | **Socket.IO `/app-runtime` — dispatch tool calls to browser Nodepod, handle heartbeats, revision guards, mutation locks** |
| **Source revisions** | **Commit immutable revision manifests to Ceph, presign file reads, hydrate revisions** |
| Deploy | HTTP App Builder (`POST …/sessions/:id/deploy`), independent of Nodepod |
| **App sharing** | **Email-based share with notification, App Marketplace with owned + shared apps** |
| **RBAC** | **Owner / viewer roles with granular permissions (session.read, events.read, files.read, workspace_documents.read, session.write, session.delete, stream.write, deploy.write, share.write)** |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React)                                               │
│    ↕ SSE (GET /stream)        ↕ Socket.IO (/app-runtime)       │
├─────────────────────────────────────────────────────────────────┤
│  conversation-v2 module                                         │
│    StreamController ──→ StreamService ──→ GrpcClientService     │
│    Controller (REST) ──→ SessionService, EventStore, Deploy     │
│    StreamGateway (SSE fan-out per user)                         │
├─────────────────────────────────────────────────────────────────┤
│  app-runtime module                                             │
│    McpController (Streamable HTTP JSON-RPC)                     │
│    RuntimeBrokerService → RuntimeToolDispatcherService          │
│    AppRuntimeGateway (Socket.IO /app-runtime)                   │
│    RuntimeBindingService, RuntimeRevisionService                │
│    RuntimeTicketService, RuntimeTokenService                    │
└──────────────┬──────────────────────────────────┬───────────────┘
               │                                  │
    OpenCode (APImanus)                 Browser Nodepod (VFS)
    POST /api/v1/mcp/app-runtime       Socket.IO tool.invoke
```

### APImanus side

APImanus hosts the OpenCode gateway and calls `POST /internal/app-runtime/bind`
to obtain `mcpUrl` + `mcpToken`. It passes these to OpenCode, which invokes
Runtime MCP tools over Streamable HTTP. APImanus does **not** host Runtime MCP
on its own path (unless `APP_RUNTIME_MCP_LOCATION=apimanus` for legacy rollback).

### YellowStorm side

YellowStorm serves the Runtime MCP endpoint, brokers tool calls to the browser
via Socket.IO, manages source revisions in Ceph, and handles deploy/sharing.

## Session lifecycle

```
POST /conversation-v2/sessions
  → 1. Create session pointer in Mongo (status: active)
  → 2. Create system workspace (50MB default)
  → 3. Create gRPC session in ADK (with workspace paths)
  → 4. Attach aiSessionId + systemWorkspaceId to pointer
  → Return { sessionId, workspaceIds, systemWorkspaceId }
```

Cleanup on partial failure: if step 2/3/4 fails, earlier artifacts are
rolled back (system workspace deleted, gRPC session stopped, draft removed).

## Streaming chat

The stream is **fully decoupled** from any HTTP request:

1. `POST …/message` persists the user event and kicks off a background gRPC
   subscription.
2. Every AI event is persisted to the event store AND pushed to all of the
   user's open SSE pipes via the gateway.
3. A single SSE pipe carries events for **all** of the user's conversations
   (each frame tagged with `sessionId`), so switching tabs never tears down a
   running stream.
4. Title generation fires on the first user message (async, via `NameGeneratorService`).
5. Model resolution: per-message `model` → conversation-v2 default → global
   admin default → ADK fallback.
6. Concurrency: max `conversationV2.maxConcurrentStreams` (default 5) concurrent
   streams per user; re-sending on the same session returns `CONVERSATION_ALREADY_STREAMING`.

### Send a message

`POST /conversation-v2/sessions/:id/message` (body, returns `202`). The
resulting events are delivered over the persistent `/stream` pipe — this request
only persists the user echo and registers the background stream before returning.

| Field | Type | Description |
|---|---|---|
| `message` | `string` | Required, 1..16384 chars |
| `model` | `string?` | Optional full LiteLLM model id (e.g. `azure/gpt-4.1`); overrides the default chain |
| `clientEventId` | `UUID?` | Client UUID so the SSE frame replaces the optimistic echo instead of duplicating it |
| `skillIds` | `string[]?` | Skill ids to enable for the turn |
| `connectorIds` | `string[]?` | Connector ids to bind (per-user OAuth resolved) |
| `connectorId` / `connectorName` / `connectorRepoId` / `connectorRepoName` / `connectorRepoUrl` | `string?` | Repo-bound GitHub connector. When `connectorId` + `connectorRepoId` are present, a `[system]` preamble is prepended telling the agent the repo is already selected (no re-prompting). |

### Skills & connectors

Each message can include `skillIds` and `connectorIds`. The stream service
resolves them into full gRPC payloads (including per-user OAuth tokens for
connectors) and forwards to ADK. Selection is persisted on the session so
reload re-hydrates the composer. Connector bindings are resolved with the
current user's auth per request via a `SandboxRuntimeContext`
(`scopeType: 'conversation'`, `scopeId: conversation:{sessionId}`, `laneId: main`).

### Stop / pause / resume

- `POST …/sessions/:id/stop` — go through the gRPC `StopSession` (ends the stream,
  which triggers the local `complete` handler).
- `POST …/sessions/:id/pause` / `…/resume` — gRPC `PauseSession` / `ResumeSession`.

All three translate gRPC errors: `NOT_FOUND`/`PERMISSION_DENIED` → `404 Session not
found`, `UNIMPLEMENTED` → `501`, otherwise rethrow.

## Event persistence

Events are stored in `conversation_v2_events` with an auto-incrementing
`sequence` per session. The sequence is atomically incremented via
`findOneAndUpdate` on the session pointer (`$inc: { eventSequence: 1 }`).

Idempotence: events carry an `eventId` (client-provided or UUID). Duplicate
`eventId` appends are silently deduplicated (the sequence slot is wasted but
the event is not duplicated).

Key fields: `sessionId`, `sequence`, `eventId`, `type`, `emittedAt`, `payload`,
`modelId` (tagged on first assistant message).

## SSE fan-out

`ConversationV2StreamGatewayService` maintains per-user SSE connection sets
(max `conversationV2.maxSseConnections`, default 5). Every pushed event is
written to all live pipes. A write failure on one connection removes just that
connection; others are unaffected.

The global SSE endpoint (`GET /conversation-v2/stream`) is authenticated via
`@StreamAuth()` and uses a 2KB padding frame to avoid initial buffering.

### Pipe frames (`GET /conversation-v2/stream`)

| Frame | Purpose |
|---|---|
| `connected` | Sent on connect; carries `connectionId` (primes the client heartbeat timer) |
| `heartbeat` | Application heartbeat, every `conversationV2.sseHeartbeatMs` (default 15s) |
| `error` | Sent when the per-user connection cap is hit (`CONVERSATION_SSE_LIMIT`) |
| `<event>` | Named event per type (`event: message`, `event: tool`, …) with JSON `data` including `sessionId` + `sequence` |

Connection lifecycle: the controller registers the response via
`registerConnection`, which returns `false` when the user is already at the cap
(the pipe is rejected). On client close, the pipe is removed and the heartbeat
interval is unsubscribed. A `flush()` on each write is called for compression
middleware safety.

The per-session live-tail endpoint (`GET …/stream/live`) polls the event store
every `conversationV2.liveTailPollMs` (default 1000ms) and terminates on
session completion/error. It is a reconnection/replay fallback; the live path is
the persistent `/stream` pipe.

## Application preview / Nodepod

When ADK emits `application_component`, the frontend:

1. Opens the right panel in **Preview** mode.
2. Shows a read-only file tree from `files_tree`.
3. Downloads sources via batch signed URLs (revision-based or `ceph_path`).
4. Boots `@scelar/nodepod` in the browser, runs `npm install` + `npm run dev`.
5. Embeds the local Nodepod preview URL in an iframe.

YellowStorm does **not** boot Nodepod on the server. It:

1. Maps the gRPC event into a typed payload (including parsed `files_tree`).
2. Persists and SSE-pushes that payload to the frontend.
3. Exposes batch Ceph **presigned read URLs** so the browser can download
   sources and hydrate Nodepod's virtual filesystem.

### Proto (`proto/conversation.proto`)

```protobuf
message ApplicationComponentEvent {
  string url = 1;
  string title = 2;
  string ceph_path = 3;
  string files_tree_json = 4;
  int32  file_count = 5;
  string revision_id = 6;
}
```

## App Builder runtime integration

The runtime layer lives in `../app-runtime/` and is consumed by conversation-v2
via three integration points:

### Runtime ticket

```http
POST /conversation-v2/sessions/:id/runtime-ticket
```

Issues a one-shot, short-lived ticket for the browser to authenticate on the
`/app-runtime` Socket.IO namespace. The browser never sees the `mcpToken`.

Keyed on `aiSessionId` (workspace id), not the pointer `_id`, because APImanus
binds the runtime with its own session id.

### Runtime MCP endpoint

```http
POST /api/v1/mcp/app-runtime
Content-Type: application/json
Authorization: Bearer <mcpToken>

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "yellowruntime_write",
    "arguments": { "path": "src/App.tsx", "content": "..." }
  }
}
```

Streamable HTTP — supports both regular POST and SSE streaming for
`tools/list`. Authenticated via `RuntimeMcpAuthService` (bearer token →
binding lookup).

### Socket.IO protocol

Namespace: `/app-runtime`

| Direction | Event | Payload |
|---|---|---|
| Browser → Server | `runtime.register` | `{ runtimeSessionId, workspaceId, revisionId, capabilities, browserRuntimeId? }` |
| Browser → Server | `runtime.heartbeat` | `{ workspaceId, revisionId? }` |
| Browser → Server | `tool.progress` | `{ toolCallId, phase?, message? }` |
| Browser → Server | `tool.completed` | `{ toolCallId, result }` |
| Browser → Server | `tool.failed` | `{ toolCallId, error: { code, message, data? } }` |
| Server → Browser | `tool.invoke` | `{ toolCallId, workspaceId, tool, arguments, baseRevisionId, timeoutMs }` |
| Server → Browser | `runtime.rehydrate` | `{ workspaceId, expectedRevisionId, actualRevisionId }` |

### Runtime MCP tools

12 tools mirroring the APImanus schemas:

| Tool | Description | Capability | Mutating |
|---|---|---|---|
| `list` | List files/directories in workspace | filesystem | No |
| `read` | Read file content with SHA-256 hash | filesystem | No |
| `search` | Regex search across workspace files | filesystem | No |
| `write` | Write/create file (commits revision) | filesystem | **Yes** |
| `apply_patch` | Apply unified diff (commits revision) | filesystem | **Yes** |
| `delete` | Delete file (commits revision) | filesystem | **Yes** |
| `diff` | Diff between revisions | filesystem | No |
| `run` | Spawn binary (npm install, etc.) | npm | No |
| `dev_server` | Report/restart managed Vite preview | npm | No |
| `preview_inspect` | Inspect rendered preview DOM/console | previewInspection | No |
| `preview_action` | Interact with preview (click, input, scroll) | previewInspection | No |
| `finalize` | Finalize revision as completed app | filesystem | No |

### Capabilities

The browser runtime advertises capabilities on `runtime.register`:

```ts
interface RuntimeCapabilities {
  filesystem: boolean;    // Nodepod VFS
  npm: boolean;           // npm install/run
  previewInspection: boolean; // DOM inspection
  nativeBinaries: boolean;    // Always false in Nodepod
}
```

A tool whose required capability is missing fails with `UNSUPPORTED_CAPABILITY`
(`-32001`). MicroVM fallback is planned for phase 5.

### Consistency guarantees

- **Idempotence**: `toolCallId` is unique in `app_runtime_tool_calls`. A settled
  call replays its stored outcome instead of mutating twice.
- **One mutation at a time**: `write`, `apply_patch` and `delete` serialize on a
  per-workspace lock (`APP_RUNTIME_MUTATION_WAIT_MS`, default 30s).
- **Revision guard**: mutations are refused when the browser revision differs
  from the binding revision. `runtime.rehydrate` is emitted first.

### Error codes

| Code | Constant | Meaning |
|---|---|---|
| `-32001` | `UNSUPPORTED_CAPABILITY` | Tool requires a capability the browser doesn't have |
| `-32002` | `RUNTIME_OFFLINE` | No socket connected, or heartbeat timed out |
| `-32003` | `REVISION_CONFLICT` | Browser filesystem is stale, needs rehydrate |
| `-32005` | `TOOL_TIMEOUT` | Tool execution or mutation lock timeout |

## Source revisions

### Commit a workspace revision

```http
POST /conversation-v2/sessions/:id/revisions/commit
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "revisionId": "rev_17",
  "parentRevisionId": "rev_16",
  "files": [
    { "path": "src/App.tsx", "sha256": "abc...", "size": 1234, "objectKey": "..." }
  ],
  "toolCallId": "tc_..."
}
```

Response:
```json
{
  "revisionId": "rev_17",
  "parentRevisionId": "rev_16",
  "manifestObjectKey": "revisions/rev_17/manifest.json",
  "fileCount": 1
}
```

### List revision files

```http
GET /conversation-v2/sessions/:id/revisions/:revisionId/files
```

Returns the file manifest (path, sha256, size) for an authorized revision.

### Presign revision files

```http
POST /conversation-v2/sessions/:id/revisions/:revisionId/presign
Content-Type: application/json

{ "paths": ["src/App.tsx", "package.json"] }
```

Returns batch presigned URLs resolved from the revision manifest only
(authorization is workspace-scoped).

### Legacy: app-source/urls

```http
POST /conversation-v2/sessions/:id/app-source/urls
Content-Type: application/json

{
  "cephPath": "yellowstorm/user/appbuilder/conversation/projectSRC",
  "paths": ["package.json", "app/page.tsx"]
}
```

Deprecated — prefer revision-based `…/revisions/:revisionId/presign`.

## Deploy

```http
POST /conversation-v2/sessions/:id/deploy
Content-Type: application/json

{ "revisionId": "rev_15", "title": "My App" }
```

Flow:
1. Resolve revision (explicit `revisionId` or `binding.latestRevisionId`).
2. `POST https://app-deployer.yellowsys.org/app/deploy` with `{ aiSessionId, revisionId }`.
3. Poll `POST …/app/deploy/status` every 15s until `ready`.
4. Store `deployedUrl`, `deployedAppTitle`, `lastDeployedAt` on the session.
5. Sync metadata to app-share rows (recipients see the updated URL).

Status values: `idle` → `deploying` → `deployed` | `error`.

## App sharing / Marketplace

### Share deployed app by email

```http
POST /conversation-v2/sessions/:id/share-deploy
Content-Type: application/json

{ "emails": ["alice@example.com", "bob@example.com"] }
```

For each recipient (YellowMind user or unknown email):
1. Skip self-shares (→ `skippedSelf` list).
2. Issue an opaque register-invite token (`ConversationV2ShareService`), persist
   its SHA-256 hash + expiry (`conversationV2.appShareInviteTtlDays`, default 7 days)
   on the `ConversationV2AppShare` row, and rotate any previous token.
3. Send a branded invite email with a **Create account** CTA to
   `{deployedUrl}register?invite={token}` (yellowsys logo, registration link only).
4. Known YellowMind users also receive an in-app notification.

Unknown emails are stored as pending `recipientEmail` shares (no 404). When that
person later signs into YellowMind with the same email, `claimPendingSharesForUser`
links `recipientUserId`. App end-user accounts on the deployed app are created
separately via Register + invite token (deny-all CRUD until the owner grants
permissions).

### List deployed apps (Marketplace)

```http
GET /conversation-v2/apps
```

Returns owned + shared-with-user apps, deduplicated by sessionId.

### Share via token (read-only)

```http
PATCH /conversation-v2/sessions/:id
Content-Type: application/json

{ "isShared": true }
```

Returns a `shareToken` for public read-only access via `GET /share/v2/:token`.

## RBAC / guards

| Guard | Scope | Checks |
|---|---|---|
| `ConversationV2OwnerGuard` | Write operations (name is historical) | Owner **or** shared recipient via `ConversationV2SessionAccessService` |
| `ConversationV2SessionAccessGuard` | Read operations | Owner → full access; shared → via app-share or token share; enforces fine-grained permissions |

Permissions (via `@RequireConversationSessionPermission`, from
`constants/conversation-v2-session-permissions.ts`):
- `session.read` — read session metadata
- `events.read` — read event history
- `files.read` — read revision/file metadata
- `workspace_documents.read` — read workspace documents
- `session.write` — send messages, issue runtime tickets
- `session.delete` — delete a session
- `stream.write` — write/send on the stream
- `deploy.write` — deploy an app
- `share.write` — share a session/app

Shared recipients resolve to the same full permission set as the owner.

## Event data flow

```
User sends message
  │
  ▼
POST /sessions/:id/message
  │
  ├──→ EventStoreService.append() ──→ conversation_v2_events (sequence++)
  │         │
  │         ▼
  │    PointerWriterService.apply() ──→ updates session pointer (status, title, eventCount)
  │
  └──→ StreamService.startStream()
         │
         ├──→ persist user event + SSE push
         │
         └──→ gRPC Chat stream (APImanus)
                │
                ├── next(event)
                │     │
                │     ├── EventStoreService.append() ──→ conversation_v2_events (sequence++)
                │     │
                │     ├── PointerWriterService.apply() ──→ session pointer
                │     │
                │     └── GatewayService.sendToUser() ──→ SSE pipe(s)
                │           │
                │           └──→ Frontend EventSource listener
                │
                ├── error → emitTerminalError → persist + SSE push
                │
                └── complete → emitTerminalDone → persist + SSE push
```

### Event types

| Type | Persisted | SSE-pushed | Description |
|---|---|---|---|
| `message` | Yes | Yes | User or assistant text (+ attachments) |
| `tool` | Yes | Yes | Tool call with variant content (browser, shell, file, search, mcp, webpage) |
| `step` | Yes | Yes | Agent workflow step update |
| `plan` | Yes | Yes | Multi-step plan snapshot |
| `title` | Yes | Yes | Auto-generated conversation title (first message only) |
| `wait` | Yes | Yes | Agent requests user input with optional options |
| `application_component` | Yes | Yes | App preview with Ceph source metadata |
| `app_build_progress` | Yes | Yes | Build phase progress |
| `done` | Yes | Yes | Turn completed |
| `error` | Yes | Yes | Terminal error |
| `heartbeat` | No | No | gRPC liveness ping — resets idle timer only |

## API reference

### Sessions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/conversation-v2/sessions` | JWT | Create session (auto-assigns all user workspaces if none specified) |
| `GET` | `/conversation-v2/sessions` | JWT | List sessions (cursor-paginated, search by title) |
| `GET` | `/conversation-v2/sessions/:id` | Access guard | Get session detail (status, deploy, permissions) |
| `PATCH` | `/conversation-v2/sessions/:id` | Owner | Rename or toggle share |
| `DELETE` | `/conversation-v2/sessions/:id` | Owner | Soft-delete + cleanup system workspace |

`GET /sessions/:id` (`session.read`) returns the full pointer plus:
`title`, `status`, `isShared`, `workspaceIds`, `selectedSkillIds`,
`selectedConnectorIds`, `lastEventAt`, `eventCount`, `systemWorkspaceId`,
`deployStatus`, `deployedUrl`, `lastDeployedAt`, and the caller's `viewerRole`
(`owner` | `shared`) + `permissions`.

`PATCH /sessions/:id` (Owner):
- `{ "title": string }` — rename.
- `{ "isShared": true }` — issues a new share token (only the hash is stored);
  returns `shareToken` once. `{ "isShared": false }` revokes it (`shareToken: null`).
  Used for public read-only access via `GET /share/v2/:token`.

`DELETE /sessions/:id` (Owner) — soft-deletes the pointer, deletes the system
workspace + its documents, and removes all app-share rows for the session.

### Chat & streaming

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/conversation-v2/sessions/:id/message` | Owner | Send message (fire-and-forget, 202) |
| `GET` | `/conversation-v2/stream` | StreamAuth | Global SSE pipe (all conversations) |
| `GET` | `/conversation-v2/sessions/:id/stream/live` | StreamAuth | Per-session live-tail SSE |
| `POST` | `/conversation-v2/sessions/:id/stop` | Owner | Stop gRPC stream |
| `POST` | `/conversation-v2/sessions/:id/pause` | Owner | Pause gRPC session |
| `POST` | `/conversation-v2/sessions/:id/resume` | Owner | Resume gRPC session |

### Events

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/conversation-v2/sessions/:id/events` | Access guard | List events (sequence-based pagination) |

### App Builder runtime

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/conversation-v2/sessions/:id/runtime-ticket` | Access guard | Issue one-shot browser runtime ticket |
| `POST` | `/api/v1/mcp/app-runtime` | Bearer (mcpToken) | Runtime MCP Streamable HTTP endpoint |

### Source revisions

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/conversation-v2/sessions/:id/revisions/:revisionId/files` | Access guard | List files in a revision |
| `POST` | `/conversation-v2/sessions/:id/revisions/:revisionId/presign` | Access guard | Batch-presign revision file URLs |
| `POST` | `/conversation-v2/sessions/:id/revisions/commit` | Access guard | Commit workspace revision to Ceph |
| `POST` | `/conversation-v2/sessions/:id/app-source/urls` | Access guard | Legacy batch-presign (deprecated) |
| `POST` | `/conversation-v2/files/signed-url` | JWT | Single file presign |

### Deploy & share

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/conversation-v2/sessions/:id/deploy` | Owner | Deploy finalized revision |
| `POST` | `/conversation-v2/sessions/:id/share-deploy` | Owner | Share deployed app by email |
| `GET` | `/conversation-v2/apps` | JWT | List deployed apps (owned + shared) |
| `DELETE` | `/conversation-v2/apps/:id` | JWT | Remove deployed app |
| `GET` | `/conversation-v2/share/v2/:token` | Public | Get shared session + events |

### App Data (end-user management, sibling `app-data` module)

Served by `AppDataOwnerController` under `/conversation-v2/sessions/:id/app-data`,
protected by `ConversationV2OwnerGuard`. Feature-gated by `appData.enabled` +
`appData.dataTabEnabled` (tables) or `appData.endUserAuthEnabled` (end-user mgmt).

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `.../sessions/:id/app-data/status` | Owner read-only App Data status |
| `GET` | `.../sessions/:id/app-data/end-users` | List registered end-users + CRUD grants |
| `PUT` | `.../sessions/:id/app-data/end-users/:userId/grants` | Update CRUD grants (create/read/update/delete) |
| `PATCH` | `.../sessions/:id/app-data/end-users/:userId/status` | Enable/disable an end-user account |
| `GET` | `.../sessions/:id/app-data/:env/tables` | List tables for an environment |
| `GET` | `.../sessions/:id/app-data/:env/tables/:table/rows` | Paginate table rows |

Grant/status updates are audited (`app_data_audit`); row reads skip policy checks
for the owner principal.

### Workspace documents

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/conversation-v2/sessions/:id/workspace-documents` | Access guard (`workspace-documents.read`) | List documents across the session's attached workspaces |
| `GET` | `/conversation-v2/sessions/:id/vnc/signed-url` | Owner | VNC signed URL for sandbox desktop |

The workspace-documents endpoint filters out the session's **system** workspace
and lists across the remaining attached `workspaceIds` only (pagination via
`DocumentQueryDto`). Empty when the session has no non-system workspace.

The VNC endpoint calls the gRPC `GetVncSignedUrl`. It returns `421
VmUnavailable` (via `VmUnavailableException`) when the upstream returns
`UNIMPLEMENTED`/`NOT_FOUND` or omits a URL — the sandbox desktop is unavailable
for that session.

## Key files

### conversation-v2 module

| Path | Role |
|---|---|
| `conversation-v2.controller.ts` | REST endpoints: sessions, deploy, revisions, share, VNC |
| `conversation-v2-stream.controller.ts` | SSE endpoints: global pipe, per-session live-tail, send message |
| `conversation-v2.module.ts` | NestJS module definition |
| `services/conversation-v2-session.service.ts` | CRUD for session pointers in Mongo |
| `services/conversation-v2-session-access.service.ts` | RBAC resolution (owner/viewer, permissions) |
| `services/conversation-v2-stream.service.ts` | Background gRPC consumption, persist + SSE push |
| `services/conversation-v2-stream-gateway.service.ts` | Per-user SSE connection registry + fan-out |
| `services/conversation-v2.grpc-client.service.ts` | gRPC client: create/stop/pause/resume session, chat stream |
| `services/conversation-v2-event-store.service.ts` | Event append with sequence, listSince, tagModel |
| `services/conversation-v2-pointer-writer.service.ts` | Update session status/title from events |
| `services/conversation-v2-share.service.ts` | Token generation, hash, timing-safe verify |
| `services/conversation-v2-deploy.service.ts` | Deploy via app-deployer, polling, timeout |
| `services/conversation-v2-app-share.service.ts` | Email share, notification, conversation access |
| `services/conversation-v2-name-generator.service.ts` | Auto-title from first message |
| `proto/conversation.proto` | gRPC contract (sync with APImanus) |
| `types/conversation-v2.types.ts` | Event / payload TypeScript types |
| `utils/event-mapper.ts` | Wire event → SSE frame conversion |
| `utils/normalize-app-source-ceph-prefix.ts` | Ceph path normalization |
| `guards/conversation-v2-session-access.guard.ts` | Session access guard (owner + shared) |
| `guards/conversation-v2-owner.guard.ts` | Owner-only guard |
| `decorators/require-conversation-session-permission.decorator.ts` | Permission decorator |
| `decorators/current-conversation-session.decorator.ts` | Session injection decorator |
| `constants/conversation-v2-session-permissions.ts` | Permission constants |
| `exceptions/vm-unavailable.exception.ts` | VNC unavailable error |
| `dto/*.ts` | Request DTOs (create, send, list, update, deploy, share, revisions) |

### app-data module (sibling) — end-user permissions

| Path | Role |
|---|---|
| `app-data/controllers/app-data-owner.controller.ts` | End-user + table endpoints under `/conversation-v2/sessions/:id/app-data` |
| `app-data/controllers/app-data-public-invite.controller.ts` | Public `GET …/invites/resolve` for register-invite tokens |
| `app-data/services/app-data-end-user-auth.service.ts` | App end-user register/login + invite consume |
| `app-data/services/app-data-end-user.service.ts` | End-user CRUD + status |
| `app-data/services/app-data-end-user-grants.service.ts` | Per-user CRUD grant persistence |
| `app-data/services/app-data-catalog.service.ts` | App registration, status, environment lookup |
| `app-data/services/app-data-query.service.ts` | Row listing with policy checks |
| `app-data/constants/app-data.errors.ts` | `AppDataException`, `AppDataErrorCode` (deploy integration) |

### app-runtime module (sibling)

| Path | Role |
|---|---|
| `app-runtime/README.md` | Full runtime module documentation |
| `app-runtime/controllers/app-runtime-mcp.controller.ts` | Streamable HTTP MCP endpoint |
| `app-runtime/controllers/app-runtime-internal.controller.ts` | Internal bind + legacy tool-invoke |
| `app-runtime/gateways/app-runtime.gateway.ts` | Socket.IO `/app-runtime` namespace |
| `app-runtime/services/runtime-broker.service.ts` | Tool dispatch orchestration |
| `app-runtime/services/runtime-tool-dispatcher.service.ts` | Dispatch to browser via gateway |
| `app-runtime/services/runtime-binding.service.ts` | Binding CRUD in Mongo |
| `app-runtime/services/runtime-revision.service.ts` | Revision commit, list, presign |
| `app-runtime/services/runtime-ticket.service.ts` | One-shot ticket generation |
| `app-runtime/services/runtime-token.service.ts` | MCP token validation |
| `app-runtime/services/runtime-mcp-auth.service.ts` | MCP bearer auth |
| `app-runtime/services/runtime-mcp-dispatcher.service.ts` | MCP JSON-RPC dispatch |
| `app-runtime/services/runtime-connection.registry.ts` | Socket.IO connection registry |
| `app-runtime/services/app-runtime-conversation-notifier.service.ts` | Publish events to conversation-v2 |
| `app-runtime/mcp/runtime-mcp.tools.ts` | Tool names, descriptions, JSON schemas |
| `app-runtime/mcp/runtime-mcp.jsonrpc.ts` | JSON-RPC request parsing |
| `app-runtime/mcp/runtime-mcp.errors.ts` | MCP error codes |
| `app-runtime/mcp/runtime-mcp-validation.ts` | Tool argument validation |
| `app-runtime/constants/app-runtime-capabilities.ts` | RuntimeCapabilities, tool→capability map |
| `app-runtime/constants/app-runtime-error-codes.ts` | Error code constants |
| `app-runtime/constants/starter-react-vite-v1.ts` | Starter template revision |
| `app-runtime/schemas/app-runtime-binding.schema.ts` | Mongoose binding schema |
| `app-runtime/schemas/app-runtime-tool-call.schema.ts` | Mongoose tool call idempotence schema |
| `app-runtime/schemas/app-runtime-ticket.schema.ts` | Mongoose ticket schema |
| `app-runtime/schemas/app-source-revision.schema.ts` | Mongoose source revision schema |
| `app-runtime/dto/bind-app-runtime.dto.ts` | Bind request DTO |
| `app-runtime/dto/invoke-app-runtime-tool.dto.ts` | Legacy tool-invoke DTO |
| `app-runtime/types/app-runtime-protocol.ts` | Socket.IO event types, ticket result |
| `app-runtime/app-runtime.module.ts` | NestJS module definition |

## Environment variables

### conversation-v2

| Variable | Default | Purpose |
|---|---|---|
| `conversationV2.maxMessageLength` | `16384` | Max chars per message |
| `conversationV2.maxConcurrentStreams` | `5` | Max concurrent streams per user |
| `conversationV2.maxSseConnections` | `5` | Max SSE connections per user |
| `conversationV2.sseHeartbeatMs` | `15000` | SSE heartbeat interval |
| `conversationV2.liveTailPollMs` | `1000` | Per-session SSE poll interval |
| `conversationV2.grpcUrl` | `localhost:50051` | AI service gRPC endpoint |
| `conversationV2.grpcUnaryDeadlineMs` | `5000` | Unary gRPC call timeout |
| `conversationV2.grpcStreamDeadlineMs` | `900000` | gRPC stream deadline (15min) |
| `conversationV2.grpcMaxMessageBytes` | `16777216` | Max gRPC message size (16MB) |
| `conversationV2.grpcIdleTimeoutMs` | `900000` | Idle background stream timeout (15min) |
| `conversation.systemWorkspaceStorageBytes` | `52428800` | System workspace size (50MB) |
| `conversationV2.appBuilderDeployBaseUrl` | `https://app-deployer.yellowsys.org/` | Deploy service URL |
| `conversationV2.appBuilderDeployToken` | — | Deploy service auth token |
| `conversationV2.appBuilderDeployTimeoutMs` | `600000` | Deploy HTTP timeout (10min) |
| `conversationV2.appBuilderDeployInitialStatusDelayMs` | `15000` | First poll delay |
| `conversationV2.appBuilderDeployStatusPollIntervalMs` | `15000` | Status poll interval |
| `conversationV2.appBuilderDeployedAppsPathPrefix` | `/apps` | Public URL prefix for deployed apps |
| `conversationV2.appShareInviteTtlDays` | `7` | TTL for deployed-app register invite tokens |

### app-runtime

| Variable | Default | Purpose |
|---|---|---|
| `APP_RUNTIME_MCP_ENABLED` | `true` | Enable/disable MCP endpoint |
| `APP_RUNTIME_MCP_URL` | — | Public MCP URL returned on bind |
| `APP_RUNTIME_PUBLIC_BASE_URL` | — | Derive MCP URL if MCP_URL unset |
| `APP_RUNTIME_LEGACY_TOOL_INVOKE` | `true` | Legacy HTTP bridge to dispatcher |
| `APP_RUNTIME_TICKET_TTL_MS` | `60000` | Browser ticket lifetime |
| `APP_RUNTIME_HEARTBEAT_TIMEOUT_MS` | `45000` | Offline detection timeout |
| `APP_RUNTIME_TOOL_TIMEOUT_MS` | `180000` | Default tool execution timeout |
| `APP_RUNTIME_MUTATION_WAIT_MS` | `30000` | Per-workspace mutation lock wait |
