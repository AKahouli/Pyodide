# YellowStorm Backend — Coding Guidelines

> Audience: backend developers contributing to `YellowStorm/back`, and frontend developers who need to understand the HTTP/SSE/gRPC contracts the backend exposes.
> Goal: produce code that is **compliant** with existing patterns, **maintainable**, and **coherent** across modules.
>
> **Golden rule:** before inventing a pattern, look at a sibling module (`auth`, `conversation`, `playbook`, `workspace`). If a convention already exists, follow it. Do not create a second way to do the same thing.

---

## 1. Stack

| Layer | Tech |
|-------|------|
| Framework | NestJS 10 on Node 20+ |
| HTTP server | Express (`@nestjs/platform-express`) |
| Validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| ORM | Mongoose 8 (`@nestjs/mongoose`) |
| Auth | `@nestjs/passport` + `passport-jwt` + `@nestjs/jwt` |
| Config | `@nestjs/config` + Joi env validation |
| Docs | `@nestjs/swagger` (gated in non-prod) |
| Scheduling | `@nestjs/schedule` |
| Health | `@nestjs/terminus` |
| gRPC | `@grpc/grpc-js` + `@grpc/proto-loader` (client to the Python ADK) |
| Realtime | SSE via RxJS `Observable<MessageEvent>` (+ `@nestjs/websockets` + socket.io available) |
| Storage | `@azure/storage-blob` (SAS URLs) |
| Email | `nodemailer` (SMTP) or Microsoft Graph (Outlook, `@azure/msal-node`) |
| Security | `helmet`, `compression`, `cookie-parser`, `bcrypt` |
| Testing | Jest 29 + `@nestjs/testing` (`*.spec.ts`) |

**Do not add a new library** without confirming nothing already in `package.json` covers it.

---

## 2. Project Structure

```
back/src/
├── main.ts                     # Bootstrap: middleware, pipes, CORS, Swagger, shutdown
├── app.module.ts               # Root module: config, Mongoose, APP_GUARD, feature modules
├── common/
│   ├── decorators/             # @Public()
│   ├── interceptors/           # LoggingInterceptor, TransformInterceptor
│   ├── dto/                    # Shared DTOs (PaginationDto, ...)
│   ├── services/
│   ├── utils/
│   └── index.ts
├── config/
│   ├── *.config.ts             # registerAs('<ns>', () => ({...}))
│   ├── config.schema.ts        # Joi validation for process.env
│   └── index.ts
└── modules/
    ├── auth/                   # Strategies, guards, sessions, JWT, password reset
    ├── authorization/          # Roles, permissions (RBAC)
    ├── auth-provider/          # OAuth providers (Microsoft, ...)
    ├── conversation/           # Chat, SSE stream, gRPC client, messages, proto/
    ├── playbook/               # Playbooks + executions
    ├── workspace/              # Workspaces + documents
    ├── user/, agent/, agent-type/, skill/, tool/, connector/
    ├── models/                 # LLM model catalog
    ├── usage/                  # Quotas + usage tracking
    ├── notifications/          # Persisted notifications + SSE stream
    ├── email/                  # SMTP / Graph email service
    ├── logger/                 # Structured logger + MongoDB persistence
    ├── request-context/        # AsyncLocalStorage request context + requestId middleware
    ├── rate-limiter/           # Per-route rate limit guard + decorator
    ├── response/               # Response envelope interceptor
    ├── exceptions/             # Custom exception hierarchy + global filter + error codes
    ├── database/               # Mongo connection module
    ├── document/               # Azure blob uploads + SAS URLs
    ├── indexing/               # Workspace indexing pipeline
    ├── analytics/, health/, system/
```

### Path aliases (tsconfig.json + jest)

Always import via aliases — **never** `../../../`:

```ts
import { JwtAuthGuard } from '@modules/auth/guards/jwt-auth.guard';
import { LoggerService } from '@modules/logger/logger.service';
import { PaginationDto } from '@common/dto/pagination.dto';
import authConfig from '@config/auth.config';
```

