# Agent Type Module

The Agent Type module manages agent type definitions and their model-specific prompts. Agent types categorize agents (e.g. "manager", "visualizer") and provide configurable prompt templates that can be overridden per LLM model.

## Table of Contents

- [Overview](#overview)
- [Module Structure](#module-structure)
- [Schemas](#schemas)
- [API Endpoints](#api-endpoints)
- [Service Methods](#service-methods)
- [DTOs](#dtos)
- [Prompt Resolution](#prompt-resolution)
- [Error Codes](#error-codes)
- [Usage Examples](#usage-examples)

---

## Overview

### Key Features

- **Agent Type CRUD**: Create, update, delete agent types with unique name and auto-generated slug
- **Name Restriction**: Names must contain only letters, numbers, and spaces
- **Slug Generation**: Machine-friendly identifier auto-generated from name (lowercase, spaces replaced with `_`)
- **Two-Level Prompt System**: Default prompt per agent type + model-specific prompt overrides
- **Batch Prompt Resolution**: Efficiently resolve prompts for multiple agent/model pairs in 2 DB queries
- **Permission-Based Access**: All endpoints require admin permissions via `PermissionsGuard`
- **Audit Logging**: All write operations are logged with actor, action, target, and metadata

### Module Structure

```
agent-type/
├── agent-type.module.ts
├── agent-type.service.ts
├── agent-type.controller.ts
├── schemas/
│   ├── agent-type.schema.ts
│   └── agent-type-prompt.schema.ts
├── dto/
│   ├── create-agent-type.dto.ts
│   ├── update-agent-type.dto.ts
│   ├── query-agent-type.dto.ts
│   ├── upsert-agent-type-prompt.dto.ts
│   └── index.ts
└── interfaces/
    ├── agent-type.interface.ts
    └── agent-type-prompt.interface.ts
```

### Module Configuration

- **Imports**: `AuthorizationModule`, `SkillModule`, `forwardRef(() => AgentModule)` (no `MongooseModule`)
- **Controllers**: `AgentTypeController`
- **Providers**: `AgentTypeService`, `AGENT_TYPE_STORE` -> `PgAgentTypeStore`
- **Exports**: `AgentTypeService` (available for injection in other modules, used by `AgentModule`)

---

## Schemas

### AgentType

Postgres table `catalog.agent_types` (Drizzle: `postgres/schema/catalog.schema.ts`), accessed through `AGENT_TYPE_STORE` -> `PgAgentTypeStore`. Skill assignments are held in the junction table `catalog.agent_type_skills` (FKs to agent types and skills with `ON DELETE CASCADE`, `position` keeps order).

```typescript
{
  name: string;           // Required, unique, trim, max 100 chars
  slug: string;           // Required, unique, trim, max 100 chars, auto-generated
  defaultPrompt: string;  // Default '', max 50000 chars
  isActive: boolean;      // Default true
  createdAt: Date;        // Auto (timestamps)
  updatedAt: Date;        // Auto (timestamps)
}

// Indexes:
// uq_agent_types_name (name)   unique
// uq_agent_types_slug (slug)   unique
// idx_agent_types_active (is_active)
```

### AgentTypePrompt

Postgres table `catalog.agent_type_prompts`. `agent_type_id` is an FK to `catalog.agent_types` with `ON DELETE CASCADE`; `model_id` is a soft link to `catalog.ai_models.model_id` (no FK, models are deactivated rather than deleted).

```typescript
{
  agentType: ObjectId;    // Required, ref: AgentType (agent_type_id)
  modelId: string;        // Required (e.g. 'gpt-4o', 'claude-opus')
  prompt: string;         // Required, max 50000 chars
  createdAt: Date;        // Auto (timestamps)
  updatedAt: Date;        // Auto (timestamps)
}

// Indexes:
// uq_agent_type_prompts_type_model (agent_type_id, model_id) unique — one prompt per model per agent type
```

---

## API Endpoints

Base route: `/admin/agent-types`

All endpoints require Bearer token + `PermissionsGuard`.

### Agent Type CRUD

| Method | Route | Permission | Description |
|--------|-------|-----------|-------------|
| GET | `/` | `agent_types.read` | List agent types (paginated, searchable) |
| GET | `/active` | `agent_types.read` | List all active agent types (for dropdowns) |
| GET | `/:id` | `agent_types.read` | Get agent type by ID |
| POST | `/` | `agent_types.create` | Create agent type |
| PATCH | `/:id` | `agent_types.update` | Update agent type |
| DELETE | `/:id` | `agent_types.delete` | Delete agent type + all its prompts |

### Model-Specific Prompts

| Method | Route | Permission | Description |
|--------|-------|-----------|-------------|
| GET | `/:id/prompts` | `agent_types.read` | List all prompts for an agent type |
| PUT | `/:id/prompts/:modelId` | `agent_types.update` | Create or update a model-specific prompt |
| DELETE | `/:id/prompts/:modelId` | `agent_types.update` | Delete a model-specific prompt |

---

## Service Methods

### Agent Type CRUD

| Method | Description |
|--------|-------------|
| `create(dto)` | Create agent type. Auto-generates slug from name. Checks name + slug uniqueness |
| `findAll(query)` | Paginated list with search (case-insensitive regex on name) and isActive filter |
| `findById(id)` | Get single agent type with prompt count |
| `findAllActive()` | Get all active agent types sorted by name |
| `update(id, dto)` | Update agent type. Recomputes slug if name changes. Checks uniqueness |
| `delete(id)` | Delete agent type and all associated prompts |

### Prompt Management

| Method | Description |
|--------|-------------|
| `getPromptsForAgentType(agentTypeId)` | Get all model-specific prompts, sorted by modelId |
| `upsertPrompt(agentTypeId, modelId, prompt)` | Create or update prompt (`INSERT ... ON CONFLICT (agent_type_id, model_id) DO UPDATE`) |
| `deletePrompt(agentTypeId, modelId)` | Delete a model-specific prompt |
| `resolvePrompt(agentTypeId, modelId)` | Get prompt for a model, falling back to defaultPrompt |
| `resolvePromptsInBatch(pairs)` | Resolve prompts for multiple agent type + model pairs efficiently |

### Private Helpers

| Method | Description |
|--------|-------------|
| `generateSlug(name)` | Converts name to slug: lowercase, spaces → `_` |
| `getPromptCountsForIds(ids)` | Batch count prompts per agent type using aggregation |
| `toResponse(doc, promptCount)` | Map document to `IAgentTypeResponse` |
| `toPromptResponse(doc)` | Map document to `IAgentTypePromptResponse` |

---

## DTOs

### CreateAgentTypeDto

| Field | Type | Required | Validators |
|-------|------|----------|-----------|
| `name` | string | Yes | MinLength(2), MaxLength(100), Matches(`/^[a-zA-Z0-9 ]+$/`) |
| `defaultPrompt` | string | No | MaxLength(50000) |
| `isActive` | boolean | No | Default: true |

### UpdateAgentTypeDto

All fields optional, same validators as create.

### QueryAgentTypeDto (extends PaginationDto)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `search` | string | No | Search by name (case-insensitive) |
| `isActive` | boolean | No | Filter by active status |

### UpsertAgentTypePromptDto

| Field | Type | Required | Validators |
|-------|------|----------|-----------|
| `prompt` | string | Yes | MaxLength(50000) |

---

## Prompt Resolution

The module implements a two-level prompt system:

```
Request prompt for (agentTypeId, modelId)
    │
    ├── Model-specific prompt exists?
    │       │
    │   YES ▼
    │   Return model-specific prompt
    │
    └── NO
        │
        ▼
    Return agent type's defaultPrompt
```

### Batch Resolution

`resolvePromptsInBatch()` efficiently resolves prompts for multiple pairs using only 2 DB queries:

1. **Query 1**: Find all model-specific prompts matching any of the pairs
2. **Query 2**: For pairs without a model-specific prompt, fetch defaultPrompt from agent types

Returns a `Map<string, string>` keyed by `{agentTypeId}:{modelId}`.

---

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_2200 | `AGENT_TYPE_NOT_FOUND` | Agent type does not exist |
| ERR_2201 | `AGENT_TYPE_ALREADY_EXISTS` | Name or slug already taken |
| ERR_2210 | `AGENT_TYPE_PROMPT_NOT_FOUND` | Model-specific prompt not found |

---

## Usage Examples

### Creating an Agent Type

```bash
curl -X POST /admin/agent-types \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Manager", "defaultPrompt": "You are a manager agent..."}'

# Response:
{
  "id": "...",
  "name": "Manager",
  "slug": "manager",
  "defaultPrompt": "You are a manager agent...",
  "promptCount": 0,
  "isActive": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Setting a Model-Specific Prompt

```bash
curl -X PUT /admin/agent-types/{id}/prompts/gpt-4o \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "You are a manager agent optimized for GPT-4o..."}'
```

### Using in AgentService

```typescript
// Resolve a single prompt
const prompt = await this.agentTypeService.resolvePrompt(agentTypeId, modelId);

// Batch resolve for multiple agents
const pairs = agents.map(a => ({ agentTypeId: a.agentTypeId, modelId }));
const promptMap = await this.agentTypeService.resolvePromptsInBatch(pairs);
const prompt = promptMap.get(`${agentTypeId}:${modelId}`);
```
