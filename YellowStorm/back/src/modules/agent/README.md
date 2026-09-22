# Agent Module

The Agent module manages AI agents — both user-created personal agents and system-wide default agents. It handles agent CRUD, tool/knowledge-base assignment, and builds the complete agent payloads used by the streaming AI service.

## Table of Contents

- [Overview](#overview)
- [Module Structure](#module-structure)
- [Schema](#schema)
- [API Endpoints](#api-endpoints)
- [Service Methods](#service-methods)
- [DTOs](#dtos)
- [Interfaces](#interfaces)
- [Stream Integration](#stream-integration)
- [Channel Integrations](#channel-integrations)
- [Error Codes](#error-codes)
- [Usage Examples](#usage-examples)
- [Related Documentation](#related-documentation)

---

## Overview

### Key Features

- **Dual Agent Model**: Personal agents (user-scoped) and default agents (system-wide)
- **Agent Type Binding**: Each agent references an agent type for prompt configuration
- **Tool Assignment**: Agents can be assigned tools from the Tool module
- **Knowledge Base Assignment**: Personal agents can reference workspaces for RAG context
- **Sharing**: A personal agent can be shared with other users by email, with `read` or `write` access (mirrors the Team module's sharing)
- **Agent Memory**: Agents holding the `smart-memory` connector expose `hasSmartMemory` in their response; their memory cards are read/deleted through the [Memory Cards module](../memory-cards/README.md) (delete gated by `canWriteAgent`)
- **Stream Integration**: Builds complete gRPC-ready agent payloads with resolved prompts, tools, and model info
- **Batch Processing**: Resolves prompts and tools in batch for efficiency (2–3 DB queries)
- **Name Uniqueness**: Per-user for personal agents, global for default agents
- **Admin Audit Logging**: All admin write operations are logged with full actor context
- **Channel Integrations**: External messaging connectors (WhatsApp, Telegram) are scoped per agent and depend on `AgentService` for ownership checks and stream payloads

### Module Structure

```
agent/
├── agent.module.ts
├── agent.service.ts
├── controllers/
│   ├── agent.controller.ts          # User (personal) agent endpoints
│   ├── admin-agent.controller.ts    # Admin (default) agent endpoints
│   └── agent-share.controller.ts    # Sharing endpoints (/agents/:id/shares...)
├── services/
│   └── agent-share.service.ts       # share / list / update / revoke / unshare
├── guards/
│   └── agent-permission.guard.ts    # owner | write | read access
├── decorators/
│   └── require-agent-permission.decorator.ts
├── persistence/
│   ├── agent-share.store.ts         # AGENT_SHARE_STORE port
│   └── pg-agent-share.store.ts      # PgAgentShareStore (public.shared_agents)
├── repositories/
│   └── agent.repository.ts          # AgentRepository (Drizzle, public.agents + link tables)
├── dto/
│   ├── create-agent.dto.ts
│   ├── update-agent.dto.ts
│   ├── query-agent.dto.ts
│   ├── share-agent.dto.ts
│   └── index.ts
└── interfaces/
    └── agent.interface.ts
```

### Module Configuration

- **Imports**: `AgentRepositoryModule` (Postgres-backed `AgentRepository`; no `MongooseModule`), `AgentTypeModule`, `AuthorizationModule`, `ToolModule`, `UserModule` (sharing resolves recipients by email)
- **Controllers**: `AgentController`, `AdminAgentController`, `AgentShareController`
- **Providers**: `AgentService`, `AgentShareService`, `AgentPermissionGuard`, `AGENT_SHARE_STORE` -> `PgAgentShareStore`, `CHANNEL_TEARDOWN` (Telegram + widget teardown adapters)
- **Exports**: `AgentService`, `AgentShareService` (consumed by `WhatsAppModule`, `TelegramModule`, `ConversationModule`, and others)

Channel integration modules live in separate NestJS modules but expose REST routes nested under `/agents/:agentId/…`. They import `AgentModule` and call `AgentService.findUserAgentById()` to enforce that only the agent owner can configure connectors.

---

## Schema

Postgres table `public.agents` (Drizzle: `postgres/schema/agents.schema.ts`), accessed through `AgentRepository`. Ids are 24-char hex strings (`char(24)`, Mongo ObjectId-compatible for the cross-service contract). Only `agent_id` columns on the child tables have real foreign keys; references to other domains (agent type, tools, skills, connectors, workspaces, creator) are plain `char(24)` columns without a cross-schema FK. Multi-valued references live in join tables, each with `agent_id` -> `agents(id)` `ON DELETE CASCADE`: `agent_tools`, `agent_skills`, `agent_disabled_skills`, `agent_connectors`, `agent_knowledge_bases`, `agent_connector_actions`. Guardrails and deployment settings are `jsonb` columns. The shape below is the logical (API-level) model:

```typescript
{
  name: string;              // Required, trim, min 2, max 50
  agentType: ObjectId;       // Required, ref: AgentType (agent_type_id)
  role: string;              // Required, max 50000
  description: string;       // Default '', max 1000
  temperature: number;       // Default 0, min 0, max 1
  llmModel?: string;         // Optional, max 100 (model ID override)
  instruction: string;       // Default '', max 50000
  ignorePrePrompt: boolean;  // Default false
  knowledgeBases: ObjectId[];// Default [], ref: Workspace
  tools: ObjectId[];         // Default [], ref: Tool
  isDefault: boolean;        // Default false (true = system-wide)
  isActive: boolean;         // Default true
  createdBy: ObjectId;       // Required, ref: User
  createdAt: Date;           // Auto (timestamps)
  updatedAt: Date;           // Auto (timestamps)
}

// Indexes (Postgres):
// idx_agents_created_by_is_active (created_by, is_active)
// idx_agents_is_default_is_active (is_default, is_active)
// idx_agents_agent_type_slug, idx_agents_is_active, plus agent-type/default-for-type composites
// uq_agents_name_created_by (name, created_by)   unique — name uniqueness per user
// uq_agents_created_by_slug_non_default          unique partial (created_by, slug) WHERE is_default = false AND slug <> ''
// uq_agents_slug_default                         unique partial (slug, is_default) WHERE is_default = true AND slug <> ''
```

Shares live in `public.shared_agents` (`shared_by`, `shared_with`, `permission` constrained to `read`/`write`) with a unique index `uq_shared_agents_agent_user (agent_id, shared_with)`.

---

## API Endpoints

### User (Personal) Agents

Base route: `/agents` — requires Bearer token.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/agents` | List personal agents (paginated, filterable) |
| GET | `/agents/all` | Get all agents for user (personal + defaults, no pagination) |
| GET | `/agents/:id` | Get personal agent by ID |
| POST | `/agents` | Create personal agent |
| PATCH | `/agents/:id` | Update personal agent (owner **or** `write`-shared user) |
| DELETE | `/agents/:id` | Delete personal agent (204) |

`GET /agents/all` returns owned + default agents **and** agents shared with the user; each shared agent carries a `shareInfo` object (`{ shareId, permission, sharedBy }`).

### Agent Sharing

Base route: `/agents` — requires Bearer token. Access is enforced by `AgentPermissionGuard` + `@RequireAgentPermission`.

| Method | Route | Access | Description |
|--------|-------|--------|-------------|
| POST | `/agents/:id/shares` | owner | Share with users by email (`read`/`write`) |
| GET | `/agents/:id/shares` | owner | List an agent's shares |
| PATCH | `/agents/:id/shares/:shareId` | owner | Change a share's permission |
| DELETE | `/agents/:id/shares/:shareId` | owner | Revoke a share |
| DELETE | `/agents/:id/unshare` | recipient | Remove a shared agent from your own list |

- Only **personal** agents are shareable (you must own them; default agents are already global).
- `read` recipients see the agent; `write` recipients can also edit it via `PATCH /agents/:id` (uniqueness checks are scoped to the **owner**, not the editor). Deletion stays owner-only.
- Deleting an agent removes all of its share records via the `ON DELETE CASCADE` foreign key `public.shared_agents.agent_id -> public.agents(id)`.

### Agent Channel Integrations (separate modules)

These routes are served by the WhatsApp and Telegram modules, not by `AgentController`. They are listed here because they are **agent-scoped** and require a saved personal agent.

| Module | Base route | Description |
|--------|------------|-------------|
| [WhatsApp](../whatsapp/README.md) | `/agents/:agentId/whatsapp-integration` | QR pairing, session status, disconnect/reconnect |
| [Telegram](../telegram/) | `/agents/:agentId/telegram-integration` | Bot token, webhook, link codes |

See each module's README for full endpoint and payload details.

### Admin (Default) Agents

Base route: `/admin/agents` — requires Bearer token + permissions.

| Method | Route | Permission | Description |
|--------|-------|-----------|-------------|
| GET | `/admin/agents` | `agents.read` | List default agents (paginated) |
| GET | `/admin/agents/:id` | `agents.read` | Get default agent by ID |
| POST | `/admin/agents` | `agents.create` | Create default agent |
| PATCH | `/admin/agents/:id` | `agents.update` | Update default agent |
| DELETE | `/admin/agents/:id` | `agents.delete` | Delete default agent (204) |

---

## Service Methods

### Personal Agent Methods

| Method | Description |
|--------|-------------|
| `createPersonal(userId, dto)` | Create personal agent. Validates agent type is active. Enforces per-user name uniqueness |
| `findUserAgents(userId, query)` | List personal agents with pagination, search, and filters |
| `findUserAgentById(userId, agentId)` | Get personal agent. Validates ownership |
| `updatePersonal(userId, agentId, dto)` | Update personal agent. Checks ownership, validates agent type if changed |
| `deletePersonal(userId, agentId)` | Delete personal agent. Validates ownership and not default |

### Default Agent Methods

| Method | Description |
|--------|-------------|
| `createDefault(adminUserId, dto)` | Create default agent. Forces `isDefault=true`, `knowledgeBases=[]` |
| `findDefaultAgents(query)` | List default agents with pagination |
| `findDefaultAgentById(agentId)` | Get default agent by ID |
| `updateDefault(agentId, dto)` | Update default agent. Strips knowledgeBases from update |
| `deleteDefault(agentId)` | Delete default agent |

### Sharing Methods (`AgentShareService`)

| Method | Description |
|--------|-------------|
| `shareAgent(ownerId, agentId, dto)` | Upsert share grants for the given emails at one permission level. Rejects self-share; resolves recipients via `UserService.findByEmail` |
| `getAgentShares(agentId)` | List everyone an agent is shared with (owner view) |
| `updateSharePermission(agentId, shareId, dto)` | Change a share's `read`/`write` level |
| `removeShare(agentId, shareId)` | Owner revokes a specific share |
| `unshareFromSelf(userId, agentId)` | Recipient removes a shared agent from their own list |
| `getShareInfoMapForUser(userId)` | `Map<agentId, shareInfo>` for the user — lets `getAllForUserResponse` tag shared agents |
| `getSharePermission(userId, agentId)` | The user's `read`/`write` level on an agent, or `null` |
| `getShareInfo(userId, agentId)` | Full `shareInfo` for a user on an agent, or `null` |

### Stream Integration Methods

| Method | Description |
|--------|-------------|
| `getAgentsForUser(userId)` | Get active personal + default agents (flat list) |
| `buildAgentsForStream(userId, fallbackModelId?)` | Build complete gRPC agent payloads with resolved prompts, tools, and model info |
| `getAllForUserResponse(userId)` | Get all active agents for API response (defaults first) |

### Utility Methods

| Method | Description |
|--------|-------------|
| `countByAgentType(agentTypeId)` | Count agents using a specific agent type (for deletion checks) |
| `canWriteAgent(userId, agentId)` | Whether the user may modify the agent (owner or `write`-share; default agents are read-only). Used by the Memory Cards module to gate memory deletion. |

> **Smart-memory flag:** `getAllForUserResponse()` sets `hasSmartMemory` on each returned agent by resolving its connectors in a single query and checking for the `smart-memory` slug (owned **and** shared agents). The frontend uses this flag to decide whether to show the agent-memories icon. See the [Memory Cards module](../memory-cards/README.md).

---

## DTOs

### CreateAgentDto

| Field | Type | Required | Validators |
|-------|------|----------|-----------|
| `name` | string | Yes | MinLength(2), MaxLength(50), Matches(`/^[a-zA-Z0-9 ]+$/`) |
| `agentType` | string | Yes | IsMongoId() |
| `role` | string | Yes | MaxLength(50000) |
| `description` | string | No | MaxLength(1000) |
| `temperature` | number | No | Min(0), Max(1), Default: 0 |
| `model` | string | No | MaxLength(100) |
| `instruction` | string | No | MaxLength(50000) |
| `ignorePrePrompt` | boolean | No | Default: false |
| `knowledgeBases` | string[] | No | IsMongoId({ each: true }) |
| `tools` | string[] | No | IsMongoId({ each: true }) |
| `isActive` | boolean | No | Default: true |

### UpdateAgentDto

All fields optional, same validators as create.

### QueryAgentDto (extends PaginationDto)

| Field | Type | Description |
|-------|------|-------------|
| `search` | string | Search by name (case-insensitive regex) |
| `agentType` | string | Filter by agent type ID |
| `isActive` | boolean | Filter by active status |
| `isDefault` | boolean | Filter by default status |

---

## Interfaces

### IAgentResponse

Returned by all CRUD endpoints:

```typescript
{
  id: string;
  name: string;
  agentType: { id: string; name: string };
  role: string;
  description: string;
  temperature: number;
  model?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  connectors?: string[];
  hasSmartMemory?: boolean;           // true when the agent has the "smart-memory" connector
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  shareInfo?: {                       // present only on agents shared *with* the caller
    shareId: string;
    permission: 'read' | 'write';
    sharedBy: { id: string; email: string; firstName?: string; lastName?: string };
  };
}
```

### IAgentForStream

Intermediate format used internally before building gRPC payloads:

```typescript
{
  id: string;
  name: string;
  agentTypeName: string;
  agentTypeId: string;
  role: string;
  description: string;
  temperature: number;
  model?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  toolIds: string[];       // Not yet populated — resolved later in batch
  isDefault: boolean;
}
```

### IGrpcAgent

Final format sent to the AI streaming service via gRPC:

```typescript
{
  id: string;
  name: string;
  description: string;
  prompt: string;          // Resolved from agent type + instruction
  agent_type: string;      // Agent type name
  save_memory: boolean;
  tools: Record<string, unknown>[];  // Full tool objects with attributes
  chatbot_name: {
    name: string;
    provider: string;      // Always 'anthropic'
    description: string;
  };
}
```

---

## Stream Integration

`buildAgentsForStream()` assembles the complete agent payload for the AI service:

```
1. Fetch active agents (personal + defaults)
2. Batch-resolve prompts via AgentTypeService.resolvePromptsInBatch()
   - Model-specific prompt if available, else defaultPrompt
3. Batch-fetch tools by ID via ToolService
4. For each agent:
   a. Compute prompt = agentTypePrompt + instruction (if not ignorePrePrompt)
   b. Map tools with their attributes
   c. Resolve model + provider
   d. Build IGrpcAgent object
5. Return IGrpcAgent[]
```

This approach uses at most 3 DB queries regardless of the number of agents (agents query, prompt batch query, tools batch query).

Channel integrations reuse the same agent identity when routing inbound messages:

```
WhatsApp DM  →  WhatsAppMessageService  →  agentIds: [agentId]
                                           →  StreamService.startStream()
                                           →  buildAgentsForStream() uses linked agent config
```

---

## Channel Integrations

Agents can be connected to external messaging channels. Each integration stores its own row keyed by `agent_id` (unique per channel; Telegram and widget data live in the Postgres `channels` schema, while the deprecated WhatsApp module stays on Mongo). The Agent module does **not** embed connector state in the `agents` table — integration modules own their stores and import `AgentModule` for validation.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Module                              │
│  AgentService.findUserAgentById(userId, agentId)  ◄─────────────┼── ownership gate
│  AgentService.buildAgentsForStream(userId)        ◄─────────────┼── gRPC payloads
└───────────────────────────────┬─────────────────────────────────┘
                                │ exports AgentService
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
┌───────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ WhatsAppModule│     │ TelegramModule  │     │ ConversationModule│
│ (Mongo, depr.)│     │ channels.telegr.│     │ (stream / chat)   │
│               │     │ _integrations   │     │                   │
└───────────────┘     └─────────────────┘     └──────────────────┘
```

### WhatsApp integration

| Aspect | Detail |
|--------|--------|
| **Module** | [`../whatsapp/`](../whatsapp/README.md) |
| **Collection** | `agent_whatsapp_integrations` — one row per agent |
| **Ownership** | `WhatsAppIntegrationService.assertAgentOwnership()` → `AgentService.findUserAgentById()` |
| **Inbound flow** | DM → `WhatsAppMessageService` creates conversation → `StreamService` with `agentIds: [agentId]` |
| **UI** | Frontend Connectors tab in agent edit modal |
| **Prerequisite** | Agent must exist and belong to the current user before pairing |

**Typical lifecycle:**

1. User creates/saves agent via `POST /agents` or `PATCH /agents/:id`
2. User opens Connectors tab → `POST /agents/:agentId/whatsapp-integration/connect`
3. After QR scan, status becomes `CONNECTED`; inbound WhatsApp messages route to the linked agent
4. On agent delete, disconnect WhatsApp first (integration is not cascade-deleted from agent CRUD)

### Telegram integration

| Aspect | Detail |
|--------|--------|
| **Module** | [`../telegram/`](../telegram/) |
| **Table** | `channels.telegram_integrations` (unique on `agent_id`) |
| **Pattern** | Same agent-scoped REST under `/agents/:agentId/telegram-integration` |
| **Transport** | Telegram Bot API webhooks (vs Baileys WebSocket for WhatsApp) |

### Agent deletion note

Deleting an agent via `DELETE /agents/:id` runs the `CHANNEL_TEARDOWN` adapters (Telegram and widget, provided in `AgentModule`), and the Postgres `ON DELETE CASCADE` foreign keys on `agent_id` (Telegram integrations, widget tokens, share rows, join tables) remove dependent rows. WhatsApp is not part of `CHANNEL_TEARDOWN`: clean up its connector explicitly through the WhatsApp module endpoints to avoid orphaned integration records.

### Accepted deviations (documented)

- worky-stream deletes its manager agent via the repository (`AgentRepository.deleteByIdAndOwner`), bypassing `CHANNEL_TEARDOWN` — accepted because manager agents have no Telegram/widget integrations and their rows are removed by FK cascades.
- The widget teardown adapter deactivates the agent's tokens (`revokeAllForAgent`) rather than deleting them — the `ON DELETE CASCADE` FK removes them when the agent row is deleted.
- WhatsApp is deprecated and intentionally not part of `CHANNEL_TEARDOWN` (the module stays on Mongo until it is cleaned up).

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_2400 | `CUSTOM_AGENT_NOT_FOUND` | Agent does not exist |
| ERR_2401 | `CUSTOM_AGENT_ALREADY_EXISTS` | Agent name already taken (per user or among defaults) |
| ERR_2402 | `CUSTOM_AGENT_FORBIDDEN` | User does not own / cannot access this agent |
| ERR_2405 | `CUSTOM_AGENT_DEFAULT_READONLY` | Default agents are not editable via the user endpoints |
| ERR_2408 | `CUSTOM_AGENT_SHARE_NOT_FOUND` | Share record does not exist |
| ERR_2409 | `CUSTOM_AGENT_SHARE_SELF` | Cannot share an agent with yourself |
| ERR_2410 | `CUSTOM_AGENT_SHARE_FORBIDDEN` | Not allowed to manage this share / insufficient share level |
| ERR_2411 | `CUSTOM_AGENT_SHARE_USER_NOT_FOUND` | No user found for the provided email |

---

## Usage Examples

### Creating a Personal Agent

```bash
curl -X POST /agents \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Code Reviewer",
    "agentType": "665a1b2c3d4e5f6a7b8c9d0e",
    "role": "You are a code review expert...",
    "temperature": 0.3,
    "tools": ["665a1b2c3d4e5f6a7b8c9d0f"]
  }'
```

### Creating a Default Agent (Admin)

```bash
curl -X POST /admin/agents \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "General Assistant",
    "agentType": "665a1b2c3d4e5f6a7b8c9d0e",
    "role": "You are a helpful assistant...",
    "tools": ["665a1b2c3d4e5f6a7b8c9d0f"]
  }'
```

### Building Agents for Stream (Internal)

```typescript
// Used by the stream/conversation service
const grpcAgents = await this.agentService.buildAgentsForStream(userId, requestModelId);
// grpcAgents is ready to send via gRPC to the AI service
```

### Key Differences: Personal vs Default

| Aspect | Personal | Default |
|--------|----------|---------|
| Created by | Any user | Admin only |
| `isDefault` | `false` | `true` |
| Knowledge bases | Allowed | Always `[]` |
| Name uniqueness | Per user | Global |
| Visibility | Owner + users it's shared with | All users |
| Edit/Delete | Owner (edit also: `write`-shared users) | Admin only |
| Shareable | Yes (`read`/`write` by email) | No (already global) |
| WhatsApp / Telegram | Personal agents only (owner configures connectors) | Not supported |

---

## Related Documentation

- [WhatsApp Module](../whatsapp/README.md) — Baileys QR pairing, inbound routing, Socket.IO
- [Telegram Module](../telegram/) — Bot token and webhook integration
- [Conversation Module](../conversation/README.md) — `StreamService`, gRPC agent payloads
- [Frontend Agent Module](../../../front/src/modules/agent/whatsapp/README.md) — WhatsApp connector UI
