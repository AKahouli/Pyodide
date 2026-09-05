# YellowStorm Backend — Coding Guidelines

> **Golden rule:** before inventing a pattern, look at a sibling module (`auth`, `conversation`, `conversation-v2`, `playbook-flow`, `worky`, `workspace`). If a convention already exists, follow it.

---

## 1. Stack

| Layer | Tech |
|-------|------|
| Framework | NestJS 10, Express, `@nestjs/config` + Joi env validation |
| Validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| ORM | Mongoose 8 (`@nestjs/mongoose`) |
| Auth | `@nestjs/passport` + `passport-jwt` + `@nestjs/jwt`, bcrypt |
| Docs | `@nestjs/swagger` (gated in non-prod) |
| Scheduling | `@nestjs/schedule` |
| Health | Custom (not `@nestjs/terminus` — see §19) |
| gRPC | `@grpc/grpc-js` + `@grpc/proto-loader` (client to Python ADK) |
| Realtime | SSE via RxJS `Observable<MessageEvent>`, manual SSE, HTTP fetch streams, Socket.IO for WhatsApp pairing, browser sessions, and app runtime |
| Storage | S3/Ceph via `@aws-sdk/client-s3` + presigned URLs; legacy Azure Blob dependency may exist |
| Email | `nodemailer` (SMTP) or Microsoft Graph (`@azure/msal-node`) |
| AI runtimes | gRPC ADK services, MCP via `@modelcontextprotocol/sdk` |
| WhatsApp | `@whiskeysockets/baileys`, `socket.io`, `qrcode` |
| Relational storage | `pg` for memory-cards/Postgres-backed features |
| Security | `helmet`, `compression`, `cookie-parser` |
| Testing | Jest 29 + `@nestjs/testing` (`*.spec.ts`) |

**Do not add a new library** without confirming nothing already in `package.json` covers it.

---

## 2. Project Structure

```
back/src/
├── main.ts                     # Bootstrap: middleware, pipes, CORS, Swagger, shutdown
├── app.module.ts               # Root: config, Mongoose, APP_GUARD, feature modules
├── common/                     # @Public() decorator, interceptors, shared DTOs
├── config/                     # registerAs('<ns>', () => ({...})) + Joi schema
└── modules/                    # Feature modules (auth, conversation-v2, playbook-flow, worky, …)
```

Representative current modules include: `agent`, `agent-type`, `analytics`, `app-data`, `app-runtime`, `auth`, `auth-provider`, `authorization`, `browser-session`, `chat-completion`, `classifier`, `connected-app`, `connector`, `conversation`, `conversation-v2`, `database`, `document`, `email`, `evaluation`, `exceptions`, `governance`, `guardrails`, `health`, `humain-agent`, `indexing`, `integration-events`, `knowledge-intelligence`, `logger`, `memory-cards`, `models`, `notifications`, `playbook-flow`, `postgres`, `project`, `rate-limiter`, `request-context`, `response`, `semantic-model`, `skill`, `system`, `team`, `telegram`, `tool`, `usage`, `user`, `user-group`, `whatsapp`, `widget-chat`, `workspace`, `workspace-artifact`, `workspace-web-import`, `worky`. This list is descriptive, not an exhaustive registry; verify `src/modules/` and `app.module.ts`. New playbook work belongs in `playbook-flow`. A legacy `playbook` directory remains but is not root-loaded; do not extend it or create another parallel playbook module. `workspace-web-import` is currently a scaffolding stub (empty `dto/`, `interfaces/`, `schemas/`); do not assume it has runtime behavior until it is implemented.

**Path aliases** (`@/*`, `@modules/*`, `@common/*`, `@config/*`) — **never** `../../../`:

```ts
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { PaginationDto } from '@common/dto/pagination.dto';
import authConfig from '@config/auth.config';
```

---

## 3. Module Anatomy

```
src/modules/<name>/
├── <name>.module.ts            # @Module: imports, controllers, providers, exports
├── controllers/                # *.controller.ts + colocated *.spec.ts
├── services/                   # *.service.ts + *.spec.ts (sub-directories for domains)
├── dto/                        # class-validator DTOs (request + query)
├── schemas/                    # Mongoose @Schema/@Prop
├── guards/                     # CanActivate implementations
├── decorators/                 # Param / metadata decorators
├── domain/                     # Policy, access, sanitisation, response assembly — optional
├── design/                     # Async design operations — optional (playbook-flow)
├── execution/                  # gRPC client + runtime services — optional (playbook-flow)
│   ├── grpc/                   # gRPC client, Struct mappers
│   └── runtime/                # Dispatchers, event handlers, stream finalizers
├── proto/                      # gRPC .proto files
├── interfaces/                 # TypeScript interfaces for internal contracts
├── mappers/                    # DTO ↔ domain mappers
├── utils/                      # Module-specific utilities
└── constants/                  # Static maps / enums
```

**Rules:**
- Export services that other modules need. Keep internal providers unexported.
- Use `forwardRef(() => OtherModule)` only for unavoidable circular deps; prefer extracting shared logic to a third module.
- Register schemas with `MongooseModule.forFeature(...)` **inside the owning module**. Cross-module access goes through the owning service — never re-register the schema.

---

## 4. Bootstrap (`main.ts`)