Aliases: `@/*`, `@modules/*`, `@common/*`, `@config/*`.

---

## 3. Module Anatomy

Every feature module follows the same layout. Copy it for new modules.

```
src/modules/<name>/
├── <name>.module.ts            # @Module: imports, controllers, providers, exports
├── controllers/
│   ├── *.controller.ts
│   └── *.controller.spec.ts    # colocated tests
├── services/
│   ├── *.service.ts
│   └── *.service.spec.ts
├── dto/                        # class-validator DTOs (request payloads + query)
├── schemas/                    # Mongoose schemas (@Schema, @Prop)
├── interfaces/                 # TS contracts (optional — some modules inline)
├── guards/                     # CanActivate implementations
├── decorators/                 # Param / metadata decorators
├── strategies/                 # Passport strategies (auth only)
├── proto/                      # gRPC .proto (conversation only, for now)
├── constants/                  # Static maps / enums not belonging in a DTO
├── utils/                      # Pure helpers
└── README.md                   # What the module does + notable decisions
```

### Module file template

```ts
@Module({
  imports: [
    ConfigModule.forFeature(conversationConfig),
    MongooseModule.forFeature([
      { name: Conversation.name, schema: ConversationSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
    forwardRef(() => AuthModule),  // avoid circular imports
    ModelsModule,
  ],
  controllers: [ConversationController, MessageController, StreamController],
  providers: [
    ConversationService,
    MessageService,
    StreamService,
    ConversationOwnerGuard,
    SseAuthGuard,
  ],
  exports: [ConversationService, MessageService, StreamService],
})
export class ConversationModule {}
```

**Rules**
- Export services that other modules depend on. Keep internal providers unexported.
- Use `forwardRef(() => OtherModule)` only when a circular dependency is unavoidable. Prefer extracting shared logic to a third module.
- Register schemas with `MongooseModule.forFeature(...)` **inside the module that owns them**. Cross-module access is through the owning service, not by re-registering the schema.

---

## 4. Bootstrap (`main.ts`)

Global configuration is centralised. **Do not** re-apply middleware or pipes per-controller unless absolutely necessary.

Applied globally in `src/main.ts`:
- `helmet()` with CSP (default-src `'self'`, style-src allows inline, img-src `'self' data: https:`); COEP disabled for compatibility.
- `compression()` (threshold 1 KB).
- `cookieParser()` for the HTTP-only refresh token cookie.
- CORS: origins from `CORS_ORIGIN` (comma-separated), `credentials: true`, exposes `Set-Cookie`.
- URI versioning: `/v1/` prefix, enabled via `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })`.
- Global prefix: `api` (env `API_PREFIX`). Final route shape: `/api/v1/<resource>`.
- `ValidationPipe` globally (see §6).
- `SwaggerModule.setup('docs', ...)` mounted at `/docs` — **non-production only**.
- Graceful shutdown on `SIGTERM`, `SIGINT`, `uncaughtException`, `unhandledRejection`, with structured logging.

**Do not** change bootstrap behaviour inside a feature module.

---

## 5. Configuration

### 5.1 Pattern: `registerAs` namespaces

Every config lives in `src/config/<name>.config.ts`:

```ts
// src/config/auth.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  bcryptRounds: Number(process.env.AUTH_BCRYPT_ROUNDS ?? 12),
  emailVerificationExpiry: process.env.AUTH_EMAIL_VERIFICATION_EXPIRY ?? '24h',
  refreshTokenCookieName: process.env.AUTH_REFRESH_COOKIE_NAME ?? 'refresh_token',
  cookieSameSite: (process.env.AUTH_COOKIE_SAME_SITE ?? 'lax') as 'strict' | 'lax' | 'none',
}));
```

### 5.2 Loading & injection

Configs are loaded at the app root in `app.module.ts`:

```ts
ConfigModule.forRoot({
  isGlobal: true,
  load: [appConfig, jwtConfig, authConfig, microsoftConfig, healthConfig, /* ... */],
  validationSchema: envValidationSchema, // Joi
  validationOptions: { abortEarly: false, allowUnknown: true },
})
```

