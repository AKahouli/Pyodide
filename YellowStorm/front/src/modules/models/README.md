# Models Module (Frontend)

The models module provides AI model data management for the frontend, enabling model selection in conversations and displaying available providers.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Types](#types)
- [API Layer](#api-layer)
- [State Management](#state-management)
- [Selector Hooks](#selector-hooks)
- [Caching Strategy](#caching-strategy)
- [Usage Examples](#usage-examples)

---

## Overview

The models module provides:

- **Model Fetching**: Retrieve available AI models from the backend
- **Cached State**: In-memory caching with automatic staleness detection
- **Provider Grouping**: Group models by provider (chef) for organized display
- **Default Model**: Identify and access the system's default model
- **Selector Hooks**: Optimized React hooks for accessing model data

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MODELS MODULE (Frontend)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                         REACT COMPONENTS                              │   │
│  │                                                                       │   │
│  │   ModelSelector          ModelDropdown          ProviderFilter        │   │
│  │        │                      │                       │               │   │
│  │        └──────────────────────┼───────────────────────┘               │   │
│  │                               │                                       │   │
│  │                               ▼                                       │   │
│  │  ┌────────────────────────────────────────────────────────────────┐  │   │
│  │  │                     SELECTOR HOOKS                              │  │   │
│  │  │                                                                 │  │   │
│  │  │  useModels()    useModelById()    useChefs()    useDefaultModel │  │   │
│  │  └────────────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        ZUSTAND STORE                                  │   │
│  │                                                                       │   │
│  │  State:                        Actions:                               │   │
│  │  ├─ models: Model[]            ├─ fetchModels()                      │   │
│  │  ├─ total: number              ├─ refreshModels()                    │   │
│  │  ├─ isLoading: boolean         ├─ getModelById(id)                   │   │
│  │  ├─ isInitialized: boolean     ├─ getModelsByChef(slug)              │   │
│  │  ├─ error: string | null       ├─ getChefs()                         │   │
│  │  └─ lastFetchedAt: Date        └─ reset()                            │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                          API LAYER                                    │   │
│  │                                                                       │   │
│  │  getModels()          getModel(id)          getModelsByChef(slug)    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                      │                                       │
│                                      ▼                                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     BACKEND API (/api/v1/models)                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **React 18** | UI framework |
| **Zustand** | State management with devtools |
| **TypeScript** | Type-safe development |
| **Axios** | HTTP client (via apiClient) |

---

## Directory Structure

```
models/
├── index.ts      # Public exports (types, API, store, hooks)
├── types.ts      # TypeScript interfaces
├── api.ts        # API functions
├── store.ts      # Zustand store and selector hooks
└── README.md     # This documentation
```

---

## Types

### Model

Represents an AI model available for use:

```typescript
interface Model {
  id: string;         // Model identifier (e.g., "gpt-4o")
  name: string;       // Display name (e.g., "GPT-4o")
  chef: string;       // Provider display name (e.g., "OpenAI")
  chefSlug: string;   // Provider slug (e.g., "openai")
  providers: string[]; // List of provider slugs
  isActive: boolean;  // Whether model is available
  isDefault: boolean; // Whether this is the default model
}
```

### ModelsListResponse

API response for model list:

```typescript
interface ModelsListResponse {
  models: Model[];
  total: number;
}
```

### ModelsState

Store state shape:

```typescript
interface ModelsState {
  // Data
  models: Model[];
  total: number;

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // Error state
  error: string | null;

  // Cache tracking
  lastFetchedAt: Date | null;
}
```

### ModelsActions

Store actions:

```typescript
interface ModelsActions {
  fetchModels: () => Promise<void>;
  getModelById: (id: string) => Model | undefined;
  getModelsByChef: (chefSlug: string) => Model[];
  getChefs: () => Array<{ slug: string; name: string }>;
  refreshModels: () => Promise<void>;
  reset: () => void;
}
```

---

## API Layer

### Functions

| Function | Method | Endpoint | Description |
|----------|--------|----------|-------------|
| `getModels()` | GET | `/models` | Fetch all available models |
| `getModel(id)` | GET | `/models/:id` | Fetch single model by ID |
| `getModelsByChef(slug)` | GET | `/models/chef/:slug` | Fetch models by provider |

### Usage

```typescript
import { getModels, getModel, getModelsByChef } from '@/modules/models';

// Fetch all models
const { models, total } = await getModels();

// Fetch single model
const model = await getModel('gpt-4o');

// Fetch models by provider
const { models: openaiModels } = await getModelsByChef('openai');
```

---

## State Management

### Store Creation

The store uses Zustand with devtools middleware for debugging:

```typescript
export const useModelsStore = create<ModelsStore>()(
  devtools(
    (set, get) => ({
      // State and actions
    }),
    { name: 'models-store' }
  )
);
```

### Actions

#### fetchModels()

Fetches models with smart caching:

```typescript
fetchModels: async () => {
  const state = get();

  // Skip if already loading
  if (state.isLoading) return;

  // Skip if data is fresh (< 5 minutes old)
  if (
    state.isInitialized &&
    state.lastFetchedAt &&
    Date.now() - state.lastFetchedAt.getTime() < 5 * 60 * 1000
  ) {
    return;
  }

  // Fetch from API...
}
```

#### refreshModels()

Forces a fresh fetch regardless of cache:

```typescript
refreshModels: async () => {
  set({ lastFetchedAt: null, isInitialized: false });
  await get().fetchModels();
}
```

#### getModelById(id)

Retrieves a model from local cache:

```typescript
getModelById: (id: string): Model | undefined => {
  return get().models.find((model) => model.id === id);
}
```

#### getModelsByChef(chefSlug)

Filters models by provider:

```typescript
getModelsByChef: (chefSlug: string): Model[] => {
  return get().models.filter(
    (model) => model.chefSlug.toLowerCase() === chefSlug.toLowerCase()
  );
}
```

#### getChefs()

Extracts unique providers from models:

```typescript
getChefs: (): Array<{ slug: string; name: string }> => {
  const chefsMap = new Map<string, string>();

  for (const model of get().models) {
    if (!chefsMap.has(model.chefSlug)) {
      chefsMap.set(model.chefSlug, model.chef);
    }
  }

  return Array.from(chefsMap.entries())
    .map(([slug, name]) => ({ slug, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
```

#### reset()

Resets store to initial state:

```typescript
reset: () => {
  set(initialState);
}
```

---

## Selector Hooks

Optimized hooks for accessing specific parts of the store:

| Hook | Returns | Description |
|------|---------|-------------|
| `useModels()` | `Model[]` | All models |
| `useModelsLoading()` | `boolean` | Loading state |
| `useModelsInitialized()` | `boolean` | Initialization state |
| `useModelsError()` | `string \| null` | Error message |
| `useModelById(id)` | `Model \| undefined` | Single model by ID |
| `useModelsByChef(slug)` | `Model[]` | Models filtered by provider |
| `useChefs()` | `Array<{slug, name}>` | Unique providers list |
| `useDefaultModel()` | `Model \| undefined` | The default model |

### Hook Implementations

```typescript
// Simple selectors
export const useModels = () =>
  useModelsStore((state) => state.models);

export const useModelsLoading = () =>
  useModelsStore((state) => state.isLoading);

export const useModelsInitialized = () =>
  useModelsStore((state) => state.isInitialized);

export const useModelsError = () =>
  useModelsStore((state) => state.error);

// Parameterized selectors
export const useModelById = (id: string) =>
  useModelsStore((state) => state.models.find((m) => m.id === id));

export const useModelsByChef = (chefSlug: string) =>
  useModelsStore((state) =>
    state.models.filter(
      (m) => m.chefSlug.toLowerCase() === chefSlug.toLowerCase()
    )
  );

// Computed selector
export const useDefaultModel = () =>
  useModelsStore((state) => state.models.find((m) => m.isDefault));
```

---

## Caching Strategy

### Cache Duration

Models are cached for **5 minutes** before being considered stale:

```
┌─────────────────────────────────────────────────────────────────┐
│                      CACHING LOGIC                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  fetchModels() called                                            │
│         │                                                        │
│         ▼                                                        │
│  ┌─────────────────┐                                            │
│  │ Already loading? │──── YES ──► Return (skip)                 │
│  └────────┬────────┘                                            │
│           │ NO                                                   │
│           ▼                                                      │
│  ┌─────────────────────────────────────┐                        │
│  │ Initialized AND lastFetchedAt exists │                       │
│  │ AND age < 5 minutes?                 │── YES ──► Return     │
│  └────────┬────────────────────────────┘            (use cache) │
│           │ NO                                                   │
│           ▼                                                      │
│  Fetch from API ──► Update state ──► Set lastFetchedAt          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Force Refresh

Use `refreshModels()` to bypass the cache:

```typescript
const { refreshModels } = useModelsStore();

// Force fetch fresh data
await refreshModels();
```

---

## Usage Examples

### Basic Model List

```tsx
import { useModels, useModelsLoading, useModelsStore } from '@/modules/models';
import { useEffect } from 'react';

function ModelList() {
  const models = useModels();
  const isLoading = useModelsLoading();
  const { fetchModels } = useModelsStore();

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  if (isLoading) {
    return <div>Loading models...</div>;
  }

  return (
    <ul>
      {models.map((model) => (
        <li key={model.id}>
          {model.name} ({model.chef})
        </li>
      ))}
    </ul>
  );
}
```

### Model Selector Dropdown

```tsx
import { useModels, useDefaultModel, useModelsStore } from '@/modules/models';
import { useEffect, useState } from 'react';

function ModelSelector({ onSelect }: { onSelect: (modelId: string) => void }) {
  const models = useModels();
  const defaultModel = useDefaultModel();
  const { fetchModels } = useModelsStore();
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  useEffect(() => {
    // Set default selection
    if (!selectedId && defaultModel) {
      setSelectedId(defaultModel.id);
      onSelect(defaultModel.id);
    }
  }, [defaultModel, selectedId, onSelect]);

  return (
    <select
      value={selectedId}
      onChange={(e) => {
        setSelectedId(e.target.value);
        onSelect(e.target.value);
      }}
    >
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name} {model.isDefault && '(Default)'}
        </option>
      ))}
    </select>
  );
}
```

### Grouped by Provider

```tsx
import { useModels, useChefs } from '@/modules/models';

function ModelsByProvider() {
  const models = useModels();
  const chefs = useChefs();

  return (
    <div>
      {chefs.map((chef) => (
        <div key={chef.slug}>
          <h3>{chef.name}</h3>
          <ul>
            {models
              .filter((m) => m.chefSlug === chef.slug)
              .map((model) => (
                <li key={model.id}>{model.name}</li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

### Get Specific Model

```tsx
import { useModelById } from '@/modules/models';

function ModelDetails({ modelId }: { modelId: string }) {
  const model = useModelById(modelId);

  if (!model) {
    return <div>Model not found</div>;
  }

  return (
    <div>
      <h2>{model.name}</h2>
      <p>Provider: {model.chef}</p>
      <p>ID: {model.id}</p>
      {model.isDefault && <span className="badge">Default</span>}
    </div>
  );
}
```

### Error Handling

```tsx
import { useModels, useModelsLoading, useModelsError, useModelsStore } from '@/modules/models';
import { useEffect } from 'react';

function ModelsWithErrorHandling() {
  const models = useModels();
  const isLoading = useModelsLoading();
  const error = useModelsError();
  const { fetchModels, refreshModels } = useModelsStore();

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return (
      <div>
        <p>Error: {error}</p>
        <button onClick={refreshModels}>Retry</button>
      </div>
    );
  }

  return (
    <ul>
      {models.map((model) => (
        <li key={model.id}>{model.name}</li>
      ))}
    </ul>
  );
}
```

### Accessing Store Outside React

```typescript
import { useModelsStore } from '@/modules/models';

// Get current state
const { models, isInitialized } = useModelsStore.getState();

// Call actions
await useModelsStore.getState().fetchModels();

// Subscribe to changes
const unsubscribe = useModelsStore.subscribe((state) => {
  console.log('Models updated:', state.models.length);
});
```

---

## Integration with Other Modules

### Conversation Module

The models module integrates with the conversation module for model selection:

```tsx
// In ConversationInput.tsx
import { useModels, useDefaultModel } from '@/modules/models';

function ConversationInput() {
  const models = useModels();
  const defaultModel = useDefaultModel();
  const [selectedModelId, setSelectedModelId] = useState(
    defaultModel?.id ?? ''
  );

  const handleSend = async (content: string) => {
    await sendMessage(conversationId, {
      content,
      modelId: selectedModelId,
    });
  };

  // ...
}
```

### Model Selection Persistence

When users select a model, it can be stored in the conversation store:

```typescript
// In conversation store
const selectedModelId = useConversationStore((s) => s.selectedModelId);

// Falls back to default model from models store
const effectiveModelId = selectedModelId ?? useDefaultModel()?.id;
```
