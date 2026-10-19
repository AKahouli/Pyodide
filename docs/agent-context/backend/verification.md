# Backend verification and prohibited patterns

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 20. Testing

Jest 29 + `@nestjs/testing`. Tests colocated as `*.spec.ts`. Run: `npm test`, `npm run test:cov`, `npm run test:e2e`.

**Rules:**
- Mock Mongoose models with `getModelToken(Model.name)` + chainable `.select().lean().exec()` mock. Don't hit a real Mongo.
- Test error paths: `expect(...).rejects.toBeInstanceOf(NotFoundException)`.
- Controller tests focus on wiring (guards, DTO → service arg mapping). Push business logic into services.
- Never mock what you own if it's trivial — import it directly.

## 25. Pre-PR Checklist

- [ ] Controller has `@ApiTags` + `@ApiBearerAuth` (unless `@Public`).
- [ ] DTOs decorated with `class-validator` + `@ApiProperty`.
- [ ] No direct `process.env` in services.
- [ ] Exceptions thrown from `@modules/exceptions` with proper `ErrorCode`.
- [ ] Mongoose schema: `timestamps`, indexes, `toJSON` transform (`_id` → `id`).
- [ ] Postgres schema change: Drizzle schema updated in `src/modules/postgres/schema/`, migration generated into `./drizzle/`, and store mapper/consumers updated in the same change set (see [domain pattern 24.5](persistence.md)).
- [ ] Tests colocated as `*.spec.ts`; `npm test` passes.
- [ ] Proto changes mirrored in ADK when applicable; standalone `dist/`, Docker packaging, and both runtime sides validated.
- [ ] Proto packaging: all backend proto files (`a2a_admin.proto`, `chatbot.proto`, `conversation.proto`, `playbook-flow.proto`, `companion_ai.proto`, plus new ones) exist in standalone `dist/` and the production image; update `postbuild` and Docker copies as required.
- [ ] `google.protobuf.Struct` fields wrapped with `toGrpcStruct()` — never assign a plain JS object.
- [ ] Frontend contract items synced per [related guidance](api-contracts.md).
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