Inject into services using **typed config**:

```ts
constructor(
  @Inject(authConfig.KEY)
  private readonly auth: ConfigType<typeof authConfig>,
) {}
```

Or via `ConfigService` when the value is one-off:

```ts
this.config.get<string>('jwt.secret')
```

### 5.3 Env validation

All env vars ship through Joi in `src/config/config.schema.ts`. **Add new env vars here**; the app refuses to boot if required vars are missing. Production requires `JWT_SECRET`, `ENCRYPTION_KEY`, `MONGODB_URI`, storage + email secrets.

Frontend-visible env keys (CORS, cookie SameSite, API prefix) are the interface between the two apps — coordinate changes with the frontend team.

---

## 6. Validation & DTOs

### 6.1 Global `ValidationPipe` (set in `main.ts`)

```ts
new ValidationPipe({
  whitelist: true,              // strips unknown props
  forbidNonWhitelisted: true,   // 400 on unknown props
  transform: true,              // applies @Type transformations
  transformOptions: { enableImplicitConversion: true },
  stopAtFirstError: true,
})
```

### 6.2 DTO conventions

- **One class per payload**. No reusing a DTO for both create and update unless the shape is strictly identical.
- Name: `Create*.dto.ts`, `Update*.dto.ts`, `*Query.dto.ts`.
- Always decorate with both validation (`class-validator`) and Swagger (`@ApiProperty` / `@ApiPropertyOptional`).

```ts
export class CreateConversationDto {
  @ApiPropertyOptional({ maxLength: 200, default: 'New Conversation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsArray()
  @IsMongoId({ each: true })
  workspaces?: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ParticipantDto)
  participants?: ParticipantDto[];
}
```

- Use `@Type(() => ChildDto)` any time a nested object needs validation.
- Use `@Transform(({ value }) => …)` sparingly, only when a format change is mandatory.
- For partial updates prefer `PartialType(CreateXDto)` over hand-crafting.
- Query DTOs use `@IsOptional()` + `@Type(() => Number)` for numeric query params (implicit conversion covers most cases).

Validation failures emerge as `ERR_1001` (see §11).

---

## 7. HTTP API Contract (for frontend consumers)

### 7.1 Routing

- Base URL: `${API_PREFIX}/v1/<resource>` → `/api/v1/conversations`, `/api/v1/playbooks`, …
- REST verbs: `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`.
- IDs in path params, filters in query, body for payloads.
- Controller pattern:

```ts
@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class ConversationController {
  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query() query: ConversationQueryDto) { /* … */ }

  @Get(':id')
  @UseGuards(ConversationOwnerGuard)
  findOne(@Param('id') id: string) { /* … */ }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateConversationDto) { /* … */ }
}
```

### 7.2 Response envelope

Every successful response is wrapped by the global response interceptor:

```json
{
  "success": true,
  "data": <T>,
  "meta": {
    "timestamp": "2026-04-22T10:00:00.000Z",
    "requestId": "uuid-v4",
    "path": "/api/v1/conversations",
    "duration": 123
  }
}
```

Frontend consumers: unwrap `response.data.data` (already the pattern in `front/src/lib/api/client.ts`).

Opt-out of wrapping is allowed via a dedicated decorator (used only for raw file streams / SSE). When you opt out, document why.

### 7.3 Error envelope

Emitted by the global exception filter in `src/modules/exceptions/filters/`:

```json
{
  "success": false,
  "error": {
    "code": "ERR_1002",
    "message": "Conversation not found",
    "statusCode": 404,
    "timestamp": "2026-04-22T10:00:00.000Z",
    "path": "/api/v1/conversations/xyz",
    "method": "GET",
    "requestId": "uuid-v4",
    "details": [{ "field": "id", "message": "Invalid ObjectId" }]
  }
}
```

`details` is populated for validation errors. In production, internal stack traces are never exposed.

### 7.4 Error code registry

