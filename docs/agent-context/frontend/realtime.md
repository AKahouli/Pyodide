# Realtime and module integration patterns

Read only the sections relevant to the task. Paths such as `src/` are relative to `YellowStorm/front/`; verify descriptive module examples and recorded debt against current source. Essential edit rules are in [frontend AGENTS.md](../../../YellowStorm/front/AGENTS.md).

## Streaming (SSE)

Seven streaming patterns coexist depending on module requirements:

### Pattern 1: Singleton SSE Service (conversation, notifications)

`ConversationStreamService` uses one fetch/ReadableStream pipe with an Authorization
header, bounded frame parsing and AbortController; no access token enters its URL.
`NotificationsService` retains EventSource. Token refresh uses the existing shared
auth owner and `reconnectWithNewToken()`. Same-session refresh preserves the
opaque cursor; account/session replacement clears it. Exponential backoff (base
1s, cap 60s), heartbeat timeout (~30s), eviction and canonical resync remain.
Classic PostgreSQL cursors use `pg:1:<sequence>`; legacy process cursors resync.

### Pattern 2: BroadcastChannel Leader-Election (playbook)

`PlaybookStreamService` — one `EventSource` shared across tabs via `BroadcastChannel` with leader election. Leader owns the connection and broadcasts events to followers. Followers sync state via channel messages. Heartbeat, reconnect, and buffered step updates. SSE events dispatched into TanStack Query cache (when `querySseEnabled`) and optionally mirrored to Zustand.

### Pattern 3: Singleton Per-User Multiplexed Stream (conversation-v2)

`ConversationV2StreamService` opens **one** `EventSource` per authenticated user to `/conversation-v2/stream`, kept alive for the whole app session. The connection hook (`useConversationV2StreamConnection`) is mounted **once at the app shell** (`RootGuard`), not per conversation page. The connection is intentionally decoupled from any single conversation view: it stays open across navigation so multiple conversations can stream at the same time and the user can switch between them freely.

Events are tagged with their `sessionId`; the Zustand store renders the current session live and accumulates the rest in a background cache. Session pages hydrate background state and replay paged historical events for gap recovery. Heartbeat, backoff, and reconnect are handled in the service; token refresh reintegrates via the axios interceptor.

- Mount the connection hook exactly once. Never open a second per-session `EventSource` from a page component.
- Preserve the backend `sequence` cursor for gap detection and resume.
- The Zustand store is the event sink; do not mix TanStack Query into this pipe.

### Pattern 4: Fetch + ReadableStream SSE (worky)

`worky/stream/sse.ts` uses `fetch` with a `ReadableStream` reader instead of `EventSource` because the stream needs custom headers and tighter retry control. Keep parsing, reconnect, and abort logic in the module stream helper; components subscribe through module hooks.

### Pattern 5: Socket.IO WhatsApp Pairing Channels

`socket.io-client` is used for WhatsApp QR pairing flows in `agent`, `admin`, and `worky`. Do not use Socket.IO for generic app realtime until an event schema and backend gateway contract are agreed.

### Pattern 6: Socket.IO Browser Session (workspace web import)

`useBrowserSession` opens the `/browser-session` Socket.IO namespace (JWT handshake via the access token) to drive an interactive remote browser for workspace web import / indexing. The server emits JPEG `frame` events plus `navigated` / `blocked` / `closed`; the client emits `start` / `input` / `navigate`. `BrowserSessionViewer` draws frames 1:1 to a canvas and maps local input back to the remote viewport; `AddLinkDialog` collects visited URLs, asks the backend which are already indexed, and submits selected links with auto/deep-index settings.

**Hard coordinate contract:** the client uses fixed `VIEWPORT_W = 1280` / `VIEWPORT_H = 720` (16:9) to match the backend Playwright viewport so input coordinates map correctly. Change both sides together — see the [backend realtime contract](../backend/realtime.md).

Ack messages use raw strings (`BUSY`, `BAD_REQUEST`, `NO_SESSION`), not the global error envelope; handle them in the hook, do not try to route them through `handleApiError`.

### Pattern 7: Socket.IO Browser-Hosted App Runtime

`BrowserRuntimeClient` connects to `/app-runtime` for Conversation V2 application previews. It authenticates with a one-shot runtime ticket obtained through the authenticated REST API, not the access token. `BrowserRuntimeHost` owns registration, heartbeat, revision rehydration, and tool execution for the browser-hosted runtime.

