# Chat Completion Module

Internal LLM chat completion service. Provides a generic producer that any module can inject to make direct LLM calls via LiteLLM's OpenAI-compatible `/v1/chat/completions` endpoint, bypassing the gRPC AI service.

## Key Features

- **Generic producer** — no stored config; callers pass all params per-request
- **Model resolution** — validates model exists and is active via `ModelsService`
- **System prompt injection** — optional system prompt prepended to messages
- **Usage tracking** — logs model, token counts, and latency for every request
- **Admin playground** — `POST /admin/chat-completion/chat` endpoint for interactive testing

## Module Structure

```
chat-completion/
  chat-completion.module.ts           # Module definition
  chat-completion.service.ts          # Core completion logic
  admin-chat-completion.controller.ts # Admin test endpoint
  index.ts                            # Public exports
  dto/
    chat-request.dto.ts               # Request validation DTO
  interfaces/
    chat-completion.interface.ts      # TypeScript interfaces
```

## Module Configuration

```typescript
imports:     [ModelsModule, AuthorizationModule]
controllers: [AdminChatCompletionController]
providers:   [ChatCompletionService]
exports:     [ChatCompletionService]  // Available for injection by other modules
```

## Service Methods

| Method | Description |
|--------|-------------|
| `complete(request: CompletionRequest)` | Send messages to LiteLLM and return structured result with content, usage, model, and latency |
| `completeText(prompt: string, options: CompletionOptions)` | Convenience wrapper — text in, text out. Builds a single user message and returns the response string |

### CompletionRequest

```typescript
{
  messages: ChatMessage[];   // Required — conversation messages
  modelId: string;           // Required — e.g., "gpt-4o"
  maxTokens?: number;        // Default: 1024 (range: 1-32768)
  temperature?: number;      // Default: 0.7 (range: 0-2)
  systemPrompt?: string;     // Optional — prepended as system message
}
```

### CompletionResult

```typescript
{
  content: string;           // Model response text
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;             // LiteLLM model identifier used
  latencyMs: number;         // Request duration
}
```

## API Endpoints

| Method | Route | Permission | Description |
|--------|-------|-----------|-------------|
| POST | `/admin/chat-completion/chat` | `chat_completion.update` | Send a chat completion request (admin playground) |

### Request Body (ChatRequestDto)

| Field | Type | Required | Validators |
|-------|------|----------|------------|
| `messages` | `ChatMessageDto[]` | Yes | Array, min 1 item, each validated |
| `modelId` | `string` | Yes | |
| `maxTokens` | `number` | No | Min 1, Max 32768 |
| `temperature` | `number` | No | Min 0, Max 2 |
| `systemPrompt` | `string` | No | Max 10000 chars |

## Error Codes

| Code | Constant | Description |
|------|----------|-------------|
| ERR_2702 | `CHAT_COMPLETION_FAILED` | LiteLLM request returned an error |
| ERR_2703 | `CHAT_COMPLETION_MODEL_NOT_FOUND` | Specified model not found or inactive |
| ERR_2704 | `CHAT_COMPLETION_LITELLM_UNAVAILABLE` | LiteLLM service is unreachable |

## Permissions

| Permission | Description |
|-----------|-------------|
| `chat_completion.read` | View chat completion configuration |
| `chat_completion.update` | Use the admin chat playground |
| `chat_completion.*` | Full access |

## Usage Examples

### Internal service usage (from another module)

```typescript
// 1. Import ChatCompletionModule in your module
@Module({
  imports: [ChatCompletionModule],
  providers: [MyService],
})
export class MyModule {}

// 2. Inject and use
@Injectable()
export class MyService {
  constructor(private readonly chatCompletion: ChatCompletionService) {}

  async generateTitle(userMessage: string): Promise<string> {
    return this.chatCompletion.completeText(userMessage, {
      modelId: 'gpt-4o',
      maxTokens: 50,
      temperature: 0.3,
      systemPrompt: 'Generate a short title for this conversation.',
    });
  }
}
```

### Admin API (curl)

```bash
curl -X POST http://localhost:3000/api/v1/admin/chat-completion/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{ "role": "user", "content": "Hello!" }],
    "modelId": "gpt-4o",
    "maxTokens": 256,
    "temperature": 0.7
  }'
```
