# REST contracts, DTOs and errors

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 6. Validation & DTOs

**Global `ValidationPipe`** (`whitelist`, `forbidNonWhitelisted`, `transform`, `stopAtFirstError`).

**DTO conventions:**
- One class per payload (`Create*.dto.ts`, `Update*.dto.ts`, `*Query.dto.ts`). No reusing for create+update unless identical.
- Decorate with `class-validator` **and** `@ApiProperty` / `@ApiPropertyOptional`.
- Use `@Type(() => ChildDto)` for nested objects needing validation.
- For partial updates prefer `PartialType(CreateXDto)`.
- Query DTOs: `@IsOptional()` + `@Type(() => Number)` for numeric query params.
- Validation failures → `ERR_1001`.

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
| `ERR_3700`–`ERR_3710` | Semantic model |
| `ERR_3800`–`ERR_3806` | Conversation V2 template catalog (incl. category codes `ERR_3800`–`ERR_3801` and template codes `ERR_3802`–`ERR_3806`) |

Adding a code: pick the right range, add to backend enum, mirror it in `front/src/lib/error-codes.ts`, and add EN+FR messages in frontend `errors.json`. Frontend drift is easy to miss because unknown backend codes still reach the UI as generic errors.

### Pagination
Query: `?page=1&limit=10` (shared `PaginationDto`). Response wraps items + `pagination: { page, limit, total, totalPages }` inside `data`.

### Headers
`X-Request-ID`, `X-Correlation-ID` (response). `X-RateLimit-*` + `Retry-After` on rate-limited routes.

## 11. Errors & Exceptions

Custom hierarchy in `src/modules/exceptions/exceptions/`. All extend `AppException extends HttpException`:
```ts
throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
throw new ValidationException([{ field: 'email', message: 'Invalid email' }]);
```

**Never** throw raw `Error` in controllers/services reachable from a controller.

`GlobalExceptionFilter` catches everything: `AppException` → envelope as-is; `HttpException` → mapped code; `ValidationPipe` → `ERR_1001` + details; unknown → `ERR_1000` (logged, not leaked). Every exception logged with `requestId`, `userId`, path, method, status, code.

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
