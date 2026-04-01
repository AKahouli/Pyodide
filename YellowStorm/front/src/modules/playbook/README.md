# Playbook Module (Frontend)

The playbook module provides a visual workflow builder for creating, editing, executing, and monitoring multi-step AI agent workflows. It features a ReactFlow-based canvas editor, an IDE-style resizable split view for simultaneous workflow editing and execution monitoring, real-time execution tracking via SSE, pagination, lazy-loaded routes, and a GitHub Actions-inspired execution results view.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Routing](#routing)
- [State Management](#state-management)
- [SSE Streaming](#sse-streaming)
- [Components](#components)
- [Hooks](#hooks)
- [API Layer](#api-layer)
- [Types](#types)
  - [Execution schedule & triggers](#execution-schedule--triggers)
- [Key Features](#key-features)
- [Performance](#performance)
- [Data Flow](#data-flow)
- [Localization](#localization)
- [Testing](#testing)

---

## Overview

The playbook module is a self-contained feature module that handles:

- **Playbook List**: Paginated card grid with search, sort, filters (task count range, date range), favorites, bulk select/delete, and "Load more"
- **Canvas Editor**: ReactFlow-based visual editor for building step-by-step workflows
- **AI Generation**: Generate complete playbooks from a text prompt (Auto Builder)
- **AI Designer**: Iteratively modify playbooks via natural language chat with message history and revert
- **Node Configuration**: Side sheet for editing step title, description, agent, and interrupt settings
- **Workspace Attachment**: Multi-select workspace picker for providing document context to agents
- **Autosave**: Debounced automatic saving of canvas changes (1-second delay)
- **Auto Layout**: Dagre-based automatic node positioning (left-to-right DAG layout) with toolbar button
- **Execution**: Real-time monitoring of playbook execution with SSE events and loading indicators
- **Split View**: IDE-style resizable vertical split (canvas on top, execution panel on bottom) so both the workflow editor and execution results are visible simultaneously — no navigation required
- **Results View**: GitHub Actions-inspired split-panel layout (step list + detail panel with rich components)
- **Auto-Follow**: During live executions, the selected step automatically follows the currently running or interrupted step
- **Execution History**: Dropdown to switch between past executions (lightweight summaries) directly from the execution panel
- **Execution Comparison**: Side-by-side comparison of two executions (statuses, outputs, durations, tokens, models)
- **Interrupt Handling**: Inline feedback components and modal dialog for approval, review, and clarification
- **Single-Step Execution**: Run individual steps in isolation via node context menu
- **Stop Execution**: Cancel a running or interrupted execution
- **Sharing**: Share playbooks with other users by email (creates independent copies)
- **Favorites**: Toggle favorite status on playbooks for quick filtering
- **Bulk Delete**: Select and delete multiple playbooks at once
- **Token Usage**: Per-execution and aggregate token tracking with usage indicator
- **Beta Disclaimer**: First-visit modal with dismissible beta notice
- **Execution schedule (types)**: `Playbook` includes `executionSchedule` (`ExecutionScheduleData | null`) aligned with the backend embedded document (daily / weekly / monthly / advanced payloads). Used once schedule UI and APIs are wired.
- **Execution trigger**: `PlaybookExecution` and `PlaybookExecutionSummary` include optional `executionTrigger` (`manual` | `scheduled`). Client-initiated runs and SSE optimistic objects use `manual`; `scheduled` is set when the backend creates an execution from the cron runner.

---

## Architecture

```
+-----------------------------------------------------------------------------+
|                            PLAYBOOK MODULE                                  |
+-----------------------------------------------------------------------------+
|                                                                             |
|  +--------------+    +--------------+    +--------------+                   |
|  |  Components  |<-->|    Store     |<-->|    API       |                   |
|  |  (React UI)  |    |   (Zustand)  |    |   (Axios)    |                   |
|  +------+-------+    +------+-------+    +--------------+                   |
|         |                   |                                               |
|         |                   v                                               |
|         |            +--------------+    +--------------+                   |
|         |            | SSE Service  |    | Agent Store  |                   |
|         |            | (Singleton + |    | (getAgentById|                   |
|         |            |  per-page)   |    |  fetchAgents)|                   |
|         |            +------+-------+    +--------------+                   |
|         |                   |                                               |
|         v                   v                                               |
|  +--------------------------------------------------------------+          |
|  |              Backend (NestJS)                                 |          |
|  |  - REST API for CRUD + execution                             |          |
|  |  - SSE endpoint for real-time updates                        |          |
|  |  - gRPC orchestration of AI agents                           |          |
|  +--------------------------------------------------------------+          |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI components with hooks-based architecture |
| **Zustand** | State management with devtools middleware |
| **ReactFlow (@xyflow/react)** | Canvas editor for node-based workflows |
| **react-resizable-panels** | Resizable split view (canvas + execution panel) |
| **@dagrejs/dagre** | Automatic DAG layout algorithm (Sugiyama / layered graph drawing) |
| **EventSource (SSE)** | Real-time server-sent events for execution tracking |
| **Axios** | HTTP client for REST API calls |
| **TypeScript** | Type safety across the module |
| **Radix UI / Shadcn** | Accessible UI primitives (Dialog, Sheet, Select, etc.) |
| **Lucide React** | Icons (Workflow, Play, Loader2, CheckCircle2, etc.) |
| **Sonner** | Toast notifications |
| **i18next** | Internationalization (en/fr) |

---

## Directory Structure

```
playbook/
├── index.ts                              # Public module exports
├── types.ts                              # TypeScript interfaces and types
├── api.ts                                # API functions (Axios calls)
├── store.ts                              # Zustand store (state + actions + selectors)
├── services/
│   └── playbookStreamService.ts          # Unified SSE service (global singleton, handles all event routing + reconnection)
├── components/
│   ├── PlaybookButton.tsx                # Sidebar navigation button (BETA badge)
│   ├── PlaybookListPage.tsx              # Paginated card grid with search, sort, filters, bulk actions
│   ├── PlaybookCard.tsx                  # Individual playbook card (favorite toggle, selectable)
│   ├── CreatePlaybookDialog.tsx          # Create playbook modal (Manual + Auto Builder tabs)
│   ├── PlaybookCanvasPage.tsx            # ReactFlow canvas editor (loads agents on mount)
│   ├── PlaybookNode.tsx                  # Custom ReactFlow node (context menu, status ring)
│   ├── PlaybookNodeEditor.tsx            # Side sheet for editing node properties
│   ├── PlaybookToolbar.tsx               # Canvas toolbar (designer, add step, auto layout, history, save, run)
│   ├── PlaybookWorkspaceSelect.tsx       # Multi-select workspace picker
│   ├── PlaybookGeneratingOverlay.tsx     # Animated overlay during AI generation/design
│   ├── PlaybookDesignerPanel.tsx         # AI Designer chat panel (right sidebar)
│   ├── PlaybookUsageIndicator.tsx        # Token usage display (color-coded bar)
│   ├── PlaybookBetaDisclaimer.tsx        # First-visit beta disclaimer modal
│   ├── PlaybookStatusBadge.tsx           # Reusable status badge component
│   ├── CloneShareDialog.tsx              # Share playbook by email dialog
│   ├── PlaybookExecutionPage.tsx         # Execution results view (split panel)
│   ├── PlaybookExecutionListPage.tsx     # Past executions list with compare selection
│   ├── PlaybookExecutionComparePage.tsx  # Side-by-side execution comparison
│   ├── ExecutionPanel.tsx                # Inline execution panel for split view (auto-loads, auto-follows steps)
│   ├── ExecutionHeader.tsx               # Top bar (status, duration, stop, history dropdown)
│   ├── ExecutionStepList.tsx             # Left panel (step list with status icons)
│   ├── ExecutionStepDetail.tsx           # Right panel (step output, components, tokens, metadata)
│   ├── ExecutionHistoryDropdown.tsx      # Switch between past executions (standalone page)
│   ├── HumanFeedbackInline.tsx           # Inline feedback component in step detail
│   └── InterruptDialog.tsx              # Approval/clarification modal
├── hooks/
│   ├── useAutosave.ts                   # Debounced autosave (1s)
│   └── usePlaybookCanvas.ts             # ReactFlow <-> Zustand store bridge
├── utils/
│   ├── auto-layout.ts                   # Dagre-based automatic node layout (LR DAG)
│   └── merge-components.ts              # Smart component array merging for SSE updates
└── locales/
    ├── en.json                          # English translations (~208 keys)
    └── fr.json                          # French translations
```

---

## Routing

Routes are registered inside `RootGuard` children in `Router.tsx` and are **lazy-loaded** with `React.lazy()` + `<Suspense>`:

```tsx
const PlaybookListPage = React.lazy(() =>
  import('./modules/playbook/components/PlaybookListPage').then(m => ({ default: m.PlaybookListPage }))
);
// ... same pattern for CanvasPage, ExecutionPage, ExecutionListPage, ComparePage

{ path: "playbooks",                              element: <Suspense fallback={null}><PlaybookListPage /></Suspense> }
{ path: "playbooks/generating",                    element: <Suspense fallback={null}><PlaybookCanvasPage /></Suspense> }
{ path: "playbooks/:id",                          element: <Suspense fallback={null}><PlaybookCanvasPage /></Suspense> }
{ path: "playbooks/:id/executions",               element: <Suspense fallback={null}><PlaybookExecutionListPage /></Suspense> }
{ path: "playbooks/:id/executions/compare",       element: <Suspense fallback={null}><PlaybookExecutionComparePage /></Suspense> }
{ path: "playbooks/:id/executions/:executionId",  element: <Suspense fallback={null}><PlaybookExecutionPage /></Suspense> }
```

All routes require authentication (inside `RootGuard`).

---

## State Management

### Store (`store.ts`)

The Zustand store manages all playbook state with `devtools` middleware:

```typescript
interface PlaybookState {
  playbooks: PlaybookSummary[];
  playbooksLoading: boolean;
  playbooksPagination: PaginationMeta | null;
  playbooksQuery: PlaybookQueryParams;                // Current search/sort/filter params
  currentPlaybook: Playbook | null;
  currentPlaybookLoading: boolean;
  isDirty: boolean;
  dirtyVersion: number;                               // Increments on each dirty change (debounce key)
  isSaving: boolean;
  currentExecution: PlaybookExecution | null;
  currentExecutionLoading: boolean;
  executionCache: Record<string, PlaybookExecution>;   // LRU cache (max 20 entries)
  executionHistory: PlaybookExecutionSummary[];         // Lightweight summaries (capped at 50)
  executionsLoading: boolean;
  executingPlaybookIds: string[];                       // Tracks which playbooks have active executions
  isGenerating: boolean;
  generateRetryData: GeneratePlaybookData | null;
  selectedStepId: string | null;
  error: string | null;
  designMessages: DesignMessage[];                     // Capped at 50
  designMessagesLoading: boolean;
  isStopping: boolean;
  isDesigning: boolean;
  designerOpen: boolean;
  executionPanelOpen: boolean;                          // Controls the split-view execution panel visibility
}
```

### Constants

- `MAX_EXECUTION_HISTORY = 50` — Caps `executionHistory` to prevent unbounded growth
- `MAX_EXECUTION_CACHE = 20` — LRU eviction for `executionCache`
- `MAX_DESIGN_MESSAGES = 50` — Caps `designMessages`
- `EMPTY_PLAYBOOKS` / `EMPTY_EXECUTIONS` / `EMPTY_DESIGN_MESSAGES` — Stable empty refs for referential stability in selectors

### Actions

| Category | Actions |
|----------|---------|
| **CRUD** | `fetchPlaybooks`, `fetchMorePlaybooks`, `fetchPlaybook`, `createPlaybook`, `updatePlaybook`, `deletePlaybook`, `bulkDeletePlaybooks`, `toggleFavorite` |
| **Canvas** | `updateTasks`, `updateEdges`, `updateWorkspaces`, `setDirty`, `saveCurrentPlaybook` |
| **AI** | `generatePlaybook`, `clearGenerateRetry`, `designPlaybook`, `fetchDesignMessages`, `revertToSnapshot`, `setDesignerOpen` |
| **Execution** | `executePlaybook`, `resumeExecution`, `stopExecution`, `setExecutionPanelOpen`, `viewExecutionInPanel` |
| **SSE Handlers** | `onExecutionStart`, `onStepStart`, `onStepComplete`, `onExecutionComplete`, `onInterrupt` |
| **History** | `fetchExecutions`, `fetchExecution`, `selectStep` |
| **Cleanup** | `reset` |

**Key implementation details:**

- `fetchPlaybooks(query?)` — Passes `{ page: 1, limit: 20, ...query }`, stores `playbooksPagination` and `playbooksQuery`
- `fetchMorePlaybooks()` — Checks `page < totalPages`, appends next page to existing list
- `onExecutionStart(data)` — Creates both a full `PlaybookExecution` (for `currentExecution` + `executionCache`) and a `PlaybookExecutionSummary` (for `executionHistory`), caps history at 50; both use `executionTrigger: 'manual'` (SSE does not distinguish scheduled runs)
- `fetchExecutions(playbookId)` — Pre-fetches latest execution details, caps history
- `fetchExecution(playbookId, execId)` — Smart merge: keeps newer SSE status over stale API response
- `deletePlaybook(id)` — Optimistic delete: removes from list immediately, restores on API failure
- `toggleFavorite(id)` — Optimistic toggle, re-fetches list to reflect sort order
- `resumeExecution(id, data)` — Optimistically marks humanFeedback component as answered
- `executePlaybook(id)` — Adds `playbookId` to `executingPlaybookIds`, removed on completion; optimistic `PlaybookExecution` uses `executionTrigger: 'manual'` until `fetchExecution` refreshes from the API
- `executionCache` — LRU with max 20 entries, evicts oldest by `updatedAt`
- `viewExecutionInPanel(executionId)` — Loads execution from cache (or fetches from API) and opens the split-view panel
- `setExecutionPanelOpen(open)` — Toggles the execution panel visibility
- `onExecutionStart` — Auto-opens the execution panel when the viewed playbook starts executing
- `onInterrupt` — Auto-opens the execution panel and selects the interrupted step

### Selector Hooks

```typescript
usePlaybooks()                            // PlaybookSummary[] (useShallow, stable empty ref)
usePlaybooksLoading()                     // boolean
useCurrentPlaybook()                      // Playbook | null (useShallow)
useCurrentPlaybookLoading()               // boolean
useCurrentExecution()                     // PlaybookExecution | null (useShallow)
useCurrentExecutionLoading()              // boolean
useLatestExecutionForPlaybook(playbookId) // PlaybookExecution | null (most recent from cache)
useExecutionHistory()                     // PlaybookExecutionSummary[] (useShallow, stable empty ref)
useExecutionsLoading()                    // boolean
useIsExecuting(playbookId?)               // boolean (checks executingPlaybookIds)
useExecutingPlaybookIds()                 // string[] (useShallow)
useIsDirty()                              // boolean
useDirtyVersion()                         // number
useIsGenerating()                         // boolean
useIsSaving()                             // boolean
useSelectedStep()                         // string | null
usePlaybookError()                        // string | null
useDesignMessages()                       // DesignMessage[] (useShallow, stable empty ref)
useDesignMessagesLoading()                // boolean
useIsDesigning()                          // boolean
useIsStopping()                           // boolean
useDesignerOpen()                         // boolean
useExecutionPanelOpen()                   // boolean
useHasActiveExecution(playbookId)         // boolean (checks executingPlaybookIds + history + currentExecution)
```

---

## SSE Streaming

### Unified SSE Architecture

The module uses a single **global singleton** SSE service (`services/playbookStreamService.ts`):

- Mounted once at the `RootGuard` level via `usePlaybookStreamGlobal()`
- Persists across navigation so events are never lost
- Uses module-level variables (not React state) for the `EventSource` instance
- Handles all event routing to the Zustand store

**Configuration:**
- **Endpoint**: `GET /api/v1/playbooks/stream?token=<jwt>`
- **Reconnection**: Exponential backoff (1s -> 60s max, 10 attempts)
- **Heartbeat watchdog**: 30s timeout, triggers reconnect if no heartbeat received
- **Catch-up**: On connect, fetches active executions from `GET /playbooks/active-executions` to hydrate state

### SSE Event Flow

```
EventSource -> onmessage -> parse JSON -> switch(type) -> store handler -> React re-render
```

| SSE Event | Store Handler | Effect |
|-----------|---------------|--------|
| `playbook_connected` | -- | Reset reconnect counter |
| `playbook_heartbeat` | -- | Reset heartbeat watchdog |
| `playbook_execution_start` | `onExecutionStart` | Set `currentExecution` + cache + append summary to `executionHistory` + auto-open execution panel |
| `playbook_step_start` | `onStepStart` | Update task status to `running`, auto-select step |
| `playbook_step_complete` | `onStepComplete` | Update task with output/error/duration/components/tokens |
| `playbook_execution_complete` | `onExecutionComplete` | Set final status, sync history, remove from `executingPlaybookIds` |
| `playbook_execution_error` | `onExecutionComplete` | Set error status |
| `playbook_interrupt` | `onInterrupt` | Set `interrupted` status, add humanFeedback component, auto-open execution panel |
| `playbook_shared` | -- | Re-fetches playbooks list |

---

## Components

### Pages

#### PlaybookListPage

Paginated card grid with search, sort, and filters:
- Fetches first page on mount (`page: 1, limit: 20`)
- **Search**: Debounced (200ms) text search
- **Sort**: By updatedAt, createdAt, name, taskCount, lastExecutionAt (asc/desc)
- **Filters**: Task count range (min/max), date range (from/to on createdAt/updatedAt/lastExecutionAt)
- **Bulk actions**: Select mode with checkbox per card, bulk delete with confirmation
- **Favorites**: Star toggle on each card
- "New Playbook" button opens `CreatePlaybookDialog`
- Each `PlaybookCard` shows name, description, step count, last modified
- Loading skeletons and empty state
- "Load more" button when `pagination.page < pagination.totalPages`
- `PlaybookBetaDisclaimer` modal on first visit

#### PlaybookCanvasPage

ReactFlow-based canvas editor wrapped in `ReactFlowProvider` with an IDE-style resizable split view for simultaneous editing and execution monitoring:

```
+---------------------------------------------------------------+
| Header: [<- Back] Title (click to edit) [Usage] [Share] [Ws]  |
|  [Toolbar: Designer | Add Step | Auto Layout | Executions |   |
|           Save | Run]                                          |
+---------------------------------------------------------------+
|                          |                                     |
|  ReactFlow Canvas        | PlaybookDesignerPanel (toggleable)  |
|  - Custom node type:     |                                     |
|    playbookStep           |                                     |
|  - Animated edges         |                                     |
|  - Drag to connect        |                                     |
|  - Double-click to edit   |                                     |
|  - Context menu: edit,    |                                     |
|    clone, execute, delete |                                     |
|  - Live status ring/      |                                     |
|    colors during exec     |                                     |
+====================drag handle================================+
| ExecutionPanel (resizable, collapsible)                        |
| [Execution] * Running | 12s | [Stop] | [Compare] | #5 v | [X] |
| +------------------+----------------------------------------+ |
| | Step List (w-80) | Step Detail (flex-1)                    | |
| | + Research  2.1s | Title, status, output, components       | |
| | * Writing   ...  | Human feedback widgets                  | |
| | o Validation     | Token usage                             | |
| +------------------+----------------------------------------+ |
+---------------------------------------------------------------+
```

- **Split view**: Uses `react-resizable-panels` for a vertical resizable split (canvas 60% / execution 40% by default)
- The execution panel **auto-opens** when a run starts or an interrupt occurs
- The "Executions" toolbar button **toggles** the panel open/closed (no navigation away from the canvas)
- Panel **auto-loads** the latest execution when opened with no execution selected
- **Auto-follow**: During live executions, the selected step automatically tracks the running step; interrupted steps take priority
- **Execution history dropdown**: Switch between past runs directly from the panel header
- **Compare button**: Navigates to the full execution comparison page when 2+ executions exist
- **Close button (X)**: Collapses the panel, giving the canvas full height
- Panel state (`executionPanelOpen`, `currentExecution`, `selectedStepId`) is **reset on playbook switch** to prevent stale data bleed
- Calls `useAgentStore.getState().fetchAgents()` on mount to ensure agent names display immediately
- Inline name editing (click title -> input -> blur to save)
- Workspace attachment via `PlaybookWorkspaceSelect`
- Token usage via `PlaybookUsageIndicator`
- Share button opens `CloneShareDialog`
- Step status visualization: `stepStatusMap` overlaid onto nodes/edges during live execution
- Edge styles change based on source node status (color-coded)
- Autosave via `useAutosave` hook (1s debounce)
- Node positions sync to store on drag end (not during drag)

#### PlaybookExecutionPage (Standalone Fallback)

Full-screen execution results view. This is the **fallback** route (`/playbooks/:id/executions/:executionId`) — the primary execution viewing experience is now the inline `ExecutionPanel` in the split view. The standalone page is still useful for direct URL access or when a full-screen view is preferred.

```
+----------------------------------------------------------+
| ExecutionHeader                                          |
| [<- Canvas] Name | * Running | 12s | [Stop] | Run #5 v  |
+--------------------+-------------------------------------+
| ExecutionStepList  | ExecutionStepDetail                  |
| (w-80, scrollable) | (flex-1, scrollable)                |
|                    |                                      |
| + Research   2.1s  | Step: Analysis                       |
| + Analysis   3.4s  | Status: * Completed                  |
| * Writing    ...   | Agent: Analyst                        |
| o Validation       | Duration: 3.4s                        |
|                    | Tokens: 1.2K in / 0.8K out            |
|                    |                                      |
|                    | --- Components ---                    |
|                    | (text, code, humanFeedback, etc.)    |
+--------------------+-------------------------------------+
```

- Connects SSE on mount
- Auto-selects running step (unless user manually selected another)
- Shows stop button for running/interrupted executions

#### PlaybookExecutionListPage

Past executions list with compare mode:
- Displays execution number, status badge, creation date, duration
- Click to navigate to full execution detail
- Compare mode: select 2 executions, navigate to compare view

#### PlaybookExecutionComparePage

Side-by-side comparison of two executions:
- Per-step: status, output, duration (with % variation), token usage, model
- Global totals in header (duration, tokens, steps completed)

### Node Components

#### PlaybookNode

Custom ReactFlow node with context menu:
- **Header**: Execution order badge + title + status badge (during execution)
- **Content**: Agent name (resolved via `useAgentStore.getAgentById`), description preview, interrupt/clarification tags
- **Footer**: Status text + execute step button
- **Status visualization**: Ring color and header background change per `StepStatus`
- **Context menu**: Edit, Clone, Execute Step, Delete

#### PlaybookNodeEditor

Side sheet (`Sheet` from shadcn) for editing node properties:
- Title (max 200 chars), description (max 2000 chars, textarea)
- Agent selector (`SearchableSelect` from agent store)
- Interrupt settings (3 toggles: before, after, clarification)
- Calls `fetchAgents()` on open for fresh agent list

### Supporting Components

| Component | Description |
|-----------|-------------|
| `ExecutionPanel` | Inline execution panel for split view: compact header (status, duration, stop, history picker, compare, close), auto-loads latest execution, auto-follows running/interrupted steps, reuses `ExecutionStepList` + `ExecutionStepDetail` |
| `PlaybookToolbar` | Canvas toolbar: Designer, Add Step, Auto Layout, Executions (toggle panel), Save (with status), Run (with loading) |
| `PlaybookWorkspaceSelect` | Multi-select workspace picker (fetches on mount/open) |
| `PlaybookUsageIndicator` | Token usage display: total/limit bar (green->yellow->amber->rose), input/output breakdown tooltip |
| `PlaybookStatusBadge` | Status icon + color for step/execution statuses (sm/md sizes) |
| `PlaybookGeneratingOverlay` | Animated overlay during AI generation/design (morphing blobs, shimmer text) |
| `PlaybookDesignerPanel` | Right sidebar chat panel for AI-assisted playbook modification with revert support |
| `PlaybookBetaDisclaimer` | First-visit beta disclaimer modal (dismissible via localStorage) |
| `CloneShareDialog` | Share playbook by email (comma/enter separated, shows success/failure results) |
| `ExecutionHistoryDropdown` | Dropdown to switch between past executions (standalone execution page) |
| `ExecutionStepList` | Scrollable step list with status icons, agent names, error snippets, and durations |
| `ExecutionStepDetail` | Step output viewer with rich component rendering, token counts, timing |
| `HumanFeedbackInline` | Inline feedback: approval (approve/reject + reason), review (approve/reject + feedback), clarification (textarea). Shows answered state with persisted response. Collapsible task description and agent result sections |
| `InterruptDialog` | Modal for approval/clarification/review responses |
| `CreatePlaybookDialog` | Two tabs: Manual (name + description) and Auto Builder (name + prompt + workspace) |
| `PlaybookCard` | Card component for list view (name, description, step count, favorite star, selectable checkbox) |
| `PlaybookButton` | Sidebar navigation button with BETA badge |

### Status Badge Icons

| Status | Icon | Color |
|--------|------|-------|
| `pending` | Circle | muted |
| `running` | Loader2 (spinning) | primary |
| `completed` | CheckCircle2 | green |
| `failed` | XCircle | destructive/red |
| `skipped` | CornerDownRight | muted |
| `interrupted` | PauseCircle | yellow |
| `cancelled` | XCircle | muted |

---

## Hooks

### `usePlaybookStreamGlobal()` (in `services/playbookStreamService.ts`)

Unified singleton SSE connection mounted once at the app level (`RootGuard`). Uses module-level variables instead of React refs so the `EventSource` instance persists across component re-renders and navigation. Handles all event routing to the Zustand store, reconnection with exponential backoff, and heartbeat watchdog. On connect, fetches active executions for catch-up hydration.

### `useAutosave()`

Watches `isDirty` flag and `dirtyVersion` counter, triggers `saveCurrentPlaybook()` after 1 second of inactivity. Skips if already saving. Returns `{ saveNow, isDirty, isSaving }`.

### `usePlaybookCanvas()`

Bridges ReactFlow state with the Zustand store:

| Function | Description |
|----------|-------------|
| `tasksToNodes(tasks)` | Converts `PlaybookTask[]` -> ReactFlow `Node[]` with type `playbookStep` |
| `nodesToTasks(nodes)` | Extracts `PlaybookTask[]` from ReactFlow nodes |
| `playbookEdgesToFlowEdges(edges)` | Converts `PlaybookEdge[]` -> ReactFlow `Edge[]` with type `animated` |
| `wouldCreateCycle(edges, source, target)` | BFS cycle detection before creating edges |

**Hook returns:**

```typescript
{
  nodes, edges,
  onNodesChange, onNodeDragStop, onEdgesChange, onConnect,
  addNode, removeNode, updateNodeData,
  setNodes, setEdges
}
```

- Syncs from playbook on load (tracks via `${id}::${updatedAt}` key to detect changes)
- `onNodesChange` handles local ReactFlow state only (no store sync)
- `onNodeDragStop` syncs node positions to store (avoids constant updates during drag)
- `onEdgesChange` skips `select` changes, defers structural updates
- `onConnect` prevents cycles via BFS, generates edge IDs as `e-source-target`
- Calls `updateTasks` / `updateEdges` on structural canvas changes

---

## Utilities

### `autoLayoutTasks(tasks, edges)` (`utils/auto-layout.ts`)

Automatic DAG layout using `@dagrejs/dagre` (Sugiyama algorithm):

- **Direction**: Left-to-right (`rankdir: 'LR'`)
- **Node dimensions**: 384px wide × 160px tall
- **Spacing**: 60px vertical (`nodesep`), 100px horizontal (`ranksep`)
- **Usage**: Called automatically after AI generation and AI design, or manually via toolbar button
- Converts dagre center-based coordinates to top-left for ReactFlow

### `mergeComponents(existing, incoming)` (`utils/merge-components.ts`)

Smart component array merging for SSE step_complete updates:
- Preserves existing `humanFeedback` components (answered or pending)
- Replaces non-humanFeedback components with incoming data
- Used by `onStepComplete` store handler to prevent losing interrupt state during live updates

---

## API Layer

### API Functions (`api.ts`)

| Function | Method | Endpoint | Returns |
|----------|--------|----------|---------|
| `getPlaybooks(query?)` | GET | `/playbooks` | `{ playbooks: PlaybookSummary[], pagination }` |
| `getPlaybook(id)` | GET | `/playbooks/:id` | `Playbook` |
| `createPlaybook(data)` | POST | `/playbooks` | `Playbook` |
| `generatePlaybook(data)` | POST | `/playbooks/generate` | `{ id }` |
| `updatePlaybook(id, data)` | PATCH | `/playbooks/:id` | `Playbook` |
| `deletePlaybook(id)` | DELETE | `/playbooks/:id` | `void` |
| `bulkDeletePlaybooks(ids)` | POST | `/playbooks/bulk-delete` | `{ deleted }` |
| `toggleFavorite(id)` | POST | `/playbooks/:id/favorite` | `{ isFavorite }` |
| `cloneSharePlaybook(id, emails)` | POST | `/playbooks/:id/clone-share` | `CloneShareResult` |
| `executePlaybook(id, data?)` | POST | `/playbooks/:id/execute` | `{ executionId }` |
| `resumePlaybook(id, data)` | POST | `/playbooks/:id/resume` | `{ status }` |
| `stopPlaybook(id, data)` | POST | `/playbooks/:id/stop` | `{ status }` |
| `designPlaybook(id, data)` | POST | `/playbooks/:id/design` | `{ playbook?, message }` |
| `getDesignMessages(id)` | GET | `/playbooks/:id/design-messages` | `DesignMessage[]` |
| `revertToSnapshot(id, msgId)` | POST | `/playbooks/:id/design-messages/:msgId/revert` | `{ playbook, message }` |
| `getExecutions(playbookId, query?)` | GET | `/playbooks/:id/executions` | `{ executions: PlaybookExecutionSummary[], pagination }` |
| `getExecution(playbookId, execId)` | GET | `/playbooks/:id/executions/:execId` | `PlaybookExecution` |
| `getActiveExecutions()` | GET | `/playbooks/active-executions` | `PlaybookExecution[]` |

All responses unwrapped via `response.data.data` pattern.

### API Config

Endpoints are registered in `front/src/lib/api/config.ts` under `API_ENDPOINTS.playbooks`:

```typescript
playbooks: {
  list: '/playbooks',
  generate: '/playbooks/generate',
  bulkDelete: '/playbooks/bulk-delete',
  byId: (id) => `/playbooks/${id}`,
  execute: (id) => `/playbooks/${id}/execute`,
  resume: (id) => `/playbooks/${id}/resume`,
  stop: (id) => `/playbooks/${id}/stop`,
  favorite: (id) => `/playbooks/${id}/favorite`,
  design: (id) => `/playbooks/${id}/design`,
  designMessages: (id) => `/playbooks/${id}/design-messages`,
  revertDesign: (id, msgId) => `/playbooks/${id}/design-messages/${msgId}/revert`,
  cloneShare: (id) => `/playbooks/${id}/clone-share`,
  executions: (id) => `/playbooks/${id}/executions`,
  execution: (id, execId) => `/playbooks/${id}/executions/${execId}`,
  stream: '/playbooks/stream',
  activeExecutions: '/playbooks/active-executions',
}
```

---

## Types

### Core Entities

```typescript
PlaybookSummary          // id, name, description, taskCount, isFavorite, lastExecutionAt, createdAt, updatedAt
Playbook                 // id, name, description, tasks[], edges[], workspaces[], createdBy, isFavorite, isActive,
                         //   executionSchedule (ExecutionScheduleData | null), createdAt, updatedAt
PlaybookTask             // id, title, description, assignedAgentId, position, interrupt settings,
                         //   clarificationPrompt, maxClarifications, inputKeys[], outputKey
PlaybookEdge             // id, sourceId, targetId
PlaybookExecution        // Full: id, playbookId, executedBy, executionNumber, status, executionTrigger?,
                         //   taskResults[], threadId, interruptPayload, playbookSnapshot, singleStepTaskId,
                         //   totalInputTokens, totalOutputTokens, totalTokens, timestamps
PlaybookExecutionSummary // List: id, playbookId, executedBy, executionNumber, status, executionTrigger?,
                         //   error, durationMs, singleStepTaskId, timestamps (no taskResults/playbookSnapshot)
TaskResult               // taskId, nodeTitle, agentName, order, status, output, error, durationMs,
                         //   startedAt, completedAt, components[],
                         //   inputTokens, outputTokens, totalTokens, modelName
PlaybookComponent        // MessageComponent | { type: 'humanFeedback'; data: Record<string, unknown> }
CloneShareResult         // succeeded: { email, playbookId }[], failed: { email, reason }[]
```

### Execution schedule & triggers

Defined in [`types.ts`](types.ts) to match backend [`interfaces/playbook.interface.ts`](../../../../back/src/modules/playbook/interfaces/playbook.interface.ts) / Mongo schemas:

| Type | Role |
|------|------|
| `ExecutionScheduleType` | `'daily' \| 'weekly' \| 'monthly' \| 'advanced'` |
| `ExecutionScheduleData` | `enabled`, `timezone`, optional `type`, `lastScheduledRunAt`, nested `daily` / `weekly` / `monthly` / `advanced` payloads |
| `DailySchedulePayloadData`, `WeeklySlotData`, `WeeklySchedulePayloadData`, `MonthlySlotData`, `MonthlySchedulePayloadData`, `AdvancedSchedulePayloadData`, `AdvancedScheduleVariant` | Nested schedule shapes |
| `executionTrigger` on `PlaybookExecution` / `PlaybookExecutionSummary` | `'manual'` \| `'scheduled'`; optional on the client for backward compatibility with older API responses |

### Enums

```typescript
StepStatus      = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'interrupted'
ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled'
InterruptType   = 'approval_request' | 'review_request' | 'clarification'
```

### SSE Event Types

```typescript
PlaybookExecutionStartEvent    // executionId, playbookId, executionNumber, status, taskResults?
PlaybookStepStartEvent         // executionId, taskId, status
PlaybookStepCompleteEvent      // executionId, taskId, status, output?, error?, durationMs?,
                               //   components?, inputTokens?, outputTokens?, totalTokens?, modelName?
PlaybookExecutionCompleteEvent // executionId, status, durationMs?, error?, skippedTaskIds?,
                               //   totalInputTokens?, totalOutputTokens?, totalTokens?
PlaybookInterruptEvent         // executionId, taskId, type, message, threadId, taskDescription?, result?
```

### Interrupt & Feedback

```typescript
InterruptPayload    // type, taskId, taskTitle, message, threadId, payloadJson?, taskDescription?, result?
HumanFeedbackData   // interruptType, message, status ('pending' | 'answered'),
                    //   humanResponse?, taskDescription?, result?, approved?, reason?, feedback?
```

### DTOs

```typescript
CreatePlaybookData    // name, description?, workspaces?
GeneratePlaybookData  // name, prompt, workspaces?
DesignPlaybookData    // query
UpdatePlaybookData    // name?, description?, tasks?, edges?, workspaces?
ExecutePlaybookData   // singleStepTaskId?, query?
ResumePlaybookData    // executionId, taskId, approved, reason?, feedback?
PlaybookQueryParams   // page?, limit?, search?, sortBy?, sortOrder?, minTasks?, maxTasks?,
                      //   dateField?, dateFrom?, dateTo?
```

### Design Types

```typescript
PlaybookSnapshot     // tasks: PlaybookTask[], edges: PlaybookEdge[]
DesignMessage        // id, playbookId, userQuery, aiSummary, snapshotBefore,
                     //   status ('completed' | 'failed' | 'reverted'), revertedFromMessageId?, error?, timestamps
```

### Store Types

```typescript
PaginationMeta   // page, limit, total, totalPages
PlaybookState    // All state fields (playbooks, pagination, query, currentPlaybook, execution, cache, history, executionPanelOpen, etc.)
PlaybookActions  // All action methods (CRUD, canvas, AI, execution, SSE handlers, history, designer, execution panel)
PlaybookStore    // PlaybookState & PlaybookActions
PlaybookNodeData // extends PlaybookTask with stepStatus?: StepStatus (for ReactFlow)
```

---

## Key Features

### Canvas Editor

- **Add steps**: Toolbar button creates nodes at viewport center
- **Connect steps**: Drag from source handle to target handle (with BFS cycle detection)
- **Edit steps**: Double-click opens side sheet editor
- **Clone steps**: Context menu duplicates node with offset
- **Delete steps**: Context menu removes node + connected edges
- **Move steps**: Drag nodes, positions synced to store on drag end
- **Inline rename**: Click playbook title to edit in place
- **Custom node types**: `playbookStep` renders with agent name, status badges, interrupt tags
- **Animated edges**: SVG animation along edge paths, color-coded by source node status
- **Workspace selection**: Attach workspaces for document context (saved immediately, no autosave wait)
- **Auto Layout**: Dagre-based automatic repositioning via toolbar button (LayoutGrid icon)
- **Share**: Share playbook copies with other users via email

### AI Generation (Auto Builder)

- Enter a text prompt describing the desired workflow
- Optionally select workspaces for context
- Calls `POST /playbooks/generate` to create a complete playbook with tasks and edges
- Auto-layout is applied automatically after generation via `autoLayoutTasks()`
- Retry mechanism if generation fails (`generateRetryData`)

### AI Designer

- Side panel chat interface (`PlaybookDesignerPanel`) for iterative playbook modifications
- Natural language instructions to add, remove, or modify steps
- Design messages are persisted and can be viewed via `getDesignMessages()`
- Revert to any previous design state via `revertToSnapshot()`
- Auto-layout is applied automatically after each design modification
- Auto-saves playbook before sending design request

### Agent Integration

- `PlaybookCanvasPage` calls `useAgentStore.getState().fetchAgents()` on mount
- `PlaybookNode` resolves agent names via `useAgentStore.getAgentById(assignedAgentId)`
- `PlaybookNodeEditor` uses `useAgents()` for the agent dropdown
- Agent store has 5-minute cache, so no redundant API calls across components

### Autosave

- 1-second debounce on canvas changes (node position, edge, node data)
- Tracked via `dirtyVersion` counter (increments on each change)
- Visual indicator: Save button shows "Saving..." / "Saved" state
- Manual save: Click save button to bypass debounce
- Dirty flag tracking: `isDirty` resets after successful save

### Execution

1. Click "Run" -> button shows loading spinner ("Starting...") -> calls `POST /playbooks/:id/execute`
2. If unsaved changes, auto-saves first
3. Receives `{ executionId }` -> SSE `execution_start` event auto-opens the execution panel in the split view
4. SSE events update store in real-time -> execution panel re-renders
5. Running step auto-selected in step list, auto-follows as steps progress
6. Interrupted step auto-selected with priority over running steps
7. Completion/failure shows final state with toast notification (toast "View" action navigates to playbook and opens panel)
8. The standalone execution page (`/playbooks/:id/executions/:executionId`) remains as a fallback full-screen view

### Single-Step Execution

- Right-click node -> "Execute Step" in context menu
- Button disabled if execution active, saving, or dirty
- Only the target step runs; all others are skipped
- Useful for testing individual steps in isolation

### Stop Execution

- Click "Stop" during a running or interrupted execution -> calls `POST /playbooks/:id/stop`
- Shows "Stopping..." state while processing
- Cancels the active gRPC stream and marks remaining tasks as skipped

### Sharing

- Click share icon -> `CloneShareDialog` opens
- Enter one or more recipient emails (comma or enter separated)
- Each recipient gets an independent copy of the playbook
- Shows success/failure results per recipient

### Execution Comparison

- Click the "Compare" button in the execution panel header (visible when 2+ executions exist)
- Navigates to the execution list page (`/playbooks/:id/executions`) with compare mode
- Select 2 executions -> navigates to `/playbooks/:id/executions/compare?a=X&b=Y`
- Side-by-side view showing per-step: status, output, duration (with % variation), token usage, model
- Global totals displayed in header

### Token Usage

- `PlaybookUsageIndicator` shows total tokens used vs limit
- Color-coded bar: green -> yellow (50%) -> amber (70%) -> rose (90%)
- Tooltip: input/output breakdown, time to reset, limit exceeded warning
- Supports unlimited mode

### Interrupt/Resume

1. SSE `playbook_interrupt` -> `onInterrupt` handler adds humanFeedback component to task
2. `HumanFeedbackInline` renders interactive UI in step detail:
   - **Approval**: Approve/Reject buttons (reject shows reason textarea)
   - **Review**: Approve/Reject with feedback textarea
   - **Clarification**: Textarea + Submit button
3. User responds -> `POST /playbooks/:id/resume` with `{ approved, reason?, feedback? }`
4. Optimistic update: humanFeedback component immediately marked as "answered"
5. Execution continues or interrupts again

---

## Performance

### Lazy-Loaded Routes

All playbook routes use `React.lazy()` + `<Suspense>` so the playbook module chunk is only loaded when navigating to a playbook page.

### Paginated Playbook List

- First page loads 20 playbooks by default
- "Load more" button fetches next page and appends
- Pagination metadata (`PaginationMeta`) tracked in store

### Execution Cache (LRU)

- `executionCache` stores up to 20 full `PlaybookExecution` objects
- LRU eviction: when limit reached, oldest by `updatedAt` is evicted
- Avoids redundant API calls when switching between executions

### Execution Summary Type

- `executionHistory` stores `PlaybookExecutionSummary[]` (no `taskResults` or `playbookSnapshot`)
- Full execution detail only loaded when viewing a specific execution
- Reduces SSE event size and store memory

### Bounded Collections

- `executionHistory` capped at `MAX_EXECUTION_HISTORY = 50` entries
- `executionCache` capped at `MAX_EXECUTION_CACHE = 20` entries
- `designMessages` capped at `MAX_DESIGN_MESSAGES = 50` entries

### Stable SSE Connection

- Unified singleton SSE service persists across navigation (no per-page connections)
- Uses module-level variables — the `EventSource` is never recreated on store mutations
- Only reconnects on actual connection errors or heartbeat timeout
- Catches up on connect by fetching active executions from REST API

### Selector Optimization

- `useShallow` for array/object selectors to prevent unnecessary re-renders
- Stable empty refs (`EMPTY_PLAYBOOKS`, `EMPTY_EXECUTIONS`, `EMPTY_DESIGN_MESSAGES`) for referential stability when arrays are empty

### Smart Merge

- `fetchExecution` merges cached SSE updates (which may be newer) with API response
- Uses status priority to keep the most up-to-date version

### Position Sync

- Node positions only sync to store on drag end (`onNodeDragStop`), not during drag
- Prevents constant store updates and autosave triggers while dragging

---

## Data Flow

### Canvas Editing

```
User drags node -> ReactFlow onNodesChange -> local state
                                    |
                           onNodeDragStop -> usePlaybookCanvas -> store.updateTasks()
                                                                       |
                                                              isDirty = true, dirtyVersion++
                                                                       |
                                                              useAutosave (1s debounce on dirtyVersion)
                                                                       |
                                                              store.saveCurrentPlaybook()
                                                                       |
                                                              PATCH /playbooks/:id
                                                                       |
                                                              isDirty = false
```

### Execution Monitoring (Split View)

```
POST /execute -> { executionId }
                      |
        SSE: execution_start -> store.onExecutionStart()
                      |
        executionPanelOpen = true (auto-opens panel)
        currentExecution = new execution
                      |
        +-----------+-----------+
        |                       |
SSE: step_start          SSE: step_complete
        |                       |
store.onStepStart()    store.onStepComplete()
        |                       |
ExecutionPanel auto-follow effect:
  - interrupted step? -> select it
  - running step?     -> select it
  - completed exec?   -> no auto-follow (user keeps selection)
        |                       |
ExecutionStepList     ExecutionStepDetail
re-renders            re-renders
        |
Canvas liveNodes/liveEdges also update (status overlays)
```

### Pagination Flow

```
Mount -> fetchPlaybooks({ page: 1, limit: 20 }) -> set playbooks + playbooksPagination
                                                          |
                                                 hasMore = page < totalPages
                                                          |
                                              "Load more" click -> fetchMorePlaybooks()
                                                          |
                                              getPlaybooks({ page: 2, limit: 20 })
                                                          |
                                              Append to playbooks[], update pagination
```

---

## Localization

The module uses the `playbook` i18n namespace with `useModuleTranslation('playbook')`.

### Supported Languages

- **English** (`locales/en.json`) — ~213 keys
- **French** (`locales/fr.json`)

### Key Namespaces

| Prefix | Content |
|--------|---------|
| `sidebar.*` | Sidebar button labels |
| `list.*` | List page (title, search, sort, filters, empty state, load more, bulk select) |
| `card.*` | Card labels (step count, updated, actions, favorite) |
| `create.*` | Create dialog (tabs: manual/auto builder, fields, submit) |
| `canvas.*` | Canvas page (loading, generating, designing, execution running) |
| `toolbar.*` | Toolbar buttons (designer, add, autoLayout, save, run, starting, executions) |
| `executions.*` | Executions list (empty state) |
| `nodeEditor.*` | Node editor fields and labels |
| `node.*` | Node display labels (untitled, noAgent, statuses, executeStep) |
| `nodeContextMenu.*` | Context menu items (edit, clone, delete) |
| `execution.*` | Execution page labels (agent, started, finished, duration, output, stop) |
| `interrupt.*` | Interrupt dialog (titles, buttons, placeholders, approval, rejection) |
| `designer.*` | Designer panel (title, empty, placeholder, send, revert) |
| `workspace.*` | Workspace selector labels |
| `share.*` | Clone/share dialog (title, description, email, results) |
| `beta.*` | Beta disclaimer (title, subtitle, disclaimers, buttons) |
| `compare.*` | Execution comparison (title, steps, tokens, model) |
| `usage.*` | Token usage labels (tokens, input, output, resets, limit) |
| `status.*` | Status labels (pending, running, completed, failed, skipped, interrupted, cancelled) |
| `common.*` | Shared labels (cancel, creating, submitting) |
| `store.*` | Store toast messages and error messages |

### Registration

The namespace is auto-discovered by the dynamic import backend via:
```
import.meta.glob('../*/locales/*.json')
```

It is also registered in:
- `front/src/modules/localization/constants.ts` -> `NAMESPACES` array
- `front/src/modules/localization/types.ts` -> `NamespaceResourceMap` type

---

## Testing

Unit tests are colocated in the module as `*.test.ts` and `*.test.tsx` — **20 test files, 85 tests**.

### Test Coverage

| Area | Test File | Tests |
|------|-----------|-------|
| **API** | `api.test.ts` | 4 |
| **Store** | `store.test.ts` | 12 (includes execution panel actions, SSE handler panel behavior) |
| **Index** | `index.test.ts` | 1 |
| **Components** | `PlaybookButton.test.tsx` | 1 |
| | `PlaybookStatusBadge.test.tsx` | 2 |
| | `PlaybookGeneratingOverlay.test.tsx` | 2 |
| | `PlaybookUsageIndicator.test.tsx` | 2 |
| | `PlaybookWorkspaceSelect.test.tsx` | 2 |
| | `PlaybookToolbar.test.tsx` | 9 |
| | `PlaybookCard.test.tsx` | 5 |
| | `PlaybookBetaDisclaimer.test.tsx` | 4 |
| | `ExecutionStepList.test.tsx` | 5 |
| | `ExecutionStepDetail.test.tsx` | 6 |
| | `ExecutionHeader.test.tsx` | 6 |
| | `ExecutionPanel.test.tsx` | 8 (auto-load, auto-follow, panel open/close) |
| | `HumanFeedbackInline.test.tsx` | 5 |
| **Hooks** | `useAutosave.test.tsx` | 2 |
| | `usePlaybookCanvas.test.tsx` | 4 |
| **Services** | `playbookStreamService.test.tsx` | 3 |
| **Utils** | `auto-layout.test.ts` | 2 |

Shared test builders live in `src/modules/playbook/test-utils.ts` (`makePlaybook`, `makeExecution`, `makeExecutionSummary`, `makeTask`, `makeEdge`). `makePlaybook` sets `executionSchedule: null`; `makeExecution` / `makeExecutionSummary` set `executionTrigger: 'manual'` by default.

### Running Tests

```bash
# Run all playbook tests
npm test -- src/modules/playbook

# Run a specific test file
npm test -- src/modules/playbook/store.test.ts

# Duplication check
npx jscpd src/modules/playbook --pattern "**/*.test.{ts,tsx}" --threshold 3 --reporters console
```
