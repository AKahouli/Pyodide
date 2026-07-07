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
| Realtime | SSE via RxJS `Observable<MessageEvent>`, manual SSE, HTTP fetch streams, Socket.IO for WhatsApp pairing |
| Storage | S3/Ceph via `@aws-sdk/client-s3` + presigned URLs; legacy Azure Blob dependency may exist |
| Email | `nodemailer` (SMTP) or Microsoft Graph (`@azure/msal-node`) |
| AI runtimes | gRPC ADK services, Worky FastAPI runtime over HTTP SSE, MCP via `@modelcontextprotocol/sdk` |
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

Current modules include: `agent`, `agent-type`, `analytics`, `auth`, `auth-provider`, `authorization`, `chat-completion`, `classifier`, `connected-app`, `connector`, `conversation`, `conversation-v2`, `database`, `document`, `email`, `evaluation`, `exceptions`, `governance`, `guardrails`, `health`, `indexing`, `logger`, `memory-cards`, `models`, `notifications`, `playbook-flow`, `project`, `rate-limiter`, `request-context`, `response`, `skill`, `system`, `team`, `telegram`, `tool`, `usage`, `user`, `user-group`, `whatsapp`, `widget-chat`, `workspace`, `worky`. Use the actual module name `playbook-flow`; do not create a parallel `playbook` module.

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

**Existing config namespaces:** `app`, `auth`, `jwt`, `database`, `email`, `storage`, `logging`, `health`, `notifications`, `workspace`, `indexing`, `conversation`, `conversation-v2`, `litellm`, `playbook-flow`, `telegram`, `microsoft`, `a2aAdmin`, `grpcSecurity`, `grpcSecurityV2`, `whatsapp`, `worky`, `memoryCards`.

Keep `src/config/*.config.ts`, `src/config/config.schema.ts`, `src/config/index.ts`, and `ConfigModule.forRoot({ load: [...] })` in sync. A config namespace loaded in `app.module.ts` but not exported from `src/config/index.ts` is a drift smell; a file exported but not loaded is likely dead code.

The **playbook-flow** config (`src/config/playbook-flow.config.ts`) is the most extensive: gRPC URLs, execution limits, token buffer, execution lease, delta patch, async design, and concurrency controls. Any new env var in this domain must be added to both the config file and `config.schema.ts` — missing entries cause silent fallback to defaults.

gRPC TLS/security is split by runtime: `grpcSecurity` covers shared services such as conversation v1, a2a-admin, and playbook-flow; `grpcSecurityV2` covers conversation-v2/Manus. Keep API keys, TLS mode, CA paths, and server-name overrides in the matching namespace.

All config keys read in services must be declared in the corresponding `<name>.config.ts`. If you find a service reading a key that is not in the config file (e.g. `playbook-flow.maxSseConnections`), add it — do not rely on fallback defaults.

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
| `ERR_1002`–`ERR_1009` | Generic HTTP (404, 401, 403, 409, 400, 429, 503, 410) |
| `ERR_1100`–`ERR_11xx` | Auth |
| `ERR_1200`–`ERR_12xx` | User |
| `ERR_1300`–`ERR_13xx` | Agent |
| `ERR_1400`–`ERR_14xx` | Chat / conversation |
| `ERR_1500`–`ERR_15xx` | External service |
| `ERR_1600`–`ERR_16xx` | System |
| `ERR_1700`–`ERR_17xx` | Usage / plan |
| `ERR_1800`–`ERR_18xx` | Notification |
| `ERR_1900`–`ERR_19xx` | Workspace |
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
| `ERR_3400`–`ERR_3408` | Widget chat |
| `ERR_3500`–`ERR_3530` | Worky |
| `ERR_3600`–`ERR_3671` | Governance |

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

---

## 9. Mongoose & Schemas

- Always `@Schema({ timestamps: true })`. Export `HydratedDocument<T>` as `<Name>Document`.
- Declare indexes next to the schema, not in services.
- Apply `toJSON` transform: `_id` → `id`, strip `__v`. The frontend expects `id`.
- Use strict typing (`!` on required, `?` on optional).

**Queries:** Prefer `.select()` projection over full documents. Use `.lean()` on read-heavy endpoints. Compound indexes for paginated queries. **Never** leak internal Mongo fields through the API.

