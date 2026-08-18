# Models Module

The models module manages AI model configuration and synchronization with LiteLLM, providing model discovery, activation/deactivation, and default model selection.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Data Model](#data-model)
- [LiteLLM Integration](#litellm-integration)
- [Connection Management](#connection-management)
- [API Endpoints](#api-endpoints)
- [Model Synchronization](#model-synchronization)
- [Configuration](#configuration)
- [Error Handling](#error-handling)

---

## Overview

The models module provides:

- **Model Discovery**: Automatic synchronization of available AI models from LiteLLM (all types, not just chat)
- **Model Management**: CRUD operations for model configuration
- **Model Classification**: Each model carries a `type` (chat, embedding, image_generation, …) initialised from LiteLLM and editable by an admin
- **Default Model Selection**: Admin ability to set a default model for new conversations
- **Conversation-V2 Default**: Admin ability to set a dedicated default model for the conversation-v2 flow (falls back to the global default, then to no model)
- **Provider Organization**: Models grouped by provider (chef) for easy filtering
- **Connection Resilience**: Automatic reconnection with exponential backoff
- **Health Monitoring**: Periodic health checks to detect LiteLLM availability

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MODELS MODULE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────────────┐    ┌──────────────────────┐                       │
│  │   ModelsController   │    │ AdminModelsController │                       │
│  │   (Public API)       │    │   (Admin API)         │                       │
│  └──────────┬───────────┘    └──────────┬───────────┘                       │
│             │                           │                                    │
│             └───────────┬───────────────┘                                    │
│                         ▼                                                    │
│               ┌──────────────────┐                                           │
│               │  ModelsService   │                                           │
│               │  - findAll()     │                                           │
│               │  - syncModels()  │                                           │
│               │  - setDefault()  │                                           │
│               └────────┬─────────┘                                           │
│                        │                                                     │
│          ┌─────────────┴─────────────┐                                       │
│          ▼                           ▼                                       │
│  ┌──────────────────┐    ┌─────────────────────────┐                        │
│  │   LiteLLMClient  │    │  MongoDB (AiModel)      │                        │
│  │   (HTTP Client)  │    │  - modelId              │                        │
│  └────────┬─────────┘    │  - name, chef           │                        │
│           │              │  - litellmModel         │                        │
│           ▼              │  - isActive, isDefault  │                        │
│  ┌─────────────────────────┐ └────────────────────────┘                     │
│  │ LiteLLMConnectionService│                                                │
│  │ - Auto-reconnect        │                                                │
│  │ - Health checks         │                                                │
│  │ - Exponential backoff   │                                                │
│  └───────────┬─────────────┘                                                │
│              │                                                               │
│              ▼                                                               │
│  ┌─────────────────────────┐                                                │
│  │     LiteLLM Server      │                                                │
│  │   (External Service)    │                                                │
│  └─────────────────────────┘                                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS** | Module framework with dependency injection |
| **Mongoose** | MongoDB ODM for model persistence |
| **Axios** | HTTP client for LiteLLM API communication |
| **ConfigModule** | Feature-specific configuration management |
| **AuthorizationModule** | Permission-based access control for admin endpoints |

---

## Directory Structure

```
models/
├── index.ts                       # Module exports
├── models.module.ts               # NestJS module definition
├── models.controller.ts           # Public API endpoints
├── admin-models.controller.ts     # Admin-only API endpoints
├── models.service.ts              # Business logic and data access
├── models.service.spec.ts         # Unit tests (sync, classification, public filtering)
├── litellm.client.ts              # LiteLLM API client
├── litellm-connection.service.ts  # Connection management with auto-reconnect
├── schemas/
│   └── model.schema.ts            # MongoDB schema definition
├── interfaces/
│   └── model.interface.ts         # TypeScript interfaces
└── dto/
    └── update-model.dto.ts        # Validation DTO for updates
```

---

## Data Model

### AiModel Schema

```typescript
@Schema({ timestamps: true, collection: 'models' })
export class AiModel {
  @Prop({ required: true, unique: true, index: true })
  modelId: string;          // e.g., "gpt-4o"

  @Prop({ required: true })
  name: string;             // e.g., "GPT-4o"

  @Prop({ required: true })
  chef: string;             // e.g., "OpenAI" (display name)

  @Prop({ required: true, index: true })
  chefSlug: string;         // e.g., "openai" (URL-friendly)

  @Prop({ default: '' })
  litellmModel: string;     // Full LiteLLM identifier (e.g., "azure/gpt-4.1", "anthropic/claude-sonnet-4-5")

  @Prop({ type: [String], default: [] })
  providers: string[];      // List of provider slugs

  @Prop({ default: '', index: true })
  type: string;             // Classification: chat | embedding | image_generation | ...
                            // '' = unclassified, set by admin. Initialised from
                            // LiteLLM mode for new models, never overwritten on re-sync.

  @Prop({ default: true })
  isActive: boolean;        // Whether model is available for use

  @Prop({ default: false })
  isDefault: boolean;       // Only one model can be default

  @Prop({ default: false })
  isConversationV2Default: boolean; // Only one model can be the conversation-v2 default
}
```

### Database Indexes

| Index | Fields | Purpose |
|-------|--------|---------|
| Primary | `modelId` (unique) | Fast lookups by model ID |
| Chef filter | `chefSlug, isActive` | Filter models by provider |
| Type filter | `type, isActive` | Filter active models by classification (e.g. chat-only public list) |
| Active filter | `isActive` | List active models only |
| Default lookup | `isDefault` | Find default model |
| Conversation-v2 default lookup | `isConversationV2Default` | Find conversation-v2 default model |

### Response Interfaces

```typescript
interface ModelResponse {
  id: string;           // Model ID (e.g., "gpt-4o")
  name: string;         // Display name (e.g., "GPT-4o")
  chef: string;         // Provider name (e.g., "OpenAI")
  chefSlug: string;     // Provider slug (e.g., "openai")
  litellmModel: string; // Full LiteLLM identifier (e.g., "azure/gpt-4.1")
  providers: string[];  // All providers supporting this model
  type: string;         // Classification ("chat", "embedding", ...; "" if unclassified)
  isActive: boolean;    // Availability status
  isDefault: boolean;   // Whether this is the default model
  isConversationV2Default: boolean; // Whether this is the conversation-v2 default model
}

interface ModelsListResponse {
  models: ModelResponse[];
  total: number;
}
```

---

## LiteLLM Integration

### Overview

[LiteLLM](https://github.com/BerriAI/litellm) is a unified API gateway that provides a consistent interface to multiple AI providers. The models module fetches available models from LiteLLM's `/v1/model/info` endpoint, which provides detailed model metadata including the provider, mode, and capabilities.

### LiteLLMClient

The `LiteLLMClient` provides methods to interact with LiteLLM:

```typescript
class LiteLLMClient {
  // Fetch all available models from LiteLLM /v1/model/info
  async fetchModels(): Promise<LiteLLMModelInfoEntry[]>

  // Check LiteLLM health status
  async checkHealth(): Promise<boolean>

  // Get current health status
  getHealthStatus(): LiteLLMConnectionStatus

  // Check if LiteLLM is configured
  isConfigured(): boolean
}
```

### LiteLLM Response Format

The `/v1/model/info` endpoint returns rich model metadata:

```typescript
interface LiteLLMModelInfoEntry {
  model_name: string;          // Model alias configured in LiteLLM (used as modelId)
  litellm_params: {
    model: string;             // Full LiteLLM identifier (e.g., "azure/gpt-4.1")
  };
  model_info: {
    id: string;                // Internal LiteLLM ID
    litellm_provider: string;  // Provider slug (e.g., "azure", "anthropic")
    mode: string;              // Model mode ("chat", "embedding", etc.)
    max_tokens: number | null;
    max_input_tokens: number | null;
    max_output_tokens: number | null;
    input_cost_per_token: number | null;
    output_cost_per_token: number | null;
    supports_vision: boolean | null;
    supports_function_calling: boolean | null;
    supports_reasoning: boolean | null;
  };
}
```

**Field Mapping (LiteLLM → AiModel):**

| LiteLLM Field | AiModel Field | Example |
|---------------|---------------|---------|
| `model_name` | `modelId` | `"gpt-4o"` |
| `model_info.litellm_provider` | `chefSlug` | `"azure"` |
| `litellm_params.model` | `litellmModel` | `"azure/gpt-4.1"` |
| `model_info.mode` | `type` | `"chat"` — seeds the type of NEW models only; not overwritten afterwards |
| _(derived from chefSlug)_ | `chef` | `"Azure"` |

### Provider Display Names

The module maps the provider slug (`model_info.litellm_provider`) to user-friendly display names:

| Provider Slug | Display Name |
|---------------|--------------|
| `openai` | OpenAI |
| `anthropic` | Anthropic |
| `google` | Google |
| `azure` | Azure |
| `mistral` | Mistral AI |
| `meta` / `meta-llama` | Meta |
| `deepseek` | DeepSeek |
| `groq` | Groq |
| `perplexity` | Perplexity |
| `together` | Together AI |
| `bedrock` | AWS Bedrock |
| `vertex_ai` | Google Vertex AI |
| `ollama` | Ollama |
| `openrouter` | OpenRouter |
| `cohere` | Cohere |
| `anyscale` | Anyscale |
| `replicate` | Replicate |
| `huggingface` | Hugging Face |
| `sagemaker` | AWS SageMaker |
| `custom` | Custom |

Unrecognized slugs are auto-capitalized (e.g., `"newprovider"` → `"Newprovider"`).

---

## Connection Management

### LiteLLMConnectionService

Manages the HTTP connection to LiteLLM with resilience features:

```typescript
class LiteLLMConnectionService {
  // Establish connection to LiteLLM
  async connect(): Promise<void>

  // Verify connection is still active
  async verifyConnection(): Promise<boolean>

  // Get current connection status
  getHealthStatus(): LiteLLMConnectionStatus

  // Get the Axios HTTP client
  getHttpClient(): AxiosInstance | null
}
```

### Connection Status

```typescript
interface LiteLLMConnectionStatus {
  available: boolean;        // Whether LiteLLM URL is configured
  connected: boolean;        // Current connection state
  error: string | null;      // Last error message if any
  lastCheckedAt?: Date;      // When health was last verified
  reconnectAttempts: number; // Number of reconnect attempts
  isReconnecting: boolean;   // Whether reconnection is scheduled
}
```

### Auto-Reconnection

The service automatically reconnects using exponential backoff:

```
Connection Lost
      │
      ▼
  Wait 1s (+ jitter)  ──► Attempt 1
      │
      ▼ (failed)
  Wait 2s (+ jitter)  ──► Attempt 2
      │
      ▼ (failed)
  Wait 4s (+ jitter)  ──► Attempt 3
      │
      ▼
  ... up to maxDelayMs (30s default)
```

**Backoff Formula:**
```typescript
delay = min(initialDelay * (multiplier ^ attempts), maxDelay) * jitter
// jitter = random value between 0.9 and 1.1 (±10%)
```

### Health Checks

Periodic health checks run in the background (default: every 60 seconds):
- Verify LiteLLM is reachable via `/health/readiness`
- Auto-trigger reconnection if connection lost
- Update `lastCheckedAt` timestamp

---

## API Endpoints

### Public Endpoints

All public endpoints require JWT authentication.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/models` | List active **chat** models (filtered to `type === "chat"`) |
| `GET` | `/models/:id` | Get model by ID |
| `GET` | `/models/chef/:chefSlug` | Get active **chat** models by provider |

> **Note:** the public endpoints intentionally return only `type === "chat"` models so that conversation model selectors never surface embeddings, image-generation, etc. The admin endpoints (`/admin/models`) return **all** types.

### Admin Endpoints

Admin endpoints require specific permissions via `PermissionsGuard`.

| Method | Endpoint | Permission | Description |
|--------|----------|------------|-------------|
| `GET` | `/admin/models` | `MODELS_READ_ALL` | List all models (including inactive) |
| `GET` | `/admin/models/default` | `MODELS_READ_ALL` | Get the default model |
| `PATCH` | `/admin/models/:id` | `MODELS_UPDATE` | Update model properties |
| `POST` | `/admin/models/:id/set-default` | `MODELS_SET_DEFAULT` | Set model as default |
| `POST` | `/admin/models/:id/clear-default` | `MODELS_SET_DEFAULT` | Clear default status |
| `POST` | `/admin/models/:id/set-conversation-v2-default` | `MODELS_SET_DEFAULT` | Set model as conversation-v2 default |
| `POST` | `/admin/models/:id/clear-conversation-v2-default` | `MODELS_SET_DEFAULT` | Clear conversation-v2 default status |
| `POST` | `/admin/models/sync` | `MODELS_UPDATE` | Trigger manual sync from LiteLLM |

### Request/Response Examples

**GET /models**
```json
{
  "models": [
    {
      "id": "gpt-4o",
      "name": "GPT 4o",
      "chef": "Azure",
      "chefSlug": "azure",
      "litellmModel": "azure/gpt-4o",
      "providers": ["azure"],
      "type": "chat",
      "isActive": true,
      "isDefault": true,
      "isConversationV2Default": false
    },
    {
      "id": "claude-3-opus",
      "name": "Claude 3 Opus",
      "chef": "Anthropic",
      "chefSlug": "anthropic",
      "litellmModel": "anthropic/claude-3-opus",
      "providers": ["anthropic"],
      "type": "chat",
      "isActive": true,
      "isDefault": false
    }
  ],
  "total": 2
}
```

**PATCH /admin/models/:id**
```json
// Request (type must be one of the 8 supported values)
{
  "name": "GPT-4 Omni",
  "type": "chat",
  "isActive": false
}

// Response
{
  "id": "gpt-4o",
  "name": "GPT-4 Omni",
  "chef": "Azure",
  "chefSlug": "azure",
  "litellmModel": "azure/gpt-4o",
  "providers": ["azure"],
  "type": "chat",
  "isActive": false,
  "isDefault": false
}
```

**POST /admin/models/sync**
```json
{
  "added": 3,
  "updated": 2,
  "reactivated": 1,
  "deactivated": 2,
  "total": 15
}
```

---

## Model Synchronization

### Sync Process

The `syncModels()` method keeps the local database in sync with LiteLLM's `/v1/model/info` endpoint. **All** model types are ingested (chat, embeddings, image generation, audio, etc.). Each new model is classified via its `type` field, seeded from `model_info.mode`; the admin can override it afterwards and a re-sync will never overwrite it.

```
┌─────────────────────────────────────────────────────────────────┐
│                     MODEL SYNC PROCESS                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Fetch models from LiteLLM /v1/model/info                   │
│         │                                                       │
│         ▼                                                       │
│  2. (no type filter — every model is ingested)                  │
│         │                                                       │
│         ▼                                                       │
│  3. For each model:                                             │
│     ┌───────────────────────────────────────────────┐          │
│     │ Model exists in DB?                           │          │
│     │   NO  ──► Create (isActive=true,              │          │
│     │            type = mode || "")                  │          │
│     │   YES ──► Always update chefSlug, litellmModel,│         │
│     │           providers from source of truth       │          │
│     │           (type is NEVER touched here)          │          │
│     │           Model inactive? ──► Reactivate it    │          │
│     └───────────────────────────────────────────────┘          │
│         │                                                       │
│         ▼                                                       │
│  4. Deactivate models NOT in LiteLLM                            │
│     (models removed from LiteLLM become inactive)              │
│         │                                                       │
│         ▼                                                       │
│  5. Return sync statistics                                      │
│     { added, updated, reactivated, deactivated, total }        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Source-of-Truth Fields

On every sync, the following fields are **always updated** from LiteLLM for existing models, ensuring they stay accurate:

| Field | Source | Reason |
|-------|--------|--------|
| `chefSlug` | `model_info.litellm_provider` | Provider may change if model is remapped |
| `chef` | _(derived from chefSlug)_ | Display name must match slug |
| `litellmModel` | `litellm_params.model` | Full identifier needed for gRPC/streaming |
| `providers` | `[chefSlug]` | Keep in sync with provider |

The `name` and `type` fields are **never overwritten** on existing models, preserving admin-set custom display names and classifications. `type` is only seeded on creation (from `model_info.mode`).

### Sync Statistics

| Statistic | Description |
|-----------|-------------|
| `added` | New models discovered in LiteLLM |
| `updated` | Existing active models whose source-of-truth fields changed |
| `reactivated` | Previously deactivated models found again in LiteLLM |
| `deactivated` | Models no longer in LiteLLM, marked inactive |
| `total` | Total models returned by LiteLLM |

### Sync Triggers

1. **Application Startup**: Non-blocking sync on `onApplicationBootstrap`
2. **Manual Trigger**: Admin calls `POST /admin/models/sync`

### One-Off Migration (type backfill)

Because the public list filters on `type === "chat"`, models that predate the
`type` field would disappear from selectors until a re-sync. Every model already
in the DB is a chat model (the old sync only stored chat), so run this once
**after deploy and before the first re-sync**:

```bash
cd back && npx ts-node scripts/migrations/2026-06-26-backfill-model-type-chat.ts
```

It sets `type: "chat"` on all models that are still unclassified.

### Model Name Generation

New models get auto-generated display names:

```typescript
// "gpt-4o" → "GPT 4o"
// "claude-3-opus-20240229" → "Claude 3 Opus"
// "gemini-1.5-pro" → "Gemini 1.5 Pro"
```

**Rules:**
- Date suffixes removed (e.g., `-20240229`)
- Known acronyms uppercased (GPT, LLM, AI, API)
- Version numbers preserved (1.5, 4o, 3.5)
- Hyphens/underscores converted to spaces

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LITELLM_API_URL` | (required) | LiteLLM server base URL |
| `LITELLM_API_KEY` | - | API key for authentication |
| `LITELLM_TIMEOUT_MS` | `10000` | Request timeout in milliseconds |
| `LITELLM_HEALTH_CHECK_ENABLED` | `true` | Enable periodic health checks |
| `LITELLM_HEALTH_CHECK_INTERVAL_MS` | `60000` | Health check interval (60s) |
| `LITELLM_RECONNECT_ENABLED` | `true` | Enable auto-reconnection |
| `LITELLM_RECONNECT_INITIAL_DELAY_MS` | `1000` | Initial reconnect delay |
| `LITELLM_RECONNECT_MAX_DELAY_MS` | `30000` | Maximum reconnect delay |
| `LITELLM_RECONNECT_MAX_ATTEMPTS` | `0` | Max attempts (0 = unlimited) |
| `LITELLM_RECONNECT_MULTIPLIER` | `2` | Exponential backoff multiplier |

### Configuration File

```typescript
// config/litellm.config.ts
export default registerAs('litellm', () => ({
  apiUrl: process.env.LITELLM_API_URL || '',
  apiKey: process.env.LITELLM_API_KEY || '',
  healthEndpoint: '/health/readiness',
  modelsEndpoint: '/v1/model/info',
  timeoutMs: parseInt(process.env.LITELLM_TIMEOUT_MS || '10000', 10),

  healthCheck: {
    enabled: process.env.LITELLM_HEALTH_CHECK_ENABLED !== 'false',
    intervalMs: parseInt(process.env.LITELLM_HEALTH_CHECK_INTERVAL_MS || '60000', 10),
  },

  reconnect: {
    enabled: process.env.LITELLM_RECONNECT_ENABLED !== 'false',
    initialDelayMs: parseInt(process.env.LITELLM_RECONNECT_INITIAL_DELAY_MS || '1000', 10),
    maxDelayMs: parseInt(process.env.LITELLM_RECONNECT_MAX_DELAY_MS || '30000', 10),
    maxAttempts: parseInt(process.env.LITELLM_RECONNECT_MAX_ATTEMPTS || '0', 10),
    multiplier: parseFloat(process.env.LITELLM_RECONNECT_MULTIPLIER || '2'),
  },
}));
```

---

## Error Handling

### Error Codes

| Code | Description |
|------|-------------|
| `ERR_MODEL_NOT_FOUND` | Requested model does not exist |
| `ERR_MODEL_INACTIVE` | Model exists but is deactivated |

### Connection Error Handling

The connection service gracefully handles various error scenarios:

| Error | Behavior |
|-------|----------|
| `ECONNREFUSED` | Schedule reconnection |
| `ETIMEDOUT` | Schedule reconnection |
| HTTP 4xx/5xx | Log error, schedule reconnection |
| Config missing | Log warning, skip initialization |

### Audit Logging

Admin operations are logged via `AuditLogService`:

```typescript
this.auditLogService.logSuccess({
  actorId: actor._id.toString(),
  actorEmail: actor.email,
  action: 'models.update',       // or 'models.sync', 'models.set_default'
  targetId: id,
  targetType: 'Model',
  metadata: { changes: dto },
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});
```

---

## Usage Examples

### Importing the Module

```typescript
import { ModelsModule, ModelsService } from '@modules/models';

@Module({
  imports: [ModelsModule],
})
export class ConversationModule {
  constructor(private readonly modelsService: ModelsService) {}

  async validateModel(modelId: string) {
    const result = await this.modelsService.validateModelActive(modelId);
    if (!result.valid) {
      if (result.inactive) {
        throw new BadRequestException('Model is inactive');
      }
      throw new NotFoundException('Model not found');
    }
    return result.model;
  }
}
```

### Getting the LiteLLM Model Identifier

The `litellmModel` field contains the full provider/model identifier used for routing requests through LiteLLM:

```typescript
const model = await this.modelsService.findById('gpt-4o');
if (model) {
  console.log(model.litellmModel); // "azure/gpt-4.1"
  // This value is sent to the gRPC stream service as the chatbot model
}
```

### Checking Model Validity

```typescript
// Returns { valid: boolean, model: ModelResponse | null, inactive: boolean }
const result = await this.modelsService.validateModelActive('gpt-4o');

if (!result.valid) {
  if (result.inactive) {
    // Model exists but disabled
  } else {
    // Model not found
  }
}
```

### Getting Default Model

```typescript
const defaultModel = await this.modelsService.getDefaultModel();
if (defaultModel) {
  console.log(`Default model: ${defaultModel.name}`);
}
```

### Getting the Conversation-V2 Default Model

```typescript
// Returns the model flagged isConversationV2Default (active), or null.
const defaultModel = await this.modelsService.getConversationV2DefaultModel();
if (defaultModel) {
  console.log(`Conversation-v2 default: ${defaultModel.name}`);
}
```

### Conversation-V2 Default Resolution

The conversation-v2 stream service resolves its model in this order:

1. Model explicitly selected for the conversation (or passed in the request).
2. The model flagged `isConversationV2Default`.
3. The global default model (`getDefaultModel()`).
4. No model (`undefined`) — the agent runtime falls back to its own default.

This keeps the conversation-v2 flag distinct from the global `isDefault`; setting a
conversation-v2 default never affects the v1/worky/playbook flows.

### Checking LiteLLM Health

```typescript
const status = this.modelsService.getHealthStatus();
if (!status.connected) {
  console.warn(`LiteLLM disconnected: ${status.error}`);
}
```