Codes live in `src/modules/exceptions/constants/error-codes.ts` as a string enum with numeric ranges. The frontend mirrors this in `front/src/lib/error-codes.ts` — **keep them in sync**.

| Range | Meaning |
|-------|---------|
| `ERR_1000` | Internal error |
| `ERR_1001` | Validation error |
| `ERR_1002`–`ERR_1008` | Generic HTTP (404, 401, 403, 409, 400, 429, 503) |
| `ERR_1100`–`ERR_11xx` | Auth (invalid credentials, expired token, session revoked, maintenance, …) |
| `ERR_1200`–`ERR_12xx` | User |
| `ERR_1300`–`ERR_13xx` | Agent |
| `ERR_1400`–`ERR_14xx` | Chat / conversation |

Adding a new error code: pick the right range, add to the enum, add the English + French message in the frontend `errors.json`.

### 7.5 Pagination

- Request query: `?page=1&limit=10` (shared `PaginationDto` in `@common/dto/pagination.dto.ts`).
- Controllers return the collection plus a `pagination` block:

```json
{
  "data": [ /* items */ ],
  "pagination": { "page": 1, "limit": 10, "total": 42, "totalPages": 5 }
}
```

The envelope interceptor wraps that into `meta.requestId`/`timestamp`; the `pagination` block lives inside `data`.

### 7.6 Request/response headers

- `X-Request-ID` (response) — echoed back to the caller for correlation. Echo it from the client in follow-ups if provided.
- `X-Correlation-ID` (response) — cross-service trace ID.
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` — on rate-limited routes.

---

## 8. Authentication & Authorization

### 8.1 JWT + session model

- **Access token**: short-lived (default `15m`), `Authorization: Bearer <jwt>`. Payload carries `userId`, `sessionId`, `type: 'access'`, `permissions[]`, `roleNames[]`, `permissionsVersion`.
- **Refresh token**: long-lived (default `7d`), HTTP-only cookie named `refresh_token` (configurable). Cookie attributes: `httpOnly: true`, `secure: true` (production), `sameSite: 'strict'|'lax'|'none'` (configurable). Rotated on every refresh.
- `POST /api/v1/auth/refresh` — rotates the token pair. Frontend relies on this via its axios 401-retry queue.
- Sessions are persisted server-side; `JwtStrategy` validates both the token signature and that the session is still active (e.g. not revoked after password change).

### 8.2 Global guard

```ts
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
]
```

Every route is authenticated **by default**. Opt-out requires an explicit decorator:

```ts
@Public()
@Post('login')
login(@Body() dto: LoginDto) { /* … */ }
```

The `@Public()` decorator sets metadata (`IS_PUBLIC_KEY`). `JwtAuthGuard` reads it via `Reflector` and skips the check. OPTIONS requests also bypass.

### 8.3 Current user / permissions

- `@CurrentUser()` — param decorator resolving to the authenticated user (from `request.user`).
- `@RequirePermissions('playbook.read')` — guarded by `PermissionsGuard` from `src/modules/authorization/`.
- `@Roles('admin')` — guarded by `RolesGuard`. Use sparingly; prefer permission checks.

**Never** read raw JWT claims in controllers; always go through `@CurrentUser()`.

### 8.4 Passwords & secrets

- Hash with `bcrypt`, rounds from `AUTH_BCRYPT_ROUNDS` (default 12).
- Never log tokens, password hashes, or refresh cookies.
- Never include secrets in error responses or Swagger examples.

---

## 9. Mongoose & Schemas

### 9.1 Schema template

```ts
export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ type: String, trim: true, maxlength: 200, default: 'New Conversation' })
  title!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Message' }], default: [] })
  messages!: Types.ObjectId[];

  @Prop({ type: Boolean, default: false })
  isArchived!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ createdBy: 1, lastMessageAt: -1 });

ConversationSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
```

**Rules**
- Always use `@Schema({ timestamps: true })` unless the collection truly has no temporal dimension.
- Always export `HydratedDocument<X>` as `XDocument`.
- Declare indexes **next to the schema**, not scattered across services.
- Apply a `toJSON` transform that renames `_id` → `id` and strips `__v`. The frontend expects `id`, not `_id`.
- Use strict typing (`!` on required fields, `?` on optional).

### 9.2 Queries

- Prefer explicit projection (`.select('title updatedAt')`) over returning full documents to the frontend.
- Use `.lean()` on read-heavy endpoints that don't need Mongoose hydration.
- Compound indexes for paginated queries (`{ ownerId: 1, createdAt: -1 }`).
- **Never** expose internal Mongo fields (`__v`, secrets) through the API — DTO-shape responses explicitly.

---

## 10. gRPC & Microservices

### 10.1 Proto files

- Location: `src/modules/<module>/proto/<name>.proto`. Currently: `conversation/proto/chatbot.proto`.
- Services: `ChatbotService.RunAgentTeam(stream)`, `RunPlaybookWorkflow(stream)`, `GenerateConversationName`, etc.
- **Any change to a `.proto` file must be mirrored in `yellowstorm-adk/grpc/proto/`** — the Python ADK owns the server implementation. See the repo's contract-validation protocol.

### 10.2 Client setup

The backend acts as a gRPC **client**. Clients are built manually with `@grpc/grpc-js` + `@grpc/proto-loader` inside a service (e.g. `StreamService` in `modules/conversation/services/`), usually in `OnModuleInit`. Pattern:

```ts
@Injectable()
export class StreamService implements OnModuleInit {
  async onModuleInit() {
    const packageDef = await protoLoader.load(resolve(__dirname, '../proto/chatbot.proto'), { ... });
    const proto = grpc.loadPackageDefinition(packageDef) as any;
    this.client = new proto.chatbot.ChatbotService(
      this.config.get('CONVERSATION_GRPC_URL'),
      grpc.credentials.createInsecure(),
    );
  }
}
```

### 10.3 Post-build proto copy

`package.json`'s `postbuild` script copies `.proto` files into `dist/modules/conversation/proto/`. This is **mandatory** — without it the compiled client cannot locate the proto at runtime. If you add a new `.proto` file, extend `postbuild` to copy it.

### 10.4 Handling streams

- Map gRPC stream events to RxJS `Observable`/`Subject` before exposing to controllers.
- Always handle `error`, `end`, and client disconnect; release resources on each.
- Translate gRPC status codes to the domain error codes (`ERR_14xx` for chat) — don't leak raw gRPC codes to the frontend.

---

## 11. Errors & Exceptions

### 11.1 Custom exception hierarchy

Located in `src/modules/exceptions/exceptions/`. All extend `AppException extends HttpException`:

```ts
export class AppException extends HttpException {
  code: ErrorCode;
  details?: ErrorDetail[];
  toJSON() { /* envelope body */ }
}

