# Conversation V2 — Frontend

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

The toggle in `DeployControls` switches between Nodepod (local dev) and
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

From SSE / replay ([`interfaces/events.ts`](interfaces/events.ts)):

```ts
// Core message
{ type: 'message'; event_id: string; timestamp: number; role: 'user'|'assistant'; content: string; attachments?: FileInfo[]; model?: string }

// Application preview
{ type: 'application_component'; event_id: string; timestamp: number; url: string; title?: string; ceph_path?: string; files_tree?: FilesTreeNode | null; file_count?: number; revision_id?: string }

// Tool call lifecycle
{ type: 'tool_call_start'; event_id: string; tool_call_id: string; tool_name: string; function_name: string; function_args: Record<string, unknown> }
{ type: 'tool_call_end'; event_id: string; tool_call_id: string; function_result: unknown; tool_content?: { result: unknown } }

// Progress
{ type: 'app_build_progress'; event_id: string; phase: string; message?: string; progress?: number }

// Plan & thinking
{ type: 'plan'; event_id: string; steps: PlanStep[] }
{ type: 'thinking'; event_id: string; content: string }

// Questions
{ type: 'question'; event_id: string; question_id: string; question_text: string; options?: QuestionOption[] }

// Lifecycle
{ type: 'title'; event_id: string; title: string }
{ type: 'done'; event_id: string; timestamp: number }
{ type: 'error'; event_id: string; error: string }
{ type: 'wait'; event_id: string; question_id?: string }
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

[`store.ts`](store.ts) (Zustand) keeps:

```ts
// Session
sessionId: string | null;
title: string;
status: 'active' | 'completed' | 'error' | 'waiting';
isShared: boolean;
workspaceIds: string[];
selectedSkillIds: string[];
selectedConnectorIds: string[];
systemWorkspaceId: string | null;

// Messages
messages: TimelineEntry[];       // ordered events for rendering
toolCalls: Map<string, ToolCallState>;  // tool call lifecycle

// App Builder
applicationComponent: {
  url: string;
  title: string;
  cephPath?: string;
  filesTree?: FilesTreeNode | null;
  fileCount?: number;
  revision: string;   // event_id — remounts Nodepod on new generation
  revisionId?: string;
} | null;

// Deploy
deployStatus: 'idle' | 'deploying' | 'deployed' | 'error';
deployedUrl: string | null;
deployedAppTitle: string | null;
lastDeployedAt: string | null;

// UI state
rightPanelMode: 'code' | 'preview';
selectedFile: string | null;
rightPanelOpen: boolean;
```

- Live: `handleEvent('application_component')` sets the object and `rightPanelMode: 'app'`.
- Replay / cache: `deriveApplicationComponent` takes the **last** `application_component` in history.
- `setDeployState` updates `deployedUrl` only — it does **not** overwrite Nodepod source fields.

### Session reducer

`utils/session-reducer.ts` (382L) processes SSE events into timeline entries:

- Deduplicates events by `event_id`.
- Merges consecutive assistant text deltas into a single bubble.
- Tracks tool call start/end lifecycle.
- Handles plan steps, thinking blocks, questions.
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
│  │ ┌─ DeployControls ────────────────────────────────┐ │ │
│  │ │ [Publish] [Nodepod|Deployed] [Share]             │ │ │
│  │ └─────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### Right panel modes

| Mode | Content | When |
|---|---|---|
| **Code** | `AppSourceFileTree` + `AppSourceFileViewer` | Always available after `application_component` |
| **Preview** | Nodepod iframe (live) or Deployed iframe | Default after generation; toggle in DeployControls |

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

Eight specialized views for rendering tool call results in the right panel:

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
conversationV2Api.createSession(body?)           // POST /conversation-v2/sessions
conversationV2Api.getSessions(query?)            // GET /conversation-v2/sessions
conversationV2Api.getSession(id)                 // GET /conversation-v2/sessions/:id
conversationV2Api.patchSession(id, body)         // PATCH /conversation-v2/sessions/:id
conversationV2Api.deleteSession(id)              // DELETE /conversation-v2/sessions/:id

// Chat
conversationV2Api.sendMessage(id, body)          // POST /conversation-v2/sessions/:id/message
conversationV2Api.stopSession(id)                // POST /conversation-v2/sessions/:id/stop
conversationV2Api.pauseSession(id)               // POST /conversation-v2/sessions/:id/pause
conversationV2Api.resumeSession(id)              // POST /conversation-v2/sessions/:id/resume

// Events
conversationV2Api.getEvents(id, query?)          // GET /conversation-v2/sessions/:id/events

// App Builder
conversationV2Api.issueRuntimeTicket(id)         // POST /conversation-v2/sessions/:id/runtime-ticket

// Source revisions
conversationV2Api.getRevisionFiles(id, revId)    // GET …/revisions/:revisionId/files
conversationV2Api.presignRevisionFiles(id, rev, paths) // POST …/revisions/:revisionId/presign
conversationV2Api.commitWorkspaceRevision(id, body)     // POST …/revisions/commit
conversationV2Api.getAppSourceUrls(id, ceph, paths)     // POST …/app-source/urls (legacy)
conversationV2Api.getFileSignedUrl(path)               // POST /conversation-v2/files/signed-url

// Deploy & share
conversationV2Api.deploySession(id, body)        // POST /conversation-v2/sessions/:id/deploy
conversationV2Api.shareDeploy(id, body)          // POST /conversation-v2/sessions/:id/share-deploy
conversationV2Api.getApps()                       // GET /conversation-v2/apps
conversationV2Api.removeApp(id)                   // DELETE /conversation-v2/apps/:id
conversationV2Api.getShared(token)                // GET /conversation-v2/share/v2/:token

// Workspace
conversationV2Api.getWorkspaceDocuments(id, q)   // GET …/workspace-documents
conversationV2Api.getVncSignedUrl(id)             // GET …/vnc/signed-url
```

