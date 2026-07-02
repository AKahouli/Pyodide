# Worky ↔ WhatsApp Bridge (Backend)

This document describes the **Worky stream** WhatsApp integration: pairing a phone number to a Worky stream, bridging messages through a dedicated WhatsApp **group**, and mirroring the Manager (IA) replies back to that group.

For the **agent DM** integration (1:1 chats → conversation/gRPC), see [`../whatsapp/README.md`](../whatsapp/README.md).

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Module Boundaries](#module-boundaries)
- [Pairing & Group Setup](#pairing--group-setup)
- [Inbound Flow (WhatsApp → Worky chat)](#inbound-flow-whatsapp--worky-chat)
- [Outbound Flow (Worky IA → WhatsApp group)](#outbound-flow-worky-ia--whatsapp-group)
- [Planning Turn & Runtime](#planning-turn--runtime)
- [Loop Prevention & Deduplication](#loop-prevention--deduplication)
- [Database](#database)
- [REST API](#rest-api)
- [Socket.IO (pairing UI)](#socketio-pairing-ui)
- [Dependency Injection](#dependency-injection)
- [Baileys Auth Persistence](#baileys-auth-persistence)
- [Logging](#logging)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [Source File Map](#source-file-map)
- [Testing](#testing)
- [Known Limitations](#known-limitations)

---

## Overview

| Capability | Description |
|------------|-------------|
| **System bot (singleton)** | `worky_whatsapp_system_bot` — admin pairs `WHATSAPP_WORKY_GROUP_PHONE` once; session reused globally |
| **One user integration per stream** | `worky_whatsapp_integrations` — unique `streamId`; user pairs their WhatsApp per stream |
| **Bridge group** | System bot creates group with user as participant; `workyGroupJid` stored per stream |
| **Inbound** | User session: `fromMe` messages in bridge group → Worky planning turn |
| **Outbound** | System bot session: one Manager reply per turn via `sendToWorkyGroup` |
| **Admin UI** | `/admin/worky-whatsapp-system` — pair system bot before users can connect streams |

Worky WhatsApp does **not** use the conversation/gRPC `RunSingleAgent` path. It uses the **Worky planning runtime** (`worky-adk-runtime`) via HTTP SSE.

---

## Architecture

Two Baileys sessions run in `WhatsAppSessionManager`:

| Session kind | `integrationRef.kind` | Restored on boot | Responsibility |
|--------------|----------------------|------------------|----------------|
| System bot | `worky_system_bot` | First (singleton) | `groupCreate`, `sendToWorkyGroup` (IA egress) |
| Stream user | `worky_stream` | Per connected integration | Inbound `fromMe` in bridge group |

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         Frontend                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│  Admin: WorkyWhatsAppSystemBotPage · useWorkySystemBotPairingSocket          │
│  Stream: WorkyWhatsAppConnectModal · useWorkyWhatsAppPairingSocket           │
│  Chat: ChatMessageThread / PromptBar · SSE /worky/streams/:id/events         │
├──────────────────────────────────────────────────────────────────────────────┤
│  REST  /worky/streams/:id/whatsapp-integration/*                               │
│  REST  /admin/worky/whatsapp-system-bot/*                                    │
│  GET   /worky/whatsapp-system-bot/status                                     │
│  WS    /whatsapp  (rooms: system-bot + user:{userId}:worky:{streamId})       │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │
        ┌───────────────────────┴───────────────────────┐
        │              WorkyModule                       │
        │  WorkyWhatsAppIntegrationController          │
        │  WorkyWhatsAppIntegrationService             │
        │  WorkyWhatsAppSystemBotService                │
        │  WorkyWhatsAppIngressService (+ STT voice)  │
        │  WorkyPlanningService (+ ensureWhatsApp…)    │
        └───────────────────────┬───────────────────────┘
                                │ forwardRef
        ┌───────────────────────┴───────────────────────┐
        │              WhatsAppModule                    │
        │  WorkyWhatsAppSystemBotConnectionService       │
        │  WorkyWhatsAppConnectionService              │
        │  WorkyWhatsAppGroupService                   │
        │  WhatsAppSessionManager (Baileys ×2)         │
        │  MongoBaileysAuthStore · WhatsAppGateway     │
        └───────────────────────┬───────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
         ┌─────────────┐                 ┌─────────────┐
         │   MongoDB   │                 │ WhatsApp Web │
         └─────────────┘                 └─────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  worky-adk-runtime    │
                    │  POST …/planning-turn │
                    └───────────────────────┘
```

### Message directions

```
WhatsApp group                         Worky stream (web)
     │                                        │
     │  user text (fromMe, group JID)         │
     ├──────────────────────────────────────►│  appendOwnerMessage
     │                                        │  startTurn → runtime SSE
     │                                        │  SSE: assistant_token / message.appended
     │  Manager reply (one per turn)          │
     │◄──────────────────────────────────────┤  ensureWhatsAppDelivery
     │                                        │  → sendToWorkyGroup
```

---

## Module Boundaries

| Layer | Module | Responsibility |
|-------|--------|----------------|
| HTTP API (stream-scoped) | `worky` | CRUD integration status, connect/disconnect |
| Connection orchestration | `whatsapp` | `WorkyWhatsAppConnectionService` — pairing, auth purge, forward helper |
| Baileys lifecycle | `whatsapp` | `WhatsAppSessionManager` — sockets, group create, inbound/outbound |
| Ingress | `worky` | `WorkyWhatsAppIngressService` — validate stream, persist owner msg, start turn |
| IA + WhatsApp egress | `worky` | `WorkyPlanningService.ensureWhatsAppDelivery` — single send per turn |
| Integration ref | `whatsapp` | `agent` \| `worky_stream` \| `worky_system_bot` |

See also: [`README.md`](./README.md) (module overview).

Both modules import each other with `forwardRef(() => …)` because of the cycle:

```
WorkyPlanningService → WorkyWhatsAppConnectionService → WhatsAppSessionManager
      ↑                                                        │
      └──────── WorkyWhatsAppIngressService ──────────────────┘
```

---

## Pairing & Group Setup

### 0. System bot (admin, once)

```
POST /admin/worky/whatsapp-system-bot/connect
  → WorkyWhatsAppSystemBotConnectionService.connect()
  → upsert worky_whatsapp_system_bot (PAIRING)
  → WhatsAppSessionManager.startPairing(kind=worky_system_bot)
```

On `connection.open`, paired phone must match `WHATSAPP_WORKY_GROUP_PHONE` or integration → `FAILED`.

Admin UI: `/admin/worky-whatsapp-system`. Socket room: `user:{adminId}:worky:system-bot`.

### 1. Stream connect (user)

Requires system bot `CONNECTED` (`ERR_3220` otherwise).

```
POST /worky/streams/:id/whatsapp-integration/connect
  → WorkyWhatsAppConnectionService.connect()
  → assertSystemBotConnected()
  → upsert worky_whatsapp_integrations (PAIRING)
  → clear workyGroupJid (re-pair creates new group)
  → WhatsAppSessionManager.startPairing(kind=worky_stream)
```

### 2. QR scan

Baileys `connection.update` → QR cached → `WhatsAppGateway.emitToWorkyStream('whatsapp.qr.generated')`.

### 3. Connection open (stream user)

When `integrationRef.kind === 'worky_stream'`:

1. `WorkyWhatsAppGroupService.provisionBridgeGroup()` via **system bot socket**:
   - `groupCreate(streamTitle, [userJid])`
   - Persists `workyGroupJid` + `userWhatsappJid` on stream integration
2. Integration status → `CONNECTED`

The user must send messages **in this group** (not in a random group).

### Migration from legacy single-session model

Existing integrations used the user socket to create groups. To migrate:

1. Admin pairs system bot at `/admin/worky-whatsapp-system`
2. Per stream: disconnect + delete integration, then re-connect
3. New flow creates groups via system bot with both accounts

---

## Inbound Flow (WhatsApp → Worky chat)

**Handler:** `WhatsAppSessionManager` — `messages.upsert` when `kind === 'worky_stream'`.

| Filter | Reason |
|--------|--------|
| `type !== 'notify'` | Ignore history replay (`append`) — prevents duplicate planning turns |
| `!fromMe` | Only messages sent by the linked account |
| `remoteJid !== workyGroupJid` | Only the bridge group |
| `botSentMessageIds` | Skip echoes of outbound IA messages |
| `ingestedMessageIds` | Dedupe duplicate upserts for same WhatsApp message id |
| Empty / non-text | `extractMessageText` — conversation + extendedText only |
| Voice notes (`audioMessage`) | Baileys `downloadMediaMessage` → `WorkySttService.transcribe` → same ingress as text |

**Text path:**

```typescript
WorkyWhatsAppIngressService.ingestMessage({ streamId, userId, content })
  → planning.appendOwnerMessage()     // role=owner, SSE message.appended
  → planning.startTurn({ triggerKind: 'owner_message' })
```

**Voice path:**

```typescript
WhatsAppSessionManager.ingestWorkyStreamVoiceMessage()
  → downloadMediaMessage (user session socket)
  → WorkyWhatsAppIngressService.ingestAudioMessage({ audio, mimetype })
  → WorkySttService.transcribe()    // WORKY_STT_* env vars
  → ingestMessage({ content: transcript })   // same planning turn as text
```

---

## Outbound Flow (Worky IA → WhatsApp group)

Outbound is centralized in **`WorkyPlanningService.ensureWhatsAppDelivery`**, called **once** at the end of each planning turn (`planning.done` or implicit stream end).

### Priority (exactly one message sent)

1. **Manager message** persisted during this turn (`WorkyMessage`, `role: 'manager'`, `createdAt >= turnStartedAt`)
2. **Pending clarification** (`WorkyInteraction`, types `clarification` \| `assignment_disambiguation`)
3. **Streamed tokens** accumulated from `planning.token` frames (fallback when nothing was persisted)

### Call chain

```
ensureWhatsAppDelivery(streamId, delivery)
  → deliverManagerMessageToWhatsApp()
  → WorkyWhatsAppConnectionService.forwardManagerMessage()
  → WhatsAppSessionManager.sendToWorkyGroup()   // system bot socket
  → botSocket.sendMessage(workyGroupJid, { text })
  → botSentMessageIds.add(sentId)   // 60s TTL
```

**Important:** Do not add secondary forward paths (internal controller, per-frame hooks, ingress subscribe). Multiple paths caused duplicate WhatsApp messages in production.

---

## Planning Turn & Runtime

```
startTurn()
  → runTurn() POST {WORKY_RUNTIME_BASE_URL}/runtime/streams/{id}/planning-turn
  → parse SSE frames → emitRuntimeFrame()
```

| Runtime frame | Worky SSE / persistence |
|---------------|-------------------------|
| `planning.token` | `assistant_token` (streaming UI) |
| `assistant.message` | `message.appended` (manager) |
| `interaction.requested` | Clarification created via `POST /worky/internal/.../interaction` + UI card |
| `planning.delta.applied` | Plan/kanban updates |
| `planning.done` | `stream.terminal` + **ensureWhatsAppDelivery** |

Clarifications often have **no** `planning.token` / `assistant.message` — the UI shows `ChatClarificationCard` from `interaction.requested`. That is why outbound uses DB fallback for clarifications.

---

## Loop Prevention & Deduplication

| Mechanism | Location | Purpose |
|-----------|----------|---------|
| `botSentMessageIds` | `WhatsAppSessionManager` | Ignore `messages.upsert` for IA replies we just sent |
| `ingestedMessageIds` | `WhatsAppSessionManager` | Ignore duplicate upserts of same inbound id (5 min TTL) |
| `type === 'notify'` only | inbound handler | Skip Baileys history sync |
| `whatsappDelivered` flag | `TurnWhatsAppDelivery` | At most one WhatsApp send per planning turn |
| `turnStartedAt` | `TurnWhatsAppDelivery` | DB fallback only sees entities created this turn |

---

## Database

### `worky_whatsapp_integrations`

Collection: `worky_whatsapp_integrations`  
Unique index: `{ streamId: 1 }`

```typescript
{
  streamId: ObjectId;       // WorkyStream (unique)
  userId: ObjectId;        // Stream owner
  phoneNumber?: string;     // E.164 after pairing
  displayName?: string;
  status: 'PAIRING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
  sessionId?: string;       // UUID per pairing attempt
  workyGroupJid?: string;   // e.g. 120363xxx@g.us — bridge group
  userWhatsappJid?: string; // normalized @s.whatsapp.net (no device suffix)
  lastActivityAt?: Date;
  errorMessage?: string;
  enabled: boolean;
  createdAt / updatedAt;
}
```

### `worky_whatsapp_system_bot`

Singleton document for the shared system bot session.

```typescript
{
  status: 'PAIRING' | 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
  sessionId?: string;
  phoneNumber?: string;
  displayName?: string;
  pairedByUserId?: ObjectId;
  errorMessage?: string;
  lastActivityAt?: Date;
  createdAt / updatedAt;
}
```

### `whatsapp_auth_sessions`

Shared with agent integration. Keyed by `integrationId` (= `WorkyWhatsAppIntegration._id`).

Encrypted Baileys credentials + Signal keys. See [Baileys Auth Persistence](#baileys-auth-persistence).

### Related Worky collections (message path)

| Collection | Role in bridge |
|------------|----------------|
| `worky_messages` | Owner + manager chat history |
| `worky_interactions` | Clarification questions for outbound fallback |
| `worky_streams` | Ownership, status, model ids |

---

## REST API

Base: `/api/v1/worky/streams/:id/whatsapp-integration`  
Guards: JWT + `WorkyStreamAccessGuard` + permissions.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Integration status (or `null`) |
| `POST` | `/connect` | Start pairing; returns `sessionId`, `qrCode` |
| `GET` | `/:sessionId/pairing` | Poll QR / pairing code |
| `POST` | `/:sessionId/reconnect` | Reconnect with stored auth |
| `DELETE` | `/:sessionId` | Logout session, keep shell |
| `DELETE` | `/` | Full teardown (session + auth + bindings) |

DTOs are shared with the agent integration:

- `WhatsAppConnectResponseDto`
- `WhatsAppIntegrationResponseDto`
- `WhatsAppPairingResponseDto`

### Admin — system bot

Base: `/api/v1/admin/worky/whatsapp-system-bot`  
Guards: JWT + `WORKY_ADMIN_GOVERNANCE`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | System bot status |
| `POST` | `/connect` | Start admin pairing |
| `GET` | `/:sessionId/pairing` | Poll QR / pairing code |
| `POST` | `/:sessionId/reconnect` | Reconnect bot session |
| `DELETE` | `/:sessionId` | Logout bot session |

### Public status (stream UI gate)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/worky/whatsapp-system-bot/status` | `{ connected: boolean }` — no admin permission |

---

## Socket.IO (pairing UI)

Namespace: `/whatsapp` (same gateway as agent).

| Room | Join payload | Used by |
|------|--------------|---------|
| `user:{userId}:worky:{streamId}` | `{ streamId, sessionId? }` | Stream pairing modal |
| `user:{userId}:worky:system-bot` | `{ systemBot: true, sessionId }` | Admin system bot page |

**Stream room events:**
| Event | Direction | Payload highlights |
|-------|-----------|-------------------|
| `join` | Client → Server | `{ streamId, sessionId? }` or `{ systemBot: true, sessionId }` |
| `whatsapp.qr.generated` | Server → Client | `{ streamId?, sessionId, qrCode, systemBot? }` |
| `whatsapp.connected` | Server → Client | `{ streamId?, phoneNumber, displayName, systemBot? }` |
| `whatsapp.disconnected` | Server → Client | `{ streamId?, sessionId, systemBot? }` |
| `whatsapp.session.failed` | Server → Client | `{ streamId?, errorMessage, systemBot? }` |

Chat content uses **SSE**, not Socket.IO: `GET /worky/streams/:id/events`.

---

## Dependency Injection

| Service | Injects (forwardRef where noted) |
|---------|--------------------------------|
| `WorkyWhatsAppIngressService` | `WorkyPlanningService` † |
| `WorkyPlanningService` | `WorkyWhatsAppConnectionService` † (optional) |
| `WhatsAppSessionManager` | `WorkyWhatsAppIngressService` †, `WorkyWhatsAppIntegrationService` |
| `WorkyWhatsAppConnectionService` | `WhatsAppSessionManager`, `WorkyWhatsAppIntegrationService` |

† Required to break the circular module graph.

`WhatsAppModule` exports `WorkyWhatsAppConnectionService`.  
`WorkyModule` exports `WorkyWhatsAppIngressService`, `WorkyWhatsAppIntegrationService`.

---

## Baileys Auth Persistence

File: `whatsapp/baileys/mongo-auth-state.ts`

Signal session keys contain Node `Buffer` values. They **must** be serialized with Baileys `BufferJSON.replacer` / `reviver` when writing to / reading from MongoDB. Without this, after a backend restart you may see:

- `Bad MAC`
- `No matching sessions found for message`
- `serialized is not iterable`

**Recovery:** delete the integration from the UI and re-pair (clears corrupted auth).

---

## Logging

Structured logs via `LoggerService` (`context` field).

| Message | When |
|---------|------|
| `Worky WhatsApp message ingested` | Inbound text accepted |
| `Worky WhatsApp voice transcribed` | Voice note STT succeeded |
| `Worky WhatsApp voice drop: …` / `voice STT failed` | Voice rejected or STT error (WARN) |
| `Worky planning turn started` | Runtime POST begins |
| `Worky IA response received from runtime` | `assistant.message` frame |
| `Worky IA clarification received from runtime` | `interaction.requested` frame |
| `Worky IA WhatsApp delivery from …` | `ensureWhatsAppDelivery` picked a source |
| `Forwarding manager message to WhatsApp` | Before Baileys send |
| `sendToWorkyGroup invoked` / `delivered` | Session manager transport |
| `sendToWorkyGroup: no matching connected session` | Stream id mismatch or group missing |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WHATSAPP_ENABLED` | `true` | Master switch |
| `WHATSAPP_WORKY_GROUP_PHONE` | `21651856582` | **System bot identity** — must match the phone paired in admin UI (digits, no `+`) |
| `WORKY_RUNTIME_BASE_URL` | `http://worky-adk-runtime:8011` | Planning runtime SSE endpoint |
| `WORKY_RUNTIME_TIMEOUT_MS` | (see `worky.config`) | Planning turn HTTP timeout |
| `WORKY_STT_BASE_URL` | OpenRouter URL | Voice note transcription (WhatsApp ingress) |
| `WORKY_STT_MODEL` | `openai/whisper-large-v3-turbo` | STT model |
| `WORKY_STT_API_KEY` | — | Required for voice ingress |
| `WORKY_STT_MAX_BYTES` | `26214400` | Max voice note size (bytes) |

Plus shared WhatsApp vars: reconnect backoff, connectivity probe, etc. — see [`../whatsapp/README.md#environment-variables`](../whatsapp/README.md#environment-variables).

Server must reach `web.whatsapp.com` (Baileys). `Timed Out` / `init queries` errors are network-level.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Message in Worky chat, nothing on WhatsApp | Clarification-only turn; old code without `ensureWhatsAppDelivery` | Restart backend; check `Worky IA WhatsApp delivery` logs |
| Duplicate IA messages on WhatsApp | Multiple forward paths | Ensure only `ensureWhatsAppDelivery` sends (current design) |
| Duplicate owner messages / double IA in chat | Double `messages.upsert` ingestion | Check `ingestedMessageIds` logs; verify `type === 'notify'` |
| IA reply triggers new planning turn | Echo not filtered | Verify `botSentMessageIds` after `sendToWorkyGroup` |
| `no matching connected session` | Wrong `streamId` or session down | Reconnect integration for that stream |
| `ERR_3220` on stream connect | System bot not connected | Pair bot at `/admin/worky-whatsapp-system` |
| `ERR_3221` on bot pairing | Wrong phone scanned | Use device matching `WHATSAPP_WORKY_GROUP_PHONE` |
| Baileys decrypt / MAC errors | Corrupt auth or network | Re-pair; fix network; verify `BufferJSON` in auth store |
| Voice note ignored | STT misconfigured or empty transcript | Check `WORKY_STT_*`; logs `Worky WhatsApp voice …` |
| `bad-request` on group create | JID device suffix (`:21`) | `normalizeWhatsappUserJid()` strips device id |

---

## Source File Map

### Worky module

| File | Role |
|------|------|
| `controllers/worky-whatsapp-integration.controller.ts` | Stream REST API |
| `controllers/admin/worky-whatsapp-system-bot.controller.ts` | Admin system bot REST API |
| `controllers/worky-whatsapp-system-bot-status.controller.ts` | Public `{ connected }` status |
| `services/worky-whatsapp-integration.service.ts` | Integration persistence, ownership |
| `services/worky-whatsapp-system-bot.service.ts` | Singleton system bot document |
| `services/worky-whatsapp-ingress.service.ts` | WhatsApp → owner message + `startTurn` |
| `services/worky-planning.service.ts` | Runtime SSE, chat SSE, `ensureWhatsAppDelivery` |
| `schemas/worky-whatsapp-integration.schema.ts` | Per-stream integration |
| `schemas/worky-whatsapp-system-bot.schema.ts` | Singleton system bot |

### WhatsApp module (Worky-specific)

| File | Role |
|------|------|
| `services/worky-whatsapp-connection.service.ts` | Stream connect / disconnect / `forwardManagerMessage` |
| `services/worky-whatsapp-system-bot-connection.service.ts` | Admin bot connect / status |
| `services/worky-whatsapp-group.service.ts` | Bridge group provision + JID resolve |
| `services/whatsapp-session.manager.ts` | Dual Baileys sockets, inbound/outbound |
| `utils/whatsapp-user-jid.util.ts` | JID normalization for `groupCreate` |
| `utils/whatsapp-audio-message.util.ts` | Detect `audioMessage` payloads |
| `interfaces/whatsapp-integration-ref.interface.ts` | `toWorkyIntegrationRef`, `toSystemBotIntegrationRef` |
| `gateways/whatsapp.gateway.ts` | `emitToWorkyStream`, `emitToSystemBot` |
| `baileys/mongo-auth-state.ts` | Encrypted session store |

### Frontend (reference)

| File | Role |
|------|------|
| `front/src/modules/worky/README.md` | Worky UI module overview |
| `front/src/modules/worky/components/WorkyWhatsAppConnectModal.tsx` | Stream pairing UI |
| `front/src/modules/worky/hooks/useWorkyWhatsAppPairingSocket.ts` | Stream Socket.IO client |
| `front/src/modules/admin/pages/WorkyWhatsAppSystemBotPage.tsx` | Admin system bot pairing |
| `front/src/modules/admin/hooks/useWorkySystemBotPairingSocket.ts` | Admin Socket.IO client |
| `front/src/lib/whatsapp-integration-utils.ts` | Shared status/QR/error helpers |

---

## Testing

```bash
cd YellowStorm/back

# Planning + ingress unit tests
npx jest --testPathPattern="worky-planning.service" --no-coverage
npx jest --testPathPattern="worky-whatsapp-ingress" --no-coverage
npx jest --testPathPattern="worky-whatsapp-group" --no-coverage
npx jest --testPathPattern="worky-whatsapp-system-bot-connection" --no-coverage

# WhatsApp module (shared infrastructure)
npx jest --testPathPattern="whatsapp" --no-coverage
```

### Manual checklist

1. Admin: pair system bot at `/admin/worky-whatsapp-system` → `CONNECTED`, phone matches env.
2. Connect WhatsApp on a Worky stream → QR → `CONNECTED`, bridge group created (`Worky stream group ready` log).
3. Send **text** in the bridge group from the phone → appears in Worky chat; one IA reply in chat **and** one in the group.
4. Send a **voice note** in the bridge group → transcribed text in Worky chat; IA reply as above.
5. Send from Worky web prompt bar → IA in chat; if stream is connected, same reply in group.
6. Disconnect / delete integration → session stopped, auth cleared.
7. Restart backend with `CONNECTED` integrations → bot + user sessions restored, `workyGroupJid` reused.

---

## Known Limitations

| Limitation | Detail |
|------------|--------|
| Single-node sockets | Baileys sessions are in-memory; multi-instance needs sticky sessions or redesign |
| Text only (outbound) | IA replies are text; inbound supports voice → STT → text |
| One bridge group per stream | Created at first connect; JID stored on integration |
| `fromMe` inbound only | Messages from other group members are ignored |
| Network dependency | Meta/WhatsApp Web must be reachable from the backend host |
| Runtime dependency | `worky-adk-runtime` must be up for IA replies |
| Clarification UX on WhatsApp | Questions are sent as plain text; option buttons are Worky-web only |

---

## Related Documentation

- [Worky module overview](./README.md)
- [Worky frontend module](../../../../front/src/modules/worky/README.md)
- [WhatsApp module (agent DMs)](../whatsapp/README.md)
- [Worky planning runtime](../../../../../worky-adk-runtime/app/routers/planning.py)
- [Backend guidelines](../../BACKEND_GUIDELINES.md)
