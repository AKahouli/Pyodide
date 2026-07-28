# Worky gRPC Manager + Electric SQL Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace worky's adk-runtime HTTP/SSE engine with a conversation-v2 gRPC `Worky` kickoff plus a Nest-side Electric SQL consumer that mirrors manager-owned Postgres task state into Mongo and broadcasts over the existing worky SSE channel.

**Architecture:** The frontend only ever talks to Nest. Sending a worky message kicks the manager off over the conversation-v2 gRPC `Worky` RPC (fire-and-forget, returns `{ accepted }`). The manager writes tasks/results/messages/interactions into its own Postgres, scoped by the conversation-v2 `session_id`. A Nest `ShapeStream` consumer subscribes to those tables via Electric, idempotently upserts each row into the existing Mongo collections, and emits the existing `WorkyEvent` SSE frames so the unchanged frontend refetches its board snapshot from Mongo. Electric is a resumable transport (Nest persists shape handle+offset); Mongo remains the durable system-of-record.

**Tech Stack:** NestJS 10, TypeScript, Mongoose 8, `@grpc/grpc-js` ^1.14, `@grpc/proto-loader` ^0.8, `@nestjs/config`, `@electric-sql/client` (new backend dep), Jest. Frontend: Vite 6 / React 18 / React Query / Zustand.

## Global Constraints

- **Backend module boundary:** all new backend code lives under `back/src/modules/worky/` except the gRPC client method (in `back/src/modules/conversation-v2/`) and config (in `back/src/config/`). Follow existing patterns.
- **gRPC calls** pass `grpc.Metadata` **positionally** via `createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS)` — never `{ metadata }` (grpc-js drops the header otherwise).
- **Config** via `registerAs('worky', ...)` in `back/src/config/worky.config.ts`; read with `this.config.get<T>('worky.<key>')`.
- **Tests** are Jest `*.spec.ts` co-located next to the source, matching the existing worky/conversation-v2 spec style (mocked models via `getModelToken`, mocked services).
- **Idempotency:** every Electric row → Mongo write MUST be an idempotent upsert keyed on a stable external id, so replays and multi-instance overlap produce one row.
- **Integration seam (unconfirmed):** the manager's exact Postgres table/column names are external. All Postgres row shapes are defined as explicit TypeScript interfaces in one file (`worky-electric.contract.ts`) and mapped in one file (`worky-electric.mapper.ts`). If the real columns differ, only those two files change. Column names used here are the **assumed contract** — reconcile with the conversation-v2 team before end-to-end testing.
- **Commit** after each task's tests pass.

## Scope

**In scope (this plan):** proto fix; gRPC `worky()` client method; `aiSessionId` on the stream + session creation; message-kickoff via gRPC; Electric config + cursor persistence; the integration contract + mapper; the Electric consumer (tasks, task results, messages, interactions); frontend removal of the manager token-streaming effect.

**Deferred (follow-up plan — do NOT do here):**
- Migrating stream/task execution controls (`start`/`pause`/`resume`/`stop`, per-task `move`/`pause`/`cancel`) from `WorkyRuntimeDispatchService` to gRPC. Requires confirmed manager execution RPCs.
- Physical deletion of `WorkyRuntimeClient`, `WorkyRuntimeDispatchService`, `WorkyInternalController`, `WorkyServiceAuthGuard`, and the planning-turn HTTP path. Safe only once execution controls are migrated and this path is proven. Until then they remain but are no longer on the message-kickoff path.

---

## File Structure

**Create:**
- `back/src/modules/worky/schemas/worky-electric-cursor.schema.ts` — persists `{ shape, handle, offset }` for resume.
- `back/src/modules/worky/electric/worky-electric.contract.ts` — typed Postgres row interfaces (the integration seam).
- `back/src/modules/worky/electric/worky-electric.mapper.ts` — pure functions mapping Postgres rows → Mongo field objects + SSE frames.
- `back/src/modules/worky/electric/worky-electric.mapper.spec.ts`
- `back/src/modules/worky/services/worky-electric-consumer.service.ts` — the ShapeStream consumer.
- `back/src/modules/worky/services/worky-electric-consumer.service.spec.ts`

**Modify:**
- `back/src/modules/conversation-v2/proto/conversation.proto` — remove stray `"`.
- `back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.ts` — add `worky()`.
- `back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.spec.ts` — test `worky()`.
- `back/src/modules/worky/schemas/worky-stream.schema.ts` — add `aiSessionId`.
- `back/src/modules/worky/schemas/worky-task.schema.ts` — add `externalId`.
- `back/src/modules/worky/services/worky-stream.service.ts` — create conversation-v2 session, store `aiSessionId`; add `findByAiSessionId`.
- `back/src/modules/worky/controllers/worky-message.controller.ts` — kick off via gRPC.
- `back/src/config/worky.config.ts` — add Electric config keys.
- `back/src/modules/worky/worky.module.ts` — import `ConversationV2Module`, register new schema + consumer service.
- `front/src/modules/worky/components/ChatMessageThread.tsx` + `WorkyStreamPage.tsx` — drop manager token-streaming effect.

