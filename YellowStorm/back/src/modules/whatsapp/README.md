# WhatsApp Module (Backend)

The WhatsApp module connects YellowStorm agents to WhatsApp Web via [Baileys](https://github.com/WhiskeySockets/Baileys). Each agent can pair a phone number through QR code, receive inbound DMs, route them to the linked agent through the conversation pipeline, and send AI replies back on WhatsApp.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Pairing Flow](#pairing-flow)
- [Inbound Message Flow](#inbound-message-flow)
- [Module Structure](#module-structure)
- [Database Collections](#database-collections)
- [API Endpoints](#api-endpoints)
- [Socket.IO Gateway](#socketio-gateway)
- [Services](#services)
- [Baileys Layer](#baileys-layer)
- [Environment Variables](#environment-variables)
- [Error Codes](#error-codes)
- [Security](#security)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [Related Documentation](#related-documentation)

---

## Overview

Key features:

- **Agent-scoped integration** — one WhatsApp connection per agent, owned by the platform user who configured it
- **QR pairing** — Baileys `connection.update` QR events, cached and exposed via REST + Socket.IO
- **Encrypted auth persistence** — Baileys credentials stored in MongoDB via `CryptoService`
- **Real-time UI updates** — Socket.IO namespace `/whatsapp` with JWT authentication
- **Inbound routing** — WhatsApp DMs invoke gRPC `RunSingleAgent` (`RunSingleAgentRequest`, single linked agent, no manager / no SSE)
- **Outbound replies** — AI response text sent back through Baileys `sendMessage`
- **Session resilience** — reconnect with exponential backoff; restore connected sessions on app bootstrap
- **Network probe** — HTTPS reachability check to `web.whatsapp.com` before pairing/connect

There is **no public REST endpoint to send arbitrary WhatsApp messages**. Outbound send happens internally when routing an inbound message to the agent.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (Agent UI)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  AgentWhatsAppIntegrationSection                                            │
│  - Connect / Disconnect / Reconnect                                         │
│  - QR code viewer + pairing code                                              │
│  - Status banner (PAIRING | CONNECTED | DISCONNECTED | FAILED)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  REST  /api/v1/agents/:agentId/whatsapp-integration/*                       │
│  WS    /whatsapp  (Socket.IO, JWT auth)                                     │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────────────────┐
│                         WHATSAPP MODULE (NestJS)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  WhatsAppIntegrationController          WhatsAppGateway (/whatsapp)         │
│         │                                        │                          │
│         ▼                                        ▼                          │
│  WhatsAppConnectionService              JWT join rooms                       │
│  WhatsAppIntegrationService             emit qr / connected / failed         │
│         │                                                                   │
│         ▼                                                                   │
│  WhatsAppSessionManager  ◄─── in-memory Map<sessionId, WASocket>            │
│         │                                                                   │
│         ├── BaileysClientFactory + MongoBaileysAuthStore                      │
│         ├── WhatsAppPairingCacheService                                     │
│         └── WhatsAppMessageService                                          │
│                    │                                                        │
│                    ▼                                                        │
│  ConversationModule ──► MessageService + StreamService                       │
│  WhatsAppStreamService ──► StreamService.runSingleAgentStream()              │
│         └── gRPC RunSingleAgent (RunSingleAgentRequest → stream StreamChunk) │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
         ┌─────────────┐                 ┌─────────────┐
         │   MongoDB   │                 │ WhatsApp Web│
         │  (Mongoose) │                 │  (Baileys)  │
         └─────────────┘                 └─────────────┘
```

---

## Pairing Flow

```
1. User clicks "Connect WhatsApp" in agent modal
   ↓
2. POST /agents/:agentId/whatsapp-integration/connect
   ↓
3. WhatsAppConnectionService creates sessionId, upserts integration (PAIRING)
   ↓
4. WhatsAppSessionManager.startPairing() opens Baileys socket
   ↓
5. Baileys emits connection.update { qr }
   ↓
6. Session manager converts QR → data URL, stores in PairingCache
   ↓
7. Gateway emits whatsapp.qr.generated to Socket.IO room
   ↓
8. Frontend displays QR (Socket.IO + HTTP poll GET .../:sessionId/pairing every 2.5s)
   ↓
9. User scans QR in WhatsApp mobile app
   ↓
10. connection.update { connection: 'open' }
   ↓
11. Integration status → CONNECTED, phoneNumber + displayName saved
   ↓
12. Gateway emits whatsapp.connected
```

---

## Inbound Message Flow

```
1. WhatsApp user sends DM to paired number
   ↓
2. Baileys messages.upsert (type: notify)
   ↓
3. WhatsAppMessageService.handleIncomingMessages()
   - Skip: fromMe, groups (@g.us), status@broadcast, non-text
   ↓
4. ensureBinding(integrationId, remoteJid) → whatsapp_chat_bindings
   ↓
5. ensureConversation(binding) → ConversationModule
   ↓
6. MessageService.createUserMessage + createAIPlaceholder
   ↓
7. WhatsAppStreamService.runStream()
   └── StreamService.runSingleAgentStream() → gRPC `ChatbotService.RunSingleAgent`
       Request: `RunSingleAgentRequest` (one `Agent`, workspace context, no `agent_mode`)
       Response: `stream StreamChunk` (buffered server-side, no SSE gateway)
   ↓
8. extractWhatsAppReplyText() from completed AI message components
   ↓
9. socket.sendMessage(remoteJid, { text }) via sendReply callback
```

**Requirements:**

- `CONVERSATION_GRPC_URL` must point to the ADK gRPC server (e.g. `localhost:50051`)
- Backend `chatbot.proto` must declare `RunSingleAgent` / `RunSingleAgentRequest` (same contract as ADK)
- Stream idle timeout follows `conversation.grpcTimeoutMs` (default 120s) via `StreamService.runSingleAgentStream()`
- Optional: `WHATSAPP_FALLBACK_REPLY` — text sent when reply extraction fails

---

## Module Structure

```
back/src/modules/whatsapp/
├── baileys/
│   ├── baileys-loader.ts              # Dynamic ESM import wrapper
│   ├── baileys-client.factory.ts      # WASocket factory
│   ├── baileys-version.resolver.ts    # WhatsApp Web version probe
│   ├── mongo-auth-state.ts            # Encrypted Baileys auth in MongoDB
│   └── whatsapp-network.util.ts       # Network error helpers
├── controllers/
│   └── whatsapp-integration.controller.ts
├── dto/
│   ├── whatsapp-connect-response.dto.ts
│   ├── whatsapp-integration-response.dto.ts
│   └── whatsapp-pairing-response.dto.ts
├── gateways/
│   └── whatsapp.gateway.ts            # Socket.IO /whatsapp namespace
├── schemas/
│   ├── agent-whatsapp-integration.schema.ts
│   ├── whatsapp-auth-session.schema.ts
│   └── whatsapp-chat-binding.schema.ts
├── services/
│   ├── whatsapp-connectivity.service.ts   # web.whatsapp.com probe
│   ├── whatsapp-connection.service.ts     # connect / disconnect / reconnect
│   ├── whatsapp-integration.service.ts    # CRUD + status persistence
│   ├── whatsapp-message.service.ts        # inbound routing → agent
│   ├── whatsapp-stream.service.ts         # delegates to StreamService.runSingleAgentStream
│   ├── whatsapp-pairing-cache.service.ts  # in-memory QR cache
│   ├── whatsapp-session.manager.ts        # Baileys socket lifecycle
│   └── whatsapp-integration.service.spec.ts
├── utils/
│   └── whatsapp-reply-text.util.ts      # extract text/reasoning from message components
├── index.ts
├── whatsapp.module.ts
└── README.md                            # This file
```

Config lives outside the module:

```
back/src/config/whatsapp.config.ts       # registerAs('whatsapp', ...)
back/src/config/config.schema.ts         # Joi WHATSAPP_* validation
```

---

## Database Collections

### `agent_whatsapp_integrations`

One document per agent. Unique index on `agentId`.

```typescript
{
  userId: ObjectId;           // Owner (platform user)
  agentId: ObjectId;          // Linked agent (unique)
  phoneNumber?: string;       // E.164 after pairing (e.g. +21612345678)
  displayName?: string;       // WhatsApp profile name
  status: 'PAIRING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
  sessionId?: string;         // Active pairing/session UUID
  lastActivityAt?: Date;
  errorMessage?: string;      // Last failure reason
  enabled: boolean;           // Default true
  createdAt: Date;
  updatedAt: Date;
}
```

### `whatsapp_auth_sessions`

Encrypted Baileys credentials. One document per integration.

```typescript
{
  integrationId: ObjectId;    // Ref AgentWhatsAppIntegration (unique)
  encryptedCredentials: string;
  encryptedKeys: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### `whatsapp_chat_bindings`

Maps a WhatsApp JID to a YellowStorm conversation for a given integration.

```typescript
{
  integrationId: ObjectId;
  userId: ObjectId;
  agentId: ObjectId;
  remoteJid: string;          // e.g. 21612345678@s.whatsapp.net or *@lid
  conversationId?: ObjectId; // Reused across messages from same contact
  lastMessageAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

Unique index: `{ integrationId: 1, remoteJid: 1 }`.

---

## API Endpoints

Base path: `/api/v1/agents/:agentId/whatsapp-integration`  
Auth: JWT Bearer (global guard).

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Get integration status for agent |
| `POST` | `/connect` | Start QR pairing; returns `sessionId`, optional `qrCode` |
| `GET` | `/:sessionId/pairing` | Poll latest QR / pairing code snapshot |
| `POST` | `/:sessionId/reconnect` | Reconnect using stored auth or restart pairing |
| `DELETE` | `/:sessionId` | Disconnect active session (keeps integration shell) |
| `DELETE` | `/` | Remove integration entirely |

### Response shapes

**Connect** (`WhatsAppConnectResponseDto`):

```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PAIRING",
  "qrCode": "data:image/png;base64,...",
  "pairingCode": "ABCD-EFGH"
}
```

**Status** (`WhatsAppIntegrationResponseDto`):

```json
{
  "status": "CONNECTED",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "phoneNumber": "+21612345678",
  "displayName": "Hello Bado",
  "lastActivityAt": "2026-06-05T15:00:00.000Z",
  "updatedAt": "2026-06-05T14:30:00.000Z"
}
```

---

## Socket.IO Gateway

Namespace: `/whatsapp`

### Authentication

JWT passed via:

- `handshake.auth.token`, or
- `Authorization: Bearer <token>` header

Invalid/missing token → immediate disconnect.

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `join` | `{ agentId, sessionId? }` | Join room `user:{userId}:agent:{agentId}`; replays cached QR if available |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `whatsapp.qr.generated` | `{ agentId, sessionId, qrCode }` | New QR data URL |
| `whatsapp.connected` | `{ agentId, sessionId, phoneNumber?, displayName? }` | Pairing succeeded |
| `whatsapp.disconnected` | `{ agentId, sessionId }` | Session closed / logged out |
| `whatsapp.session.failed` | `{ agentId, sessionId, errorMessage }` | Pairing or connection failure |

---

## Services

| Service | Responsibility |
|---------|----------------|
| `WhatsAppIntegrationService` | CRUD integration documents, status updates, user/agent ownership checks |
| `WhatsAppConnectionService` | Orchestrates connect, pairing poll, reconnect, disconnect, delete |
| `WhatsAppSessionManager` | In-memory Baileys sockets, QR generation, creds save, reconnect backoff, bootstrap restore |
| `WhatsAppStreamService` | Thin wrapper around `StreamService.runSingleAgentStream()` (gRPC `RunSingleAgent`) |
| `WhatsAppMessageService` | Inbound filter + binding + conversation + gRPC stream + outbound reply |
| `WhatsAppConnectivityService` | Probe `https://web.whatsapp.com/sw.js` before connect |
| `WhatsAppPairingCacheService` | Short-lived in-memory QR/pairing code per `sessionId` |
| `BaileysClientFactory` | Build `WASocket` with resolved WA Web version |
| `MongoBaileysAuthStore` | Load/save encrypted Baileys auth state |

### Integration statuses

| Status | Meaning |
|--------|---------|
| `DISCONNECTED` | No active session |
| `PAIRING` | Waiting for QR scan |
| `CONNECTED` | Baileys socket open, ready for messages |
| `FAILED` | Network error, logout, or unrecoverable disconnect |

---

## Baileys Layer

| File | Role |
|------|------|
| `baileys-loader.ts` | Dynamic `import('@whiskeysockets/baileys')` (ESM-only package) |
| `baileys-version.resolver.ts` | Fetches compatible WhatsApp Web version |
| `baileys-client.factory.ts` | Creates socket with auth, browser profile, `shouldIgnoreJid` guard |
| `mongo-auth-state.ts` | Implements Baileys `useMultiFileAuthState`-style persistence in MongoDB |
| `whatsapp-network.util.ts` | Detects transport errors; shared unreachable message constant |

### Phone number formatting

On `connection: open`, the session manager extracts the phone from `socket.user.id` (JID). The device suffix (`:0`, `:9`) is stripped before formatting as E.164 (`+{digits}`).

---

## Environment Variables

Defined in `config.schema.ts`, loaded via `whatsapp.config.ts`:

| Variable | Default | Description |
|----------|---------|-------------|
| `WHATSAPP_ENABLED` | `true` | Master switch (`false` disables module bootstrap) |
| `WHATSAPP_MAX_REPLY_LENGTH` | `4000` | Truncate AI replies sent to WhatsApp (64–4096) |
| `WHATSAPP_PAIRING_TIMEOUT_MS` | `300000` | Pairing session timeout (5 min) |
| `WHATSAPP_RECONNECT_INITIAL_DELAY_MS` | `1000` | First reconnect delay |
| `WHATSAPP_RECONNECT_MAX_DELAY_MS` | `120000` | Max reconnect backoff |
| `WHATSAPP_RECONNECT_MAX_ATTEMPTS` | `10` | Max reconnect tries before FAILED |
| `WHATSAPP_CONNECTIVITY_PROBE_TIMEOUT_MS` | `10000` | Network probe timeout |
| `WHATSAPP_FALLBACK_REPLY` | *(see config)* | Reply when AI response text cannot be extracted |

`CONVERSATION_GRPC_URL` is defined in conversation config (not `whatsapp.config.ts`) but is required for inbound AI replies.

### Example `.env`

```bash
WHATSAPP_ENABLED=true
WHATSAPP_MAX_REPLY_LENGTH=4000
# Required for inbound AI replies (conversation module gRPC client)
CONVERSATION_GRPC_URL=localhost:50051
```

### npm dependencies

```json
"@whiskeysockets/baileys": "^6.7.23",
"pino": "...",
"qrcode": "...",
"@types/qrcode": "..."
```

---

## Error Codes

WhatsApp-specific codes (`ERR_3210`–`ERR_3219`):

| Code | Constant | Description |
|------|----------|-------------|
| `ERR_3210` | `WHATSAPP_INTEGRATION_NOT_FOUND` | No integration for this agent |
| `ERR_3211` | `WHATSAPP_SESSION_NOT_FOUND` | Session ID not found |
| `ERR_3212` | `WHATSAPP_SESSION_NOT_PAIRING` | Pairing endpoint called outside PAIRING state |
| `ERR_3213` | `WHATSAPP_ALREADY_CONNECTED` | Connect called while already CONNECTED |
| `ERR_3214` | `WHATSAPP_DISABLED` | Module disabled via config |
| `ERR_3215` | `WHATSAPP_SEND_FAILED` | Baileys sendMessage failure |
| `ERR_3216` | `WHATSAPP_PAIRING_FAILED` | Pairing could not complete |
| `ERR_3217` | `WHATSAPP_AUTH_INVALID` | Stored auth corrupted or invalid |
| `ERR_3218` | `WHATSAPP_USER_INACTIVE` | Integration owner account inactive |
| `ERR_3219` | `WHATSAPP_NETWORK_UNREACHABLE` | Cannot reach web.whatsapp.com |

---

## Security

| Aspect | Implementation |
|--------|----------------|
| **Auth credentials** | Encrypted with `CryptoService` before MongoDB storage |
| **REST endpoints** | JWT global guard; integration scoped to `@CurrentUser()` |
| **Socket.IO** | JWT verified on connection; rooms scoped by `userId + agentId` |
| **Ownership** | All operations validate user owns the agent integration |
| **Inbound filter** | Ignores groups, broadcasts, own messages (`fromMe`) |
| **Silent drops** | Inactive users logged at WARN; routing failures logged at ERROR |

---

## Testing

```bash
cd YellowStorm/back
npm run build
npx jest --testPathPattern=whatsapp-integration --no-coverage
```

Unit tests cover `WhatsAppIntegrationService` (status, connect guards, ownership).

Manual verification checklist:

1. `POST .../connect` → QR returned
2. Scan QR → status `CONNECTED`, phone displayed
3. Send WhatsApp DM → conversation created, AI reply received (gRPC required)
4. `DELETE .../:sessionId` → status `DISCONNECTED`
5. Restart backend with CONNECTED integration → session restored on bootstrap

---

## Known Limitations

| Limitation | Detail |
|------------|--------|
| **Single-node sockets** | Baileys sessions live in memory; multi-instance deployment requires sticky sessions or redesign |
| **No REST send API** | Outbound messages only as AI replies to inbound DMs |
| **Text only** | Supports `conversation` and `extendedTextMessage`; media not handled |
| **LID JIDs** | WhatsApp privacy IDs (`*@lid`) used for routing; phone display uses `@s.whatsapp.net` JID only |
| **gRPC dependency** | Inbound replies require ADK gRPC (`CONVERSATION_GRPC_URL`) with `RunSingleAgent` RPC |
| **Direct connection** | No HTTP/S proxy for WhatsApp Web; server must reach `web.whatsapp.com` |

---

## Related Documentation

- [Worky ↔ WhatsApp bridge](../worky/README-WHATSAPP.md) — stream-scoped group bridge, planning ingress/egress
- [Conversation Module](../conversation/README.md) — `StreamService.runSingleAgentStream()`, `RunSingleAgentRequest`, message pipeline
- [Agent Module](../agent/README.md) — agent ownership and configuration
- [Frontend WhatsApp UI](../../../front/src/modules/agent/whatsapp/README.md) — pairing UI, Socket.IO client
- [Crypto Service](../../common/services/crypto.service.ts) — credential encryption
