# Conversation V2 — Frontend

> **Documentation technique junior (Conversation en mode Agent / conversation-v2, code vérifié)** : [../../../../back/src/modules/conversation-v2/DOCUMENTATION_TECHNIQUE.md](../../../../back/src/modules/conversation-v2/DOCUMENTATION_TECHNIQUE.md)

React module for Manus conversations: composer, streaming timeline,
right panel (tool details + **Nodepod app preview**), skills/connectors,
**Runtime Browser Host**, **source revision viewer**, **deploy controls**,
and **App Marketplace** integration. 

Related docs:

- [`SKILLS.md`](SKILLS.md) — skill selection UI / store
- [`CONNECTORS.md`](CONNECTORS.md) — connector selection UI / store

Backend counterpart:
[`../../../../back/src/modules/conversation-v2/README.md`](../../../../back/src/modules/conversation-v2/README.md).

## Table of Contents

- [Overview](#overview)
- [Application preview (Nodepod)](#application-preview-nodepod)
- [Runtime Browser Host](#runtime-browser-host)
  - [Architecture](#architecture)
  - [Tool handlers](#tool-handlers)
  - [PreviewController](#previewcontroller)
  - [Revision hydration](#revision-hydration)
  - [WorkspaceRevisionStore](#workspacerevisionstore)
- [Event shape](#event-shape)
- [Store](#store)
- [UI layout](#ui-layout)
- [Boot lifecycle](#boot-lifecycle)
- [Tool views](#tool-views)
- [API client](#api-client)
- [SSE streaming](#sse-streaming)
- [Vite / service worker](#vite--service-worker)
- [i18n](#i18n)
- [Key files](#key-files)

---

## Overview

The frontend consumes conversation-v2 events via a global SSE pipe and renders
a split-pane UI:

- **Left**: message timeline with tool calls, plan, thinking, questions
- **Right**: Code/Preview panel with file explorer, Nodepod preview, deploy controls

The **App Builder** flow:

1. User sends a message → composer dispatches via `POST …/message`.
2. SSE events stream in → `session-reducer.ts` reduces them into UI state.
3. When ADK emits `application_component`, the right panel opens in **Preview** mode.
4. `useNodepodPreview` downloads source files via presigned URLs.
5. Nodepod boots in the browser, runs `npm install` + `npm run dev`.
6. The preview iframe shows the live app.
7. User can switch to **Source** (read-only code viewer) or **Code** (file tree).
8. **Publish** button deploys via `POST …/deploy`.
9. **Share** button shares the deployed app by email.

The **Browser Runtime Host** enables OpenCode to execute file operations
directly in the browser via Socket.IO — no server sandbox needed for most tasks.

## Application preview (Nodepod)

Replaces the previous remote-sandbox **iframe-only** preview.

| Piece | Role |
|---|---|
| `useNodepodPreview` | Download files → `Nodepod.boot` → install → spawn → `previewUrl` |
| `ApplicationComponentView` | Toolbar + split: file tree \| Preview / Source |
| `AppSourceFileTree` | Expandable, read-only tree with search |
| `AppSourceFileViewer` | Read-only code (CodeArtifact) + lock badge |
| `flattenFilesTree` | Tree → flat paths for signed-URL batch |

Users **cannot** edit generated sources in this panel — Source is inspection only.

### Dual preview modes

| Mode | Source | When |
|---|---|---|
| **Nodepod** | Browser VFS via presigned URL downloads | During generation (live) |
| **Deployed** | Production URL from `deployedUrl` | After publish |

The centered Preview/Deploy switch in `AppViewModeToggle` switches between Nodepod (local dev) and
deployed (production) iframes.

## Runtime Browser Host

The Runtime Browser Host enables OpenCode (in APImanus) to execute file
operations directly in the user's browser via Socket.IO — the core of the
"browser-first" App Builder architecture.

### Architecture

```
OpenCode (APImanus)
  → POST /api/v1/mcp/app-runtime (JSON-RPC, Bearer mcpToken)
    → RuntimeBrokerService (YellowStorm backend)
      → AppRuntimeGateway (Socket.IO /app-runtime)
        → BrowserRuntimeHost (this module)
          → NodepodRuntimeAdapter (VFS operations)
            → @scelar/nodepod (browser filesystem)
```

### Runtime connection lifecycle

1. **Ticket issuance**: `POST …/runtime-ticket` → one-shot ticket (short-lived).
2. **Socket.IO connect**: `io('/app-runtime', { auth: { ticket } })`.
3. **Registration**: emit `runtime.register` with workspaceId, revisionId, capabilities.
4. **Tool invocation**: server emits `tool.invoke` → host executes → emits `tool.completed`.
5. **Heartbeat**: periodic `runtime.heartbeat` to keep the connection alive.
6. **Rehydrate**: if browser revision is stale, server emits `runtime.rehydrate`.

### Tool handlers

`RuntimeToolHandlers` maps each MCP tool name to a VFS operation:

| Tool | Handler | Nodepod operation |
|---|---|---|
| `list` | `handleList` | `nodepod.readdir()` + stat |
| `read` | `handleRead` | `nodepod.readFile()` + SHA-256 |
| `search` | `handleSearch` | Grep across VFS files |
| `write` | `handleWrite` | `nodepod.writeFile()` + revision commit |
| `apply_patch` | `handleApplyPatch` | Parse unified diff → apply → commit |
| `delete` | `handleDelete` | `nodepod.unlink()` + commit |
| `diff` | `handleDiff` | Compare file versions |
| `run` | `handleRun` | Spawn command in Nodepod |
| `dev_server` | `handleDevServer` | Report/restart Vite dev server |
| `preview_inspect` | `handlePreviewInspect` | DOM inspection via iframe |
| `preview_action` | `handlePreviewAction` | Click/input/scroll in iframe |
| `finalize` | `handleFinalize` | Validate + commit final revision |

Mutating tools (`write`, `apply_patch`, `delete`) trigger a workspace revision
commit to Ceph via `POST …/revisions/commit`.

### PreviewController

Manages the live preview iframe:

- **Build**: runs Vite dev server in Nodepod, captures virtual URL.
- **Reload**: refreshes the iframe after mutations.
- **Inspect**: extracts visible text, DOM tree, console logs, errors.
- **Screenshot**: captures iframe as image (for tool results).
- **Health check**: verifies the preview is rendering correctly.

Status machine: `idle` → `building` → `ready` | `error` → `rebuilding` → …

### Revision hydration

`RevisionHydrator` downloads source files from a revision's presigned URLs
and writes them into the Nodepod VFS:

1. `GET …/revisions/:revisionId/files` → file manifest.
2. Batch `POST …/revisions/:revisionId/presign` → presigned URLs.
3. Fetch each file → `nodepod.writeFile()`.
4. Update workspace revision.

### WorkspaceRevisionStore

In-memory store tracking the current workspace state:

```ts
{
  files: Map<string, { content: string; sha256: string; size: number }>;
  currentRevisionId: string;
  pendingMutations: number;
}
```

Used for:
- SHA-256 optimistic locking on `write`/`apply_patch`.
- Tracking pending mutations for the mutation lock.
- Providing file content for `read`/`search` without hitting VFS.

## Event shape

From SSE / replay ([`interfaces/events.ts`](interfaces/events.ts)). Every event carries a
`BaseEvent` of `{ event_id, timestamp, sequence? }` (`sequence` present on persisted
events, absent on the optimistic client-side user echo):

```ts
// Core message
{ type: 'message'; event_id: string; timestamp: number; role: 'user'|'assistant'; content: string; attachments?: FileInfo[]; modelId?: string | null }

// Tool call lifecycle (single `tool` event, upserted by tool_call_id per turn)
{ type: 'tool'; event_id: string; timestamp: number; tool_call_id: string; name: string; status: string; function: string; args: Record<string, unknown>; content?: ToolContent }

// Plan steps
{ type: 'step'; event_id: string; timestamp: number; id: string; status: string; description: string }
{ type: 'plan'; event_id: string; timestamp: number; steps: Array<{ id: string; status: string; description: string }> }

// Progress
{ type: 'app_build_progress'; event_id: string; timestamp: number; phase: string; message: string }

// Questions (waits for a clarification choice)
{ type: 'wait'; event_id: string; timestamp: number; question_id?: string; question_text?: string; options?: QuestionOption[] }

// Application preview
{ type: 'application_component'; event_id: string; timestamp: number; url: string; title?: string; ceph_path?: string; files_tree?: FilesTreeNode | null; file_count?: number; revision_id?: string }

// Lifecycle
{ type: 'title'; event_id: string; timestamp: number; title: string }
{ type: 'done'; event_id: string; timestamp: number }
{ type: 'error'; event_id: string; timestamp: number; error: string }
```

`FilesTreeNode`:

```ts
{
  name: string;
  type: 'file' | 'directory';
  path?: string;   // files only
  size?: number;
  children?: FilesTreeNode[];
}
```

## Store

[`store.ts`](store.ts) (Zustand) keeps two stores: `useConversationV2Store` (the
active conversation's view state) and `useConversationV2PointersStore` (the session
sidebar list). The active store's `State`:

```ts
// Session
sessionId: string | null;
title: string | null;
systemWorkspaceId: string | null;
workspaceIds: string[];
selectedModelId: string | null;   // null = admin default (persisted per session)
selectedSkillIds: string[];
selectedConnectorIds: string[];
selectedConnectorRepo: SelectedConnectorRepoState | null;

// Streaming / events
events: AgentEvent[];             // ordered events for rendering
streaming: boolean;
streamError: string | null;
lastSequence: number;             // dedupe/gap-detection against live frames
liveToolCallId: string | null;    // latest non-message tool the panel follows
liveAssistantIds: Set<string>;    // assistant event_ids that arrived live (typewriter)
pendingQuestion: PendingQuestion | null;

// Right panel
rightPanelMode: 'closed' | 'tool' | 'app';
rightPanelAppTab: 'preview' | 'data';
selectedToolCallId: string | null;
filesSheetOpen: boolean;

// App Builder
applicationComponent: {
  url: string;
  title: string;
  cephPath?: string;
  filesTree?: FilesTreeNode | null;
  fileCount?: number;
  revision: string;            // SSE event_id — remounts Nodepod on new generation
  workspaceRevisionId?: string; // finalized rev (e.g. rev_13) used to deploy
} | null;
appBuildProgress: AppBuildProgress | null;
appViewMode: 'nodepod' | 'deployed';

// Deploy
deployStatus: 'idle' | 'deploying' | 'deployed' | 'error';
deployedUrl: string | null;
lastDeployedAt: string | null;

// Browser runtime
runtimeStatus: AppRuntimeUiStatus;   // shadows BrowserRuntimeHost; never stores ticket/token

// Background conversations (per-user pipe)
streamingStateCache: Map<string, SessionSlice>;
```

- Live: `handleEvent('application_component')` sets the object, `appBuildProgress: null`
  and `rightPanelMode: 'app'`.
- The per-user pipe routes by `sessionId`: events for other sessions accumulate in
  `streamingStateCache` (via `handleStreamEvent`), switching sessions hydrates from it.
- `setDeployState` updates `deployedUrl` only — it does **not** overwrite Nodepod source
  fields, and does **not** change `appViewMode` (sessions open in Preview / Nodepod by
  default; `deploy()` flips to Deployed after a successful publish).
- Runtime status never stores `ticket` / `mcpToken` / sandbox IDs (see BrowserRuntimeHost).

### Session reducer

`utils/session-reducer.ts` (383L) processes SSE events into timeline entries:

- Deduplicates events by `event_id`.
- Merges consecutive assistant text deltas into a single bubble.
- Tracks tool (`tool`), step (`step`) and plan (`plan`) lifecycle.
- Handles terminal states: `wait` (clarification), `done`, `error`.
- Preserves ordering by `sequence` number.

## UI layout

```
┌─ ConversationV2Header ──────────────── [Publish] [✕] ─┐
│ Title (editable) · status · [Pause] [Stop] [Share]     │
├────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ MessageList ──────────────────────────────────────┐ │
│  │ User message                                        │ │
│  │ ┌─ ThinkingIndicator ─┐                            │ │
│  │ │ ⏳ Thinking...       │                            │ │
│  │ └─────────────────────┘                            │ │
│  │ ┌─ PlanPanel ─────────┐                            │ │
│  │ │ 1. Analyze code      │                            │ │
│  │ │ 2. Write component   │                            │ │
│  │ │ 3. Test              │                            │ │
│  │ └─────────────────────┘                            │ │
│  │ ┌─ ToolCallCard ──────┐                            │ │
│  │ │ 🔧 write src/App.tsx │                            │ │
│  │ └─────────────────────┘                            │ │
│  │ Assistant message (markdown)                        │ │
│  │ ┌─ QuestionChoices ───┐                            │ │
│  │ │ [Option A] [Option B]│                            │ │
│  │ └─────────────────────┘                            │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌─ Composer ─────────────────────────────────────────┐ │
│  │ [Model ▾] [Skills ▾] [Connectors ▾]                │ │
│  │ ┌─ input ────────────────────────┐ [Send] [Stop] ──┤ │
│  └────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────┤
│  ┌─ RightPanel ───────────────────────────────────────┐ │
│  │ [Code] [Preview●]                                   │ │
│  │ ✦ Title · N files · [Live]  [Preview|Source]  ▤ ↻   │ │
│  │ ┌──────────────┬──────────────────────────────────┐ │ │
│  │ │ FILES        │  Preview → Nodepod iframe         │ │ │
│  │ │ ▾ app        │  Source  → read-only CodeArtifact │ │ │
│  │ │   page.tsx   │                                  │ │ │
│  │ │ package.json │                                  │ │ │
│  │ └──────────────┴──────────────────────────────────┘ │ │
│  │ ┌─ Header: [Code|Preview|Data]  [Preview|Deployed]  [Share][Update] │ │
│  │ └───────────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### Right panel modes

The panel has two `rightPanelMode` values (`tool` and `app`), plus an inner
`rightPanelAppTab` selector for the app surface:

| Mode | Content | When |
|---|---|---|
| **Tool** | `ToolDetailDispatch` (tool call details for the selected tool) | Selecting a tool call in the timeline |
| **App — Preview / Source** | `ApplicationComponentView`: `AppSourceFileTree` + read-only `AppSourceFileViewer`, or Nodepod (live) / Deployed iframe | After `application_component`; centered Preview↔Deploy switch in `AppViewModeToggle` |
| **App — Data** | `AppDataPanel` (production database dev/prod tables + rows) | App data tab when the app has an app-data store |

Selecting a file in the tree switches the main pane to **Source** (read-only).
Binary files show a size message instead of a viewer.

### Tool detail views

When a tool call is selected in the timeline, the right panel shows
`ToolDetailDispatch` which routes to the appropriate view:

| View | Content |
|---|---|
| `BrowserToolView` | Live VNC viewer (noVNC RFB) + screenshot fallback, take-over button |
| `ShellToolView` | Terminal output with copy button |
| `FileToolView` | Code artifact + "Open in file viewer" button |
| `SearchToolView` | Search results as cards with file links |
| `McpToolView` | JSON display of MCP server/tool results |
| `WebPageToolView` | iframe embed of a URL |
| `GenericToolView` | JSON dump for unknown tool types |

## Boot lifecycle

`useNodepodPreview` status machine:

`idle` → `loading` (download) → `installing` (`npm install`) → `starting`
(`npm run dev`) → `ready` | `error`

- Exposes `files` map for the Source viewer once downloads succeed.
- Teardown on unmount / `revision` change / retry.
- Without `cephPath` + `filesTree`: stays `idle` with a waiting message
  (no remote sandbox iframe fallback).

## Tool views

Seven specialized views for rendering tool call results in the right panel:

| Component | Renders |
|---|---|
| `BrowserToolView` | VNC live viewer + screenshot + take-over button |
| `ShellToolView` | Terminal output with copy-to-clipboard |
| `FileToolView` | Code content + "Open in file viewer" action |
| `SearchToolView` | Search results as clickable cards |
| `McpToolView` | JSON-formatted MCP tool result |
| `WebPageToolView` | Embedded iframe preview of a URL |
| `GenericToolView` | Fallback JSON dump |

## API client

[`api.ts`](api.ts):

```ts
// Sessions
conversationV2Api.createSession(workspaceIds?)       // POST /conversation-v2/sessions
conversationV2Api.listSessions(params?)              // GET /conversation-v2/sessions
conversationV2Api.getSession(id)                     // GET /conversation-v2/sessions/:id
conversationV2Api.patchSession(id, body)             // PATCH /conversation-v2/sessions/:id
conversationV2Api.deleteSession(id)                  // DELETE /conversation-v2/sessions/:id

// Chat
conversationV2Api.sendMessage(id, body)              // POST /conversation-v2/sessions/:id/message
conversationV2Api.stopSession(id)                    // POST /conversation-v2/sessions/:id/stop
conversationV2Api.pauseSession(id)                   // POST /conversation-v2/sessions/:id/pause
conversationV2Api.resumeSession(id)                  // POST /conversation-v2/sessions/:id/resume

// Events
conversationV2Api.listEvents(id, since, limit?)      // GET /conversation-v2/sessions/:id/events

// Users
conversationV2Api.searchUsers(query, limit?)         // GET /users/search

// App Builder runtime
conversationV2Api.createRuntimeTicket(id)            // POST /conversation-v2/sessions/:id/runtime-ticket

// Source revisions
conversationV2Api.getRevisionFiles(id, revId)        // GET …/revisions/:revisionId/files
conversationV2Api.presignRevisionFiles(id, rev, paths) // POST …/revisions/:revisionId/presign
conversationV2Api.commitWorkspaceRevision(id, body)     // POST …/revisions/commit
conversationV2Api.getAppSourceUrls(id, ceph, paths)     // POST …/app-source/urls (legacy)
conversationV2Api.getFileSignedUrl(path)               // POST /conversation-v2/files/signed-url

// Deploy & share
conversationV2Api.deploySession(id, body)            // POST /conversation-v2/sessions/:id/deploy
conversationV2Api.shareDeployedApp(id, emails)       // POST /conversation-v2/sessions/:id/share-deploy
conversationV2Api.getShared(token)                   // GET /conversation-v2/share/v2/:token

// App data (production database)
conversationV2Api.getAppDataStatus(id)               // GET …/app-data/status
conversationV2Api.getAppDataTables(id, env)          // GET …/app-data/:env/tables
conversationV2Api.getAppDataRows(id, env, table)     // GET …/app-data/:env/tables/:table/rows

// Workspace
conversationV2Api.listWorkspaceDocuments(id, params) // GET …/workspace-documents
conversationV2Api.getVncSignedUrl(id)                // GET …/vnc/signed-url
```

The deployed-apps Marketplace list and removal (`GET /conversation-v2/apps`,
`DELETE /conversation-v2/apps/:id`) are consumed by the sibling `app-marketplace`
module (`appMarketplaceApi`), not `conversationV2Api`.

## SSE streaming

[`conversationV2Stream.ts`](conversationV2Stream.ts) manages the global SSE
connection:

- Connects to `GET /conversation-v2/stream` on app mount.
- Registers named event listeners for each event type.
- Dispatches events to the store via `handleStreamEvent()` (routes by `sessionId`).
- Heartbeat handling: server sends `event: heartbeat` every 15s; a 35s watchdog reconnects on silence.
- Reconnection: on disconnect, reconnects with exponential backoff (up to 10 attempts, 1s → 60s).
- Connection ID tracking: server sends `event: connected` with `connectionId`.

### Event → Store mapping

```ts
stream.addEventListener('message', (e) => handleStreamEvent('message', e.data));
stream.addEventListener('tool', (e) => handleStreamEvent('tool', e.data));
stream.addEventListener('step', (e) => handleStreamEvent('step', e.data));
stream.addEventListener('plan', (e) => handleStreamEvent('plan', e.data));
stream.addEventListener('wait', (e) => handleStreamEvent('wait', e.data));
stream.addEventListener('title', (e) => handleStreamEvent('title', e.data));
stream.addEventListener('done', (e) => handleStreamEvent('done', e.data));
stream.addEventListener('error', (e) => handleStreamEvent('error', e.data));
stream.addEventListener('application_component', (e) => handleStreamEvent('application_component', e.data));
stream.addEventListener('app_build_progress', (e) => handleStreamEvent('app_build_progress', e.data));
```

## Vite / service worker

Nodepod needs `/__sw__.js` on the app origin. Configured in
[`vite.config.ts`](../../../vite.config.ts) via:

```ts
import nodepod from '@scelar/nodepod/vite';
plugins: [react(), tailwindcss(), nodepod()],
```

SharedArrayBuffer also requires cross-origin isolation headers on the
document origin (dev + prod):

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

Set in `vite.config.ts` (`server` / `preview`) and
[`nginx.conf`](../../../nginx.conf) for the production image. Prefer
`credentialless` over `require-corp` so Ceph/S3 signed downloads and API
calls keep working without CORP on every upstream.

Dependency: `@scelar/nodepod` in `front/package.json`.

## i18n

Keys under `nodepod.*` and `appRuntime.*` in [`locales/en.json`](locales/en.json)
and [`locales/fr.json`](locales/fr.json) (status badges, tabs, read-only, errors,
tool views, deploy controls).

## Key files

### Root

| Path | Role |
|---|---|
| `ConversationV2SessionPage.tsx` | Main session page (layout: header + messages + composer + right panel) |
| `ConversationV2Page.tsx` | Session list page |
| `SharedConversationV2Page.tsx` | Read-only shared view |
| `store.ts` | Zustand store — session, messages, tools, deploy, SSE state |
| `api.ts` | REST API client (all endpoints) |
| `conversationV2Stream.ts` | Global SSE connection + event dispatch |
| `useStream.ts` | SSE subscription hook with cleanup |
| `types.ts` | Re-exports from `interfaces/` |
| `features.ts` | Feature flags |
| `session-permissions.ts` | Permission constants |
| `selectedModelStorage.ts` | Persisted model selection |
| `conversation-merge.ts` | Merge conversation history from cache |

### interfaces/

| Path | Role |
|---|---|
| `interfaces/events.ts` | Event types (message, tool, step, plan, wait, lifecycle, application) |
| `interfaces/session.ts` | Session, pointer, status, deploy state types |
| `interfaces/application.ts` | FilesTreeNode, ApplicationComponent types |
| `interfaces/api.ts` | API response types |
| `interfaces/permissions.ts` | Permission types |

### utils/

| Path | Role |
|---|---|
| `utils/session-reducer.ts` | SSE events → timeline entries (dedup, merge, ordering) |
| `utils/timeline.ts` | Timeline ordering and filtering |
| `utils/tool-info.ts` | Tool name/icon/color mapping |
| `utils/files-tree.ts` | Tree → flat paths, tree rendering helpers |
| `utils/app-source.ts` | Icons, text vs binary file detection |
| `utils/app-build-phase.ts` | Build phase enum + progress calculation |
| `utils/npm-install-output.ts` | Parse npm install output for progress |

### hooks/

| Path | Role |
|---|---|
| `hooks/useNodepodPreview.ts` | Nodepod boot/teardown/file download lifecycle |
| `hooks/useVncSession.ts` | VNC connection management |
| `hooks/useTypewriter.ts` | Typewriter animation for streaming text |

### components/

| Path | Role |
|---|---|
| `components/MessageList.tsx` | Message timeline rendering with auto-scroll |
| `components/MessageBubble.tsx` | Individual message (markdown, code blocks) |
| `components/Composer.tsx` | Input + model/skill/connector selectors + send/stop |
| `components/ConversationV2Header.tsx` | Title, status, pause/stop/share buttons |
| `components/ToolCallCard.tsx` | Tool call summary card |
| `components/StepBlock.tsx` | Plan step with badge |
| `components/StepBadge.tsx` | Step status badge |
| `components/ThinkingIndicator.tsx` | Thinking animation |
| `components/TypewriterStreamdown.tsx` | Progressive text reveal |
| `components/QuestionChoices.tsx` | Question option buttons |
| `components/PlanPanel.tsx` | Plan steps display |
| `components/FilesSheet.tsx` | Workspace files sheet |
| `components/RenameDialog.tsx` | Session rename dialog |
| `components/DeleteConversationDialog.tsx` | Delete confirmation |
| `components/WorkspaceManagerSheet.tsx` | Workspace attachment manager |

### components/RightPanel/

| Path | Role |
|---|---|
| `RightPanel.tsx` | Resizable panel shell: Tool/App (Preview | Data) tabs, deploy controls |
| `ApplicationComponentView.tsx` | Dual-pane: file tree + preview/source |
| `AppSourceFileTree.tsx` | File explorer with search, expand/collapse |
| `AppSourceFileViewer.tsx` | Read-only code viewer |
| `AppBuildProgressPanel.tsx` | Build progress stepper |
| `AppDataPanel.tsx` | App-data store browse: dev/prod environments, tables, rows |
| `DeployControls.tsx` | Publish/Update, Share; `AppViewModeToggle` for Preview↔Deploy |
| `ShareDeployDialog.tsx` | User search + email share dialog |

### components/RightPanel/tool-views/

| Path | Role |
|---|---|
| `ToolDetailDispatch.tsx` | Routes tool events to correct view by `content.kind` |
| `BrowserToolView.tsx` | VNC live viewer + screenshot + take-over |
| `ShellToolView.tsx` | Terminal output + copy |
| `FileToolView.tsx` | Code artifact + "Open in file viewer" |
| `SearchToolView.tsx` | Search result cards |
| `McpToolView.tsx` | MCP tool JSON result |
| `WebPageToolView.tsx` | iframe URL embed |
| `GenericToolView.tsx` | Fallback JSON dump |

### runtime/

| Path | Role |
|---|---|
| `runtime/runtime.types.ts` | Runtime protocol types (Socket.IO events, tool calls) |
| `runtime/BrowserRuntimeHost.ts` | Orchestrator: Socket.IO connection, tool dispatch, VFS operations |
| `runtime/BrowserRuntimeClient.ts` | Socket.IO client wrapper (connect, emit, on, disconnect) |
| `runtime/PreviewController.ts` | Preview iframe management, build, reload, inspect |
| `runtime/NodepodRuntimeAdapter.ts` | Nodepod VFS adapter (read/write/list/delete/search) |
| `runtime/RevisionHydrator.ts` | Download revision files → write to Nodepod VFS |
| `runtime/RuntimeToolHandlers.ts` | MCP tool → VFS operation mapping (739L) |
| `runtime/RuntimeCapabilities.ts` | Capability detection (filesystem, npm, preview) |
| `runtime/WorkspaceRevisionStore.ts` | In-memory workspace state + SHA-256 tracking |
| `runtime/ToolError.ts` | Typed tool error class |
| `runtime/paths.ts` | Path normalization and validation |
| `runtime/limits.ts` | File size, depth, concurrency limits |
| `runtime/hashing.ts` | SHA-256 hashing utility |
| `runtime/command-line.ts` | Shell command parsing (safe exec) |
| `runtime/unified-diff.ts` | Unified diff parser and applicator |

### Tests

19 test files covering:
- Store state management (`store.test.ts`)
- Session reducer (`session-reducer.test.ts`)
- Conversation merge (`conversation-merge.test.ts`)
- Runtime tool handlers (`RuntimeToolHandlers.test.ts`)
- Browser runtime host (`BrowserRuntimeHost.test.ts`)
- Browser runtime client (`BrowserRuntimeClient.test.ts`)
- Preview controller (`PreviewController.test.ts`)
- Revision hydrator (`RevisionHydrator.test.ts`)
- Workspace revision store (`WorkspaceRevisionStore.test.ts`)
- Path utilities (`paths.test.ts`)
- Command line parsing (`command-line.test.ts`)
- Unified diff (`unified-diff.test.ts`)
- File tree utilities (`files-tree.test.ts`)
- NPM output parsing (`npm-install-output.test.ts`)
- Nodepod preview hook (`useNodepodPreview.test.ts`)
- VNC session hook (`useVncSession.test.ts`)
- Stream hook (`useStream.test.ts`)
- Runtime status store (`runtimeStatus.store.test.ts`)
- Right panel component (`RightPanel.test.tsx`)
