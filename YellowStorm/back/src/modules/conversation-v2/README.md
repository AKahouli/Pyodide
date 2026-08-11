# Conversation V2 — Backend

NestJS module that bridges YellowStorm to the Manus (APImanus) gRPC
`ConversationV2` service: sessions, streaming chat, event persistence, SSE
fan-out, deploy, and in-browser app preview metadata for Nodepod.

Related docs in this folder:

- [`SKILLS.md`](SKILLS.md) — skill selection → gRPC
- [`CONNECTORS.md`](CONNECTORS.md) — connector bindings → gRPC
- [`NODEPOD_INTEGRATION.md`](NODEPOD_INTEGRATION.md) — historical design notes (implementation landed; prefer this README)

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Application component / Nodepod](#application-component--nodepod)
- [gRPC contract](#grpc-contract)
- [SSE payload](#sse-payload)
- [App source signed URLs](#app-source-signed-urls)
- [Deploy](#deploy)
- [Key files](#key-files)

---

## Overview

| Concern | Behaviour |
|---|---|
| Sessions | Create / list / get / rename / delete pointers in Mongo |
| Chat | Background gRPC `Chat` stream → persist events → SSE to the user |
| Tools / plan / steps | Forwarded as typed SSE events |
| App preview | `application_component` carries preview URL **and** Ceph source metadata for Nodepod |
| Deploy | HTTP App Builder (`POST …/sessions/:id/deploy`), independent of Nodepod |

## Architecture

```
Frontend SSE
     ▲
ConversationV2StreamGateway  (fan-out per user)
     ▲
ConversationV2StreamService  (persist + push; drop heartbeats)
     ▲
ConversationV2GrpcClientService  (dial Manus, normaliseEvent)
     ▲
Manus gRPC ConversationV2.Chat (server-stream Event)
```

Manus side (APImanus), when the React app build is ready (files under
`/opt/react-project`, plus optional npm install/build):

1. Emits `app_build_progress` phases while coding/building.
2. Resolves public preview via Sandbox Manager `POST /app/preview` (+ status poll).
3. Triggers / polls `POST /app/code` until ready (every ~10s, timeout configurable).
4. Emits `ApplicationComponentEvent` with `url`, `title`, `ceph_path`,
   `files_tree_json`, `file_count`.

No agent tool is required — YellowStorm only consumes the streamed events.

## Application component / Nodepod

YellowStorm does **not** boot Nodepod on the server. It:

1. Maps the gRPC event into a typed payload (including parsed `files_tree`).
2. Persists and SSE-pushes that payload to the frontend.
3. Exposes batch Ceph **presigned read URLs** so the browser can download
   sources and hydrate `@scelar/nodepod`.

### Proto (`proto/conversation.proto`)

```protobuf
message ApplicationComponentEvent {
  string url = 1;
  string title = 2;
  string ceph_path = 3;         // Ceph prefix of the generated project
  string files_tree_json = 4;   // JSON nested tree { name, type, path?, size?, children? }
  int32  file_count = 5;
}
```

Keep this file in sync with
`APImanus/backend/app/interfaces/grpc/conversation.proto`.

### Mapping (`services/conversation-v2.grpc-client.service.ts`)

- Parses `files_tree_json` with `parseFilesTree()` → `FilesTreeNode | null`.
- Invalid / missing JSON → `files_tree: null` (frontend shows waiting / empty tree).

Types: [`types/conversation-v2.types.ts`](types/conversation-v2.types.ts)
(`ApplicationComponentEventPayload`, `FilesTreeNode`).

## SSE payload

```
event: application_component
data: {
  "event_id": "...",
  "timestamp": 1710000000,
  "sequence": 42,
  "url": "https://{conversation}.yellowsys.org",
  "title": "My app",
  "ceph_path": "yellowstorm/user/appbuilder/conversation/projectSRC",
  "files_tree": { "name": "", "type": "directory", "children": [ ... ] },
  "file_count": 23
}
```

## App source signed URLs

```http
POST /api/v1/conversation-v2/sessions/:id/app-source/urls
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "cephPath": "yellowstorm/user/appbuilder/conversation/projectSRC",
  "paths": ["package.json", "app/page.tsx"]
}
```

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      { "path": "package.json", "url": "https://…presigned…" },
      { "path": "app/page.tsx", "url": "https://…presigned…" }
    ]
  }
}
```

- Guard: session access + `session.read`.
- Object key = `{cephPath}/{relativePath}` (rejects `..` / absolute / empty paths).
- DTO: [`dto/get-app-source-urls.dto.ts`](dto/get-app-source-urls.dto.ts).
- Signing: `WorkspaceDocumentService.generateReadUrl` (same Ceph/S3 stack as
  message attachments).

Single-file attachments still use `POST /conversation-v2/files/signed-url`.

## Deploy

`POST /conversation-v2/sessions/:id/deploy` → App Builder HTTP
(`conversation-v2-deploy.service.ts`). Unchanged by Nodepod: publish stays on
the remote App Builder URL; the in-browser preview keeps using Ceph sources.

## Key files

| Path | Role |
|---|---|
| `proto/conversation.proto` | gRPC contract (sync with Manus) |
| `services/conversation-v2.grpc-client.service.ts` | Dial + `normaliseEvent` + `parseFilesTree` |
| `services/conversation-v2-stream.service.ts` | Persist + SSE push |
| `services/conversation-v2-stream-gateway.service.ts` | Per-user SSE fan-out |
| `conversation-v2-stream.controller.ts` | `GET /conversation-v2/stream` |
| `conversation-v2.controller.ts` | REST sessions, deploy, `app-source/urls` |
| `types/conversation-v2.types.ts` | Event / payload TS types |
| `dto/get-app-source-urls.dto.ts` | Batch presign body |
| `services/conversation-v2-deploy.service.ts` | App Builder deploy |
