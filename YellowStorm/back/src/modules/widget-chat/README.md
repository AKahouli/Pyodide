# Widget Chat Module (Backend)

The widget-chat module exposes a **public, token-authenticated** chat API for embedding an AI assistant on external websites. Visitors chat without YellowStorm login; the backend binds each widget token to one agent, runs the same gRPC agent team flow as in-app conversations, and streams replies over Server-Sent Events (SSE).

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Authentication & CORS](#authentication--cors)
- [MongoDB Schemas](#mongodb-schemas)
- [API Endpoints](#api-endpoints)
- [SSE Events](#sse-events)
- [Streaming Pipeline](#streaming-pipeline)
- [Guards & DTOs](#guards--dtos)
- [Error Codes](#error-codes)
- [Configuration](#configuration)
- [Data Flow](#data-flow)
- [Operational Notes](#operational-notes)
- [Related Modules](#related-modules)

---

## Overview

### Capabilities

- **Embed token lifecycle**: Create, list, update, revoke widget tokens per agent (admin API, JWT + `agents.update`).
- **Anonymous visitor sessions**: One active session per `(tokenHash, visitorId)`; metadata stores IP, user-agent, origin.
- **Chat + SSE**: `POST /widget/chat` accepts a message and starts gRPC streaming; `GET /widget/stream` delivers `stream_start`, `stream_chunk`, `stream_complete`, `stream_error`, and heartbeats.
- **Session reset**: `POST /widget/session/reset` closes the active session and opens a new one (used by the embed script “New conversation”).
- **Origin allowlist**: Optional per-token `allowedOrigins`; enforced in `WidgetTokenGuard` when the browser sends `Origin` / `Referer`.
- **Manager + widget agent**: Resolves agents via `AgentService.buildAgentsForStream` (manager required); prefers **manager** text in the widget UI, with **worker fallback** when manager output is empty.

### Public vs Admin Routes

| Surface | Auth | Prefix |
|---------|------|--------|
| Public widget API | Widget token (`Bearer` or `?token=`) | `/api/v1/widget/*` |
| Token management | JWT + `PermissionsGuard` (`agents.update`) | `/api/v1/admin/agents/:agentId/widget-tokens` |

All public widget routes use `@Public()` (skip JWT) and `@SkipMaintenance()`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WIDGET CHAT MODULE (NestJS)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  External site (embed script)                                                │
│       │  Bearer widget token                                                 │
│       ▼                                                                      │
│  ┌─────────────────────┐     ┌─────────────────────┐                        │
│  │ WidgetChatController │────►│  WidgetChatService   │                        │
│  │  POST session/chat   │     │  tokens, sessions,   │                        │
│  │  POST session/reset  │     │  messages, gRPC run  │                        │
│  │  GET stream (SSE)    │     └──────────┬──────────┘                        │
│  └──────────┬──────────┘                │                                     │
│             │                            ▼                                     │
│             │              ┌─────────────────────────────┐                   │
│             │              │ WidgetSseStreamRegistry      │                   │
│             │              │ (in-memory per sessionId)    │                   │
│             │              └──────────┬──────────────────┘                   │
│             │                         │ emit / observe                         │
│             ▼                         ▼                                        │
│  ┌─────────────────────┐     ┌─────────────────────┐                        │
│  │ WidgetTokenGuard     │     │   StreamService      │──► gRPC RunAgentTeam  │
│  └─────────────────────┘     │   (conversation)     │     (yellowstorm-adk) │
│                               └─────────────────────┘                        │
│  ┌─────────────────────┐     ┌─────────────────────┐                        │
│  │ AdminWidgetController│     │ MongoDB              │                        │
│  │  token CRUD          │     │ widget_tokens        │                        │
│  └─────────────────────┘     │ widget_sessions      │                        │
│                               │ widget_messages      │                        │
│                               └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
widget-chat/
├── widget-chat.module.ts
├── README.md
├── controllers/
│   ├── widget-chat.controller.ts    # Public widget API + SSE
│   └── admin-widget.controller.ts   # Token CRUD (authenticated)
├── services/
│   ├── widget-chat.service.ts       # Core business logic + gRPC
│   └── widget-sse-stream.registry.ts # Per-session SSE subjects + pending queue
├── guards/
│   └── widget-token.guard.ts        # Token hash, expiry, origin, active agent
├── dto/
│   └── widget-chat.dto.ts
├── schemas/
│   ├── widget-token.schema.ts
│   ├── widget-session.schema.ts
│   └── widget-message.schema.ts
└── interfaces/
    └── widget-chat.interface.ts
```

Registered in `app.module.ts` as `WidgetChatModule`.

---

## Authentication & CORS

### Widget token

1. Client sends raw UUID token in `Authorization: Bearer <token>` **or** query `?token=<token>` (SSE uses query).
2. Guard hashes with SHA-256 and looks up `widget_tokens.tokenHash` where `isActive: true`.
3. Optional `expiresAt` check.
4. If `allowedOrigins` is non-empty, request `Origin` (or `Referer` origin) must match an entry (full URL origin comparison).
5. Linked agent must exist and `isActive: true`.

**Security:** Only the hash is stored; the plain token is returned once on `POST` create.

### CORS

Browser calls from third-party origins require the API host to allow those origins (global CORS + optional admin dynamic whitelist). Token `allowedOrigins` is an **additional** embed-site restriction, not a substitute for server CORS.

---

## MongoDB Schemas

### `widget_tokens`

| Field | Type | Notes |
|-------|------|-------|
| `tokenHash` | string | SHA-256 of secret token, unique |
| `agentId` | ObjectId | Ref `Agent` |
| `label` | string? | Admin label |
| `allowedOrigins` | string[] | Empty = no origin check |
| `isActive` | boolean | Default `true` |
| `expiresAt` | Date? | Optional expiry |
| `lastUsedAt` | Date? | Updated on each chat |
| `createdBy` | ObjectId | Ref `User` |

`tokenHash` is stripped from JSON responses.

### `widget_sessions`

| Field | Type | Notes |
|-------|------|-------|
| `tokenHash` | string | Indexed |
| `agentId` | ObjectId | Indexed |
| `visitorId` | string | Max 64 chars from client |
| `metadata` | object | `ip`, `userAgent`, `origin` |
| `status` | `active` \| `closed` | |
| `messageCount` | number | Incremented per user/assistant message |

Unique partial index: `{ tokenHash, visitorId }` where `status: 'active'` (one active session per visitor per token).

### `widget_messages`

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | ObjectId | Ref session |
| `tokenHash` | string | |
| `agentId` | ObjectId | |
| `role` | `user` \| `assistant` | |
| `content` | string | Max 50k |
| `components` | array? | Assistant message components |
| `inputTokens` / `outputTokens` | number? | From gRPC usage |

---

## API Endpoints

Base path: `/api/v1`. Response wrapper: `{ success, data, timestamp }` unless SSE raw stream.

### Public (`WidgetChatController`)

All routes: `@UseGuards(WidgetTokenGuard)`, rate-limited.

| Method | Path | Body / Query | Description |
|--------|------|--------------|-------------|
| `POST` | `/widget/session` | `{ visitorId }` | Create or return active session → `{ sessionId }` |
| `POST` | `/widget/session/reset` | `{ visitorId }` | Close active session, create new → `{ sessionId }` |
| `POST` | `/widget/chat` | `{ message, visitorId? }` | Persist user message, start gRPC → `{ messageId, sessionId }` |
| `GET` | `/widget/stream` | `?token=&sessionId=` | SSE stream for session |

Rate limits (per IP/window): session 30/min, reset 15/min, chat 20/min, stream 10/min.

### Admin (`AdminWidgetController`)

Requires JWT + `agents.update`.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/agents/:agentId/widget-tokens` | Create token → `{ id, token, agentId }` (plain `token` once) |
| `GET` | `/admin/agents/:agentId/widget-tokens` | List tokens (no hash) |
| `PATCH` | `/admin/agents/:agentId/widget-tokens/:tokenId` | Update label, origins, `isActive`, `expiresAt` |
| `DELETE` | `/admin/agents/:agentId/widget-tokens/:tokenId` | Revoke (delete) token |

---

## SSE Events

`Content-Type: text/event-stream`. Controller sends a 2KB warmup write to reduce proxy buffering.

| Event | Payload (data) | When |
|-------|------------------|------|
| `stream_start` | `{ sessionId }` | gRPC call begins |
| `stream_chunk` | `{ action, component }` | Text (and error-as-text) chunks for widget display |
| `stream_complete` | `{ reply, usage }` | Stream finished; `reply` is aggregated display text |
| `stream_error` | `{ message }` | gRPC/validation/empty reply errors |
| `heartbeat` | `{ timestamp }` | Every `conversation.sseHeartbeatMs` (default 15s) |

Client should open `EventSource` **after** `POST /widget/chat` returns `sessionId`, with the same token:

```
GET /api/v1/widget/stream?token=<WIDGET_TOKEN>&sessionId=<SESSION_ID>
```

### Registry behavior

`WidgetSseStreamRegistry` buffers events until the browser subscribes (`sseSubscribed`), then flushes the queue. On client disconnect, `removeStream` calls `cleanup(sessionId)`.

---

## Streaming Pipeline

1. **`handleMessage`**: `ensureSession` → save user `WidgetMessage` → `executeStream` (async).
2. **`executeStream`**:
   - Waits for gRPC ready (`StreamService.waitForGrpcReady`).
   - Resolves owner `userId` from agent `createdBy` (widget runs in agent owner’s context).
   - `resolveWidgetGrpcAgents`: `buildAgentsForStream(ownerUserId, [widgetAgentId], …)` — needs an active **Manager** for manual mode.
   - `RunAgentTeam` with `agent_mode: 'manual'`, `conversation_id: sessionId`, synthetic workspace context.
3. **Display filter**: `isManagerStreamOutput` — SSE chunks prefer manager agent components; worker chunks used when manager produces no text (`usedWorkerFallback` + single `stream_chunk` before complete).
4. **Component mapping**: Uses `extractComponentData` / `component-mapper` (same as conversation module) for proto-loader oneofs.
5. **End**: Persist assistant `WidgetMessage`, emit `stream_complete`; if reply empty, also emit `stream_error` with diagnostic hint.

Dependencies: `ConversationModule` (`StreamService`), `AgentModule`, `ModelsModule` (fallback model when agent has no model).

---

## Guards & DTOs

### `WidgetTokenGuard`

Attaches to request: `widgetTokenHash`, `widgetAgentId`, `widgetAgent`.

### DTOs (`widget-chat.dto.ts`)

| DTO | Fields |
|-----|--------|
| `WidgetSendMessageDto` | `message` (required, max 5000), `visitorId?` (max 64) |
| `WidgetCreateSessionDto` | `visitorId` (required, max 64) |
| `CreateWidgetTokenDto` | `label?`, `allowedOrigins?`, `expiresAt?` |
| `UpdateWidgetTokenDto` | `label?`, `allowedOrigins?`, `isActive?`, `expiresAt?` |

---

## Error Codes

| Code | Enum | Typical cause |
|------|------|----------------|
| `ERR_3300` | `WIDGET_TOKEN_INVALID` | Missing/invalid token |
| `ERR_3301` | `WIDGET_TOKEN_EXPIRED` | Past `expiresAt` |
| `ERR_3303` | `WIDGET_ORIGIN_NOT_ALLOWED` | Origin not in token allowlist |
| `ERR_3304` | `WIDGET_AGENT_NOT_FOUND` | Agent missing or inactive |
| `ERR_3305` | `WIDGET_SESSION_NOT_FOUND` | SSE: no registry for `sessionId` |
| `ERR_3306` | `WIDGET_AI_UNAVAILABLE` | gRPC unavailable (reserved) |

SSE 404 for missing stream uses JSON `{ success: false, error: { code: 'ERR_3305', ... } }`.

---

## Configuration

Uses `ConfigService` keys from conversation module:

| Key | Default | Usage |
|-----|---------|--------|
| `conversation.grpcUrl` | `localhost:50051` | ADK gRPC target |
| `conversation.grpcTimeoutMs` | `120000` | Idle timeout per stream |
| `conversation.sseHeartbeatMs` | `15000` | Widget SSE heartbeat interval |

Ensure `CONVERSATION_GRPC_URL` (or env equivalent) points to a running ADK server for widget replies.

---

## Data Flow

### Embed visitor sends a message

```
1. Browser: POST /widget/chat  (Bearer token, { message, visitorId })
2. Guard validates token + agent + origin
3. createOrGetSession(tokenHash, agentId, visitorId)
4. Save user WidgetMessage; return { sessionId, messageId }
5. Browser: EventSource GET /widget/stream?token=&sessionId=
6. executeStream → gRPC RunAgentTeam → SSE chunks
7. stream_complete → client renders final reply
8. Assistant WidgetMessage persisted with components + usage
```

### Generate token (YellowStorm UI)

```
1. Authenticated user: POST /admin/agents/:agentId/widget-tokens
2. Service creates UUID, stores SHA-256 hash, returns plain token once
3. Front builds embed script with token + API URLs (see agent module README)
```

### New conversation (embed menu)

```
1. POST /widget/session/reset { visitorId }
2. Active session → status closed; SSE registry cleanup
3. New active session created → { sessionId }
4. Client clears UI and reconnects EventSource on next message
```

---

## Operational Notes

- **Regenerate snippet after template changes**: Embed JavaScript is generated in the frontend (`widget-template.ts`), not served as a static file from the API.
- **Manager agent required**: Without a resolvable Manager for the agent owner, widget chat returns `stream_error` explaining the requirement.
- **Empty replies**: Logged with `chunkCount`, `componentTypes`; client may receive `stream_error` after `stream_complete` with empty `reply`.
- **In-memory SSE**: Streams are per Node process; sticky sessions or single instance assumed for SSE during development; production should account for load balancing (or accept reconnect + new message).
- **Token rotation**: Create a new token via admin API; revoke old tokens. Old embeds stop working when revoked.

---

## Related Modules

| Module | Role |
|--------|------|
| `conversation` | `StreamService`, gRPC client, `component-mapper` |
| `agent` | Agent document, `buildAgentsForStream` |
| `models` | Fallback model ID when widget agent has no model |
| `authorization` | `agents.update` on admin token routes |
| `rate-limiter` | Per-route throttling on public endpoints |
| `exceptions` | `ERR_33xx` widget error codes |

Frontend integration: `YellowStorm/front/src/modules/agent` — **Deployment** tab, `AgentDeploymentSection`, `constants/widget-template.ts`.
