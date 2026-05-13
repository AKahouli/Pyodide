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
- [Error Codes](#error-codes)
- [Usage Examples](#usage-examples)

---

## Overview

### Key Features

- **Dual Agent Model**: Personal agents (user-scoped) and default agents (system-wide)
- **Agent Type Binding**: Each agent references an agent type for prompt configuration
- **Tool Assignment**: Agents can be assigned tools from the Tool module
- **Knowledge Base Assignment**: Personal agents can reference workspaces for RAG context
- **Stream Integration**: Builds complete gRPC-ready agent payloads with resolved prompts, tools, and model info
- **Batch Processing**: Resolves prompts and tools in batch for efficiency (2–3 DB queries)
- **Name Uniqueness**: Per-user for personal agents, global for default agents
- **Admin Audit Logging**: All admin write operations are logged with full actor context

### Module Structure

```
agent/
├── agent.module.ts
├── agent.service.ts
├── controllers/
│   ├── agent.controller.ts          # User (personal) agent endpoints
│   └── admin-agent.controller.ts    # Admin (default) agent endpoints
├── schemas/
│   └── agent.schema.ts
├── dto/
│   ├── create-agent.dto.ts
│   ├── update-agent.dto.ts
│   ├── query-agent.dto.ts
│   └── index.ts
└── interfaces/
    └── agent.interface.ts
```

### Module Configuration

- **Imports**: `MongooseModule` (Agent schema), `AgentTypeModule`, `AuthorizationModule`, `ToolModule`
- **Controllers**: `AgentController`, `AdminAgentController`
- **Providers**: `AgentService`
- **Exports**: `AgentService`

---

## Schema

Collection: `agents`

```typescript
{
  name: string;              // Required, trim, min 2, max 50
  agentType: ObjectId;       // Required, ref: AgentType
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

// Indexes:
// { agentType: 1 }
// { isDefault: 1 }
// { isActive: 1 }
// { createdBy: 1, isActive: 1 }
// { isDefault: 1, isActive: 1 }
// { name: 1, createdBy: 1 }   unique — name uniqueness per user
```

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
| PATCH | `/agents/:id` | Update personal agent |
| DELETE | `/agents/:id` | Delete personal agent (204) |

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
  isDefault: boolean;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
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

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_2300 | `AGENT_NOT_FOUND` | Agent does not exist |
| ERR_2301 | `AGENT_ALREADY_EXISTS` | Agent name already taken (per user or among defaults) |
| ERR_2302 | `AGENT_FORBIDDEN` | User does not own this agent |

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
| Visibility | Owner only | All users |
| Edit/Delete | Owner only | Admin only |