export class NotFoundException extends AppException { /* … */ }
export class ValidationException extends AppException { /* … */ }
export class BusinessException extends AppException { /* 409 / 400 business-rule errors */ }
// …
```

**Use these — do not throw raw `Error`** in controllers or services reachable from a controller:

```ts
throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
throw new ValidationException([{ field: 'email', message: 'Invalid email' }]);
throw new ForbiddenException(ErrorCode.AUTH_FORBIDDEN, 'Not allowed');
```

### 11.2 Global filter

`GlobalExceptionFilter` catches everything, maps:
- `AppException` → envelope as-is.
- Nest `HttpException` → envelope with mapped code (400/401/…).
- `ValidationPipe` errors → `ERR_1001` + `details`.
- Anything else → `ERR_1000` (logged at `error`, not leaked to client).

Every thrown exception is logged with `requestId`, `userId` (if known), path, method, status, code.

### 11.3 Frontend contract

The error envelope is part of the API. If you add a new error code, update:
1. `src/modules/exceptions/constants/error-codes.ts` (backend).
2. `front/src/lib/error-codes.ts` (frontend enum).
3. `front/src/modules/localization/locales/{en,fr}/errors.json` (translations).

---

## 12. Interceptors, Pipes, Guards, Filters

Set once, used globally:

| Component | Location | Purpose |
|-----------|----------|---------|
| `ValidationPipe` | `main.ts` (global) | DTO validation (§6) |
| Response envelope interceptor | `src/modules/response/` | Wraps responses (§7.2) |
| `LoggingInterceptor` | `src/common/interceptors/logging.interceptor.ts` | Request timing + log |
| `TransformInterceptor` | `src/common/interceptors/transform.interceptor.ts` | Shared response transforms |
| `GlobalExceptionFilter` | `src/modules/exceptions/filters/` | Error envelope (§11) |
| `JwtAuthGuard` | `src/modules/auth/guards/` | Default auth (§8) |
| `RateLimitGuard` | `src/modules/rate-limiter/guards/` | Per-route rate limiting (§14) |

**Per-route guards** (e.g. `ConversationOwnerGuard`, `WorkspaceMemberGuard`) live inside the owning module. Apply with `@UseGuards(...)`; keep the ownership check local to the guard.

---

## 13. Request Context & Logging

### 13.1 Request context

`src/modules/request-context/` provides an AsyncLocalStorage-backed service. The `RequestIdMiddleware`:
- Extracts or generates `X-Request-ID` (honours `x-request-id`, `x-amzn-trace-id`).
- Generates `X-Correlation-ID` if missing.
- Attaches them to `req.context` and as response headers.
- Stores the context in AsyncLocalStorage for the lifetime of the request.

Read from services via the injected `RequestContextService` — **don't thread the request object through the call stack**.

### 13.2 Logger

- `LoggerService` (`src/modules/logger/`) is `@Global()` — inject it anywhere.
- It extends Nest's logger, adds structured JSON output and an optional MongoDB sink (separate `logging` connection, buffered, 30-day TTL).
- Use scoped loggers per class:

```ts
constructor(private readonly logger: LoggerService) {
  this.logger.setContext(MyService.name);
}

this.logger.info('stream.started', { conversationId, requestId: ctx.requestId });
this.logger.error('stream.failed', err, { conversationId });
```

**Never use `console.log`.** Never log secrets, tokens, full user objects, or PII beyond user id.

---

## 14. Rate Limiting

- Decorator-driven. Applied at the handler level:

```ts
@RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'auth:register' })
@Post('register')
register(@Body() dto: RegisterDto) { /* … */ }
```

- Identifier: `${userId ?? ip}:${endpoint}` by default; `keyPrefix` scopes the window.
- The guard sets `X-RateLimit-*` headers and throws `TooManyRequestsException` (`ERR_1007`) when the window is exhausted.
- Public, unauthenticated endpoints (register, login, password reset) **must** be rate-limited.
- Skip for health checks via `@RateLimitSkip()`.

---

## 15. Real-time & SSE

### 15.1 SSE endpoints

Two primary streams consumed by the frontend:
- `GET /api/v1/conversations/stream` — conversation + agent responses.
- `GET /api/v1/notifications/stream` — system notifications.

### 15.2 Pattern

```ts
@Sse('stream')
@Public()
@StreamAuth()                       // query-param or header JWT auth
stream(@Req() req: RequestWithSseUser): Observable<MessageEvent> {
  const disconnect$ = new Subject<void>();
  req.on('close', () => disconnect$.next());

  return this.gateway.registerConnection(userId, connectionId, disconnect$);
}
```

**Rules**
- SSE auth goes through a dedicated guard (`SseAuthGuard` / `StreamAuth` decorator), not `JwtAuthGuard`, because browsers cannot set `Authorization` on `EventSource`.
- Always clean up on `req.on('close')` — clients disconnect silently.
- Cap per-user connections (the frontend issues a `TOO_MANY_TABS` error on eviction).
- Emit typed events (`connected`, `component`, `error`, …). Keep the event schema in sync with the frontend `stream.ts`.
- On auth token refresh, the frontend calls `notificationsService.reconnectWithNewToken()` — expect short-lived reconnects.

### 15.3 Websockets

`@nestjs/platform-socket.io` is available but not the current default. Do not open WebSocket gateways without agreeing on the event schema with the frontend team.

---

## 16. Scheduling

`ScheduleModule.forRoot()` is registered in `app.module.ts`. Use the decorators:

```ts
@Cron(CronExpression.EVERY_5_MINUTES)
syncHealth() { /* … */ }

