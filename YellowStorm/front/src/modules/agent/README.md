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
- [Form Validation](#form-validation)
- [Data Flow](#data-flow)
- [Usage Examples](#usage-examples)

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
│  │  AgentButton ──► AgentDialog ──► AgentList                  │  │
│  │       (sidebar)      (modal)       │                         │  │
│  │                                    ├── AgentCard (personal)  │  │
│  │                                    ├── AgentCard (default)   │  │
│  │                                    └── CreateEditAgentDialog │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                      ZUSTAND STORE                           │  │
│  │                                                              │  │
│  │  agents: Agent[]          agentTypes: AgentType[]            │  │
│  │  isLoading: boolean       isInitialized: boolean             │  │
│  │  lastFetchedAt: Date      error: string | null               │  │
│  │                                                              │  │
│  │  Actions: fetchAgents, fetchAgentTypes, createAgent,         │  │
│  │           updateAgent, deleteAgent, refreshAgents            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                        API LAYER                             │  │
│  │                                                              │  │
│  │  Agents: getAllAgents, createAgent, updateAgent, deleteAgent │  │
│  │  Types:  getAgentTypes                                      │  │
│  │  Tools:  getActiveTools                                     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                     │
│                              ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                      BACKEND APIs                            │  │
│  │                                                              │  │
│  │  /agents              /admin/agent-types/active              │  │
│  │  /agents/all          /tools/active                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
agent/
├── index.ts                 # Public exports (store hooks, components, types)
├── types.ts                 # TypeScript interfaces
├── api.ts                   # API functions (Axios)
├── store.ts                 # Zustand store with caching
├── components/
│   ├── index.ts             # Component exports
│   ├── AgentButton.tsx      # Sidebar trigger button
│   ├── AgentDialog.tsx      # Modal container
│   ├── AgentList.tsx        # Main list with CRUD logic
│   ├── AgentCard.tsx        # Individual agent card
│   ├── AgentFormSchema.ts   # Zod validation schema
│   └── CreateEditAgentDialog.tsx  # Create/edit form dialog
└── README.md
```

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

**Tool Auto-Selection**: When creating a new agent and changing the agent type, tools whose `defaultAgentTypes` include the selected type name are automatically checked. This does not happen when editing (preserves existing selections).

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
