# orch-2: Repoint worky kickoff to WorkyOrchestratorGrpcClientService

## Summary

Switched both places in the worky module that kicked off the AI turn over
conversation-v2 gRPC to use the new `WorkyOrchestratorGrpcClientService`
(`CreateSession` + `RunTask`) instead.

## Changes

### 1. `src/modules/worky/services/worky-stream.service.ts`
- Replaced the injected `ConversationV2GrpcClientService` with
  `WorkyOrchestratorGrpcClientService` (import switched to
  `./worky-orchestrator.grpc-client.service`). Renamed the constructor field
  from `grpcClient` to `orchestrator`.
- `ensureKickoffContext` now calls `await this.orchestrator.createSession(userId)`
  (dropped the second `workspaceIds: []` arg — orchestrator's `CreateSession`
  only takes `user_id`).
- Updated stale comments referencing "conversation-v2 session" to
  "orchestrator session".
- No other method in this service referenced the gRPC client (`create()`
  intentionally does not eagerly create a session, per existing test/comment).

### 2. `src/modules/worky/controllers/worky-message.controller.ts`
- Replaced injected `ConversationV2GrpcClientService` with
  `WorkyOrchestratorGrpcClientService` (field renamed to `orchestrator`).
- `sendMessage` now calls:
  ```ts
  void this.orchestrator
    .runTask(user._id.toString(), aiSessionId, dto.content, {
      model: model ?? undefined,
      idempotencyKey: saved.id,
    })
    .catch((err) =>
      this.logger.error('[worky-orchestrator] RunTask kickoff failed', {
        streamId,
        error: (err as Error).message,
      }),
    );
  ```
  Uses `saved.id` (the persisted owner message id from
  `appendOwnerMessage`) as the idempotency key — stable per turn.
- Renamed the kickoff log line from `[worky-electric] gRPC kickoff` to
  `[worky-orchestrator] RunTask kickoff`, kept `{ streamId, aiSid, model,
  contentLength }` fields and added `idempotencyKey: saved.id`.
- Kept the existing model-resolution chain (per-turn override → stream's
  persistent `managerModelId` → admin default) and the fire-and-forget +
  202 Accepted response shape unchanged.

### 3. Schema comment cleanup
- `src/modules/worky/schemas/worky-stream.schema.ts`: updated the
  `aiSessionId` field doc comment from "conversation-v2 session id... via
  the gRPC `CreateSession` RPC... `Worky` kickoff" to "AgentOrchestrator
  session id... `RunTask` kickoff" to match the new client.

### 4. `ConversationV2Module` — REMOVED from `worky.module.ts`

After Changes 1-2, grepped `src/modules/worky` for
`ConversationV2GrpcClientService` / `ConversationV2Module` / `conversation-v2`:
only three remaining hits, all comment-only, none a real dependency:
- `worky-event.service.ts:16` — comment: "Mirrors the conversation-v2
  pattern but..."
- `worky-events.controller.ts:23` — comment: "Mirrors the `conversation-v2`
  per-user..."
- `worky-stream.schema.ts` — updated as above (no longer mentions
  conversation-v2 after the fix)

Since nothing in the worky module actually imports/injects
`ConversationV2GrpcClientService` or anything else from
`ConversationV2Module` anymore, removed:
- the `import { ConversationV2Module } from '../conversation-v2/conversation-v2.module';`
  line, and
- the `ConversationV2Module` entry from the `imports: [...]` array

in `src/modules/worky/worky.module.ts`.

## Test files updated

- `src/modules/worky/services/worky-stream.service.spec.ts`: the existing
  mock (already just a plain object typed `as any`, no direct import of the
  conversation-v2 class) now asserts `createSession(userId)` (no second
  arg) instead of `createSession(userId, [])`. Renamed the "conversation-v2
  session" test description to "orchestrator session".
- `src/modules/worky/controllers/worky-message.controller.spec.ts`:
  replaced the `grpcClient: { worky: jest.Mock }` mock with
  `orchestrator: { runTask: jest.Mock }` (resolves
  `{ sessionId, accepted, runId }`). All four assertions updated to check
  `orchestrator.runTask(...)` was called with
  `(userId, aiSessionId, content, expect.objectContaining({ model?, idempotencyKey: 'm1' }))`.
  Kept the model-resolution assertions (stream field, per-turn override,
  admin default fallback) intact.

## Verification

```
npx jest worky-stream.service worky-message.controller
```
→ 2 suites, 18 tests passed.

```
npx jest worky
```
→ 33 suites, 260 tests passed. No `@electric-sql/client` module-resolution
issue was observed this run (env was fine, no reinstall needed).

```
npx tsc --noEmit -p .
```
→ No output / zero errors (including no pre-existing memory-cards errors
surfacing this run).

## Commit

`feat(worky): repoint kickoff to AgentOrchestrator (CreateSession + RunTask)`
