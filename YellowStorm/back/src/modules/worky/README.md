# Worky Module (Backend)

The Worky module implements **Chief of Staff** streams: planning turns against `worky-adk-runtime`, kanban/tasks, clarifications, governance, memory, and optional **WhatsApp bridge** per stream.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Core Capabilities](#core-capabilities)
- [WhatsApp Integration](#whatsapp-integration)
- [Related Documentation](#related-documentation)

---

## Overview

| Area | Description |
|------|-------------|
| **Streams** | One Worky “mission” per `worky_streams` document (owner, models, status) |
| **Planning** | Owner messages → HTTP SSE to ADK runtime → manager reply + plan deltas |
| **Board & tasks** | Kanban, human assignments, execution lifecycle |
| **Realtime** | `WorkyEventService` → SSE `GET /worky/streams/:id/events` |
| **WhatsApp** | Optional bridge: user phone ↔ dedicated WhatsApp group ↔ Worky chat |

Worky does **not** route WhatsApp through the conversation/gRPC `RunSingleAgent` path.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     WorkyModule (NestJS)                         │
├─────────────────────────────────────────────────────────────────┤
│  Controllers: streams, messages, board, tasks, interactions,    │
│               events (SSE), internal (runtime callbacks),        │
│               whatsapp-integration, admin governance, STT/TTS    │
├─────────────────────────────────────────────────────────────────┤
│  Services: planning, ingress, stream, task, execution,           │
│            governance, memory, budget, whatsapp-integration,       │
│            whatsapp-system-bot, runtime client                   │
├─────────────────────────────────────────────────────────────────┤
│  MongoDB: worky_streams, worky_messages, worky_tasks, …         │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP SSE
                             ▼
                  ┌──────────────────────┐
                  │  worky-adk-runtime   │
                  └──────────────────────┘
                             │
              forwardRef (WhatsApp bridge only)
                             ▼
                  ┌──────────────────────┐
                  │   WhatsAppModule     │
                  │   (Baileys sessions) │
                  └──────────────────────┘
```

---

## Directory Structure

```
worky/
├── controllers/           # REST + SSE entry points
│   ├── admin/             # Governance + system bot admin API
│   └── worky-*.controller.ts
├── services/              # Domain logic
├── schemas/               # Mongoose models
├── guards/                # Stream access, service auth
├── dto/                   # Request/response shapes
├── README.md              # This file
└── README-WHATSAPP.md     # WhatsApp bridge (detailed)
```

---

## Core Capabilities

| Capability | Primary services | HTTP |
|------------|------------------|------|
| Stream CRUD | `WorkyStreamService` | `/worky/streams` |
| Chat & planning | `WorkyPlanningService` | `/worky/streams/:id/messages`, SSE events |
| Kanban | `WorkyTaskService`, `WorkyBoardController` | `/worky/streams/:id/board` |
| Clarifications | `WorkyInteractionService` | `/worky/streams/:id/interactions` |
| Runtime callbacks | `WorkyInternalController` | `/worky/internal/*` (service auth) |
| Voice composer (web) | `WorkySttService` | `POST /worky/stt/transcribe` |
| Governance | `WorkyGovernanceService` | `/admin/worky/governance` |

---

## WhatsApp Integration

Worky WhatsApp uses a **two-session** model:

| Session | Who pairs | Role |
|---------|-----------|------|
| **System bot** (singleton) | Admin once | Creates bridge groups; sends IA replies |
| **User stream** (per stream) | Stream owner | Receives inbound (`fromMe` in bridge group) |

### Setup order

1. Admin pairs system bot: `POST /admin/worky/whatsapp-system-bot/connect`  
   UI: `/admin/worky-whatsapp-system` — phone must match `WHATSAPP_WORKY_GROUP_PHONE`.
2. User connects stream: `POST /worky/streams/:id/whatsapp-integration/connect`  
   Fails with `ERR_3220` if system bot is offline.
3. On connect, system bot creates a **bridge group** (`workyGroupJid`) with the user as participant.
4. User sends text or **voice notes** in that group → Worky chat + planning turn; IA replies once per turn in the group (via bot).

### Message paths

```
Inbound (user session):  WhatsApp group → WorkyWhatsAppIngressService → planning turn
Voice inbound:           audioMessage → WorkySttService → ingest as text
Outbound (bot session):  ensureWhatsAppDelivery → sendToWorkyGroup
```

### Key files

| File | Role |
|------|------|
| `services/worky-whatsapp-ingress.service.ts` | Text + STT voice ingress |
| `services/worky-whatsapp-integration.service.ts` | Per-stream integration persistence |
| `services/worky-whatsapp-system-bot.service.ts` | Singleton bot document |
| `services/worky-planning.service.ts` | `ensureWhatsAppDelivery` (single outbound send) |
| `controllers/worky-whatsapp-integration.controller.ts` | Stream-scoped REST |
| `controllers/admin/worky-whatsapp-system-bot.controller.ts` | Admin pairing REST |
| `controllers/worky-whatsapp-system-bot-status.controller.ts` | Public `{ connected }` |

Baileys lifecycle, group provisioning, and session manager details live in the **WhatsApp module** — see [`../whatsapp/README.md`](../whatsapp/README.md).

**Full specification:** [`README-WHATSAPP.md`](./README-WHATSAPP.md)

### Error codes

| Code | Meaning |
|------|---------|
| `ERR_3220` | System bot not connected — stream connect blocked |
| `ERR_3221` | Paired phone ≠ `WHATSAPP_WORKY_GROUP_PHONE` |

---

## Related Documentation

- [WhatsApp bridge (detailed)](./README-WHATSAPP.md)
- [WhatsApp module (Baileys, agent DMs)](../whatsapp/README.md)
- [Backend guidelines](../../BACKEND_GUIDELINES.md)