@Interval(30_000)
flushLogs() { /* … */ }

@Timeout(5_000)
warmCache() { /* … */ }
```

**Rules**
- All scheduled jobs must log start/end at `debug` and failures at `error`.
- Scheduled jobs must be idempotent (the app may run as multiple replicas).
- Long-running jobs should short-circuit if a run is already in flight (in-memory flag).

---

## 17. Email

- Service: `EmailService` in `src/modules/email/`.
- Providers: SMTP (default, `nodemailer`) or Microsoft Graph (for Outlook users via `@azure/msal-node`). Selected by `EMAIL_PROVIDER=smtp|outlook`.
- Retry: up to 3 attempts with exponential backoff.
- Templates: HTML + text variants. Every user-facing template must support EN and FR.
- **Never** send email directly from a controller — go through `EmailService`, which handles retry, logging, and health state.

---

## 18. File Storage (Azure Blob)

- Service: `DocumentService` in `src/modules/document/`.
- Pattern: **pre-signed SAS URLs** for direct browser upload.
  1. `POST /.../documents/upload-url` → returns `{ uploadUrl, blobPath }` (SAS, `PUT`, ~60 min expiry).
  2. Frontend `PUT`s the file directly to Azure.
  3. `POST /.../documents/confirm` → backend finalises metadata.
- Container: `documents` (configurable).
- Limits: `STORAGE_MAX_FILE_SIZE_MB` (default 50).
- CORS on the storage account must allow the frontend origin — see `front/README.md`.

**Rules**
- Never proxy large uploads through NestJS.
- Always validate MIME + size server-side before issuing a SAS URL.
- SAS URLs should be as narrow as possible (single blob, `cw` permissions, short expiry).

---

## 19. Health Checks

Exposed by `src/modules/health/`:

| Route | Purpose |
|-------|---------|
| `GET /api/v1/health` | Full check — 503 if unhealthy |
| `GET /api/v1/health/live` | Kubernetes liveness |
| `GET /api/v1/health/ready` | Kubernetes readiness |
| `GET /api/v1/health/history?minutes=60` | Recent results |
| `GET /api/v1/health/stats?minutes=60` | Aggregated stats |

Current checks: MongoDB connection, gRPC conversation service, email provider, Azure Blob, LiteLLM. When adding a new external dependency, add a corresponding indicator to the health module.

---

## 20. Testing

### 20.1 Stack

- Jest 29 + `@nestjs/testing`.
- Tests colocated as `*.spec.ts`. Root: `rootDir: src` (see `package.json > jest`).
- Run: `npm test`, `npm run test:cov`, `npm run test:watch`, `npm run test:e2e`.

### 20.2 Patterns

```ts
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModelMock },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: LoggerService, useValue: loggerMock },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  beforeEach(() => jest.clearAllMocks());
});
```

**Rules**
- Mock Mongoose models with `getModelToken(Model.name)` + a chainable `.select().lean().exec()` mock.
- Don't hit a real Mongo. If you truly need one, mark the test e2e.
- Never mock what you own if it's trivial — import it directly.
- Test the error path too: `expect(...).rejects.toBeInstanceOf(NotFoundException)`.
- Controller tests should focus on wiring (guards, DTO → service arg mapping). Push business logic into services and test there.

---

## 21. TypeScript Conventions

- `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.
- **Named exports only.** No `export default` (the compiled gRPC/ESM boundaries behave better).
- `type` for DTO shapes, payload objects, config types (`ConfigType<typeof xConfig>`).
- `interface` for service contracts and public module surfaces.
- `enum` (string-valued) for error codes and status enums that cross the API boundary. `as const` objects for internal static maps.
- Mongoose document types are always `HydratedDocument<T>` — exported as `<Name>Document`.
- `!` for required schema props; `?` for optional. No `any`. Prefer `unknown` + narrowing.
- Return types **explicit on public methods** (controllers, exported service methods).

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

