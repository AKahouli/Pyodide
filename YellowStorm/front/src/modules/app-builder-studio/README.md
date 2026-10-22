# App Builder Studio — Frontend

React module that powers **App Builder Studio**: composer, streaming timeline,
right panel (tool details + **NodePod app preview**), skills/connectors,
**Runtime Browser Host**, **source revision viewer**, **deploy controls**,
and **App Marketplace** integration.

**Product naming:** User-facing UI/routes say **Studio** / **App Builder Studio**.
Module code lives under `app-builder-studio/`; REST calls use the canonical
`/app-builder` prefix (the backend still accepts the legacy `/conversation-v2`
prefix as an alias). Never surface “conversation-v2” in EN/FR copy.

| Public route | Component | Notes |
|---|---|---|
| `/studio` | `AppBuilderStudioPage` | Studio home / empty state |
| `/studio/:sessionId` | `AppBuilderStudioSessionPage` | Active session |
| `/conversation-v2`, `/conversation-v2/:sessionId` | redirects | Legacy bookmarks → `/studio…` |

Path helpers: [`studio-paths.ts`](studio-paths.ts) (`STUDIO_BASE_PATH`, `studioSessionPath`, `studioCloneDraftPath`).

Related docs:

- [`SKILLS.md`](SKILLS.md) — skill selection UI / store
- [`CONNECTORS.md`](CONNECTORS.md) — connector selection UI / store
- App Builder hub + Template Studio: [`../app-builder/README.md`](../app-builder/README.md)
- Proposed commit split: [`../app-builder/COMMITS.md`](../app-builder/COMMITS.md)

Backend counterpart:
[`../../../../back/src/modules/app-builder/README.md`](../../../../back/src/modules/app-builder/README.md).

## Table of Contents

