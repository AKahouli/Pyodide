# SSE and Socket.IO protocols

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 15. Real-time & SSE

Current SSE endpoints and pipes use these serving patterns:

| Stream | Endpoint | Auth | Implementation |
|--------|----------|------|----------------|
| Conversation | `GET /api/v1/conversations/stream` | `StreamAuth`, Authorization bearer header | `@Sse()`, RxJS `Observable`, PostgreSQL recipient replay |
| Notifications | `GET /api/v1/notifications/stream` | `SseAuth` decorator | `@Sse()`, heartbeat via `interval()` |
| Playbook flow | `GET /api/v1/playbooks/stream` | `PlaybookFlowStreamAuthGuard` (query token) | `@Sse()`, `@Public()`, per-user connection tracking |
| Conversation v2 pipe | `GET /api/v1/conversation-v2/stream` | Query token | Manual SSE (no `@Sse()`), flush via warmup padding, Nagle disable, heartbeat stream |
| Conversation v2 live tail | `GET /api/v1/conversation-v2/sessions/:id/stream/live` | Query token | Manual SSE polling `eventStore.listSince` (`liveTailPollMs`, default 1000ms) |
| Worky events | `GET /api/v1/worky/streams/:id/events` | `WorkyStreamAccessGuard` | `@Sse()` endpoint; frontend consumes via fetch + `ReadableStream` |

**Rules:**
- Classic conversation requires migration 0053. The existing gateway publishes
  recipient events in ordered PostgreSQL batches and polls current authorized
  recipient rows for live delivery/replay. Existing count/TTL settings bound the
  durable window; `sseReplayEnabled` only affects the legacy direct-construction
  in-memory test path. Runtime durable delivery stays enabled. Canonical resync
  runs around every 30 seconds during healthy polling, and on reconnect/gaps.
- SSE auth uses its dedicated guard. Classic conversation fetch sets Authorization;
  the shared guard retains query-token compatibility only for conversation v2.
- Always clean up on `req.on('close')`.
- Cap per-user connections (frontend issues `TOO_MANY_TABS` on eviction).
- Emit typed events; keep schema in sync with frontend.
- Ordered streams must include and persist a monotonic cursor (`sequence` for conversation-v2) so clients can resume and gap-detect.
- On token refresh, frontend calls `reconnectWithNewToken()` — expect short-lived reconnects.
- Do not open WebSocket gateways without agreeing on event schema with the frontend team.
- `compression()` middleware is incompatible with SSE (buffering breaks streaming). It is disabled in `main.ts` — do not re-enable without verifying all SSE endpoints.

Worky governance is backend-owned; resolution uses stream override, workspace policy, then default level. Every governance evaluation must write an audit event.

### Socket.IO namespace: `/browser-session` (browser-session module)

A sanctioned Socket.IO usage alongside WhatsApp pairing and app runtime. JWT handshake via `socket.request`, one in-memory session per socket, events `start` / `input` / `navigate` (client → server) and `frame` / `navigated` / `blocked` / `closed` (server → client). Runtime is a Playwright/CDP relay: `Page.screencastFrame` emits base64 JPEG frames that the gateway forwards as `frame` events; input/navigation events are replayed to Playwright. Sessions expire on idle/max timers and are destroyed on socket disconnect.

**Hard cross-boundary invariant:** the configured 1280×720 (16:9) viewport must match the frontend `VIEWPORT_W/H` constants in `front/src/modules/workspace/hooks/useBrowserSession.ts` so streamed input coordinates map correctly. Change both sides in the same change set.

**Ack protocol uses raw strings, not the global error envelope:** `BUSY`, `BAD_REQUEST`, `NO_SESSION`, etc. Any new ack string must be added to the frontend consumer in the same change.

**Security controls are mandatory, not optional:** URL safety is checked before launch and before every navigation; routed main-document requests are validated; popups are closed and downloads cancelled. Do not bypass these checks when extending the engine — surface new unsafe patterns through the existing guard points.

### Socket.IO namespace: `/app-runtime` (app-runtime module)

The browser-hosted application runtime connects through `AppRuntimeGateway` using a one-shot runtime ticket, not the user JWT. The consumed ticket scopes the socket to one user, workspace, binding, and runtime session and cannot be replayed. One current runtime connection is registered per workspace; replacement or disconnect fails pending tools and returns the binding to its waiting state.

The protocol is defined in `app-runtime/types/app-runtime-protocol.ts`: `runtime.register`, `runtime.heartbeat`, `runtime.rehydrate`, `tool.invoke`, `tool.progress`, `tool.completed`, and `tool.failed`. The ticket decides socket ownership; never trust workspace or runtime identifiers from event payloads without matching them to the consumed ticket. Keep event names, payloads, capability negotiation, heartbeat persistence, and the frontend `BrowserRuntimeClient`/`BrowserRuntimeHost` consumers aligned.

### Widget manual SSE (widget-chat module)

`GET /widget/stream` is a `@Public()` manual SSE endpoint (no `@Sse()` decorator), authenticated by query token via `WidgetTokenGuard`. The controller writes warmup padding, disables Nagle (`socket.setNoDelay(true)`), sets SSE headers, and emits `stream_start`, `stream_chunk`, `stream_complete`, `stream_error`, plus heartbeat. Mirror this exact event set when extending; do not introduce a second widget stream shape.
