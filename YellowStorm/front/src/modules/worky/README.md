# Worky Module (Frontend)

The Worky module is the **Chief of Staff** UI: stream list, chat with the Manager, kanban board, clarifications, execution controls, and optional **WhatsApp** linking per stream.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Routing](#routing)
- [State & Data](#state--data)
- [WhatsApp Integration](#whatsapp-integration)
- [Related Documentation](#related-documentation)

---

## Overview

| Feature | Entry component | Transport |
|---------|-----------------|-----------|
| Stream list | `WorkyPage` | REST |
| Stream workspace | `WorkyStreamPage` | REST + SSE (`/worky/streams/:id/events`) |
| Chat & prompt | `ChatMessageThread`, `PromptBar` | SSE + REST messages |
| Kanban | `KanbanBoard`, `TaskDetailDrawer` | REST board/tasks |
| Clarifications | `ChatClarificationCard`, `InteractionPanel` | SSE `interaction.requested` |
| WhatsApp (per stream) | `WorkyWhatsAppConnectModal` | REST + Socket.IO pairing |
| Governance admin | `admin/WorkyGovernancePage` | REST (admin module) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      WORKY MODULE (React)                        │
├─────────────────────────────────────────────────────────────────┤
│  WorkyPage / WorkyStreamPage                                     │
│    ├── ChatMessageThread + PromptBar (owner input, STT mic)      │
│    ├── OrchestratorPanel / StreamSidebar                         │
│    └── WorkyWhatsAppConnectModal (optional)                      │
├─────────────────────────────────────────────────────────────────┤
│  api.ts · query/hooks.ts · store.ts · stream/sse.ts              │
├─────────────────────────────────────────────────────────────────┤
│  lib/whatsapp-integration-utils.ts (shared with agent module)    │
└────────────────────────────┬────────────────────────────────────┘
                             │
         REST /api/v1/worky/*  │  SSE events  │  WS /whatsapp
                             ▼
                    NestJS Worky + WhatsApp modules
```

---

## Directory Structure

```
worky/
├── components/
│   ├── WorkyPage.tsx              # Stream list
│   ├── WorkyStreamPage.tsx        # Main stream UI (+ WhatsApp modal trigger)
│   ├── WorkyWhatsAppConnectModal.tsx
│   ├── ChatMessageThread.tsx
│   ├── PromptBar.tsx
│   ├── OrchestratorPanel.tsx
│   └── admin/WorkyGovernancePage.tsx
├── hooks/
│   └── useWorkyWhatsAppPairingSocket.ts
├── query/
│   ├── hooks.ts                   # useWorkyWhatsAppIntegration, …
│   └── queryKeys.ts
├── api.ts                         # REST client (incl. WhatsApp endpoints)
├── types.ts                       # WorkyWhatsAppIntegration, …
├── stream/sse.ts                  # EventSource for stream events
├── locales/en.json · fr.json
└── README.md
```

---

## Routing

| Route | Component |
|-------|-----------|
| `#/worky` | `WorkyPage` |
| `#/worky/streams/:id` | `WorkyStreamPage` |
| `#/worky/streams/:id/report` | `StreamReportPage` |
| `#/admin/worky-governance` | `WorkyGovernancePage` (admin) |
| `#/admin/worky-whatsapp-system` | `WorkyWhatsAppSystemBotPage` (admin — **system bot prerequisite**) |

Lazy routes are wrapped in `<Suspense>` in `src/Router.tsx`.

---

## State & Data

| Concern | Mechanism |
|---------|-----------|
| Stream list / selection | Zustand `store.ts` + React Query |
| Live events | `stream/sse.ts` → updates store / query cache |
| WhatsApp status | `useWorkyWhatsAppIntegration(streamId)` + modal local state during pairing |
| i18n | Namespace `worky` — keys under `whatsapp.*` |

---

## WhatsApp Integration

### Two-level model (matches backend)

| Level | UI | Who |
|-------|-----|-----|
| **System bot** | Admin → `/admin/worky-whatsapp-system` | Instance admin pairs once (`WHATSAPP_WORKY_GROUP_PHONE`) |
| **Stream** | `WorkyWhatsAppConnectModal` on each stream | Owner pairs their personal WhatsApp |

Users **cannot** connect a stream until the system bot is online. The modal shows a banner with a link to admin settings when `GET /worky/whatsapp-system-bot/status` returns `{ connected: false }`.

### User flow (stream)

1. Open stream → WhatsApp button in `PromptBar` / `OrchestratorPanel`.
2. `WorkyWhatsAppConnectModal` loads integration via `getWorkyWhatsAppIntegration(streamId)`.
3. **Connect** → `connectWorkyWhatsApp` → QR / pairing code.
4. `useWorkyWhatsAppPairingSocket` joins Socket.IO room `user:{userId}:worky:{streamId}`; HTTP poll fallback every 2.5s.
5. On **CONNECTED**, user messages in the **bridge WhatsApp group** appear in Worky chat (text; voice notes transcribed server-side).
6. Manager replies appear in chat (SSE) and in the WhatsApp group (one message per planning turn).

### API (`api.ts` + `lib/api/config.ts`)

| Function | Endpoint |
|----------|----------|
| `getWorkyWhatsAppIntegration` | `GET /worky/streams/:id/whatsapp-integration` |
| `connectWorkyWhatsApp` | `POST …/connect` |
| `getWorkyWhatsAppPairing` | `GET …/:sessionId/pairing` |
| `reconnectWorkyWhatsApp` | `POST …/:sessionId/reconnect` |
| `disconnectWorkyWhatsAppSession` | `DELETE …/:sessionId` |
| `deleteWorkyWhatsAppIntegration` | `DELETE …/` |
| `getWorkyWhatsAppSystemBotStatus` | `GET /worky/whatsapp-system-bot/status` |

Admin system bot pairing uses `modules/admin/api.ts` and `useWorkySystemBotPairingSocket` (`join` with `{ systemBot: true }`).

### Shared utilities

`@/lib/whatsapp-integration-utils.ts` — status helpers, QR normalization, error mapping. Shared with `AgentWhatsAppIntegrationSection`.

### Key components

| File | Role |
|------|------|
| `components/WorkyWhatsAppConnectModal.tsx` | Stream pairing UI, system-bot gate, QR |
| `hooks/useWorkyWhatsAppPairingSocket.ts` | Socket.IO events for stream pairing |
| `components/PromptBar.tsx` | WhatsApp button + connected indicator |
| `components/WorkyStreamPage.tsx` | Wires modal open state + integration query |
| `query/hooks.ts` | `useWorkyWhatsAppIntegration` |
| `types.ts` | `WorkyWhatsAppIntegration`, status union |

### i18n

All user-visible strings use `useModuleTranslation('worky')` — keys prefixed `whatsapp.*` in `locales/en.json` and `locales/fr.json`.

Admin system bot copy lives in the `admin` namespace (`workyWhatsAppSystem.*`).

### Testing

```bash
cd YellowStorm/front
npx vitest run src/modules/worky/components/WorkyWhatsAppConnectModal.test.tsx
```

---

## Related Documentation

- [Backend Worky module](../../../back/src/modules/worky/README.md)
- [Backend WhatsApp bridge (detailed)](../../../back/src/modules/worky/README-WHATSAPP.md)
- [Admin module — system bot page](../admin/pages/WorkyWhatsAppSystemBotPage.tsx)
- [Frontend guidelines](../../FRONTEND_GUIDELINES.md)