**Persisted editable fields:** when adding a field users can edit, update every persistence/contract layer in one change: Mongoose schema defaults, create/update DTO validation, service mapping/serialization, public interfaces, frontend types, and any autosaved editor payload. Missing any layer causes silent data loss in autosaved UIs.

---

## 10. gRPC & Microservices

**Proto files** in `src/modules/<module>/proto/`. Currently four proto files:

| Module | File | Service | RPCs |
|--------|------|---------|------|
| `agent` | `a2a_admin.proto` | A2A admin | Admin/runtime integration |
| `conversation` | `chatbot.proto` | Messages only | — (shared types) |
| `conversation-v2` | `conversation.proto` | `ConversationV2` | 7 RPCs |
| `playbook-flow` | `playbook-flow.proto` | `PlaybookFlowRuntime` | 5 RPCs |

Any `.proto` change must be mirrored in `yellowstorm-adk/grpc/proto/`.

**Post-build:** every backend `.proto` file must be available from `dist/`. `nest-cli.json` copies proto assets, and `package.json`'s `postbuild` also copies selected proto files (`chatbot.proto`, `playbook-flow.proto` at the time of this guideline update). When adding a new proto file, verify both mechanisms and update `postbuild` when runtime path resolution depends on it.

**Backend acts as gRPC client** for ADK-backed services. Clients are built in services (e.g. `PlaybookFlowRuntimeClientService`, `ConversationV2ClientService`) via `OnModuleInit` using `@grpc/grpc-js` + `@grpc/proto-loader`.

**Worky exception:** Worky uses a separate FastAPI runtime over HTTP SSE and internal callback endpoints, not gRPC/proto. New AI-service integrations may use this pattern only when stream shape, callback auth, retry, and audit behavior are explicitly documented.

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

Worky governance is backend-owned. The runtime calls back through `POST /worky/internal/streams/{id}/governance/check`; resolution uses stream override, workspace policy, then default level. Every governance evaluation must write an audit event.

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
- **Named exports only** (no `export default` — gRPC/ESM boundaries behave better).
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
| New `.proto` field or file | `yellowstorm-adk/grpc/proto/` mirror + `postbuild` copy in `package.json` |

**Frozen contracts:** response envelope, error envelope, and pagination shape. Do not alter silently.

For persisted editable fields, treat schema, DTO, response serializer/interface, and frontend type/editor payload as one contract. Do not add a backend field without verifying the frontend can both send and read it when applicable.

Conversation-v2 sessions are backend-owned: Mongo `_id` is the wire `sessionId`, `aiSessionId` is runtime-only, event history is append-only with per-session `sequence`, and session-owned system workspaces must cascade-delete with the session.

---

## 24. Pre-PR Checklist

- [ ] Controller has `@ApiTags` + `@ApiBearerAuth` (unless `@Public`).
- [ ] DTOs decorated with `class-validator` + `@ApiProperty`.
- [ ] No direct `process.env` in services.
- [ ] Exceptions thrown from `@modules/exceptions` with proper `ErrorCode`.
- [ ] Mongoose schema: `timestamps`, indexes, `toJSON` transform (`_id` → `id`).
- [ ] Tests colocated as `*.spec.ts`; `npm test` passes.
- [ ] Proto changes mirrored in ADK, `postbuild` copies, contract validated.
- [ ] Proto files: all backend proto files (`a2a_admin.proto`, `chatbot.proto`, `conversation.proto`, `playbook-flow.proto`, plus new ones) copied in `postbuild`.
- [ ] `google.protobuf.Struct` fields wrapped with `toGrpcStruct()` — never assign a plain JS object.
- [ ] Frontend contract items synced per §23.
- [ ] Backend error codes mirrored in `front/src/lib/error-codes.ts` and EN+FR error locales.
- [ ] Ordered SSE/event streams expose cursor semantics and frontend resume/gap handling.
- [ ] Persisted editable fields are present in schema, DTO, serializer/interface, and frontend type/editor payload.
- [ ] No `console.log`; structured logs via `LoggerService`.
- [ ] Public endpoints rate-limited.
- [ ] Swagger annotations sufficient to reproduce the call from `/docs`.
- [ ] Commit: `<type>(<scope>): <subject>` (conventional commit).

---

## 25. Anti-Patterns

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
