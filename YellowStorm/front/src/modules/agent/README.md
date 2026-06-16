# Agent Module (Frontend)

The agent module provides complete agent management for users, allowing them to view default agents, create personal agents, and configure tools, knowledge bases, and prompt settings.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [API Layer](#api-layer)
- [State Management](#state-management)
- [Selector Hooks](#selector-hooks)
- [Components](#components)
- [Channel Integrations](#channel-integrations)
- [Form Validation](#form-validation)
- [Data Flow](#data-flow)
- [Usage Examples](#usage-examples)
- [Testing](#testing)
- [Related Documentation](#related-documentation)

---

## Overview

The agent module provides:

- **Agent Management**: Create, edit, delete personal agents via modal dialog
- **Default Agents**: View system-wide default agents (read-only)
- **Agent Type Selection**: Pick from active agent types configured by admins
- **Tool Auto-Selection**: Automatically selects default tools based on agent type
- **Knowledge Base Assignment**: Attach workspaces for RAG context
- **Model Override**: Optionally override the model used by a specific agent
- **Zustand Store**: Centralized state with 5-minute caching and toast notifications
- **Channel Integrations**: Connect personal agents to **WhatsApp** (QR pairing) and **Telegram** (bot token) from the Connectors tab

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        AGENT MODULE (Frontend)                     │
├───────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                         UI LAYER                             │  │
│  │                                                              │  │
│  │  AgentButton ──► AgentHubPage / AgentList                   │  │
│  │       (sidebar)      └── CreateEditAgentDialog              │  │
│  │                            ├── Identity / Behaviour / …    │  │
│  │                            └── Connectors tab               │  │
│  │                                 ├── MCP MultiSelect         │  │
│  │                                 ├── AgentTelegramIntegration  │  │
│  │                                 └── AgentWhatsAppIntegration  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                      ZUSTAND STORE                           │  │
│  │  agents, agentTypes, caching, CRUD actions                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                        API LAYER                             │  │
│  │  Agents CRUD  │  Telegram integration  │  WhatsApp integration│  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│              ┌───────────────┴───────────────┐                     │
│              ▼                               ▼                     │
│  ┌──────────────────────┐    ┌──────────────────────────────┐   │
│  │ REST /api/v1/agents  │    │ Socket.IO /whatsapp (pairing)  │   │
│  └──────────────────────┘    └──────────────────────────────┘   │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
agent/
├── index.ts                          # Public exports (store hooks, hub components, types)
├── types.ts                          # Agent, integrations, evaluation types
├── api.ts                            # REST wrappers (agents + Telegram + WhatsApp)
├── api.test.ts
├── store.ts                          # Zustand store with caching
├── evaluation-api.ts
├── components/
│   ├── CreateEditAgentDialog.tsx     # Create/edit modal (Connectors tab)
│   ├── AgentWhatsAppIntegrationSection.tsx
│   ├── AgentTelegramIntegrationSection.tsx
│   ├── whatsapp-integration-utils.ts
│   ├── AgentHubPage.tsx              # Agent hub grid
│   ├── AgentList.tsx / AgentCard.tsx / AgentButton.tsx
│   ├── EvaluationTab.tsx
│   └── hub/                          # Hub filters, cards, bulk actions
├── hooks/
│   ├── useWhatsAppPairingSocket.ts   # Socket.IO client for QR pairing
│   ├── useAgentOperations.ts
│   ├── useAgentBulkDelete.ts
│   └── useAgentHubFilters.ts
├── locales/
│   ├── en.json                       # createEdit.fields.whatsapp* keys
│   └── fr.json
└── README.md                         # This file
```

WhatsApp UI lives inside the agent module (not a separate route). Backend logic is in [`YellowStorm/back/src/modules/whatsapp/README.md`](../../../../back/src/modules/whatsapp/README.md).

---

## Types

### Agent

```typescript
interface Agent {
  id: string;
  name: string;
  agentType: { id: string; name: string };
  role: string;
  description: string;
  temperature: number;           // 0–1
  model?: string;                // Optional model override
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];      // Workspace IDs
  tools: string[];               // Tool IDs
  isDefault: boolean;            // true = system default (read-only)
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

### AgentType

```typescript
interface AgentType {
  id: string;
  name: string;
  slug: string;                  // Machine-friendly identifier
  prePrompt: string;
  isActive: boolean;
}
```

### CreateAgentData / UpdateAgentData

```typescript
interface CreateAgentData {
  name: string;                  // Required
  agentType: string;             // Required (agent type ID)
  role: string;                  // Required
  description?: string;
  temperature?: number;          // Default: 0
  model?: string;
  instruction?: string;
  ignorePrePrompt?: boolean;     // Default: false
  knowledgeBases?: string[];
  tools?: string[];
  isActive?: boolean;            // Default: true
}

// UpdateAgentData: same fields, all optional
```

### AgentWhatsAppIntegration

Returned by `getAgentWhatsAppIntegration()` and reconnect endpoints:

```typescript
type AgentWhatsAppIntegrationStatus =
  | 'PAIRING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'FAILED';

interface AgentWhatsAppIntegration {
  status: AgentWhatsAppIntegrationStatus;
  sessionId?: string;
  phoneNumber?: string;       // E.164 after successful pairing
  displayName?: string;       // WhatsApp profile name
  lastActivityAt?: string;
  errorMessage?: string;
  updatedAt?: string;
}

interface AgentWhatsAppConnectResponse {
  sessionId: string;
  status: 'PAIRING';
  qrCode?: string;            // data URL or base64 PNG
  pairingCode?: string;
}

interface AgentWhatsAppPairingResponse {
  qrCode?: string;
  pairingCode?: string;
}
```

### AgentTelegramIntegration

See `AgentTelegramIntegrationSection` — bot token is never returned; `hasToken` indicates stored credentials.

---

## API Layer

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getAllAgents()` | GET | `/agents/all` | Get all agents (personal + defaults) |
| `getAgentTypes()` | GET | `/admin/agent-types/active` | Get active agent types |
| `createAgent(data)` | POST | `/agents` | Create personal agent |
| `updateAgent(id, data)` | PATCH | `/agents/:id` | Update personal agent |
| `deleteAgent(id)` | DELETE | `/agents/:id` | Delete personal agent |
| `getActiveTools()` | GET | `/tools/active` | Get available tools for assignment |

### WhatsApp integration API

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getAgentWhatsAppIntegration(agentId)` | GET | `/agents/:id/whatsapp-integration` | Current status |
| `connectAgentWhatsApp(agentId)` | POST | `/agents/:id/whatsapp-integration/connect` | Start QR pairing |
| `getAgentWhatsAppPairing(agentId, sessionId)` | GET | `/agents/:id/whatsapp-integration/:sessionId/pairing` | Poll QR / pairing code |
| `reconnectAgentWhatsApp(agentId, sessionId)` | POST | `/agents/:id/whatsapp-integration/:sessionId/reconnect` | Reconnect session |
| `disconnectAgentWhatsAppSession(agentId, sessionId)` | DELETE | `/agents/:id/whatsapp-integration/:sessionId` | Disconnect session |
| `deleteAgentWhatsAppIntegration(agentId)` | DELETE | `/agents/:id/whatsapp-integration` | Remove integration |

Endpoint builders live in `@/lib/api/config.ts` under `API_ENDPOINTS.agents.whatsapp*`.

### Telegram integration API

| Function | Method | Endpoint |
|----------|--------|----------|
| `getAgentTelegramIntegration(agentId)` | GET | `/agents/:id/telegram-integration` |
| `upsertAgentTelegramIntegration(agentId, payload)` | PUT | `/agents/:id/telegram-integration` |
| `deleteAgentTelegramIntegration(agentId)` | DELETE | `/agents/:id/telegram-integration` |

### ToolOption (from API)

```typescript
interface ToolOption {
  id: string;
  name: string;
  description: string;
  defaultAgentTypes: string[];   // Agent type names that use this tool by default
}
```

---

## State Management

### Store Structure

```typescript
interface AgentState {
  agents: Agent[];
  agentTypes: AgentType[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
  lastFetchedAt: Date | null;    // For 5-minute cache TTL
}
```

### Caching Strategy

- `fetchAgents()` skips the API call if data was fetched within the last 5 minutes
- `refreshAgents()` clears the cache and forces a fresh fetch
- Cache is cleared on create, update, or delete (via state mutation)

### Actions

| Action | Description |
|--------|-------------|
| `fetchAgents()` | Fetch all agents (with 5-min cache) |
| `fetchAgentTypes()` | Fetch active agent types |
| `createAgent(data)` | Create agent, append to state, show toast |
| `updateAgent(id, data)` | Update agent, replace in state, show toast |
| `deleteAgent(id)` | Delete agent, remove from state, show toast |
| `getPersonalAgents()` | Sync selector: filter `isDefault === false` |
| `getDefaultAgents()` | Sync selector: filter `isDefault === true` |
| `getAgentById(id)` | Sync selector: find by ID |
| `refreshAgents()` | Clear cache, re-fetch |
| `reset()` | Reset to initial state |

---

## Selector Hooks

Optimized hooks for accessing store state:

| Hook | Returns | Description |
|------|---------|-------------|
| `useAgents()` | `Agent[]` | All agents |
| `usePersonalAgents()` | `Agent[]` | Non-default agents (shallow compare) |
| `useDefaultAgents()` | `Agent[]` | Default agents only (shallow compare) |
| `useAgentsLoading()` | `boolean` | Loading state |
| `useAgentsInitialized()` | `boolean` | Initialization state |
| `useAgentsError()` | `string \| null` | Error message |
| `useAgentById(id)` | `Agent \| undefined` | Single agent by ID |
| `useAgentTypes()` | `AgentType[]` | Available agent types |
| `useAgentStore` | Full store | Direct store access |

---

## Components

### AgentButton

Sidebar entry point. Shows "Agents" button with a "Manage Agents" dropdown action. Opens AgentDialog on click.

### AgentDialog

Modal container wrapping AgentList. Header: "Agents" with description. Max width 2xl, max height 85vh.

### AgentList

Main management interface. Fetches agents and types on mount.

```
┌─────────────────────────────────────────────────────────┐
│  🤖 Agents                              [+ New Agent]   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  MY AGENTS                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Code Reviewer          [manager]    [✏️] [🗑️]       │  │
│  │ Summarizer             [simple]     [✏️] [🗑️]       │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  DEFAULT AGENTS                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ General Assistant       [manager]   🔒              │  │
│  │ Data Analyzer           [visualizer] 🔒             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

- Personal agents show edit/delete buttons
- Default agents show lock icon (read-only)
- Delete shows an AlertDialog confirmation

### AgentCard

Displays a single agent with name, type badge, description (2-line truncated), temperature, and model. Edit/delete buttons hidden for default agents.

### CreateEditAgentDialog

Full form dialog for creating/editing agents:

| Field | Input Type | Notes |
|-------|-----------|-------|
| Name | Text input | Alphanumeric + spaces only |
| Agent Type | Select dropdown | From `useAgentTypes()` |
| Role | Textarea (6 rows) | Main agent prompt |
| Description | Textarea (2 rows) | Optional |
| Temperature | Slider (0–1, step 0.1) | Shows value in label |
| Model | Select dropdown | "Default (inherit)" option |
| Tools | Checkbox group (ScrollArea) | Auto-selects defaults on type change |
| Knowledge Bases | Checkbox group (ScrollArea) | From user workspaces |
| Instruction | Textarea (4 rows) | Additional instructions |
| Ignore Pre-prompt | Checkbox | Skip agent type prompt |
| Active | Switch | Toggle active status |

**Connectors tab** (edit mode only for channel sections — agent must be saved first):

| Section | Component | Description |
|---------|-----------|-------------|
| MCP Connectors | `MultiSelect` | Assign connector IDs from `/connectors/active` |
| Telegram | `AgentTelegramIntegrationSection` | Bot token + webhook status |
| WhatsApp | `AgentWhatsAppIntegrationSection` | QR / pairing-code flow via REST + Socket.IO |

Tab label: `createEdit.tabs.connectors`. WhatsApp and Telegram render below the connectors multi-select inside `TabsContent value="connectors"`.

**Tool Auto-Selection**: When creating a new agent and changing the agent type, tools whose `defaultAgentTypes` include the selected type name are automatically checked. This does not happen when editing (preserves existing selections).

### AgentWhatsAppIntegrationSection

Connectors-tab UI for linking a personal agent to WhatsApp. Props: `{ agentId: string | null }`.

**UI states**

| Status | Banner | Actions |
|--------|--------|---------|
| Not connected / disconnected | Neutral | Connect WhatsApp |
| `PAIRING` | Neutral | QR image, optional 8-digit pairing code, Refresh Code, Cancel |
| `CONNECTED` | Green | Phone number, display name, Disconnect, Reconnect |
| `FAILED` | Amber | Error message (network errors mapped to friendly copy), Disconnect, Reconnect |

**Behaviour**

1. On mount (when `agentId` is set): `GET /agents/:id/whatsapp-integration`.
2. **Connect**: `POST …/connect` → stores `sessionId`, shows QR/code, enables socket + HTTP poll.
3. **Realtime**: `useWhatsAppPairingSocket` joins room `{ agentId, sessionId }` on namespace `/whatsapp`.
4. **Fallback poll**: every 2.5s `GET …/:sessionId/pairing` while status is `PAIRING`.
5. **Connected**: socket `whatsapp.connected` or refreshed integration → toast, clear QR.
6. **Cancel pairing**: `DELETE …/:sessionId` (disconnect session).
7. **Disconnect**: session DELETE or full integration DELETE if no session id.
8. **Reconnect**: `POST …/:sessionId/reconnect` or new connect if disconnected.

**Test IDs**: `whatsapp-integration-section`, `whatsapp-connect`, `whatsapp-qr`, `whatsapp-pairing-code`, `whatsapp-refresh`, `whatsapp-cancel`, `whatsapp-disconnect`, `whatsapp-reconnect`.

### useWhatsAppPairingSocket

Hook in `hooks/useWhatsAppPairingSocket.ts`. Connects with JWT from `localStorage` (`AUTH_STORAGE_KEYS.accessToken`) to `${getSocketBaseUrl()}/whatsapp`.

| Socket event | Handler |
|--------------|---------|
| `connect` | Emits `join` with `{ agentId, sessionId }` |
| `whatsapp.qr.generated` | Updates QR / pairing code |
| `whatsapp.connected` | Refreshes integration, success toast |
| `whatsapp.disconnected` | Clears session, sets `DISCONNECTED` |
| `whatsapp.session.failed` | Sets `FAILED`, shows mapped error |

Enabled only when `agentId`, `sessionId`, and integration status is `PAIRING`.

### whatsapp-integration-utils

Pure helpers in `components/whatsapp-integration-utils.ts`:

| Function | Purpose |
|----------|---------|
| `normalizeQrDataUrl` | Ensures QR string is a valid `data:image/png;base64,…` URL |
| `formatPairingCodeDisplay` | Formats 8-digit code as `XXXX-XXXX` |
| `isWhatsAppConnected` / `isWhatsAppPairing` / `isWhatsAppFailed` / `isWhatsAppNotConnected` | Status guards |
| `isWhatsAppNetworkError` | Detects `ERR_3219` or connectivity strings |
| `resolveWhatsAppErrorMessage` | Maps network errors to `whatsappNetworkUnreachable` i18n label |

### AgentTelegramIntegrationSection

Same Connectors tab pattern: save agent first, then configure bot token via REST (`get` / `upsert` / `delete` on `/telegram-integration`). See component and `api.ts` for details.

---

## Channel Integrations

External messaging channels are configured per **personal agent** from the **Connectors** tab in `CreateEditAgentDialog`. The frontend does not run Baileys or Telegram bots — it calls NestJS REST APIs and, for WhatsApp pairing, a Socket.IO gateway.

### WhatsApp (front ↔ back)

```
CreateEditAgentDialog (Connectors tab)
        │
        ▼
AgentWhatsAppIntegrationSection
        │
        ├── REST  /api/v1/agents/:agentId/whatsapp-integration/*
        │         (api.ts + API_ENDPOINTS.agents.whatsapp*)
        │
        └── Socket.IO  /whatsapp  (useWhatsAppPairingSocket)
                  join { agentId, sessionId }
                  ← whatsapp.qr.generated | connected | disconnected | session.failed
```

Backend module: [`YellowStorm/back/src/modules/whatsapp/README.md`](../../../../back/src/modules/whatsapp/README.md). Agent ownership and stream payloads: [`YellowStorm/back/src/modules/agent/README.md`](../../../../back/src/modules/agent/README.md) (Channel Integrations).

**Dependencies**: `socket.io-client` (pairing events). QR rendering uses a plain `<img src={dataUrl}>` — no extra QR library on the front.

**i18n** (`locales/en.json`, `locales/fr.json`): all user-visible strings under `createEdit.fields.whatsapp*`. Use `useModuleTranslation('agent')` and literal keys such as `t('createEdit.fields.whatsappConnect')`.

**Prerequisites for end-to-end messaging** (not configured in this UI): backend must reach `web.whatsapp.com`, ADK/gRPC (`CONVERSATION_GRPC_URL`) must be up for inbound auto-replies. Network failures surface as `ERR_3219` or mapped copy via `resolveWhatsAppErrorMessage`.

### Telegram (summary)

`AgentTelegramIntegrationSection` on the same tab. Token is write-only from the UI; `hasToken` indicates stored credentials. No Socket.IO — status from REST only.

---

## Form Validation

Zod schema (`userAgentFormSchema`):

| Field | Rules |
|-------|-------|
| `name` | 2–50 chars, `/^[a-zA-Z0-9 ]+$/` |
| `agentType` | Required (min length 1) |
| `role` | Required, max 50000 chars |
| `description` | Optional, max 1000 chars |
| `temperature` | 0–1, default 0 |
| `model` | Optional, max 100 chars |
| `instruction` | Optional, max 50000 chars |
| `ignorePrePrompt` | Boolean, default false |
| `knowledgeBases` | String array, default [] |
| `tools` | String array, default [] |
| `isActive` | Boolean, default true |

---

## Data Flow

### Create Agent

```
1. User clicks "New Agent" → CreateEditAgentDialog opens
2. User fills form, agent type triggers tool auto-selection
3. Submit → AgentList.handleSave()
4. store.createAgent(data) → POST /agents
5. Agent appended to state, toast shown
6. Dialog closes
```

### Edit Agent

```
1. User clicks edit on AgentCard → CreateEditAgentDialog opens with data
2. Form pre-filled, tool auto-selection skipped (preserves existing)
3. Submit → AgentList.handleSave()
4. store.updateAgent(id, data) → PATCH /agents/:id
5. Agent updated in state, toast shown
6. Dialog closes
```

### Delete Agent

```
1. User clicks delete on AgentCard → AlertDialog confirmation
2. Confirm → AgentList.handleDelete()
3. store.deleteAgent(id) → DELETE /agents/:id
4. Agent removed from state, toast shown
```

### WhatsApp Connect & Pair

```
1. User opens agent → Connectors tab → AgentWhatsAppIntegrationSection
2. Connect → POST /agents/:id/whatsapp-integration/connect
3. Section stores sessionId, shows QR and/or pairing code
4. useWhatsAppPairingSocket joins /whatsapp; poll GET …/pairing every 2.5s as fallback
5. User scans QR in WhatsApp mobile app
6. Backend emits whatsapp.connected → section refreshes GET integration
7. UI shows phone (E.164), display name, Disconnect / Reconnect actions
```

Inbound messages after connect are handled entirely on the backend (Baileys → StreamService → reply). The front only manages pairing lifecycle.

---

## Usage Examples

### Opening the Agent Dialog

```tsx
import { AgentButton } from '@/modules/agent';

// In sidebar
<AgentButton />
```

### Accessing Agent Data

```tsx
import { useAgents, usePersonalAgents, useDefaultAgents, useAgentTypes } from '@/modules/agent';

function MyComponent() {
  const allAgents = useAgents();
  const myAgents = usePersonalAgents();
  const defaults = useDefaultAgents();
  const types = useAgentTypes();

  return <div>{myAgents.length} personal agents</div>;
}
```

### Programmatic Agent Creation

```tsx
import { useAgentStore } from '@/modules/agent';

const { createAgent } = useAgentStore.getState();

const agent = await createAgent({
  name: 'My Agent',
  agentType: 'type-id-here',
  role: 'You are a helpful assistant',
  temperature: 0.5,
  tools: ['tool-id-1', 'tool-id-2'],
});
```

---

## Testing

WhatsApp-related tests (Vitest + jsdom):

| File | Coverage |
|------|----------|
| `components/whatsapp-integration-utils.test.ts` | QR normalization, status helpers, network error mapping |
| `components/AgentWhatsAppIntegrationSection.test.tsx` | Connect / pairing / connected / disconnect UI flows (mocked API + socket) |
| `api.test.ts` | WhatsApp REST helpers and endpoint paths |

Run focused suite:

```bash
cd YellowStorm/front
npx vitest run src/modules/agent/components/whatsapp-integration-utils.test.ts \
  src/modules/agent/components/AgentWhatsAppIntegrationSection.test.ts \
  src/modules/agent/api.test.ts
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [`YellowStorm/back/src/modules/whatsapp/README.md`](../../../../back/src/modules/whatsapp/README.md) | Baileys, REST API, Socket.IO gateway, env vars, inbound routing |
| [`YellowStorm/back/src/modules/agent/README.md`](../../../../back/src/modules/agent/README.md) | Agent CRUD, stream payloads, channel integration boundaries |
| [`YellowStorm/WhatsApp-GIT-README.md`](../../../../WhatsApp-GIT-README.md) | GitLab issue ↔ commit plan for WhatsApp feature branches |

---

## Module Dependencies

| Package | Used for |
|---------|----------|
| `zustand` | Agent list store |
| `react-hook-form` + `zod` | Create/edit form |
| `socket.io-client` | WhatsApp pairing realtime events |
| `@radix-ui/*` + shadcn/ui | Dialog, tabs, buttons |