Global config applied once — **do not** re-apply per-controller:
- `helmet()` with CSP (default-src `'self'`, style-src inline, img-src `'self' data: https:`).
- `compression()` is **disabled** (commented out) — it buffers SSE responses. Do not re-enable without verifying all SSE streams.
- Body parsers use a 10 MB JSON/urlencoded limit; increase only with an endpoint-specific reason and abuse-risk review.
- `cookieParser()`, CORS (origins from `CORS_ORIGIN`, `credentials: true`).
- CORS origin resolution also reads the admin-managed MongoDB whitelist through `SystemService`; keep env and DB whitelist behavior aligned.
- URI versioning `/v1/`, global prefix `api` → `/api/v1/<resource>`.
- Global `ValidationPipe` (see §6), `SwaggerModule.setup('docs', ...)` in non-prod only.
- Nest boots with `bufferLogs: true` and then installs `LoggerService`; do not add a second logger bootstrap path.
- HTTP server timeout is 5 minutes to support long-running orchestration requests; do not lower it without checking streaming and runtime callbacks.
- Graceful shutdown on `SIGTERM`, `SIGINT`, `uncaughtException`, `unhandledRejection`.

---

## 5. Configuration

Every config file uses `registerAs` in `src/config/<name>.config.ts`. Inject via **typed config**:

```ts
constructor(@Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>) {}
```

Or `ConfigService` for one-off values. **Never** read `process.env` directly in services.

All env vars go through Joi validation in `src/config/config.schema.ts`. The app refuses to boot with missing required vars. Production requires `JWT_SECRET`, `ENCRYPTION_KEY`, `MONGODB_URI`, storage + email secrets.

**Root-loaded config namespaces:** `app`, `jwt`, `auth`, `microsoft`, `health`, `workspace`, `litellm`, `conversation`, `conversation-v2`, `appRuntime`, `appData`, `playbook-flow`, `grpcSecurity`, `grpcSecurityV2`, `telegram`, `whatsapp`, `worky`, `memoryCards`, `dataRoom`, `governedConversations`, `semanticModel`. Additional namespaces may be owned by feature modules; verify their `ConfigModule.forFeature(...)` registration rather than assuming root availability.

Keep `src/config/*.config.ts`, `src/config/config.schema.ts`, `src/config/index.ts`, and `ConfigModule.forRoot({ load: [...] })` in sync. A config namespace loaded in `app.module.ts` but not exported from `src/config/index.ts` is a drift smell; a file exported but not loaded is likely dead code.

The **playbook-flow** config (`src/config/playbook-flow.config.ts`) is the most extensive: gRPC URLs, execution limits, token buffer, execution lease, delta patch, async design, and concurrency controls. Any new env var in this domain must be added to both the config file and `config.schema.ts` — missing entries cause silent fallback to defaults.

gRPC TLS/security is split by runtime: `grpcSecurity` covers shared services such as conversation v1, a2a-admin, and playbook-flow; `grpcSecurityV2` covers conversation-v2/Manus. Keep API keys, TLS mode, CA paths, and server-name overrides in the matching namespace.

All config keys read in services must be declared in the corresponding `<name>.config.ts`. If you find a service reading a key that is not in the config file (e.g. `playbook-flow.maxSseConnections`), add it — do not rely on fallback defaults.

**Load lifecycle:** most namespaces are root-loaded in `app.module.ts`. A small number are feature-loaded inside the owning module's imports (currently `browserSession` in `browser-session.module.ts`). When introducing a namespace, decide explicitly whether it must be available app-wide (root-load) or only when the owning module is registered (feature-load), and document that choice at the registration site so consumers do not assume availability when the feature module is absent.

**Namespace parity (load + Joi + export):** every loaded namespace must satisfy all three: (a) every env-derived key it reads must be present in `config.schema.ts` Joi validation, (b) it must be exported from `src/config/index.ts`, (c) it must be loaded exactly once. Current debt: `browserSession` reads env keys without Joi entries, and `appRuntimeConfig`, `memoryCardsConfig`, `governedConversationsConfig`, and `browserSessionConfig` are not re-exported from the barrel. Fix this debt when touching those areas; do not treat it as an approved pattern.

`dataRoom` and `governedConversations` are rollout-gate namespaces consumed across module boundaries (governance, workspace, knowledge-intelligence). Treat their flags as cross-module contracts: changing a flag's default or removing it requires tracing every consumer, not just the owning module.

---

## 6. Validation & DTOs

**Global `ValidationPipe`** (`whitelist`, `forbidNonWhitelisted`, `transform`, `stopAtFirstError`).

**DTO conventions:**
- One class per payload (`Create*.dto.ts`, `Update*.dto.ts`, `*Query.dto.ts`). No reusing for create+update unless identical.
- Decorate with `class-validator` **and** `@ApiProperty` / `@ApiPropertyOptional`.
- Use `@Type(() => ChildDto)` for nested objects needing validation.
- For partial updates prefer `PartialType(CreateXDto)`.
- Query DTOs: `@IsOptional()` + `@Type(() => Number)` for numeric query params.
- Validation failures → `ERR_1001`.

---

## 7. HTTP API Contract