- [Overview](#overview)
- [Template Clone draft](#template-clone-draft)
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

The frontend consumes app-builder-studio events via a global SSE pipe and renders
a split-pane **Studio** UI:

- **Left**: message timeline with tool calls, plan, thinking, questions
- **Right**: Code / **Aperçu (Preview)** panel with file explorer, NodePod
  preview in a decorative browser frame, deploy controls

The **App Builder Studio** flow:

1. User sends a message → composer dispatches via `POST …/message`.
2. SSE events stream in → `session-reducer.ts` reduces them into UI state.
3. When ADK emits `application_component`, the right panel opens in **Preview** mode.
4. `useNodepodPreview` downloads source files via presigned URLs.
5. Nodepod boots in the browser, runs `npm install` + `npm run dev`.
6. The preview iframe shows the live app.
7. User can switch to **Source** (read-only code viewer) or **Code** (file tree).
8. **Publish** button deploys via `POST …/deploy`.
9. **Share** button shares the deployed app by email.

Invite / register links use `buildAppRegisterInviteUrl` (hash route ending in `/register`). Preview chrome copy stays product-facing via `preview-user-message` helpers. Sessions with **App Builder AI** (`hasAiFeatures`) need a publicly reachable Nest URL for the AI Proxy on deploy.

The **Browser Runtime Host** enables OpenCode to execute file operations
directly in the browser via Socket.IO — no server sandbox needed for most tasks.

## Template Clone draft

App Market **Clone App** (from `app-builder`) must open a real session immediately
for NodePod, but must **not** appear in History until the user sends the first
message.

### Flow

1. `startTemplateSession({ templateId, navigate })` → `POST …/sessions` with
   `templateId` (backend seeds `starter_revision_id = template_<id>`).
2. Navigate to `/studio/{sessionId}?action=clone` (`studioCloneDraftPath`) with
   `location.state.source = 'template-clone'` — **no** template id in the path,
   **no** History prepend. Legacy `/conversation-v2/…` redirects preserve the query.
3. `AppBuilderStudioSessionPage` detects draft via `isCloneDraftSearch` /
   `template-clone-gate` (`isTemplateCloneNavigation` / `isTemplateCloneSession`).
4. Send stays locked while `previewPhase === 'waiting'` until NodePod is ready
   (`useTemplateClonePreview` + `useWaitForPreviewHost`). Deploy controls stay
   hidden for draft clone.
5. First Send → `commitCloneDraftSession`: prepend History, `navigate` replace to
   the **same** `sessionId` **without** `?action=clone`.

### Invariants

| Rule | Detail |
|---|---|
| Same session id | Commit never creates a second session |
| No History before Send | Draft path omits pointer prepend |
| Gate Send | No auto-stream; user must type the first edit |
| Reload | `starterRevisionId` matching `template_*` re-enters clone gate |

### Key helpers

| File | Role |
|---|---|
| `startAgentSession.ts` | `startTemplateSession`, `commitCloneDraftSession` |
| `template-clone-draft.ts` | Path + `?action=clone` helpers |
| `template-clone-gate.ts` | Nav / revision / Send-gate predicates |
| `hooks/useTemplateClonePreview.ts` | `previewPhase`, lock Send, safety net |
| `hooks/useWaitForPreviewHost.ts` | Shared NodePod wait + i18n stream errors |
| `components/SessionStatusBanner.tsx` | Waiting / ready / App Builder banners |

## Application preview (Nodepod)

Replaces the previous remote-sandbox **iframe-only** preview.

| Piece | Role |
|---|---|
| `useNodepodPreview` | Download files → `Nodepod.boot` → install → spawn → `previewUrl` |
| `ApplicationComponentView` | Toolbar + split: file tree \| **Aperçu** / Source |
| `PreviewBrowserFrame` | Decorative browser chrome (traffic lights, lock, address, Live) — presentation only |
| `PreviewCenteredStatus` | Empty / boot / error centered states |
| `AppSourceFileTree` | Expandable, read-only tree with search |
| `AppSourceFileViewer` | Read-only code (CodeArtifact) + lock badge |
| `flattenFilesTree` | Tree → flat paths for signed-URL batch |

Users **cannot** edit generated sources in this panel — Source is inspection only.

**UX rules (Studio preview):**

- Tab / mode labels use **Preview** (EN) / **Aperçu** (FR) — not “Canvas”.
- Preview chrome is presentation-only: no viewport toggles or extra device features.
- Status copy stays product-facing (`preview-user-message`, `nodepod.*` locales).

### Dual preview modes

| Mode | Source | When |
|---|---|---|
| **Nodepod (Aperçu)** | Browser VFS via presigned URL downloads | During generation (live) |
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

### Version History (finalized revisions)

Each successful MCP `finalize` creates a **stable version** row (Mongo
`app_finalized_revisions`) and an `application_component` SSE event with
`revision_id`.

- **UI**: [`VersionHistoryPanel`](components/RightPanel/VersionHistoryPanel.tsx)
  exposes a compact `VersionSwitcher` popover (newest first) next to the LLM
  model button in the Composer, with Preview and Deploy actions, plus a slim
  `HistoricalPreviewBanner` when viewing an older revision — so the NodePod
  preview keeps full height under the Aperçus / Données tabs. While the agent
  streams, an amber **Draft** row (with the current workspace revision
  reference) represents the upcoming version; it converts to a definitive
  "Version N" entry only when the finalizer step lands.
- **Preview-only**: selecting an older version calls `syncHostRevisionSources`
  without changing the agent binding (`latestRevisionId`).
- **Deploy whitelist**: only finalized revision ids are accepted by
  `POST …/deploy` (default = latest finalized, not binding latest).
- **API**: `GET …/finalized-versions` hydrates from Mongo with lazy backfill
  from persisted `application_component` events.

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

[`store.ts`](store.ts) (Zustand) keeps two stores: `useAppBuilderStudioStore` (the
active conversation's view state) and `useAppBuilderStudioPointersStore` (the session
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
┌─ Studio header ─────────────────────── [Publish] [✕] ─┐
│ Title (editable) · status · [Pause] [Stop] [Share]     │
├────────────────────────────────────────────────────────┤
│  ┌─ MessageList ── thinking / plan / tools / chat ────┐ │
│  └────────────────────────────────────────────────────┘ │
│  ┌─ Composer ── model / skills / connectors · Send ───┐ │
│  └────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────┤
│  ┌─ RightPanel ───────────────────────────────────────┐ │
│  │ [Code] [Aperçu●] [Data]                             │ │
│  │ ┌──────────────┬──────────────────────────────────┐ │ │
│  │ │ FILES        │  PreviewBrowserFrame              │ │ │
│  │ │ ▾ app        │   └── NodePod iframe (live)       │ │ │
│  │ │ package.json │  Source → read-only CodeArtifact  │ │ │
│  │ └──────────────┴──────────────────────────────────┘ │ │
│  │ [Aperçu | Déployée]  [Share] [Update]               │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### Right panel modes

The panel has two `rightPanelMode` values (`tool` and `app`), plus an inner
`rightPanelAppTab` selector for the app surface:

| Mode | Content | When |
|---|---|---|
| **Tool** | `ToolDetailDispatch` (tool call details for the selected tool) | Selecting a tool call in the timeline |
| **App — Aperçu / Source** | `ApplicationComponentView`: file tree + `PreviewBrowserFrame` (NodePod / Deployed) or Source | After `application_component`; Preview↔Deploy in `AppViewModeToggle` |
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
appBuilderStudioApi.createSession(workspaceIds?)       // POST /app-builder/sessions
appBuilderStudioApi.listSessions(params?)              // GET /app-builder/sessions
appBuilderStudioApi.getSession(id)                     // GET /app-builder/sessions/:id
appBuilderStudioApi.patchSession(id, body)             // PATCH /app-builder/sessions/:id
appBuilderStudioApi.deleteSession(id)                  // DELETE /app-builder/sessions/:id

// Chat
appBuilderStudioApi.sendMessage(id, body)              // POST /app-builder/sessions/:id/message
appBuilderStudioApi.stopSession(id)                    // POST /app-builder/sessions/:id/stop
appBuilderStudioApi.pauseSession(id)                   // POST /app-builder/sessions/:id/pause
appBuilderStudioApi.resumeSession(id)                  // POST /app-builder/sessions/:id/resume

// Events
appBuilderStudioApi.listEvents(id, since, limit?)      // GET /app-builder/sessions/:id/events

// Users
appBuilderStudioApi.searchUsers(query, limit?)         // GET /users/search

// App Builder runtime
appBuilderStudioApi.createRuntimeTicket(id)            // POST /app-builder/sessions/:id/runtime-ticket

// Source revisions
appBuilderStudioApi.getRevisionFiles(id, revId)        // GET …/revisions/:revisionId/files
appBuilderStudioApi.presignRevisionFiles(id, rev, paths) // POST …/revisions/:revisionId/presign
appBuilderStudioApi.commitWorkspaceRevision(id, body)     // POST …/revisions/commit
appBuilderStudioApi.getAppSourceUrls(id, ceph, paths)     // POST …/app-source/urls (legacy)
appBuilderStudioApi.getFileSignedUrl(path)               // POST /app-builder/files/signed-url

// Deploy & share
appBuilderStudioApi.deploySession(id, body)            // POST /app-builder/sessions/:id/deploy
appBuilderStudioApi.shareDeployedApp(id, emails)       // POST /app-builder/sessions/:id/share-deploy
appBuilderStudioApi.getShared(token)                   // GET /app-builder/share/v2/:token

// App data (production database)
appBuilderStudioApi.getAppDataStatus(id)               // GET …/app-data/status
appBuilderStudioApi.getAppDataTables(id, env)          // GET …/app-data/:env/tables
appBuilderStudioApi.getAppDataRows(id, env, table)     // GET …/app-data/:env/tables/:table/rows

// Workspace
appBuilderStudioApi.listWorkspaceDocuments(id, params) // GET …/workspace-documents
appBuilderStudioApi.getVncSignedUrl(id)                // GET …/vnc/signed-url
```

The deployed-apps Marketplace list and removal (`GET /app-builder/apps`,
`DELETE /app-builder/apps/:id`) are consumed by the sibling `app-marketplace`
module (`appMarketplaceApi`), not `appBuilderStudioApi`.

## SSE streaming

[`appBuilderStudioStream.ts`](appBuilderStudioStream.ts) manages the global SSE
connection:

- Connects to `GET /app-builder/stream` on Studio/legacy v2 routes or for current/background running v2 work. It retains active runs across navigation and closes when no route/work needs the pipe; token refresh cannot open an unused pipe on a classic conversation tab.
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

Keys under `nodepod.*`, `appRuntime.*`, and Studio empty/banner strings in
[`locales/en.json`](locales/en.json) / [`locales/fr.json`](locales/fr.json).

- Preview tab: EN **Preview** / FR **Aperçu** (`tabPreview`, `modePreview`, …).
- No user-facing “Canvas” or “conversation-v2” strings.
- Address bar / Live badge: `nodepod.addressLocal`, `nodepod.liveBadge`, etc.

## Key files

### Root

| Path | Role |
|---|---|
| `studio-paths.ts` | Public `/studio` paths + clone query helpers |
| `AppBuilderStudioSessionPage.tsx` | Studio session page: bootstrap / clone-preview / runtime / reconcile |
| `AppBuilderStudioPage.tsx` | Studio home / empty state |
| `SharedAppBuilderStudioPage.tsx` | Read-only shared view |
| `startAgentSession.ts` | New session, template clone, commit clone draft → `/studio/…` |
| `template-clone-draft.ts` / `template-clone-gate.ts` | Clone draft URL + Send gate |
| `store.ts` | Zustand store — session, messages, tools, deploy, SSE state |
| `api.ts` | REST API client (all endpoints) |
| `appBuilderStudioStream.ts` | Global SSE connection + event dispatch |
| `useStream.ts` | SSE subscription hook with cleanup |
| `types.ts` | Re-exports from `interfaces/` |
| `features.ts` | Feature flags |
| `session-permissions.ts` | Permission constants |
| `selectedModelStorage.ts` | Persisted model selection |

### interfaces/

| Path | Role |
|---|---|
| `interfaces/events.ts` | Event types (message, tool, step, plan, wait, lifecycle, application) |
| `interfaces/session.ts` | Session, pointer, `AgentSessionSource`, `AgentSessionLocationState` |
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
| `utils/app-register-invite-url.ts` | Build hash-route register/invite URLs for end-users |
| `utils/preview-user-message.ts` | Product-facing preview status copy (no tool jargon) |

### hooks/

| Path | Role |
|---|---|
| `hooks/useSessionBootstrap.ts` | Load/switch session pointer + event history |
| `hooks/useTemplateClonePreview.ts` | Clone preview phase + Send lock |
| `hooks/useWaitForPreviewHost.ts` | Wait for BrowserRuntimeHost ready |
| `hooks/useInitialAgentMessage.ts` | Landing-page first message after NodePod ready |
| `hooks/useBrowserRuntimeBoot.ts` | Boot/teardown BrowserRuntimeHost |
| `hooks/useStreamingReconcile.ts` | Periodic SSE gap-fill while streaming |
| `hooks/useNodepodPreview.ts` | Nodepod boot/teardown/file download lifecycle |
| `hooks/useVncSession.ts` | VNC connection management |
| `hooks/useTypewriter.ts` | Typewriter animation for streaming text |

### components/

| Path | Role |
|---|---|
| `components/MessageList.tsx` | Message timeline rendering with auto-scroll |
| `components/MessageBubble.tsx` | Individual message (markdown, code blocks) |
| `components/Composer.tsx` | Input + model/skill/connector selectors + send/stop |
| `components/AppBuilderStudioHeader.tsx` | Title, status, pause/stop/share buttons |
| `components/SessionStatusBanner.tsx` | Clone waiting/ready + App Builder + stream-error banners |
| `components/ToolCallCard.tsx` | Tool call summary card |
| `components/StepBlock.tsx` | Plan step with badge |
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
| `RightPanel.tsx` | Resizable panel shell: Tool/App (Aperçu \| Data) tabs, deploy controls |
| `ApplicationComponentView.tsx` | Dual-pane: file tree + preview/source |
| `preview/PreviewBrowserFrame.tsx` | Decorative browser chrome around the live iframe |
| `preview/PreviewCenteredStatus.tsx` | Centered boot / waiting / error status |
| `AppSourceFileTree.tsx` | File explorer with search, expand/collapse |
| `AppSourceFileViewer.tsx` | Read-only code viewer |
| `AppBuildProgressPanel.tsx` | Build progress stepper |
| `AppDataPanel.tsx` | App-data store browse: dev/prod environments, tables, rows |
| `DeployControls.tsx` | Publish/Update, Share; `AppViewModeToggle` for Aperçu↔Deploy |
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
