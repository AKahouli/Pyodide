# AI Proxy Module

Client-facing OpenAI-compatible reverse proxy for generated App Builder apps. Clients authenticate with an app JWT; the backend injects the server-side LiteLLM App Builder key. **LiteLLM credentials never reach the browser.**

This module is separate from `ChatCompletionModule` (admin-only, non-streaming, DB model IDs). AI Proxy exposes the standard OpenAI surface (`/v1/chat/completions`, `/v1/models`) for session-token clients.

## Key Features

- **OpenAI-compatible API** — `POST /api/v1/chat/completions`, `GET /api/v1/models` (raw OpenAI JSON; `@SkipResponseWrap` — not `{ success, data }`)
- **JWT auth** — platform access JWT, App Data end-user JWT (`typ: app_end_user`), or opaque AI preview ticket (`aiprev_…`); clients send `Authorization: Bearer <token>`
- **Credential boundary** — forwards with `LITELLM_APP_BUILDER_API_KEY` + `X-Request-User`
- **Streaming + non-streaming** — SSE pipe (`text/event-stream`) or JSON response
- **Model validation** — active chat models via `ModelsService`; optional allowlist
- **Preview relay** — parent `BrowserRuntimeHost` holds AI preview ticket; iframe uses `VITE_YM_AI_PROXY` + `ym-ai-fetch` (ticket never enters the generated app)
- **Payload limits** — body size, message count, content length, max tokens
- **Rate limiting** — per user + endpoint + model
- **Usage + budget** — `UsageModule` logging; `@CheckUsage()` token budget enforcement
- **Pricing reuse** — cost metadata from `ModelsService.findPricing()` (no duplicate map)
- **OpenAI-shaped errors** — `AiProxyExceptionFilter` (`rate_limit_error`, `insufficient_quota`, …)

## Module Structure

```
ai-proxy/
  ai-proxy.module.ts
  ai-proxy.controller.ts
  ai-proxy.service.ts              # Validate → cap → forward (non-stream)
  ai-proxy-stream.service.ts       # SSE upstream pipe + disconnect cleanup
  ai-proxy-usage.service.ts        # Token resolve, pricing, UsageModule writes
  ai-proxy-exception.filter.ts     # OpenAI-compatible error JSON
  constants/
    ai-proxy.constants.ts
  dto/
    chat-completion.dto.ts
  guards/
    ai-proxy-rate-limit.guard.ts
    ai-proxy-payload-limit.guard.ts
  interfaces/
    ai-proxy.interface.ts
  README.md
```

Config lives in `src/config/ai-proxy.config.ts` (namespace `aiProxy`). Body size is enforced by `AiProxyPayloadLimitGuard` (`Content-Length`) and by post-parse checks in `AiProxyService`.

## Module Configuration

```typescript
imports:     [ModelsModule, UsageModule]
controllers: [AiProxyController]
providers:   [
  AiProxyService,
  AiProxyStreamService,
  AiProxyUsageService,
  AiProxyRateLimitGuard,
  AiProxyPayloadLimitGuard,
]
```

Registered in `app.module.ts` via `AiProxyModule`. Routes are `@Public()` for the global guard and authenticated by `AppBuilderAiAuthGuard` (platform JWT or App Data end-user JWT billed to the app owner).

## API Endpoints

Base path: `/api/v1` (`API_PREFIX=api` + URI versioning).

| Method | Route | Guards / checks | Description |
|--------|-------|-----------------|-------------|
| POST | `/api/v1/chat/completions` | Payload limit, rate limit, usage budget, JWT | Proxy chat completion (stream or JSON) |
| GET | `/api/v1/models` | Payload limit (noop), rate limit, App Builder AI auth | List active models (allowlist-filtered if set). Owns this path (OpenAI-compatible); platform catalog is `/api/v1/model-catalog`. |

### Headers (client → YellowStorm)

```http
Authorization: Bearer <app-jwt>
Content-Type: application/json
```

### Headers (YellowStorm → LiteLLM)

```http
Authorization: Bearer <LITELLM_APP_BUILDER_API_KEY>
X-Request-User: <userId>
Content-Type: application/json
```