Paths are always `src/modules/<kebab-case>/...`.

---

## 23. Security Checklist

- Every route authenticated by default (APP_GUARD); `@Public()` only on login, register, password reset, public share endpoints, and health.
- Public endpoints are rate-limited.
- DTO validation is mandatory — no `@Body() dto: any`.
- Secrets only from `ConfigService`, never from `process.env` directly inside a service.
- Bcrypt for passwords; never store plaintext.
- Refresh tokens: `httpOnly`, `secure` in prod, `sameSite` configured.
- Never reflect user input in an error message without escaping; the envelope already handles this.
- SAS URLs: narrowest permission + shortest expiry that works.
- Helmet CSP stays enabled; do not loosen without security review.
- Do not log tokens, passwords, full cookies, or PII.

---

## 24. Frontend ↔ Backend Contract (single source of truth)

Changes that cross the boundary require paired updates. Do not land a backend change that breaks the frontend without coordinating.

| Change | Frontend touchpoint |
|--------|---------------------|
| New REST endpoint | `front/src/lib/api/config.ts` (`API_ENDPOINTS`) + module `api.ts` |
| New DTO / schema field | Frontend types mirroring the response shape |
| New error code | `front/src/lib/error-codes.ts` + `locales/.../errors.json` |
| New SSE event type | `front/src/modules/conversation/stream.ts` (or notifications service) |
| Change cookie name / attrs | CORS + `credentials` + `sameSite` must match frontend expectations |
| Change versioning / prefix | Frontend `VITE_API_URL` / `env.sh` placeholder |
| New `.proto` field | `yellowstorm-adk/grpc/proto/` **and** backend + proto-copy in `postbuild` |

The response envelope, error envelope, and pagination shape are frozen contracts. Do not alter them silently.

---

## 25. Pre-PR Checklist

- [ ] New endpoint lives in the right module; controller has `@ApiTags` + `@ApiBearerAuth` (unless `@Public`).
- [ ] DTOs decorated with both `class-validator` and `@ApiProperty`.
- [ ] No direct `process.env` access in services — goes through `ConfigService` / typed config.
- [ ] Exceptions thrown are from `@modules/exceptions` with a proper `ErrorCode`.
- [ ] Mongoose schema has `timestamps`, indexes declared, `toJSON` transform mapping `_id` → `id`.
- [ ] Added tests colocated as `*.spec.ts`. `npm test` passes.
- [ ] `.proto` changes: mirrored in the ADK, `postbuild` still copies, contract validated.
- [ ] Frontend contract items (endpoints, error codes, SSE events) kept in sync per §24.
- [ ] No `console.log`; structured logs via `LoggerService`.
- [ ] Public / unauthenticated endpoint? Rate limit applied.
- [ ] Swagger annotations sufficient to reproduce the call from `/docs`.
- [ ] Commit message: `<type>(<scope>): <subject>` — conventional commit types.

---

## 26. Anti-Patterns (reject in review)

- Throwing raw `Error` or `HttpException` without an `ErrorCode`.
- Reading `process.env` inside services or controllers.
- Returning Mongoose documents with `_id`/`__v` leaking through to the API.
- Creating a second axios instance or a second gRPC client to the same service.
- Applying `ValidationPipe`, `ClassSerializerInterceptor`, or auth guards controller-by-controller when they are already global.
- `@Body() dto: any`, `@Query() q: Record<string, unknown>`, or any `any`.
- Re-registering a schema in a consuming module instead of injecting the owning service.
- Direct use of `console.*` or `toast`-like libraries (this is the backend).
- Large uploads proxied through the Node process instead of SAS URLs.
- Silent swallowing of errors (`catch { /* ignore */ }`).
- Adding an env var without adding it to `config.schema.ts` Joi validation.
- Adding a new response or error envelope shape "just for this endpoint".
- Breaking API/proto contracts without updating the frontend and the ADK in the same change set.