---

### Task 1: Fix the proto and add the `worky()` gRPC client method

**Files:**
- Modify: `back/src/modules/conversation-v2/proto/conversation.proto:40`
- Modify: `back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.ts` (after `resumeSession`, ~line 270)
- Test: `back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.spec.ts`

**Interfaces:**
- Produces: `ConversationV2GrpcClientService.worky(userId: string, sessionId: string, message: string, opts?: { model?: string; skills?: unknown[]; connectors?: unknown[] }): Promise<{ sessionId: string; accepted: boolean }>`

- [ ] **Step 1: Fix the proto syntax error**

In `conversation.proto`, delete the stray line 40 (a lone `"` between `WorkyResponse` and `message ChatRequest`). The region must read:

```proto
message WorkyResponse { string session_id = 1; bool accepted = 2; }

message ChatRequest {
```

- [ ] **Step 2: Write the failing test**

Add to `conversation-v2.grpc-client.service.spec.ts`, following the existing `createSession` test pattern (a fake `client.Worky` set on the service's private `client`):

```ts
describe('worky', () => {
  it('calls Worky with positional metadata + deadline and resolves accepted', async () => {
    const Worky = jest.fn((_req, _md, _opts, cb) =>
      cb(null, { session_id: 'sess-1', accepted: true }),
    );
    (service as any).client = { Worky };

    const result = await service.worky('user-1', 'sess-1', 'do the thing', {
      model: 'anthropic/claude-sonnet-4-5',
    });

    expect(result).toEqual({ sessionId: 'sess-1', accepted: true });
    const [req, md, opts] = Worky.mock.calls[0];
    expect(req).toMatchObject({ user_id: 'user-1', session_id: 'sess-1', message: 'do the thing', model: 'anthropic/claude-sonnet-4-5' });
    expect(md).toBeDefined();            // grpc.Metadata, passed positionally
    expect(opts).toHaveProperty('deadline');
  });

  it('rejects when Worky errors', async () => {
    (service as any).client = { Worky: (_r, _m, _o, cb) => cb(new Error('boom')) };
    await expect(service.worky('u', 's', 'm')).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd back && npx jest conversation-v2.grpc-client.service --t worky`
Expected: FAIL — `service.worky is not a function`.

- [ ] **Step 4: Implement `worky()`**

Insert after `resumeSession` (mirrors `createSession`'s unary pattern exactly):

```ts
  async worky(
    userId: string,
    sessionId: string,
    message: string,
    opts: { model?: string; skills?: unknown[]; connectors?: unknown[] } = {},
  ): Promise<{ sessionId: string; accepted: boolean }> {
    const request: Record<string, unknown> = { user_id: userId, session_id: sessionId, message };
    if (opts.model) request.model = opts.model;
    if (opts.skills?.length) request.skills = opts.skills;
    if (opts.connectors?.length) request.connectors = opts.connectors;
    return new Promise((resolve, reject) => {
      this.client.Worky(
        request,
        createGrpcMetadata(this.config, V2_GRPC_SECURITY_NS),
        this.unaryDeadline,
        (err: grpc.ServiceError | null, response: { session_id: string; accepted: boolean }) => {
          if (err) return reject(err);
          resolve({ sessionId: response.session_id, accepted: !!response.accepted });
        },
      );
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd back && npx jest conversation-v2.grpc-client.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/conversation-v2/proto/conversation.proto back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.ts back/src/modules/conversation-v2/services/conversation-v2.grpc-client.service.spec.ts
git commit -m "feat(conversation-v2): add Worky gRPC client method + fix proto"
```

---

### Task 2: Add `aiSessionId` to the stream and `externalId` to the task

**Files:**
- Modify: `back/src/modules/worky/schemas/worky-stream.schema.ts`
- Modify: `back/src/modules/worky/schemas/worky-task.schema.ts`
- Test: `back/src/modules/worky/schemas/worky-stream.schema.spec.ts` (create)

**Interfaces:**
- Produces: `WorkyStream.aiSessionId?: string | null`; `WorkyTask.externalId?: string | null` (the manager's Postgres row id, the upsert key).

- [ ] **Step 1: Write the failing test**

Create `worky-stream.schema.spec.ts`:

```ts
import { WorkyStreamSchema } from './worky-stream.schema';
import { WorkyTaskSchema } from './worky-task.schema';

describe('worky schemas — sync fields', () => {
  it('WorkyStream has an indexed aiSessionId path', () => {
    expect(WorkyStreamSchema.path('aiSessionId')).toBeDefined();
  });
  it('WorkyTask has an externalId path', () => {
    expect(WorkyTaskSchema.path('externalId')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd back && npx jest worky-stream.schema`
Expected: FAIL — `aiSessionId` path undefined.

- [ ] **Step 3: Add the fields**

In `worky-stream.schema.ts`, add inside the `WorkyStream` class (after `workerModelId`):

```ts
  /**
   * conversation-v2 session id for this stream. Created via the gRPC
   * `CreateSession` RPC when the stream is created, and used as the
   * `session_id` on every `Worky` kickoff and as the Electric shape
   * scope key (`session_id`) the manager writes task rows under.
   */
  @Prop({ type: String, default: null, index: true })
  aiSessionId?: string | null;
```

In `worky-task.schema.ts`, add inside the `WorkyTask` class (after `streamId`):

```ts
  /**
   * The manager's Postgres row id for this task (the Electric source of
   * truth). Upsert key for the Electric consumer; null for tasks not
   * originating from the manager.
   */
  @Prop({ type: String, default: null })
  externalId?: string | null;
```

And add an index at the bottom of `worky-task.schema.ts` (near the other `.index(...)` calls):

```ts
WorkyTaskSchema.index({ streamId: 1, externalId: 1 });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd back && npx jest worky-stream.schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/schemas/worky-stream.schema.ts back/src/modules/worky/schemas/worky-task.schema.ts back/src/modules/worky/schemas/worky-stream.schema.spec.ts
git commit -m "feat(worky): add aiSessionId to stream and externalId to task"
```

---

### Task 3: Create a conversation-v2 session on stream creation + lookup by session

**Files:**
- Modify: `back/src/modules/worky/worky.module.ts` (imports)
- Modify: `back/src/modules/worky/services/worky-stream.service.ts` (constructor, `create`, new `findByAiSessionId`)
- Test: `back/src/modules/worky/services/worky-stream.service.spec.ts`

**Interfaces:**
- Consumes: `ConversationV2GrpcClientService.createSession(userId, workspaceIds?)` (Task pre-existing) → `Promise<string>` session id.
- Produces: `WorkyStreamService.findByAiSessionId(aiSessionId: string): Promise<{ streamId: string; ownerUserId: string } | null>`.

- [ ] **Step 1: Wire `ConversationV2Module` into worky**

In `worky.module.ts`, add to the `imports` array (it re-exports `ConversationV2GrpcClientService`):

```ts
    ConversationV2Module,
```

Add the import at the top:

```ts
import { ConversationV2Module } from '../conversation-v2/conversation-v2.module';
```

- [ ] **Step 2: Write the failing test**

In `worky-stream.service.spec.ts`, add to the `create` describe (mock `grpcClient.createSession` to resolve `'sess-xyz'`) and a new lookup test:

```ts
it('creates a conversation-v2 session and stores aiSessionId', async () => {
  grpcClient.createSession.mockResolvedValue('sess-xyz');
  // ...existing create arrange (agentType, workspace, agent mocks)...
  await service.create('user-1', { title: 'My stream' } as any);
  expect(grpcClient.createSession).toHaveBeenCalledWith('user-1', []);
  const createdArg = streamModel.create.mock.calls[0][0];
  expect(createdArg.aiSessionId).toBe('sess-xyz');
});

it('findByAiSessionId returns streamId + ownerUserId', async () => {
  streamModel.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({ _id: 'stream-1', ownerUserId: 'owner-1' }) }) } as any);
  const res = await service.findByAiSessionId('sess-xyz');
  expect(res).toEqual({ streamId: 'stream-1', ownerUserId: 'owner-1' });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd back && npx jest worky-stream.service`
Expected: FAIL — `createSession` not called / `findByAiSessionId` not a function.

- [ ] **Step 4: Implement**

Inject the gRPC client in the constructor of `WorkyStreamService`:

```ts
    private readonly grpcClient: ConversationV2GrpcClientService,
```
with the import:
```ts
import { ConversationV2GrpcClientService } from '../../conversation-v2/services/conversation-v2.grpc-client.service';
```

In `create()`, after `createManagerAgent` and before `this.streamModel.create({...})`, create the session:

```ts
    const aiSessionId = await this.grpcClient.createSession(userId, []);
```

Add `aiSessionId,` to the `this.streamModel.create({ ... })` object (alongside `managerAgentId`).

Add the lookup method:

```ts
  async findByAiSessionId(
    aiSessionId: string,
  ): Promise<{ streamId: string; ownerUserId: string } | null> {
    const doc = await this.streamModel
      .findOne({ aiSessionId })
      .lean<{ _id: unknown; ownerUserId: unknown }>()
      .exec();
    if (!doc) return null;
    return { streamId: String(doc._id), ownerUserId: String(doc.ownerUserId) };
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd back && npx jest worky-stream.service`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/worky/worky.module.ts back/src/modules/worky/services/worky-stream.service.ts back/src/modules/worky/services/worky-stream.service.spec.ts
git commit -m "feat(worky): create conversation-v2 session on stream create + lookup by session"
```

---

### Task 4: Kick off the manager over gRPC from the message controller

**Files:**
- Modify: `back/src/modules/worky/controllers/worky-message.controller.ts`
- Test: `back/src/modules/worky/controllers/worky-message.controller.spec.ts`

**Interfaces:**
- Consumes: `WorkyPlanningService.appendOwnerMessage(userId, streamId, dto)` (persists owner message, unchanged); `WorkyStreamService.findByAiSessionId` is NOT used here — the controller resolves `aiSessionId` from the stream doc via a new `WorkyStreamService.getAiSessionId(streamId)`.
- Produces: `POST /worky/streams/:id/messages` calls `grpcClient.worky(userId, aiSessionId, content)` instead of `planning.startTurn`.

- [ ] **Step 1: Add `getAiSessionId` to the stream service**

In `worky-stream.service.ts`:

```ts
  async getAiSessionId(streamId: string): Promise<string> {
    const doc = await this.streamModel
      .findById(streamId)
      .lean<{ aiSessionId?: string | null }>()
      .exec();
    if (!doc?.aiSessionId) {
      throw new NotFoundException(
        ErrorCode.WORKY_STREAM_NOT_FOUND,
        'Worky stream has no conversation-v2 session.',
      );
    }
    return doc.aiSessionId;
  }
```

- [ ] **Step 2: Write the failing test**

Create/extend `worky-message.controller.spec.ts`:

```ts
it('appends the owner message and kicks off the manager over gRPC', async () => {
  planning.appendOwnerMessage.mockResolvedValue({ id: 'm1', content: 'hi', createdAt: 'now' });
  streamService.getAiSessionId.mockResolvedValue('sess-xyz');
  const user = { _id: { toString: () => 'user-1' } } as any;

  const res = await controller.sendMessage(user, 'stream-1', { content: 'hi' } as any);

  expect(planning.appendOwnerMessage).toHaveBeenCalledWith('user-1', 'stream-1', { content: 'hi' });
  expect(grpcClient.worky).toHaveBeenCalledWith('user-1', 'sess-xyz', 'hi', expect.any(Object));
  expect(res).toEqual({ id: 'm1', content: 'hi', createdAt: 'now', turnStarted: true });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd back && npx jest worky-message.controller`
Expected: FAIL — controller still calls `planning.startTurn`.

- [ ] **Step 4: Implement**

Inject `WorkyStreamService` and `ConversationV2GrpcClientService` into the controller constructor (imports from their service paths). Replace the `this.planning.startTurn({...})` call in `sendMessage` with:

```ts
    const aiSessionId = await this.streamService.getAiSessionId(streamId);
    // Fire-and-forget kickoff. The manager writes task/message rows into
    // its Postgres; the Electric consumer mirrors them into Mongo and
    // re-emits over the SSE channel `/worky/streams/{id}/events`.
    void this.grpcClient
      .worky(user._id.toString(), aiSessionId, dto.content, {})
      .catch((err) => this.logger.error('Worky gRPC kickoff failed', { streamId, error: (err as Error).message }));
```

(Keep `appendOwnerMessage` and the `202` return shape unchanged. Add a `LoggerService` injection if not already present, matching sibling controllers.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd back && npx jest worky-message.controller`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/worky/controllers/worky-message.controller.ts back/src/modules/worky/controllers/worky-message.controller.spec.ts back/src/modules/worky/services/worky-stream.service.ts
git commit -m "feat(worky): kick off manager over gRPC Worky on message send"
```

---

### Task 5: Electric config + cursor schema

**Files:**
- Modify: `back/src/config/worky.config.ts`
- Create: `back/src/modules/worky/schemas/worky-electric-cursor.schema.ts`
- Modify: `back/src/modules/worky/worky.module.ts` (register schema)
- Test: `back/src/modules/worky/schemas/worky-electric-cursor.schema.spec.ts`

**Interfaces:**
- Produces: config keys `worky.electricUrl`, `worky.electricTasksTable`, `worky.electricTaskResultsTable`, `worky.electricMessagesTable`, `worky.electricInteractionsTable`; Mongo model `WorkyElectricCursor { shape: string (unique); handle: string | null; offset: string | null }`.

- [ ] **Step 1: Add config keys**

In `worky.config.ts`, add inside the returned object:

```ts
  // Electric SQL sync (manager-owned Postgres → Nest consumer).
  electricUrl: process.env.WORKY_ELECTRIC_URL || 'http://electric:3000/v1/shape',
  electricTasksTable: process.env.WORKY_ELECTRIC_TASKS_TABLE || 'worky_tasks',
  electricTaskResultsTable: process.env.WORKY_ELECTRIC_TASK_RESULTS_TABLE || 'worky_task_results',
  electricMessagesTable: process.env.WORKY_ELECTRIC_MESSAGES_TABLE || 'worky_messages',
  electricInteractionsTable: process.env.WORKY_ELECTRIC_INTERACTIONS_TABLE || 'worky_interactions',
```

- [ ] **Step 2: Write the failing test**

Create `worky-electric-cursor.schema.spec.ts`:

```ts
import { WorkyElectricCursorSchema } from './worky-electric-cursor.schema';

describe('WorkyElectricCursor schema', () => {
  it('has a unique shape path plus handle/offset', () => {
    expect(WorkyElectricCursorSchema.path('shape')).toBeDefined();
    expect(WorkyElectricCursorSchema.path('handle')).toBeDefined();
    expect(WorkyElectricCursorSchema.path('offset')).toBeDefined();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd back && npx jest worky-electric-cursor.schema`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the schema**

Create `worky-electric-cursor.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkyElectricCursorDocument = HydratedDocument<WorkyElectricCursor>;

@Schema({ timestamps: true, collection: 'worky_electric_cursors' })
export class WorkyElectricCursor {
  /** Logical shape name, e.g. 'tasks' | 'task_results' | 'messages' | 'interactions'. */
  @Prop({ type: String, required: true, unique: true })
  shape!: string;

  /** Electric shape handle for resume; null until the first batch. */
  @Prop({ type: String, default: null })
  handle?: string | null;

  /** Electric shape log offset for resume; null until the first batch. */
  @Prop({ type: String, default: null })
  offset?: string | null;
}

export const WorkyElectricCursorSchema = SchemaFactory.createForClass(WorkyElectricCursor);
```

Register it in `worky.module.ts` `MongooseModule.forFeature([...])`:

```ts
      { name: WorkyElectricCursor.name, schema: WorkyElectricCursorSchema },
```
(with the import).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd back && npx jest worky-electric-cursor.schema`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/config/worky.config.ts back/src/modules/worky/schemas/worky-electric-cursor.schema.ts back/src/modules/worky/worky.module.ts back/src/modules/worky/schemas/worky-electric-cursor.schema.spec.ts
git commit -m "feat(worky): add Electric config keys and shape cursor schema"
```

---

### Task 6: Integration contract + mapper (Postgres rows → Mongo + SSE)

**Files:**
- Create: `back/src/modules/worky/electric/worky-electric.contract.ts`
- Create: `back/src/modules/worky/electric/worky-electric.mapper.ts`
- Test: `back/src/modules/worky/electric/worky-electric.mapper.spec.ts`

> **INTEGRATION SEAM:** the column names below are the **assumed contract** with the conversation-v2 manager. Reconcile before end-to-end testing; if columns differ, only this task's two files change.

**Interfaces:**
- Produces:
  - `PgWorkyTaskRow`, `PgWorkyTaskResultRow`, `PgWorkyMessageRow`, `PgWorkyInteractionRow` interfaces.
  - `mapPgTask(row: PgWorkyTaskRow, streamId: string): { set: Record<string, unknown>; event: Omit<WorkyEvent,'streamId'> }`
  - `mapPgTaskResult(row: PgWorkyTaskResultRow, taskObjectId: string): { taskId: string; version: number; set: Record<string, unknown>; event: Omit<WorkyEvent,'streamId'> }`
  - `mapPgMessage(row: PgWorkyMessageRow, streamId: string)` and `mapPgInteraction(row: PgWorkyInteractionRow, streamId: string)` returning `{ set, event }`.

- [ ] **Step 1: Write the contract**

Create `worky-electric.contract.ts`:

```ts
/** Postgres rows the manager writes, as synced by Electric. ASSUMED CONTRACT. */
export interface PgWorkyTaskRow {
  id: string;                 // manager PG row id → WorkyTask.externalId
  session_id: string;         // conversation-v2 session id (shape scope)
  title: string;
  description: string | null;
  lane: string;               // must be one of WorkyTask.lane enum values
  execution_state: string;    // must be one of WorkyTask.executionState enum values
  priority: string | null;
  assignee_type: string | null;
  action_category: string | null;
  started_at: string | null;  // ISO timestamp
  completed_at: string | null;
  updated_at: string;
}

export interface PgWorkyTaskResultRow {
  id: string;
  task_id: string;            // manager PG task id → maps to WorkyTask.externalId
  version: number;
  status: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
}

export interface PgWorkyMessageRow {
  id: string;
  session_id: string;
  role: string;               // 'owner' | 'manager'
  content: string;
  created_at: string;
}

export interface PgWorkyInteractionRow {
  id: string;
  session_id: string;
  kind: string;               // e.g. 'clarification' | 'approval'
  prompt: string;
  status: string;
  created_at: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `worky-electric.mapper.spec.ts`:

```ts
import { mapPgTask, mapPgTaskResult } from './worky-electric.mapper';

describe('worky-electric.mapper', () => {
  it('maps a task row to Mongo $set + a task.updated event', () => {
    const { set, event } = mapPgTask(
      { id: 'pg-1', session_id: 's', title: 'T', description: 'd', lane: 'running',
        execution_state: 'running', priority: 'high', assignee_type: 'ephemeral_ai_agent',
        action_category: 'research', started_at: null, completed_at: null, updated_at: '2026-07-03T00:00:00Z' },
      'stream-1',
    );
    expect(set).toMatchObject({ externalId: 'pg-1', streamId: 'stream-1', title: 'T', lane: 'running', executionState: 'running' });
    expect(event.type).toBe('task.updated');
  });

  it('maps a completed task to a task.completed event', () => {
    const { event } = mapPgTask(
      { id: 'pg-1', session_id: 's', title: 'T', description: null, lane: 'done',
        execution_state: 'done', priority: null, assignee_type: null, action_category: null,
        started_at: null, completed_at: '2026-07-03T01:00:00Z', updated_at: '2026-07-03T01:00:00Z' },
      'stream-1',
    );
    expect(event.type).toBe('task.completed');
  });

  it('maps a task result keyed by taskId+version', () => {
    const r = mapPgTaskResult({ id: 'r1', task_id: 'pg-1', version: 2, status: 'ok', summary: 's', payload: null }, 'obj-1');
    expect(r).toMatchObject({ taskId: 'obj-1', version: 2 });
    expect(r.event.type).toBe('task.completed');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd back && npx jest worky-electric.mapper`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the mapper**

Create `worky-electric.mapper.ts`:

```ts
import { WorkyEvent } from '../interfaces/worky-event.interface';
import {
  PgWorkyTaskRow, PgWorkyTaskResultRow, PgWorkyMessageRow, PgWorkyInteractionRow,
} from './worky-electric.contract';

type Frame = Omit<WorkyEvent, 'streamId'>;
const now = (): number => Date.now();

export function mapPgTask(row: PgWorkyTaskRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const set: Record<string, unknown> = {
    externalId: row.id,
    streamId,
    title: row.title,
    description: row.description ?? '',
    lane: row.lane,
    executionState: row.execution_state,
    priority: row.priority ?? 'medium',
    assigneeType: row.assignee_type ?? 'unassigned',
    actionCategory: row.action_category ?? 'internal_analysis',
    startedAt: row.started_at ? new Date(row.started_at) : null,
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
  const terminal = row.lane === 'done' || row.execution_state === 'done';
  const event: Frame = {
    type: terminal ? 'task.completed' : 'task.updated',
    emittedAt: now(),
    payload: { externalId: row.id },
  };
  return { set, event };
}

export function mapPgTaskResult(
  row: PgWorkyTaskResultRow, taskObjectId: string,
): { taskId: string; version: number; set: Record<string, unknown>; event: Frame } {
  return {
    taskId: taskObjectId,
    version: row.version,
    set: { taskId: taskObjectId, version: row.version, status: row.status, summary: row.summary ?? '', payload: row.payload ?? null },
    event: { type: 'task.completed', emittedAt: now(), payload: { taskId: taskObjectId, version: row.version } },
  };
}

export function mapPgMessage(row: PgWorkyMessageRow, _streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: { externalId: row.id, role: row.role, content: row.content, createdAt: new Date(row.created_at) },
    event: { type: 'message.appended', emittedAt: now(), payload: { role: row.role, content: row.content } },
  };
}

export function mapPgInteraction(row: PgWorkyInteractionRow, _streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: { externalId: row.id, kind: row.kind, prompt: row.prompt, status: row.status, createdAt: new Date(row.created_at) },
    event: { type: 'interaction.requested', emittedAt: now(), payload: { interactionId: row.id, kind: row.kind } },
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd back && npx jest worky-electric.mapper`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/worky/electric/
git commit -m "feat(worky): add Electric integration contract + row mapper"
```

---

### Task 7: The Electric consumer service

**Files:**
- Modify: `back/package.json` (add `@electric-sql/client`)
- Create: `back/src/modules/worky/services/worky-electric-consumer.service.ts`
- Modify: `back/src/modules/worky/worky.module.ts` (register provider)
- Test: `back/src/modules/worky/services/worky-electric-consumer.service.spec.ts`

**Interfaces:**
- Consumes: `mapPgTask`/`mapPgTaskResult`/`mapPgMessage`/`mapPgInteraction` (Task 6); `WorkyStreamService.findByAiSessionId` (Task 3); `WorkyEventService.emit(userId, streamId, event)`; models `WorkyTask`, `WorkyTaskResult`, `WorkyMessage`, `WorkyInteraction`, `WorkyElectricCursor`.
- Produces: `WorkyElectricConsumerService` implementing `OnModuleInit`/`OnModuleDestroy`; testable method `handleTaskMessages(messages: unknown[]): Promise<void>` and `persistCursor(shape, handle, offset)`.

- [ ] **Step 1: Add the dependency**

Run: `cd back && npm install @electric-sql/client`

- [ ] **Step 2: Write the failing test**

Create `worky-electric-consumer.service.spec.ts` — mock the models and `WorkyStreamService`/`WorkyEventService`; drive the handler directly with fake `ChangeMessage`s (no real network):

```ts
it('upserts a task by externalId and emits to the owner', async () => {
  streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
  taskModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);

  await service.handleTaskMessages([
    { headers: { operation: 'insert' }, value: { id: 'pg-1', session_id: 'sess-xyz', title: 'T', lane: 'running', execution_state: 'running', description: null, priority: null, assignee_type: null, action_category: null, started_at: null, completed_at: null, updated_at: '2026-07-03T00:00:00Z' } },
    { headers: { control: 'up-to-date' } },
  ]);

  expect(taskModel.findOneAndUpdate).toHaveBeenCalledWith(
    { streamId: 'stream-1', externalId: 'pg-1' },
    expect.objectContaining({ $set: expect.objectContaining({ lane: 'running' }) }),
    expect.objectContaining({ upsert: true, new: true }),
  );
  expect(events.emit).toHaveBeenCalledWith('owner-1', 'stream-1', expect.objectContaining({ type: 'task.updated' }));
});

it('is idempotent: same row twice upserts once per call with the same filter', async () => {
  streamService.findByAiSessionId.mockResolvedValue({ streamId: 'stream-1', ownerUserId: 'owner-1' });
  taskModel.findOneAndUpdate.mockReturnValue({ exec: () => Promise.resolve({ _id: 'obj-1' }) } as any);
  const msg = { headers: { operation: 'update' }, value: { id: 'pg-1', session_id: 'sess-xyz', title: 'T', lane: 'done', execution_state: 'done', description: null, priority: null, assignee_type: null, action_category: null, started_at: null, completed_at: '2026-07-03T01:00:00Z', updated_at: '2026-07-03T01:00:00Z' } };
  await service.handleTaskMessages([msg]);
  await service.handleTaskMessages([msg]);
  expect(taskModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  // both calls use the same upsert filter → one row
  expect(taskModel.findOneAndUpdate.mock.calls[0][0]).toEqual(taskModel.findOneAndUpdate.mock.calls[1][0]);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd back && npx jest worky-electric-consumer.service`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the consumer**

Create `worky-electric-consumer.service.ts`:

```ts
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ShapeStream, isChangeMessage, isControlMessage } from '@electric-sql/client';
import { LoggerService } from '../../logger/logger.service';
import { WorkyStreamService } from './worky-stream.service';
import { WorkyEventService } from './worky-event.service';
import { WorkyTask, WorkyTaskDocument } from '../schemas/worky-task.schema';
import { WorkyTaskResult, WorkyTaskResultDocument } from '../schemas/worky-task-result.schema';
import { WorkyElectricCursor, WorkyElectricCursorDocument } from '../schemas/worky-electric-cursor.schema';
import { PgWorkyTaskRow, PgWorkyTaskResultRow } from '../electric/worky-electric.contract';
import { mapPgTask, mapPgTaskResult } from '../electric/worky-electric.mapper';

@Injectable()
export class WorkyElectricConsumerService implements OnModuleInit, OnModuleDestroy {
  private streams: Array<{ unsubscribe: () => void }> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly streamService: WorkyStreamService,
    private readonly events: WorkyEventService,
    private readonly logger: LoggerService,
    @InjectModel(WorkyTask.name) private readonly taskModel: Model<WorkyTaskDocument>,
    @InjectModel(WorkyTaskResult.name) private readonly resultModel: Model<WorkyTaskResultDocument>,
    @InjectModel(WorkyElectricCursor.name) private readonly cursorModel: Model<WorkyElectricCursorDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.subscribe('tasks', this.config.get<string>('worky.electricTasksTable')!, (m) => this.handleTaskMessages(m));
    await this.subscribe('task_results', this.config.get<string>('worky.electricTaskResultsTable')!, (m) => this.handleTaskResultMessages(m));
    // messages + interactions follow the same subscribe(...) shape (Task 6 mappers).
  }

  onModuleDestroy(): void {
    for (const s of this.streams) { try { s.unsubscribe(); } catch { /* noop */ } }
  }

  private async subscribe(shape: string, table: string, handler: (messages: unknown[]) => Promise<void>): Promise<void> {
    const cursor = await this.cursorModel.findOne({ shape }).lean().exec();
    const stream = new ShapeStream({
      url: this.config.get<string>('worky.electricUrl')!,
      params: { table },
      handle: cursor?.handle ?? undefined,
      offset: (cursor?.offset as never) ?? undefined,
    });
    const unsubscribe = stream.subscribe(
      async (messages) => {
        await handler(messages);
        await this.persistCursor(shape, stream.shapeHandle, String(stream.lastOffset));
      },
      (err) => this.logger.error('Electric stream error', { shape, error: (err as Error).message }),
    );
    this.streams.push({ unsubscribe });
  }

  async persistCursor(shape: string, handle: string | undefined, offset: string): Promise<void> {
    await this.cursorModel.updateOne({ shape }, { $set: { handle: handle ?? null, offset } }, { upsert: true }).exec();
  }

  async handleTaskMessages(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m) || !isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue; // manager tombstones out of scope
      const row = m.value as PgWorkyTaskRow;
      const target = await this.streamService.findByAiSessionId(row.session_id);
      if (!target) { this.logger.warn('Task for unknown session', { session: row.session_id }); continue; }
      const { set, event } = mapPgTask(row, target.streamId);
      await this.taskModel.findOneAndUpdate(
        { streamId: target.streamId, externalId: row.id },
        { $set: set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      this.events.emit(target.ownerUserId, target.streamId, event);
    }
  }

  async handleTaskResultMessages(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m) || !isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      const row = m.value as PgWorkyTaskResultRow;
      const task = await this.taskModel.findOne({ externalId: row.task_id }).lean<{ _id: unknown; streamId: unknown }>().exec();
      if (!task) { this.logger.warn('Result for unknown task', { task: row.task_id }); continue; }
      const streamId = String(task.streamId);
      const mapped = mapPgTaskResult(row, String(task._id));
      await this.resultModel.findOneAndUpdate(
        { taskId: mapped.taskId, version: mapped.version },
        { $set: mapped.set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).exec();
      const owner = await this.streamService.getOwnerByStreamId(streamId);
      if (owner) this.events.emit(owner, streamId, mapped.event);
    }
  }
}
```

Add a small helper to `WorkyStreamService` used above:

```ts
  async getOwnerByStreamId(streamId: string): Promise<string | null> {
    const doc = await this.streamModel.findById(streamId).lean<{ ownerUserId: unknown }>().exec();
    return doc ? String(doc.ownerUserId) : null;
  }
```

Register the provider in `worky.module.ts` `providers` array: `WorkyElectricConsumerService`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd back && npx jest worky-electric-consumer.service`
Expected: PASS.

- [ ] **Step 6: Run the full worky backend suite**

Run: `cd back && npx jest worky`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add back/package.json back/package-lock.json back/src/modules/worky/services/worky-electric-consumer.service.ts back/src/modules/worky/services/worky-electric-consumer.service.spec.ts back/src/modules/worky/worky.module.ts back/src/modules/worky/services/worky-stream.service.ts
git commit -m "feat(worky): Electric consumer mirrors manager Postgres into Mongo + SSE"
```

---

### Task 8: Frontend — drop the manager token-streaming effect

**Files:**
- Modify: `front/src/modules/worky/components/WorkyStreamPage.tsx` (SSE `assistant_token` handling)
- Modify: `front/src/modules/worky/components/ChatMessageThread.tsx` (streaming bubble)
- Test: `front/src/modules/worky/components/ChatMessageThread.test.tsx`

**Interfaces:**
- Manager messages now arrive as complete `message.appended` frames (via the Electric consumer). No `assistant_token` frames are produced for the manager path.

- [ ] **Step 1: Update the test**

In `ChatMessageThread.test.tsx`, remove/adjust any assertion that renders a live streaming bubble from `assistantText`; assert that a manager message renders in full from `messages` when `message.appended` arrives (no partial-token state).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd front && npx vitest run ChatMessageThread`
Expected: FAIL on the old streaming-bubble assertion.

- [ ] **Step 3: Implement**

In `WorkyStreamPage.tsx`, remove the `case 'assistant_token':` branch (the `setStreaming(true)` + `appendAssistantToken`) from the SSE event switch, keeping `message.appended` → `appendMessage`. In `ChatMessageThread.tsx`, remove the live streaming bubble that renders `assistantText`/`streaming`; render only persisted `messages` interleaved with `pendingClarifications`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd front && npx vitest run ChatMessageThread`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/components/WorkyStreamPage.tsx front/src/modules/worky/components/ChatMessageThread.tsx front/src/modules/worky/components/ChatMessageThread.test.tsx
git commit -m "feat(worky): manager messages arrive as complete rows (drop token streaming)"
```

---

## Self-Review

**Spec coverage:**
- gRPC kickoff + proto fix → Task 1. ✅
- Stream↔session mapping (`aiSessionId`) → Tasks 2, 3. ✅
- Message kickoff over gRPC → Task 4. ✅
- Electric consumer + Mongo persistence + SSE broadcast → Tasks 5, 6, 7. ✅
- Resumability (handle+offset persistence) → Task 5 (cursor schema) + Task 7 (`persistCursor`). ✅
- Frontend Nest-only + complete-row messages → Task 8. ✅
- **Deferred (documented in Scope):** execution-control migration + physical deletion of the adk-runtime path. These are the spec's §4.3/§6; they are explicitly a follow-up plan because safe deletion requires confirmed manager execution RPCs and a proven new path.

**Known integration reconciliation (not a placeholder — a real external seam):** the assumed Postgres column names in `worky-electric.contract.ts` (Task 6) and the Electric URL shape must be confirmed with the conversation-v2 team; only `worky-electric.contract.ts` + `worky-electric.mapper.ts` change if they differ.

**Type consistency:** `emit(userId, streamId, Omit<WorkyEvent,'streamId'>)` used consistently (Tasks 6, 7). `findByAiSessionId` returns `{ streamId, ownerUserId }` (Task 3) and is consumed in Task 7. `externalId` upsert key defined in Task 2, used in Tasks 6/7. Messages/interactions mappers exist (Task 6) and their subscriptions follow the same `subscribe(...)` shape noted in Task 7 `onModuleInit`.
