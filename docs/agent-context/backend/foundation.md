# Backend structure and TypeScript conventions

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 1. Stack

| Layer | Tech |
|-------|------|
| Framework | NestJS 10, Express, `@nestjs/config` + Joi env validation |
| Validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| ORM | Mongoose 8 (`@nestjs/mongoose`) |
| Auth | `@nestjs/passport` + `passport-jwt` + `@nestjs/jwt`, bcrypt |
| Docs | `@nestjs/swagger` (gated in non-prod) |
| Scheduling | `@nestjs/schedule` |
| Health | Custom (not `@nestjs/terminus` — see [related guidance](operations.md)) |
| gRPC | `@grpc/grpc-js` + `@grpc/proto-loader` (client to Python ADK) |
| Realtime | SSE via RxJS `Observable<MessageEvent>`, manual SSE, HTTP fetch streams, Socket.IO for WhatsApp pairing, browser sessions, and app runtime |
| Storage | S3/Ceph via `@aws-sdk/client-s3` + presigned URLs; legacy Azure Blob dependency may exist |
| Email | `nodemailer` (SMTP) or Microsoft Graph (`@azure/msal-node`) |
| AI runtimes | gRPC ADK services, MCP via `@modelcontextprotocol/sdk` |
| WhatsApp | `@whiskeysockets/baileys`, `socket.io`, `qrcode` |
| Relational storage | `pg` + `drizzle-orm` (conversation domain — see [domain pattern 24.5](persistence.md); memory-cards and other Postgres-backed features) |
| Security | `helmet`, `compression`, `cookie-parser` |
| Testing | Jest 29 + `@nestjs/testing` (`*.spec.ts`) |

**Do not add a new library** without confirming nothing already in `package.json` covers it.

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

## 21. TypeScript Conventions

- `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`.
- Use named exports by default; gRPC/ESM boundaries must not depend on ambiguous default imports. Nest `registerAs()` configuration factories are the established exception and may use default exports.
- `type` for DTO shapes, payload objects, config types. `interface` for service contracts and public module surfaces. `enum` (string-valued) for error codes and API-boundary enums; `as const` for internal static maps.
- Mongoose document types: `HydratedDocument<T>`, exported as `<Name>Document`.
- `!` for required schema props, `?` for optional. No `any` — prefer `unknown` + narrowing.
- Explicit return types on public methods (controllers, exported service methods).

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