## SSE streaming

[`conversationV2Stream.ts`](conversationV2Stream.ts) manages the global SSE
connection:

- Connects to `GET /conversation-v2/stream` on app mount.
- Registers named event listeners for each event type.
- Dispatches events to the store via `handleEvent()`.
- Heartbeat handling: server sends `: heartbeat\n\n` every 15s.
- Reconnection: on disconnect, reconnects after a backoff delay.
- Connection ID tracking: server sends `event: connected` with `connectionId`.

### Event → Store mapping

```ts
stream.addEventListener('message', (e) => handleEvent('message', e.data));
stream.addEventListener('application_component', (e) => handleEvent('application_component', e.data));
stream.addEventListener('tool_call_start', (e) => handleEvent('tool_call_start', e.data));
stream.addEventListener('tool_call_end', (e) => handleEvent('tool_call_end', e.data));
stream.addEventListener('app_build_progress', (e) => handleEvent('app_build_progress', e.data));
stream.addEventListener('plan', (e) => handleEvent('plan', e.data));
stream.addEventListener('thinking', (e) => handleEvent('thinking', e.data));
stream.addEventListener('question', (e) => handleEvent('question', e.data));
stream.addEventListener('title', (e) => handleEvent('title', e.data));
stream.addEventListener('done', (e) => handleEvent('done', e.data));
stream.addEventListener('error', (e) => handleEvent('error', e.data));
stream.addEventListener('wait', (e) => handleEvent('wait', e.data));
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
| `interfaces/events.ts` | Event types (message, tool, plan, question, etc.) |
| `interfaces/session.ts` | Session, timeline entry, tool call types |
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
| `RightPanel.tsx` | Resizable panel shell: Code/Preview tabs, deploy controls |
| `ApplicationComponentView.tsx` | Dual-pane: file tree + preview/source |
| `AppSourceFileTree.tsx` | File explorer with search, expand/collapse |
| `AppSourceFileViewer.tsx` | Read-only code viewer |
| `AppBuildProgressPanel.tsx` | Build progress stepper |
| `DeployControls.tsx` | Publish/Update, Nodepod↔Deployed toggle, Share |
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
| `runtime/RuntimeToolHandlers.ts` | MCP tool → VFS operation mapping (730L) |
| `runtime/RuntimeCapabilities.ts` | Capability detection (filesystem, npm, preview) |
| `runtime/WorkspaceRevisionStore.ts` | In-memory workspace state + SHA-256 tracking |
| `runtime/ToolError.ts` | Typed tool error class |
| `runtime/paths.ts` | Path normalization and validation |
| `runtime/limits.ts` | File size, depth, concurrency limits |
| `runtime/hashing.ts` | SHA-256 hashing utility |
| `runtime/command-line.ts` | Shell command parsing (safe exec) |
| `runtime/unified-diff.ts` | Unified diff parser and applicator |

### Tests

22 test files covering:
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