### Chat completion body (`ChatCompletionDto`)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `model` | `string` | Yes | Must be active chat model; optional allowlist |
| `messages` | `{ role, content }[]` | Yes | Roles: system, user, assistant, tool |
| `stream` | `boolean` | No | SSE when `true` |
| `temperature` | `number` | No | 0–2. Stripped when catalog `omitTemperature` is set (reasoning models). |
| `top_p` | `number` | No | 0–1 |
| `max_tokens` / `max_completion_tokens` | `number` | No | Capped; if both omitted, injects `AI_PROXY_MAX_TOKENS_PER_REQUEST` |
| `stop` | `string \| string[]` | No | |

Unknown fields are rejected (`forbidNonWhitelisted`).

### Streaming

Upstream request includes `stream_options: { include_usage: true }` when possible. Client response headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

## Security & Limits

### Rate limit

`AiProxyRateLimitGuard` scopes by **user + handler + model** (when body has `model`).

Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` on 429.

### Payload

| Check | Default |
|-------|---------|
| `Content-Length` (`AiProxyPayloadLimitGuard`) | 1 MiB |
| Serialized body after parse | 1 MiB |
| Messages count | 100 |
| Chars per message content | 100_000 |
| Max completion tokens | 4096 |

### Models

1. `ModelsService.validateModelActive(model, 'chat')` — missing / inactive / non-chat → 400  
2. If `AI_PROXY_ALLOWED_MODELS` is non-empty, model must be in the set  
3. Empty allowlist → active catalog only (not raw LiteLLM dump)  
4. `GET /models` applies the same allowlist filter  

### Budget

`@CheckUsage()` + `UsageLimitGuard` on chat completions. Exceeded plan tokens → **429** with `insufficient_quota` (OpenAI-compatible).

## Usage Recording

`AiProxyUsageService` writes to `UsageModule` with endpoint `ai-proxy.chat-completions`:

- `userId`, `modelName`, input/output tokens, `durationMs`, `success`
- `metadata.tokensStatus`: `known` \| `unknown` (never treat missing usage as silent zero consumption without marking unknown)
- `metadata.pricing` / `estimatedCost` from `ModelsService.findPricing()`
- Optional `litellmRequestId`
- Failures (non-stream and mid-stream errors) also recorded when possible

## Error Shape

```json
{
  "error": {
    "message": "…",
    "type": "invalid_request_error | rate_limit_error | insufficient_quota | server_error",
    "code": "insufficient_quota"
  }
}
```

| HTTP | Typical cause |
|------|----------------|
| 400 | Invalid model, payload limits, bad request |
| 401 | Missing/invalid JWT |
| 429 | Rate limit or token budget |
| 502 / 503 | Upstream LiteLLM failure / unavailable |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LITELLM_API_URL` | — | LiteLLM base URL (via connection service) |
| `LITELLM_APP_BUILDER_API_KEY` | — | Key injected for App Builder traffic (**required** for proxy) |
| `AI_PROXY_RATE_LIMIT_PER_USER` | `60` | Requests per window |
| `AI_PROXY_RATE_LIMIT_WINDOW_MS` | `60000` | Window size |
| `AI_PROXY_ALLOWED_MODELS` | `` (empty = all active) | Comma-separated allowlist |
| `AI_PROXY_MAX_TOKENS_PER_REQUEST` | `4096` | Cap / default injected max tokens |
| `AI_PROXY_MAX_BODY_BYTES` | `1048576` | Max request body |
| `AI_PROXY_MAX_MESSAGES` | `100` | Max messages array length |
| `AI_PROXY_MAX_MESSAGE_CONTENT_CHARS` | `100000` | Max chars per message |

Request timeout for proxy calls is `AI_PROXY_REQUEST_TIMEOUT_MS` (300s), independent of the shorter global `LITELLM_TIMEOUT_MS`.

## Client Example

```typescript
import OpenAI from 'openai';

const ai = new OpenAI({
  baseURL: `${backendUrl}/api/v1`,
  apiKey: sessionJwt, // App JWT — not a LiteLLM key
  dangerouslyAllowBrowser: true,
});

const stream = await ai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
  stream: true,
});
```

## Tests

```bash
npm test -- --testPathPattern=ai-proxy --no-coverage
```

## Related

- Architecture overview: `YellowStorm/back/AI-PROXY-ARCHITECTURE.md`
- Internal admin completions: `modules/chat-completion/`
- LiteLLM connectivity: `modules/models/litellm-connection.service.ts`
- Usage / plans: `modules/usage/`