The shared protocol events are `runtime.register`, `runtime.heartbeat`, `runtime.rehydrate`, `tool.invoke`, `tool.progress`, `tool.completed`, and `tool.failed`. Keep event names and payloads aligned with `back/src/modules/app-runtime/types/app-runtime-protocol.ts`. Do not create a second app-runtime socket owner or reuse the one-shot ticket after connection.

### Rules (all patterns)

- Never open ad-hoc `new EventSource` in a component (use the module's service/hook)
- Never hand-roll SSE parsing in a component; use the module stream helper (`conversation-v2/useStream`, `worky/stream/sse.ts`, or service singleton)
- Never open ad-hoc `io()` Socket.IO connections in a component; use the owning module's hook or service (`useBrowserSession`, WhatsApp pairing hooks, `BrowserRuntimeClient`)
- Token refresh integration mandatory where applicable
- Always clean up on unmount / disconnect
- Cap per-user connections (backend enforces, frontend handles eviction with `TOO_MANY_TABS`)
- For ordered streams, preserve and store the backend `sequence` cursor so clients can resume without duplicate events.
- For the browser-session Socket.IO namespace, keep the client viewport constants in sync with the backend (see Pattern 6).
- For the app-runtime namespace, preserve one-shot ticket authentication, registration-before-tools, heartbeat, and revision rehydration semantics (see Pattern 7).

## Module-Specific Patterns

These patterns capture how specific modules extend or deviate from the base rules. Mirror the closest sibling when adding similar behavior.

### Governance (Query-first, no SSE)

`governance` is TanStack Query-first with a separate UI-only Zustand store:

- Query hooks live in a single `query/hooks.ts` file (not the `query/hooks/` directory), using `useQuery`, `useQueries`, mutations, structured query keys, and cache invalidation. Active reconciliation runs are polled at 1s — there is **no** governance SSE today.
- UI selection state lives in `uiStore.ts` (devtools-enabled), separate from server state.
- **Established exception to the barrel rule ([Module anatomy](architecture.md#module-anatomy)):** `governance/index.ts` re-exports the API surface, every query hook, and all types (`export *`). When adding to governance, follow this expanded surface; do not retrofit the limited-surface rule without a planned refactor.
- The legacy `conversation` module imports governance internals directly for its banner and carousel (`ConversationPage.tsx`, `NewConversationPage.tsx`). This cross-module internal import is a documented exception for governed-conversation integration — do not replicate the pattern for new integrations; expose a public surface on the consumer module instead.

### conversation-v2 UI patterns

- Event types beyond messages include `step`, `tool`, `plan`, and `application_component` — discriminated unions in `conversationV2Stream.ts`.
- `StepBlock` renders collapsible execution steps with their tool calls; `ToolCallCard` opens a mutually-exclusive right-panel detail view (only one tool detail visible at a time).
- The current "thinking" UI is `ThinkingIndicator` (three-dot animation). `PulseProgress` is not the canonical CoT component.
- Read-only shared conversations use a token route (`SharedConversationV2Page`) that fetches a snapshot and renders a `MessageList`. Deployed-app sharing UI exists (`ShareDeployDialog`, `DeployControls`) but is currently commented out in `RightPanel` — do not assume it is live.

### Widget embedding (administered from `agent`)

There is no separate React widget app on the frontend. The widget is **generated vanilla-JS output** administered from the agent module:

- `AgentDeploymentSection` issues a one-time widget token then calls `buildWidgetCdnSnippet()` to produce a `<script>` snippet. The CDN host is the current origin or `VITE_APP_URL`.
- `agent/constants/widget-template.ts` is a standalone DOM/CSS/JS runtime that builds its own launcher/dialog markup. It resolves the API base from `window.__APP_CONFIG__.API_URL` (same as the SPA) or the script origin.
- When extending the widget runtime, remember it is **not** React: no hooks, no JSX, no module bundler assumptions beyond what the template emits. Test the generated snippet in isolation.

### Browser session viewer (workspace web import)

`useBrowserSession` (Pattern 6) drives an interactive remote browser. `BrowserSessionViewer` paints JPEG frames to a canvas at 1:1 scale and maps local pointer/keyboard events back to the remote viewport. `AddLinkDialog` collects visited URLs, asks the backend which are already indexed, and submits selected links with auto/deep-index settings. The link API wrappers live under `workspace/api.ts` (`addLink`, `addLinks`, `checkUrls`). Do not introduce a second browser-session consumer — extend the workspace hook.
