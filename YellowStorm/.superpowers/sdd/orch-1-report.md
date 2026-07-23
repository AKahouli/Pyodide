# orch-1: Dedicated AgentOrchestrator gRPC client

## What was built

New, self-contained gRPC client for the worky module's `AgentOrchestrator` service (proto
`src/modules/worky/proto/orchestrator.proto`, package `yellowstorm.orchestrator.v1`),
mirroring the conversation-v2 gRPC client pattern exactly.

Files created:

- `back/src/config/worky-orchestrator.config.ts` — `registerAs('workyOrchestrator', ...)`.
  `grpcUrl` (`WORKY_ORCHESTRATOR_GRPC_URL`, default `localhost:50052`),
  `grpcUnaryDeadlineMs` (`WORKY_ORCHESTRATOR_GRPC_UNARY_DEADLINE_MS`, default `15000`),
  `grpcMaxMessageBytes` (`WORKY_ORCHESTRATOR_GRPC_MAX_MESSAGE_BYTES`, default 16 MiB),
  `grpcIdleTimeoutMs` (`WORKY_ORCHESTRATOR_GRPC_IDLE_TIMEOUT_MS`, default `120000`).
- `back/src/config/grpc-security-worky-orchestrator.config.ts` — mirrors
  `grpc-security-v2.config.ts`, env prefix `WORKY_ORCHESTRATOR_GRPC_*`
  (`_API_KEY`, `_TLS_MODE` default `insecure`, `_TLS_CA_CERT_PATH`,
  `_TLS_SERVER_NAME_OVERRIDE`, `_REQUIRE_TLS`). Exports namespace constant
  `WORKY_ORCHESTRATOR_GRPC_SECURITY_NS = 'grpcSecurityWorkyOrchestrator'`.
- `back/src/modules/worky/services/worky-orchestrator.grpc-client.service.ts` —
  `WorkyOrchestratorGrpcClientService implements OnModuleInit, OnModuleDestroy`.
  Loads `orchestrator.proto` via protoLoader (`keepCase:true, longs:Number,
  enums:String, defaults:true, oneofs:true`), builds the grpc-js client via
  `buildGrpcChannelCredentials(config, warn, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS)`,
  sets max message size + keepalive, does an initial `waitForReady` probe plus a
  `@Cron(EVERY_10_SECONDS)` health check (mirrors conversation-v2's pattern),
  and `resolveProtoPath()` tries `__dirname/../proto/orchestrator.proto`,
  `<cwd>/dist/modules/worky/proto/orchestrator.proto`,
  `<cwd>/src/modules/worky/proto/orchestrator.proto`.

  Public methods, all unary with positional metadata
  (`createGrpcMetadata(this.config, WORKY_ORCHESTRATOR_GRPC_SECURITY_NS)`) and
  `this.unaryDeadline`:
  - `createSession(userId)` → `CreateSession({ user_id })` → `session_id`.
  - `runTask(userId, sessionId, message, { model?, skills?, connectors?, idempotencyKey })`
    → `RunTask({ user_id, session_id, message, idempotency_key, ...optional })`
    (model/skills/connectors only set when provided, same style as
    conversation-v2's `worky()`/`chat()`) → `{ sessionId, accepted, runId }`.
  - `getSession(userId, sessionId)` → `GetSession({ user_id, session_id })` →
    `{ sessionId, title, status, plan }`.
  - `stopSession(userId, sessionId)` → `StopSession({ user_id, session_id })` →
    `{ stopped }`.

Files created (tests):

- `back/src/modules/worky/services/worky-orchestrator.grpc-client.service.spec.ts` —
  fakes `service.client` per method, asserts request shape (snake_case, incl.
  `idempotency_key`), positional metadata, deadline option, mapped return
  value, an "omits optional fields" case for `runTask`, and an error-path test
  per method (9 tests total).

## Wiring

- `back/src/modules/worky/worky.module.ts`: added
  `ConfigModule.forFeature(workyOrchestratorConfig)` and
  `ConfigModule.forFeature(workyOrchestratorSecurityConfig)` to `imports`
  (same pattern as the existing `ConfigModule.forFeature(workyConfig)`);
  added `WorkyOrchestratorGrpcClientService` to both `providers` and `exports`.
- `back/.env`: added under the Electric section:
  ```
  # Worky Orchestrator gRPC (dedicated worky API)
  WORKY_ORCHESTRATOR_GRPC_URL=
  ```
- Did **not** touch `back/src/app.module.ts`'s global `ConfigModule.forRoot`
  `load` array or `config.schema.ts` — not requested by the task, and
  `ConfigModule` is global + `forFeature` is sufficient (confirmed by
  `workyConfig`, which is registered the same way and works fine). Joi
  validation (`configValidationSchema`) defaults to `allowUnknown: true`
  (only `abortEarly` is overridden in `app.module.ts`), so the new
  `WORKY_ORCHESTRATOR_GRPC_*` env vars don't need schema entries to pass
  validation — same as several existing `WORKY_*`/`WORKY_ELECTRIC_*` vars
  that also aren't in `config.schema.ts`.

## nest-cli.json finding

`back/nest-cli.json` already has `"assets": ["**/*.proto", "**/*.pem",
"**/*.crt", "**/*.cert"]` with `sourceRoot: "src"`. The glob `**/*.proto` is
unscoped and already covers `src/modules/worky/proto/orchestrator.proto` (same
glob that already copies `conversation-v2`'s `conversation.proto`). **No
change needed.**

## Did NOT do (per instructions)

Did not touch `WorkyMessageController` or `WorkyStreamService` — the new
client is only built + wired as an injectable provider. Existing
conversation-v2 usage is untouched.

## Verification

`npx jest worky-orchestrator.grpc-client.service`:
```
Test Suites: 1 passed, 1 total
Tests:       9 passed, 9 total
```

`npx jest worky` (full worky suite, checking for regressions):
```
Test Suites: 1 failed, 32 passed, 33 total
Tests:       246 passed, 246 total
```
The one failing suite, `worky-electric-consumer.service.spec.ts`, fails to
*compile* (`Cannot find module '@electric-sql/client'`) — a pre-existing
environment issue (missing npm dependency) unrelated to this change; no file
touched by this task is involved. All 246 runnable tests pass, including the
9 new ones.

`npx tsc --noEmit -p .`:
```
src/modules/worky/services/worky-electric-consumer.service.ts(5,64): error TS2307: Cannot find module '@electric-sql/client' or its corresponding type declarations.
src/modules/worky/services/worky-electric-consumer.service.ts(106,14): error TS7006: Parameter 'messages' implicitly has an 'any' type.
src/modules/worky/services/worky-electric-consumer.service.ts(111,8): error TS7006: Parameter 'err' implicitly has an 'any' type.
```
Same pre-existing `@electric-sql/client` issue, no other errors. No errors
from any file created/edited in this task.

## Commit

`feat(worky): add dedicated AgentOrchestrator gRPC client`