### Routing
- Base: `/api/v1/<resource>`. REST verbs: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`.
- IDs in path params, filters in query, body for payloads.
- Controllers: `@ApiTags`, `@ApiBearerAuth` (unless `@Public`).

### Response envelope (global interceptor)
```json
{ "success": true, "data": <T>, "meta": { "timestamp": "...", "requestId": "uuid", "path": "...", "duration": 123 } }
```
Frontend unwraps `response.data.data`. Opt-out only for file streams / SSE — document why.

### Error envelope (global filter)
```json
{ "success": false, "error": { "code": "ERR_1002", "message": "...", "statusCode": 404, "timestamp": "...", "path": "...", "requestId": "uuid", "details": [...] } }
```
`details` populated for validation errors. In production, never expose stack traces.

### Error codes
Live in `src/modules/exceptions/constants/error-codes.ts`; frontend mirrors in `front/src/lib/error-codes.ts` — **keep in sync**.

| Range | Meaning |
|-------|---------|
| `ERR_1000` | Internal error |
| `ERR_1001` | Validation error |
| `ERR_1002`–`ERR_1009` | Generic HTTP (404, 401, 403, 409, 400, 429, 503, 410, idempotency mismatch) |
| `ERR_1100`–`ERR_11xx` | Auth |
| `ERR_1200`–`ERR_12xx` | User |
| `ERR_1300`–`ERR_13xx` | Agent |
| `ERR_1400`–`ERR_14xx` | Chat / conversation |
| `ERR_1500`–`ERR_15xx` | External service |
| `ERR_1600`–`ERR_16xx` | System |
| `ERR_1700`–`ERR_17xx` | Usage / plan |
| `ERR_1800`–`ERR_18xx` | Notification |
| `ERR_1900`–`ERR_1970` | Workspace (incl. workspace-artifact / derived-document codes `ERR_1961`–`ERR_1970`, and indexing/share codes `ERR_1950`–`ERR_1960`) |
| `ERR_2000`–`ERR_20xx` | Models |
| `ERR_2100`–`ERR_21xx` | Authorization / RBAC |
| `ERR_2200`–`ERR_22xx` | Tool / skill |
| `ERR_2300`–`ERR_24xx` | Agent type / custom agent |
| `ERR_2500`–`ERR_25xx` | **Playbook** |
| `ERR_2600`–`ERR_26xx` | Auth provider |
| `ERR_2700`–`ERR_27xx` | Project |
| `ERR_2800`–`ERR_28xx` | Classifier |
| `ERR_2900`–`ERR_29xx` | Chat completion |
| `ERR_3000`–`ERR_30xx` | Connected app |
| `ERR_3100`–`ERR_31xx` | Connector |
| `ERR_3200`–`ERR_32xx` | Telegram |
| `ERR_3210`–`ERR_3222` | WhatsApp |
| `ERR_3300`–`ERR_3313` | Team |
| `ERR_3350`–`ERR_3351` | User group |
| `ERR_3400`–`ERR_3409` | Widget chat (incl. citation not found) |
| `ERR_3500`–`ERR_3530` | Worky |
| `ERR_3600`–`ERR_3688` | Governance (incl. governed-conversation codes `ERR_3680`–`ERR_3688`) |

Adding a code: pick the right range, add to backend enum, mirror it in `front/src/lib/error-codes.ts`, and add EN+FR messages in frontend `errors.json`. Frontend drift is easy to miss because unknown backend codes still reach the UI as generic errors.

### Pagination
Query: `?page=1&limit=10` (shared `PaginationDto`). Response wraps items + `pagination: { page, limit, total, totalPages }` inside `data`.

### Headers
`X-Request-ID`, `X-Correlation-ID` (response). `X-RateLimit-*` + `Retry-After` on rate-limited routes.

---

## 8. Authentication & Authorization

- **Access token**: short-lived (~15m), `Authorization: Bearer <jwt>`. Payload: `userId`, `sessionId`, `permissions[]`, `roleNames[]`.
- **Refresh token**: long-lived (~7d), HTTP-only `refresh_token` cookie (`httpOnly`, `secure` in prod, `sameSite` configurable). Rotated on every refresh.
- `POST /api/v1/auth/refresh` — frontend axios 401-retry queue depends on this.
- Sessions persisted server-side; `JwtStrategy` validates token + active session.

**Global guard** via `APP_GUARD: JwtAuthGuard` — every route authenticated by default. Opt-out with `@Public()`.

**Current user:** `@CurrentUser()` decorator (from `request.user`). Never read raw JWT claims in controllers.
- `@RequirePermissions('playbook.read')` — `PermissionsGuard`.
- `@Roles('admin')` — `RolesGuard`. Prefer permission checks.

**Secrets:** bcrypt (rounds from `AUTH_BCRYPT_ROUNDS`, default 12). Never log tokens, hashes, cookies, or include secrets in responses/Swagger.

**Widget public-API family (separate from JWT):** `widget-chat` exposes a second, public, non-JWT API family for embedded and integration consumers. Widget tokens are agent-bound, optionally expiring, optionally origin-allowlisted, and are stored **only as SHA-256 hashes** — never log, return, or persist the plaintext token after the one-time creation response. Auth is enforced by `WidgetTokenGuard`, not `JwtAuthGuard`; routes are `@Public()` and may declare a deployment mode (`embed` vs REST integration) that determines whether the consumer receives manual SSE or a synchronous JSON response. There is also a separate synchronous external REST contract at `POST /integrations/agents/:agentId/messages` whose token's agent must equal the route's `:agentId`. When adding widget routes, reuse `WidgetTokenGuard` and the existing deployment-mode shapes rather than introducing a third auth model.

---

## 9. Mongoose & Schemas

- Always `@Schema({ timestamps: true })`. Export `HydratedDocument<T>` as `<Name>Document`.
- Declare indexes next to the schema, not in services.
- Apply `toJSON` transform: `_id` → `id`, strip `__v`. The frontend expects `id`.
- Use strict typing (`!` on required, `?` on optional).

**Queries:** Prefer `.select()` projection over full documents. Use `.lean()` on read-heavy endpoints. Compound indexes for paginated queries. **Never** leak internal Mongo fields through the API.

**Persisted editable fields:** when adding a field users can edit, update every persistence/contract layer in one change: Mongoose schema defaults, create/update DTO validation, service mapping/serialization, public interfaces, frontend types, and any autosaved editor payload. Missing any layer causes silent data loss in autosaved UIs.

**Revision-based optimistic concurrency:** documents that multiple workers or users may mutate concurrently (e.g. `workspace-artifact`, `governance-deployment-revision`) carry a monotonic `revision` (or equivalent) counter. Update payloads must include `expectedRevision`; the service atomically increments it and rejects mismatches. Pair this with a unique compound index on the logical identity (e.g. `(programId, workspaceId)` for governance bindings, `(workspaceId, artifactType)` for artifacts). Do not use bare `findOneAndUpdate` for documents that have a revision field — always filter on the expected revision.

**Embedded lease state machine:** long-running generation/extraction jobs embed the lease sub-document directly on the job document (`leaseToken`, `expiresAt`, `attempt`, `retryCount`, `engineVersion`). Workers claim by atomic filter on `leaseToken == null OR expiresAt < $now`, then write results back only if their `leaseToken` still matches; long runs must extend `expiresAt` via heartbeat. Unique job identity is a compound key (e.g. `(sourceVersionId, jobType, inputHash, engineVersion)` for knowledge-extraction jobs). Do not introduce an external queue for these workers without documenting why Mongo-embedded leases are insufficient.

---

## 10. gRPC & Microservices

**Proto files** live in `src/modules/<module>/proto/`. Currently five proto files:

| Module | File | Service | RPCs |
|--------|------|---------|------|
| `agent` | `a2a_admin.proto` | A2A admin | Admin/runtime integration |
| `conversation` | `chatbot.proto` | Messages only | — (shared types) |
| `conversation-v2` | `conversation.proto` | `ConversationV2` | 7 RPCs |
| `playbook-flow` | `playbook-flow.proto` | `PlaybookFlowRuntime` | 5 RPCs |
| `worky` | `companion_ai.proto` | Companion AI orchestrator | Worky orchestration |

Any `.proto` consumed by YellowStorm ADK must be mirrored in `yellowstorm-adk/grpc/proto/` and changed on both sides in one change set. The current ADK tree mirrors `a2a_admin.proto`, `chatbot.proto`, `playbook-flow.proto`, and `companion_ai.proto`; it does not contain `conversation.proto`. Treat that absence as unresolved ownership/contract debt: verify the Conversation V2 server owner before changing the proto, and add the ADK mirror if ADK is the receiver.

**Packaging:** every backend `.proto` needed at runtime must be available from a standalone `dist/` artifact and from the production image. `nest-cli.json` declares `**/*.proto`; `package.json`'s `postbuild` explicitly copies `chatbot.proto`, `conversation.proto`, `playbook-flow.proto`, and `companion_ai.proto`; the Dockerfile explicitly copies all five proto directories. `a2a_admin.proto` is currently omitted from the explicit `postbuild` copy and was absent from a standalone local `dist/` after `npm run build`, although Docker compensates for it. Fix that build-artifact gap before relying on `dist/` outside the Docker image. When adding a proto, verify Nest assets, `postbuild`, the Docker image, and runtime path resolution.

**Backend acts as gRPC client** for ADK-backed services. Clients are built in services (e.g. `PlaybookFlowRuntimeClientService`, `ConversationV2ClientService`) via `OnModuleInit` using `@grpc/grpc-js` + `@grpc/proto-loader`.

Worky uses the gRPC ADK orchestrator and Electric projections. Keep its sender, receiver, and projection contracts aligned when changing the orchestration flow.

**Streams:** Map gRPC stream events to RxJS `Observable`/`Subject`. Always handle `error`, `end`, disconnect. Translate gRPC codes to domain error codes — never leak raw gRPC codes to frontend.

**`google.protobuf.Struct`:** `@grpc/proto-loader` does NOT auto-convert plain JS objects to Struct wire format. Always wrap with the module's `toGrpcStruct()` before assigning to a Struct-typed field. Known Struct/payload-style fields include `task_metadata`, `evaluation_config`, `trigger_context`, `agent_params`, `args`, `metadata`, `input_context`, and `payload`; verify the proto before adding or editing any Struct assignment. A missed wrap causes a silent empty field on the Python side with no log or error.

**Prompt-facing paths:** Any workspace/document path that flows into an LLM prompt or ADK trigger context must strip the leading Mongo ObjectId owner segment. Keep path sanitisation consistent across document paths, workspace path metadata, and trigger context paths.

---

## 11. Errors & Exceptions

Custom hierarchy in `src/modules/exceptions/exceptions/`. All extend `AppException extends HttpException`:
```ts
throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
throw new ValidationException([{ field: 'email', message: 'Invalid email' }]);
```

**Never** throw raw `Error` in controllers/services reachable from a controller.

`GlobalExceptionFilter` catches everything: `AppException` → envelope as-is; `HttpException` → mapped code; `ValidationPipe` → `ERR_1001` + details; unknown → `ERR_1000` (logged, not leaked). Every exception logged with `requestId`, `userId`, path, method, status, code.

---

## 12. Interceptors, Pipes, Guards, Filters

Set once globally; per-route guards live in the owning module:

| Component | Location |
|-----------|----------|
| `ValidationPipe` | `main.ts` (global) |
| Response envelope interceptor | `src/modules/response/` |
| Optional/non-global interceptors (`LoggingInterceptor`, `TransformInterceptor`) | `src/common/interceptors/` |
| `GlobalExceptionFilter` | `src/modules/exceptions/filters/` |
| `JwtAuthGuard` (APP_GUARD) | `src/modules/auth/guards/` |
| `MaintenanceGuard` (APP_GUARD) | `src/modules/system/` |
| `RateLimitGuard` | `src/modules/rate-limiter/guards/` |

`LoggingInterceptor` and `TransformInterceptor` under `src/common/interceptors/` are not automatically active unless registered as `APP_INTERCEPTOR`. Do not cite an interceptor as global until the provider registration exists.

---

## 13. Request Context & Logging

`RequestIdMiddleware` extracts/generates `X-Request-ID`, `X-Correlation-ID`, stores in AsyncLocalStorage. Read via `RequestContextService` — don't thread the request object through the call stack.

`LoggerService` (`src/modules/logger/`, `@Global()`): structured JSON, optional MongoDB sink (buffered, 30-day TTL). Use scoped loggers per class. **Never `console.log`.** Never log secrets, tokens, full user objects, or PII beyond user id.

---

## 14. Rate Limiting

Decorator-driven: `@RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'auth:register' })`. Identifier: `${userId ?? ip}:${endpoint}`. Sets `X-RateLimit-*` headers, throws `TooManyRequestsException` (`ERR_1007`) when exhausted. Public endpoints **must** be rate-limited. Skip health checks with `@RateLimitSkip()`.

---

## 15. Real-time & SSE

Current SSE endpoints and pipes use these serving patterns:

| Stream | Endpoint | Auth | Implementation |
|--------|----------|------|----------------|
| Conversation | `GET /api/v1/conversations/stream` | `StreamAuth` decorator | `@Sse()`, RxJS `Observable` |
| Notifications | `GET /api/v1/notifications/stream` | `SseAuth` decorator | `@Sse()`, heartbeat via `interval()` |
| Playbook flow | `GET /api/v1/playbooks/stream` | `PlaybookFlowStreamAuthGuard` (query token) | `@Sse()`, `@Public()`, per-user connection tracking |
| Conversation v2 pipe | `GET /api/v1/conversation-v2/stream` | Query token | Manual SSE (no `@Sse()`), flush via warmup padding, Nagle disable, heartbeat stream |
| Conversation v2 live tail | `GET /api/v1/conversation-v2/sessions/:id/stream/live` | Query token | Manual SSE polling `eventStore.listSince` (`liveTailPollMs`, default 1000ms) |
| Worky events | `GET /api/v1/worky/streams/:id/events` | `WorkyStreamAccessGuard` | `@Sse()` endpoint; frontend consumes via fetch + `ReadableStream` |

**Rules:**
- SSE auth via dedicated guard, not `JwtAuthGuard` (browsers can't set `Authorization` on `EventSource`).
- Always clean up on `req.on('close')`.
- Cap per-user connections (frontend issues `TOO_MANY_TABS` on eviction).
- Emit typed events; keep schema in sync with frontend.
- Ordered streams must include and persist a monotonic cursor (`sequence` for conversation-v2) so clients can resume and gap-detect.
- On token refresh, frontend calls `reconnectWithNewToken()` — expect short-lived reconnects.
- Do not open WebSocket gateways without agreeing on event schema with the frontend team.
- `compression()` middleware is incompatible with SSE (buffering breaks streaming). It is disabled in `main.ts` — do not re-enable without verifying all SSE endpoints.

Worky governance is backend-owned; resolution uses stream override, workspace policy, then default level. Every governance evaluation must write an audit event.

### Socket.IO namespace: `/browser-session` (browser-session module)

A sanctioned Socket.IO usage alongside WhatsApp pairing and app runtime. JWT handshake via `socket.request`, one in-memory session per socket, events `start` / `input` / `navigate` (client → server) and `frame` / `navigated` / `blocked` / `closed` (server → client). Runtime is a Playwright/CDP relay: `Page.screencastFrame` emits base64 JPEG frames that the gateway forwards as `frame` events; input/navigation events are replayed to Playwright. Sessions expire on idle/max timers and are destroyed on socket disconnect.

**Hard cross-boundary invariant:** the configured 1280×720 (16:9) viewport must match the frontend `VIEWPORT_W/H` constants in `front/src/modules/workspace/hooks/useBrowserSession.ts` so streamed input coordinates map correctly. Change both sides in the same change set.

**Ack protocol uses raw strings, not the global error envelope:** `BUSY`, `BAD_REQUEST`, `NO_SESSION`, etc. Any new ack string must be added to the frontend consumer in the same change.

**Security controls are mandatory, not optional:** URL safety is checked before launch and before every navigation; routed main-document requests are validated; popups are closed and downloads cancelled. Do not bypass these checks when extending the engine — surface new unsafe patterns through the existing guard points.

### Socket.IO namespace: `/app-runtime` (app-runtime module)

The browser-hosted application runtime connects through `AppRuntimeGateway` using a one-shot runtime ticket, not the user JWT. The consumed ticket scopes the socket to one user, workspace, binding, and runtime session and cannot be replayed. One current runtime connection is registered per workspace; replacement or disconnect fails pending tools and returns the binding to its waiting state.

The protocol is defined in `app-runtime/types/app-runtime-protocol.ts`: `runtime.register`, `runtime.heartbeat`, `runtime.rehydrate`, `tool.invoke`, `tool.progress`, `tool.completed`, and `tool.failed`. The ticket decides socket ownership; never trust workspace or runtime identifiers from event payloads without matching them to the consumed ticket. Keep event names, payloads, capability negotiation, heartbeat persistence, and the frontend `BrowserRuntimeClient`/`BrowserRuntimeHost` consumers aligned.

### Widget manual SSE (widget-chat module)

`GET /widget/stream` is a `@Public()` manual SSE endpoint (no `@Sse()` decorator), authenticated by query token via `WidgetTokenGuard`. The controller writes warmup padding, disables Nagle (`socket.setNoDelay(true)`), sets SSE headers, and emits `stream_start`, `stream_chunk`, `stream_complete`, `stream_error`, plus heartbeat. Mirror this exact event set when extending; do not introduce a second widget stream shape.

---

## 16. Scheduling

`@Cron()`, `@Interval()`, `@Timeout()` decorators. Rules:
- Log start/end at `debug`, failures at `error`.
- Jobs must be idempotent (app may run as multiple replicas).
- Long-running jobs should short-circuit if a run is already in flight.

---

## 17. Email

`EmailService` in `src/modules/email/`. Providers: SMTP (`nodemailer`) or Microsoft Graph (`@azure/msal-node`), selected by `EMAIL_PROVIDER`. Retry up to 3 attempts with exponential backoff. Templates: HTML + text, EN and FR. **Never** send email directly from a controller — go through `EmailService`.

---

## 18. File Storage (S3/Ceph and Legacy Azure Blob)

Presigned direct browser upload via `DocumentService` (`src/modules/document/`):
1. `POST /.../documents/upload-url` → `{ uploadUrl, blobPath }` or equivalent presigned upload payload.
2. Frontend PUTs directly to object storage (S3/Ceph in current deployments; Azure Blob is legacy/dependency drift unless a module explicitly uses it).
3. `POST /.../documents/confirm` finalises.

**Rules:** Never proxy large uploads through NestJS. Validate MIME + size server-side before issuing a presigned URL. Use the narrowest permissions possible, one object key, and a short expiry.

Postgres-backed features (currently `memory-cards`) use `pg`; do not mix Mongo and Postgres in a feature unless ownership, migrations, and backup semantics are documented.

---

## 19. Health Checks

| Route | Purpose |
|-------|---------|
| `GET /api/v1/health` | Full check (503 if unhealthy) |
| `GET /api/v1/health/live` | Kubernetes liveness |
| `GET /api/v1/health/ready` | Kubernetes readiness |
| `GET /api/v1/health/history?minutes=60` | Recent results |
| `GET /api/v1/health/stats?minutes=60` | Aggregated stats |

Add a health indicator for each new external dependency.

**Note:** The health module uses a **custom implementation** (not `@nestjs/terminus`, despite the dependency being in `package.json`). It performs direct checks on memory, event loop, database, storage, email, LiteLLM, and gRPC connections. History is persisted in MongoDB for observability (`HealthHistory` schema). Do not migrate to Terminus without a documented rationale — the custom path provides richer per-check history and stats.

---

## 20. Testing

Jest 29 + `@nestjs/testing`. Tests colocated as `*.spec.ts`. Run: `npm test`, `npm run test:cov`, `npm run test:e2e`.

**Rules:**
- Mock Mongoose models with `getModelToken(Model.name)` + chainable `.select().lean().exec()` mock. Don't hit a real Mongo.
- Test error paths: `expect(...).rejects.toBeInstanceOf(NotFoundException)`.
- Controller tests focus on wiring (guards, DTO → service arg mapping). Push business logic into services.
- Never mock what you own if it's trivial — import it directly.

---

## 21. TypeScript Conventions

- `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.
- Use named exports by default; gRPC/ESM boundaries must not depend on ambiguous default imports. Nest `registerAs()` configuration factories are the established exception and may use default exports.
- `type` for DTO shapes, payload objects, config types. `interface` for service contracts and public module surfaces. `enum` (string-valued) for error codes and API-boundary enums; `as const` for internal static maps.
- Mongoose document types: `HydratedDocument<T>`, exported as `<Name>Document`.
- `!` for required schema props, `?` for optional. No `any` — prefer `unknown` + narrowing.
- Explicit return types on public methods (controllers, exported service methods).

---

## 22. File & Symbol Naming

| Kind | Style | Example |
|------|-------|---------|
| Files | kebab-case | `auth.controller.ts`, `playbook-execution.service.ts` |
| Classes | PascalCase | `AuthController`, `PlaybookExecutionService` |
| DTOs | `*.dto.ts` + `PascalCaseDto` | `create-conversation.dto.ts` → `CreateConversationDto` |
| Schemas | `*.schema.ts` | `conversation.schema.ts` |
| Guards | `*.guard.ts` | `jwt-auth.guard.ts` |
| Decorators | `*.decorator.ts` | `current-user.decorator.ts` |
| Interceptors | `*.interceptor.ts` | `logging.interceptor.ts` |
| Filters | `*.filter.ts` | `global-exception.filter.ts` |
| Modules | `*.module.ts` | `conversation.module.ts` |
| Tests | `*.spec.ts` | `auth.service.spec.ts` |
| Proto | `*.proto` under `proto/` | `chatbot.proto` |

---

## 23. Frontend ↔ Backend Contract

Changes crossing the boundary require paired updates:

| Backend change | Frontend touchpoint |
|----------------|---------------------|
| New REST endpoint | `API_ENDPOINTS` + module `api.ts` |
| New DTO / schema field | Frontend types mirror |
| New error code | `error-codes.ts` + `locales/.../errors.json` |
| New SSE event type | `stream.ts` / notifications service |
| New ordered event stream | Frontend store/query cursor handling (`sequence` or equivalent) |
| Cookie attrs change | CORS + `credentials` + `sameSite` must match |
| Versioning / prefix change | `VITE_API_URL` / `env.sh` |
| New `.proto` field or file | Mirror in `yellowstorm-adk/grpc/proto/` when ADK consumes it; verify standalone `dist/`, Docker packaging, and both runtime sides |

**Frozen contracts:** response envelope, error envelope, and pagination shape. Do not alter silently.

For persisted editable fields, treat schema, DTO, response serializer/interface, and frontend type/editor payload as one contract. Do not add a backend field without verifying the frontend can both send and read it when applicable.

Conversation-v2 sessions are backend-owned: Mongo `_id` is the wire `sessionId`, `aiSessionId` is runtime-only, event history is append-only with per-session `sequence`, and session-owned system workspaces must cascade-delete with the session.

---

## 24. Advanced Architectural Patterns

These are cross-module patterns that have their own conventions beyond the per-section rules above. Add to them only after reading the existing implementation; they encode load-bearing invariants.

### 24.1 Integration Events (Transactional Outbox)

`integration-events` implements a MongoDB transactional-outbox for cross-module domain events.

- **Envelope:** immutable event documents carry `eventId`, `aggregateType`/`aggregateId`, `eventName`, `payload`, `correlationId`/`causationId`, a global `deliveryState`, per-handler `deliveryRecords[]` keyed by `handlerKey`, and `retryMetadata`. See `integration-events/schemas/integration-event.schema.ts`.
- **Versioned contracts:** producers record events against named, versioned contracts (e.g. `workspace.document.created.v1`, `workspace.document.updated.v1`) under `integration-events/contracts/`. The `v1` suffix is a wire contract — bumping it requires a new contract file and parallel consumer registration; never edit a published contract in a breaking way.
- **Emission is feature-gated:** producers must check the relevant `dataRoom.*` flag before recording (e.g. `workspace.document.*.v1` is gated on `dataRoom.workspaceEventsEnabled`). Outbox dispatch itself is gated on `dataRoom.outboxDispatchEnabled`.
- **Dispatch:** a single `@Interval()` dispatcher (every 5s, only when enabled) acquires a distributed lock, selects due events, and fans them out to registered handlers. Stale locks are recovered after 120s.
- **Handler registration:** consumers implement the handler interface and register a `handlerKey` (e.g. `governance.workspace-events.v1`) via `OnModuleInit`. The handler-key string is the routing contract — keep it stable.
- **Delivery semantics:** at-least-once, idempotency-oriented. Handlers must be idempotent on `(eventId, handlerKey)`. Failed deliveries use exponential backoff and eventually move to a dead-letter status.

When adding a new producer: add the versioned contract, gate emission on a `dataRoom` flag, and update `config.schema.ts` if a new flag is introduced. When adding a new consumer: register a stable `handlerKey`, document idempotency key, and verify ordering expectations against the producer.

### 24.2 Governance Framework

`governance` is a large Mongo-backed domain spanning programs, hierarchical scopes/audiences, source/version lifecycle, memberships, deployments/revisions, dry-runs, metrics, workspace bindings/reconciliation, and governed conversations. It depends on `authorization`, `conversation`, `widget-chat`, `whatsapp`, `telegram`, `user-group`, `connector`, `indexing`, `integration-events`, and `knowledge-intelligence`.

- **Consumes integration events** through the handler in `governance/integration/workspace-governance-event.handler.ts`. It applies ordering and idempotency checks before materialising workspace documents into governed sources/versions, and conditionally queues knowledge-extraction work.
- **Temporal intelligence worker** is feature-gated, polls every 5s, validates workspace content/indexing identity before and after evidence search, and writes temporal-candidate records.
- **Persistence uses domain-specific uniqueness/idempotency indexes:** source-event deduplication, one binding per `(program, workspace)`, and version/revision uniqueness. When adding a new governance collection, declare the uniqueness invariant as a compound index next to the schema, not in the service.
- **Governance reconciliation** is exposed to the frontend via polling (currently 1s) on the reconciliation Query — there is no governance SSE today. If you add one, follow §15.
- **Governed conversations** are a rollout-gated integration between governance and the conversation module; their enablement flows through the `governedConversations` config namespace and the frontend `governedConversationFeatures` shared flag.

### 24.3 Workspace Artifacts and Async Generation

`workspace-artifact` is a Mongo collection (`workspace_artifacts`) holding workspace-nested artifacts with source references, JSON payload, `revision`-based optimistic concurrency (see §9), and an embedded generation lease/retry state machine.

- **REST contract:** queue/create, configuration, retry, clone, update (requires `expectedRevision`), delete — under `/api/v1/workspaces/:workspaceId/artifacts`.
- **Decision-flow generation worker** is an asynchronous, cron-polled worker. It downloads PDF source bytes from existing object storage via the document module, extracts selected-page text with `pdf-parse`, submits an LLM task through `AgentTaskExecutionService`, validates JSON output, and commits results only if the lease token still matches. Do not run this kind of worker without the lease check.
- **Source bytes are read from object storage through the document module** — do not duplicate upload/storage ownership in the artifact module.

### 24.4 Knowledge Intelligence

`knowledge-intelligence` provides reusable Mongo repositories plus a durable, Mongo-embedded extraction-job queue (see §9's lease pattern). Identity is `(sourceVersionId, jobType, inputHash, engineVersion)` — changing any of these fields creates a new job; do not mutate identity on an existing job. Engine version bumps intentionally re-run extraction; gate behind a feature flag if cost is a concern.

---

## 25. Pre-PR Checklist

- [ ] Controller has `@ApiTags` + `@ApiBearerAuth` (unless `@Public`).
- [ ] DTOs decorated with `class-validator` + `@ApiProperty`.
- [ ] No direct `process.env` in services.
- [ ] Exceptions thrown from `@modules/exceptions` with proper `ErrorCode`.
- [ ] Mongoose schema: `timestamps`, indexes, `toJSON` transform (`_id` → `id`).
- [ ] Tests colocated as `*.spec.ts`; `npm test` passes.
- [ ] Proto changes mirrored in ADK when applicable; standalone `dist/`, Docker packaging, and both runtime sides validated.
- [ ] Proto packaging: all backend proto files (`a2a_admin.proto`, `chatbot.proto`, `conversation.proto`, `playbook-flow.proto`, `companion_ai.proto`, plus new ones) exist in standalone `dist/` and the production image; update `postbuild` and Docker copies as required.
- [ ] `google.protobuf.Struct` fields wrapped with `toGrpcStruct()` — never assign a plain JS object.
- [ ] Frontend contract items synced per §23.
- [ ] Backend error codes mirrored in `front/src/lib/error-codes.ts` and EN+FR error locales.
- [ ] Ordered SSE/event streams expose cursor semantics and frontend resume/gap handling.
- [ ] Persisted editable fields are present in schema, DTO, serializer/interface, and frontend type/editor payload.
- [ ] Config namespace: env keys in Joi `config.schema.ts`, exported from `src/config/index.ts`, load lifecycle (root vs feature) documented.
- [ ] If adding a `dataRoom`/`governedConversations` flag: every cross-module consumer traced and updated.
- [ ] If emitting integration events: versioned contract under `integration-events/contracts/`, emission gated on the right `dataRoom` flag, consumer `handlerKey` stable and idempotency key documented.
- [ ] If adding a long-running worker: lease sub-document present, heartbeat/expiry extension in place, identity compound index unique, stale-lock recovery verified.
- [ ] If touching `browser-session`: viewport (1280×720) matches frontend constants; new ack strings added to the frontend consumer; URL/popup/download safety checks still enforced.
- [ ] If adding widget routes: reuse `WidgetTokenGuard`, no plaintext token logged/returned/persisted, deployment-mode shape preserved.
- [ ] No `console.log`; structured logs via `LoggerService`.
- [ ] Public endpoints rate-limited.
- [ ] Swagger annotations sufficient to reproduce the call from `/docs`.
- [ ] Commit: `<type>(<scope>): <subject>` (conventional commit).

---

## 26. Anti-Patterns

- Throwing raw `Error` or `HttpException` without `ErrorCode`.
- Reading `process.env` inside services/controllers.
- Returning Mongoose docs with `_id`/`__v` leaking to the API.
- Creating duplicate axios instances or gRPC clients to the same service.
- Applying `ValidationPipe`, `ClassSerializerInterceptor`, or auth guards per-controller when already global.
- `@Body() dto: any`, `@Query() q: Record<string, unknown>`, or any `any`.
- Re-registering a schema in a consuming module instead of injecting the owning service.
- `console.*` usage.
- Proxying large uploads through Node instead of presigned object-storage URLs.
- Silent error swallowing (`catch { /* ignore */ }`).
- Adding an env var without adding it to `config.schema.ts` Joi validation.
- Adding custom response/error envelope shapes "just for this endpoint".
- Breaking API/proto contracts without updating frontend + ADK in the same change set.
- Adding backend error codes without mirroring frontend enum and localised messages.
- Bare `catch {}` or `catch (e) { /* ignore */ }` — always log or re-throw.
- Relying on fallback defaults for config keys not declared in `<name>.config.ts` or `config.schema.ts`.
- Adding a new proto file without adding it to `package.json`'s `postbuild` copy step.
- Adding a `google.protobuf.Struct` field without wrapping the value in `toGrpcStruct()`. The silent wire drop is invisible on the Python side.
- Using `@nestjs/terminus` without verifying it matches the custom health history pattern.
- Adding a config namespace without Joi-validating its env keys and exporting it from `src/config/index.ts`.
- Emitting an integration event without a versioned contract file, without gating on the matching `dataRoom` flag, or with a handler that is not idempotent on `(eventId, handlerKey)`.
- Running a lease-based worker without extending `expiresAt` on long runs or without checking `leaseToken` before writing results back.
- Using bare `findOneAndUpdate` on a document that has a `revision` field, instead of filtering on `expectedRevision`.
- Changing the browser-session viewport on one side without updating the frontend `VIEWPORT_W/H` constants in the same change.
- Introducing a third widget auth model instead of reusing `WidgetTokenGuard`, or logging/returning a plaintext widget token after creation.
- Editing a published `*.v1` integration-event contract in a breaking way instead of publishing a `*.v2` contract and a parallel consumer.
