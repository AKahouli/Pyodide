# Connectors in Conversation V2 (Manus) — Backend

This document describes how user-selected **connectors** (remote MCP servers) are
wired into the Conversation V2 (Manus) chat flow on the backend. Connector CRUD
and auth live in the [`connector`](../connector) module; this feature is about
attaching a per-conversation connector selection to each message turn, resolving
the current user's auth, and forwarding ready-to-use bindings to the AI engine
(Manus/ADK) over gRPC.

It mirrors the [Skills](./SKILLS.md) wiring almost exactly. The one extra concern
is **auth**: unlike a skill (plain text), a connector is an executable tool, so
each turn must resolve the calling user's OAuth token / credentials and identity
headers before sending.

## Table of Contents

- [Overview](#overview)
- [Data Flow](#data-flow)
- [Request Contract](#request-contract)
- [Auth Resolution](#auth-resolution)
- [Persistence](#persistence)
- [gRPC Contract](#grpc-contract)
- [Files Touched](#files-touched)

---

## Overview

- The client sends an optional `connectorIds: string[]` with every message.
- For each turn the stream service resolves those IDs into full gRPC bindings
  (`ConnectorService.findByIdsForGrpc(ids, userId)`) — including the **per-user
  resolved auth** — and ships them to Manus over gRPC on the `Chat` request.
- The selection is **persisted on the session** (`selectedConnectorIds`) on every
  send, so reloading a conversation re-displays the same selection (mirrors
  skills' `selectedSkillIds`).
- Selection is **refreshed on every send** — the stored set always reflects the
  latest selection, not a union over time.
- Opt-in: when `connectorIds` is absent/empty, no resolution call is made and
  nothing is attached.

## Data Flow

```
Client (POST message, { message, model, connectorIds })
        │
        ▼
ConversationV2StreamController.stream      conversation-v2-stream.controller.ts
        │  passes connectorIds into the StartStreamRequest
        ▼
ConversationV2StreamService.startStream    conversation-v2-stream.service.ts
        │  1. resolve connectorIds → full gRPC bindings (with per-user auth)
        │     connectors = connectorService.findByIdsForGrpc(req.connectorIds, userId)
        │  2. persist selection on the session
        │     sessions.setSelectedConnectors(sessionId, req.connectorIds ?? [])
        │  3. open the gRPC chat with the resolved bindings
        ▼
ConversationV2GrpcClientService.chat(..., connectors)  → Manus (repeated ConnectorBinding)
```

On read (`GET` session pointer), the persisted `selectedConnectorIds` is returned
so the client can re-hydrate the composer selection.

## Request Contract

`connectorIds` is an optional array of connector ObjectId strings on the
send-message DTO ([`dto/send-message.dto.ts`](dto/send-message.dto.ts)), present
on both the query and the body. When absent or empty, no connectors are attached
and no resolution call is made.

> ⚠️ The DTO uses `forbidNonWhitelisted` validation. If the backend is deployed
> from `main` (without this `connectorIds` field) while the front sends it, every
> message fails with `400`. Deploy front + back + Manus from the connector
> branches together.

The session pointer response now exposes the persisted selection:

```ts
interface PointerSummary {
  // …
  selectedConnectorIds: string[]; // persisted selection, [] when none
}
```

## Auth Resolution

`ConnectorService.findByIdsForGrpc(ids, userId)` is a port of the v1 agent
runtime binding (`agent.service.buildConnectorBindings`) to the conv-v2 proto.
For each connector it:

1. Keeps only **enabled** actions (`action.isEnabled !== false`) and maps each to
   the gRPC `ConnectorAction` shape, **serializing `parameterSchema` to a JSON
   string** (`parameter_schema_json`). A connector with **zero** enabled actions
   is **dropped**.
2. Resolves the calling user's auth via the injected `'ConnectorAuthService'`:
   - `resolveRuntimeAuth(userId, …)` for `connected_app` sources (OAuth token /
     credential) → `auth_headers` + `auth_env`.
   - `resolveDynamicHeaders(userId, …)` → identity headers, merged on top.
   - Auth resolution failures are logged as warnings (not fatal): the binding is
     still sent, just without those headers.

The v1 `agent.service` is left **untouched** — no regression risk to v1.

## Persistence

`ConversationV2Session` gained a `selectedConnectorIds: string[]` field
([`persistence/conversation-v2-session.store.ts`](persistence/conversation-v2-session.store.ts) /
[`pg-conversation-v2-session.store.ts`](persistence/postgres/pg-conversation-v2-session.store.ts);
default `[]`).

`ConversationV2SessionService.setSelectedConnectors(id, connectorIds)` overwrites
the stored selection on every send. It is **re-display only** — no access
checks, and an invalid `id` is a no-op. Mirrors `setSelectedSkills`.

## gRPC Contract

The resolved `IGrpcConnector[]` is passed to
`ConversationV2GrpcClientService.chat(...)` and sent to Manus as the
`repeated ConnectorBinding connectors = 9` field on the chat request (see
[`proto/conversation.proto`](proto/conversation.proto)). The wire shape uses
**snake_case** keys to match the proto:

```ts
interface IGrpcConnector {
  connector_id: string;
  connector_name: string;
  mcp_transport_type: string;
  mcp_server_url: string;            // must be HTTPS (org firewall blocks HTTP)
  auth_headers: Record<string, string>;
  auth_env: Record<string, string>;
  actions: IGrpcConnectorAction[];   // { action_key, label, description, parameter_schema_json }
}
```

This `.proto` is kept **identical** to the engine's copy in
`APImanus/backend/app/interfaces/grpc/conversation.proto`. The Manus-side
handling is documented in `APImanus/docs/11_connectors.md`.

## Files Touched

| File | Change |
| --- | --- |
| [`../connector/connector.service.ts`](../connector/connector.service.ts) | `findByIdsForGrpc(ids, userId)`: resolve enabled actions + per-user auth → gRPC bindings; inject `ConnectorAuthService` |
| [`../connector/interfaces/connector.interface.ts`](../connector/interfaces/connector.interface.ts) | `IGrpcConnector` / `IGrpcConnectorAction` wire-shape interfaces |
| [`services/conversation-v2-stream.service.ts`](services/conversation-v2-stream.service.ts) | Resolve `connectorIds` → gRPC bindings, persist selection, forward to gRPC |
| [`conversation-v2.grpc-client.service.ts`](conversation-v2.grpc-client.service.ts) | `chat(...)` sets `request.connectors` |
| [`services/conversation-v2-session.service.ts`](services/conversation-v2-session.service.ts) | `setSelectedConnectors`; expose `selectedConnectorIds` on `PointerSummary` |
| [`persistence/postgres/pg-conversation-v2-session.store.ts`](persistence/postgres/pg-conversation-v2-session.store.ts) | `selectedConnectorIds` on session pointer |
| [`conversation-v2.controller.ts`](conversation-v2.controller.ts) | Return `selectedConnectorIds` on the session pointer |
| [`dto/send-message.dto.ts`](dto/send-message.dto.ts) | Optional `connectorIds` input (query + body) |
| [`conversation-v2.module.ts`](conversation-v2.module.ts) | Import `ConnectorModule` |
