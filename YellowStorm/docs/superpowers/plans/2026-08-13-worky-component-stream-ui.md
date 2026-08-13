# Worky Component-Stream UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render worky manager messages and step results as rich typed components (reusing the conversation module's `AIMessageContent` renderer), sourced from three new ElectricSQL shapes the manager writes.

**Architecture:** The worky manager writes one Postgres row per fully-formed component (`message_components`, `plan_step_components`) plus step file rows (`plan_step_artifacts`). Electric syncs these whole rows; the existing NestJS `WorkyElectricConsumerService` mirrors them into three new Mongo projections and re-broadcasts SSE events. The frontend fetches components inline with messages (and lazily for step results), maps them via the conversation module's pure `mapComponentsToContentParts`, and renders through the already-shared `AIMessageContent`. No token streaming — components appear progressively as rows arrive.

**Tech Stack:** NestJS + Mongoose + `@electric-sql/client` (backend, Jest tests); React + Zustand + React Query + Vitest/RTL (frontend). Spec: `docs/superpowers/specs/2026-08-13-worky-component-stream-ui-design.md`.

## Global Constraints

- **No token streaming.** Each Electric row is a complete component; never implement append/merge/throttle logic for worky. (Spec decision "Complete, no token stream".)
- **`data` payload is byte-identical to the conversation `{type,data}` model** so the shared renderer consumes it untranslated. `type` ∈ conversation `ComponentType` union.
- **Backward compatibility is mandatory.** Messages/steps without component rows MUST render exactly as today (plain `content` / `result` string). Owner messages, voice-transcript messages, and existing history have no component rows → text fallback.
- **The manager keeps writing the plain-text `content`/`result` string** alongside components — TTS read-aloud, notifications, and the fallback depend on it. Do not remove it.
- **Do not touch** realtime voice, STT/dictation, TTS, kanban/graph board, clarifications, or the owner-message write path (gRPC `RunTask`).
- **Idempotency:** every projection upsert keys on `{ streamId, externalId }` with a partial-unique index (`externalId: { $type: 'string' }`), mirroring `worky_messages`.
- **Reuse, don't relocate:** worky imports `mapComponentsToContentParts` from `@/modules/conversation/utils` and `MessageComponent` from `@/modules/conversation/types`. The conversation module is NOT modified.
- **Electric JSONB may arrive as a parsed object or a JSON string** — every mapper normalizes with `typeof v === 'string' ? JSON.parse(v) : v`.
- Backend tests: Jest, hand-rolled mocks (no `Test.createTestingModule`). Frontend tests: Vitest + RTL, `useWorkyStore.getState().reset()` in `beforeEach`.

---

## File Structure

**Backend (new):**
- `back/src/modules/worky/schemas/worky-message-component.schema.ts` — projection of `message_components`
- `back/src/modules/worky/schemas/worky-plan-step-component.schema.ts` — projection of `plan_step_components`
- `back/src/modules/worky/schemas/worky-plan-step-artifact.schema.ts` — projection of `plan_step_artifacts`

**Backend (modified):**
- `back/src/modules/worky/electric/worky-electric.contract.ts` — 3 `Pg*Row` interfaces
- `back/src/modules/worky/electric/worky-electric.mapper.ts` (+ `.spec.ts`) — 3 mappers
- `back/src/config/worky.config.ts` — 3 table-name vars
- `back/src/modules/worky/interfaces/worky-event.interface.ts` — 3 event types
- `back/src/modules/worky/worky.module.ts` — register 3 schemas
- `back/src/modules/worky/services/worky-electric-consumer.service.ts` (+ `.spec.ts`) — 3 subscriptions + handlers
- `back/src/modules/worky/services/worky-planning.service.ts` — attach `components` in `listMessages`
- `back/src/modules/worky/controllers/worky-message.controller.ts` — return-type widening
- `back/src/modules/worky/services/worky-task.service.ts` (or a new `worky-task-content.service.ts`) — `getResultContent`
- `back/src/modules/worky/controllers/worky-task.controller.ts` — `GET :id/result-content`

**Frontend (modified):**
- `front/src/modules/worky/types.ts` — `components`, `WorkyArtifact`, `WorkyTaskResultContent`, event types
- `front/src/lib/api/config.ts` — `taskResultContent` endpoint
- `front/src/modules/worky/api.ts` — `getTaskResultContent`
- `front/src/modules/worky/query/queryKeys.ts` — `taskResultContent` key
- `front/src/modules/worky/query/hooks.ts` — `useTaskResultContent`
- `front/src/modules/worky/components/ChatMessageThread.tsx` (+ test) — render message components
- `front/src/modules/worky/components/TaskDetailDrawer.tsx` (+ test) — render step components + artifacts
- `front/src/modules/worky/components/mobile/TaskDetailSheet.tsx` — same rendering (mobile)
- `front/src/modules/worky/components/WorkyStreamPage.tsx` — 3 SSE cases

**Commands** (run from repo root `C:\Users\Yellowsys\Desktop\YellowStorm-poc\YellowStorm`):
- Backend test: `cd back && npx jest <path>`
- Frontend test: `cd front && npx vitest run <path>`

---

## Task 1: Backend — Electric row contracts + 3 mappers

**Files:**
- Modify: `back/src/modules/worky/electric/worky-electric.contract.ts`
- Modify: `back/src/modules/worky/electric/worky-electric.mapper.ts`
- Test: `back/src/modules/worky/electric/worky-electric.mapper.spec.ts`

**Interfaces:**
- Produces: `PgMessageComponentRow`, `PgPlanStepComponentRow`, `PgPlanStepArtifactRow` (contract); `mapMessageComponent(row, streamId)`, `mapPlanStepComponent(row, streamId)`, `mapPlanStepArtifact(row, streamId)` each returning `{ set: Record<string, unknown>; event: Omit<WorkyEvent, 'streamId'> }`.
- Consumes: existing `Frame = Omit<WorkyEvent, 'streamId'>` and `now()` in the mapper file.

- [ ] **Step 1: Write the failing test**

Append to `back/src/modules/worky/electric/worky-electric.mapper.spec.ts` (import the three new fns in the existing top `import { ... } from './worky-electric.mapper'`):

```typescript
import {
  mapMessageComponent,
  mapPlanStepComponent,
  mapPlanStepArtifact,
} from './worky-electric.mapper';

describe('mapMessageComponent', () => {
  it('maps a component row to a projection set + append event', () => {
    const { set, event } = mapMessageComponent(
      { session_id: 's1', message_id: 'msg-1', component_id: 'c-1', ordinal: 0, type: 'text', data: { content: 'hi' }, created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set).toMatchObject({
      streamId: 'stream-1',
      externalId: 'c-1',
      messageExternalId: 'msg-1',
      ordinal: 0,
      type: 'text',
      data: { content: 'hi' },
    });
    expect(event).toMatchObject({
      type: 'message.component.appended',
      payload: { messageExternalId: 'msg-1', componentId: 'c-1' },
    });
  });

  it('parses a JSON-string data payload (Electric jsonb-as-string)', () => {
    const { set } = mapMessageComponent(
      { session_id: 's1', message_id: 'msg-1', component_id: 'c-2', ordinal: 1, type: 'code', data: '{"content":"x","language":"ts"}', created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set.data).toEqual({ content: 'x', language: 'ts' });
  });
});

describe('mapPlanStepComponent', () => {
  it('maps a step component row to a set + task.component event', () => {
    const { set, event } = mapPlanStepComponent(
      { session_id: 's1', step_id: 'step-1', component_id: 'c-9', ordinal: 2, type: 'artifact', data: { file_path: 'k/1', filename: 'a.png' }, created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set).toMatchObject({ streamId: 'stream-1', externalId: 'c-9', stepExternalId: 'step-1', ordinal: 2, type: 'artifact', data: { file_path: 'k/1', filename: 'a.png' } });
    expect(event).toMatchObject({ type: 'task.component.appended', payload: { stepExternalId: 'step-1', componentId: 'c-9' } });
  });
});

describe('mapPlanStepArtifact', () => {
  it('maps an artifact row to a set + task.artifact event', () => {
    const { set, event } = mapPlanStepArtifact(
      { session_id: 's1', step_id: 'step-1', artifact_id: 'a-1', file_path: 'key/abc', filename: 'report.pdf', artifact_kind: 'document', mime_type: 'application/pdf', size: 1234, created_at: '2026-08-13T10:00:00.000Z' },
      'stream-1',
    );
    expect(set).toMatchObject({
      streamId: 'stream-1',
      externalId: 'a-1',
      stepExternalId: 'step-1',
      filePath: 'key/abc',
      filename: 'report.pdf',
      artifactKind: 'document',
      mimeType: 'application/pdf',
      size: 1234,
    });
    expect(event).toMatchObject({ type: 'task.artifact.appended', payload: { stepExternalId: 'step-1', artifactId: 'a-1' } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/worky/electric/worky-electric.mapper.spec.ts`
Expected: FAIL — `mapMessageComponent is not a function` (and the two siblings).

- [ ] **Step 3: Add the contract interfaces**

Append to `back/src/modules/worky/electric/worky-electric.contract.ts`:

```typescript
/** One fully-formed component of a manager chat message (message_components shape). */
export interface PgMessageComponentRow {
  session_id: string;
  message_id: string; // joins messages(id)
  component_id: string;
  ordinal: number;
  type: string; // ComponentType: text|code|chart|artifact|citation|toolInfo|...
  data: unknown; // JSONB — object, or a JSON string (Electric variance)
  created_at: string;
}

/** One fully-formed component of a step result (plan_step_components shape). */
export interface PgPlanStepComponentRow {
  session_id: string;
  step_id: string; // joins plan_steps(session_id, step_id)
  component_id: string;
  ordinal: number;
  type: string;
  data: unknown;
  created_at: string;
}

/** A step file deliverable (plan_step_artifacts shape). */
export interface PgPlanStepArtifactRow {
  session_id: string;
  step_id: string;
  artifact_id: string;
  file_path: string; // storage key, stored raw
  filename: string;
  artifact_kind?: string | null; // image | data | code | document | null
  mime_type?: string | null;
  size?: number | null;
  created_at: string;
}
```

- [ ] **Step 4: Add the mappers**

Append to `back/src/modules/worky/electric/worky-electric.mapper.ts` (add the three new row types to the existing `import { ... } from './worky-electric.contract'`):

```typescript
import {
  PgMessageComponentRow,
  PgPlanStepComponentRow,
  PgPlanStepArtifactRow,
} from './worky-electric.contract';

/** Electric jsonb may arrive parsed or as a JSON string — normalize to an object. */
function normalizeJson(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function mapMessageComponent(row: PgMessageComponentRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const data = normalizeJson(row.data);
  return {
    set: {
      streamId,
      externalId: row.component_id,
      messageExternalId: row.message_id,
      ordinal: typeof row.ordinal === 'number' ? row.ordinal : 0,
      type: row.type,
      data,
    },
    event: {
      type: 'message.component.appended',
      emittedAt: now(),
      payload: { messageExternalId: row.message_id, componentId: row.component_id },
    },
  };
}

export function mapPlanStepComponent(row: PgPlanStepComponentRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  const data = normalizeJson(row.data);
  return {
    set: {
      streamId,
      externalId: row.component_id,
      stepExternalId: row.step_id,
      ordinal: typeof row.ordinal === 'number' ? row.ordinal : 0,
      type: row.type,
      data,
    },
    event: {
      type: 'task.component.appended',
      emittedAt: now(),
      payload: { stepExternalId: row.step_id, componentId: row.component_id },
    },
  };
}

export function mapPlanStepArtifact(row: PgPlanStepArtifactRow, streamId: string): { set: Record<string, unknown>; event: Frame } {
  return {
    set: {
      streamId,
      externalId: row.artifact_id,
      stepExternalId: row.step_id,
      filePath: row.file_path,
      filename: row.filename,
      artifactKind: row.artifact_kind ?? null,
      mimeType: row.mime_type ?? null,
      size: typeof row.size === 'number' ? row.size : null,
    },
    event: {
      type: 'task.artifact.appended',
      emittedAt: now(),
      payload: { stepExternalId: row.step_id, artifactId: row.artifact_id },
    },
  };
}
```

> Note: `'message.component.appended'`, `'task.component.appended'`, `'task.artifact.appended'` are added to the `WorkyEventType` union in Task 3 Step 3. If TypeScript complains here before Task 3, that's expected; the test in this task runs on transpiled JS via `ts-jest` and passes on values. If your `jest` config type-checks, do Task 3 Step 3 first (it's a one-line-per-entry edit).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd back && npx jest src/modules/worky/electric/worky-electric.mapper.spec.ts`
Expected: PASS (all existing + 4 new tests).

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/worky/electric/worky-electric.contract.ts back/src/modules/worky/electric/worky-electric.mapper.ts back/src/modules/worky/electric/worky-electric.mapper.spec.ts
git commit -m "feat(worky): electric row contracts + mappers for component/artifact shapes"
```

---

## Task 2: Backend — 3 Mongo projection schemas

**Files:**
- Create: `back/src/modules/worky/schemas/worky-message-component.schema.ts`
- Create: `back/src/modules/worky/schemas/worky-plan-step-component.schema.ts`
- Create: `back/src/modules/worky/schemas/worky-plan-step-artifact.schema.ts`

**Interfaces:**
- Produces: `WorkyMessageComponent`/`WorkyMessageComponentSchema`/`WorkyMessageComponentDocument`, `WorkyPlanStepComponent`/`...Schema`/`...Document`, `WorkyPlanStepArtifact`/`...Schema`/`...Document`. Fields per the code below. Consumed by Tasks 3, 4, 5.

These are structural files validated by the consumer tests in Task 3 (no standalone unit test — a schema has no behavior to TDD). Follow the exact `worky-message.schema.ts` pattern: `streamId: Types.ObjectId` ref, `externalId` partial-unique index, `toJSON` transform.

- [ ] **Step 1: Create `worky-message-component.schema.ts`**

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkyMessageComponentDocument = WorkyMessageComponent & Document;

@Schema({ timestamps: true, collection: 'worky_message_components' })
export class WorkyMessageComponent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /** The manager's Postgres `message_components.component_id` — idempotent upsert key. */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** Parent manager message: Postgres `messages.id` (== WorkyMessage.externalId). */
  @Prop({ type: String, required: true, index: true })
  messageExternalId!: string;

  @Prop({ type: Number, default: 0 })
  ordinal!: number;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyMessageComponentSchema = SchemaFactory.createForClass(WorkyMessageComponent);

WorkyMessageComponentSchema.index({ streamId: 1, messageExternalId: 1, ordinal: 1 });
WorkyMessageComponentSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
WorkyMessageComponentSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
```

- [ ] **Step 2: Create `worky-plan-step-component.schema.ts`**

Identical to Step 1 but `collection: 'worky_plan_step_components'`, class `WorkyPlanStepComponent`, and the parent field is `stepExternalId` (Postgres `plan_steps.step_id`):

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkyPlanStepComponentDocument = WorkyPlanStepComponent & Document;

@Schema({ timestamps: true, collection: 'worky_plan_step_components' })
export class WorkyPlanStepComponent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** Parent step: Postgres `plan_steps.step_id` (== WorkyTask.externalId). */
  @Prop({ type: String, required: true, index: true })
  stepExternalId!: string;

  @Prop({ type: Number, default: 0 })
  ordinal!: number;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Object, default: {} })
  data!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyPlanStepComponentSchema = SchemaFactory.createForClass(WorkyPlanStepComponent);

WorkyPlanStepComponentSchema.index({ streamId: 1, stepExternalId: 1, ordinal: 1 });
WorkyPlanStepComponentSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
WorkyPlanStepComponentSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
```

- [ ] **Step 3: Create `worky-plan-step-artifact.schema.ts`**

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type WorkyPlanStepArtifactDocument = WorkyPlanStepArtifact & Document;

@Schema({ timestamps: true, collection: 'worky_plan_step_artifacts' })
export class WorkyPlanStepArtifact extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  /** Postgres `plan_step_artifacts.artifact_id` — idempotent upsert key. */
  @Prop({ type: String, default: null })
  externalId?: string | null;

  /** Parent step: Postgres `plan_steps.step_id` (== WorkyTask.externalId). */
  @Prop({ type: String, required: true, index: true })
  stepExternalId!: string;

  @Prop({ type: String, required: true })
  filePath!: string;

  @Prop({ type: String, required: true })
  filename!: string;

  @Prop({ type: String, default: null })
  artifactKind?: string | null;

  @Prop({ type: String, default: null })
  mimeType?: string | null;

  @Prop({ type: Number, default: null })
  size?: number | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyPlanStepArtifactSchema = SchemaFactory.createForClass(WorkyPlanStepArtifact);

WorkyPlanStepArtifactSchema.index({ streamId: 1, stepExternalId: 1, createdAt: 1 });
WorkyPlanStepArtifactSchema.index(
  { streamId: 1, externalId: 1 },
  { unique: true, partialFilterExpression: { externalId: { $type: 'string' } } },
);
WorkyPlanStepArtifactSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
```

- [ ] **Step 4: Verify it compiles**

Run: `cd back && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from the three new files. (If the project has no root `tsconfig` build, skip — these files are exercised by Task 3's build/test.)

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/schemas/worky-message-component.schema.ts back/src/modules/worky/schemas/worky-plan-step-component.schema.ts back/src/modules/worky/schemas/worky-plan-step-artifact.schema.ts
git commit -m "feat(worky): mongo projection schemas for message/step components + step artifacts"
```

---

## Task 3: Backend — Consumer ingestion (config, events, module, subscriptions, handlers)

**Files:**
- Modify: `back/src/config/worky.config.ts`
- Modify: `back/src/modules/worky/interfaces/worky-event.interface.ts`
- Modify: `back/src/modules/worky/worky.module.ts`
- Modify: `back/src/modules/worky/services/worky-electric-consumer.service.ts`
- Test: `back/src/modules/worky/services/worky-electric-consumer.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 mappers; Task 2 schemas/models.
- Produces: `handleMessageComponents`, `handlePlanStepComponents`, `handlePlanStepArtifacts` (private); the consumer constructor now takes 3 extra `Model<...>` params appended after `cursorModel`.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `back/src/modules/worky/services/worky-electric-consumer.service.spec.ts`. First, extend the `makeService()` factory: add three mock models and three config keys, and pass them to the constructor.

In `makeService()`, add after the existing `cursorModel` mock:

```typescript
  const messageComponentModel = { findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ _id: 'mc-1' }) }) };
  const planStepComponentModel = { findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ _id: 'pc-1' }) }) };
  const planStepArtifactModel = { findOneAndUpdate: jest.fn().mockReturnValue({ exec: () => Promise.resolve({ _id: 'pa-1' }) }) };
```

Extend the config mock's key map with:

```typescript
    'worky.electricMessageComponentsTable': 'message_components',
    'worky.electricPlanStepComponentsTable': 'plan_step_components',
    'worky.electricPlanStepArtifactsTable': 'plan_step_artifacts',
```

Extend the constructor call (append the 3 models after `cursorModel as any`):

```typescript
  const service = new WorkyElectricConsumerService(
    config, streamService as any, events as any, logger as any,
    taskModel as any, messageModel as any, planProjectionModel as any, cursorModel as any,
    messageComponentModel as any, planStepComponentModel as any, planStepArtifactModel as any,
  );
```

Return the 3 new models from `makeService()` (add to the returned object), then add:

```typescript
describe('handleMessageComponents', () => {
  it('upserts a component projection and emits message.component.appended', async () => {
    const { service, messageComponentModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handleMessageComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', message_id: 'msg-1', component_id: 'c-1', ordinal: 0, type: 'text', data: { content: 'hi' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(messageComponentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'c-1' }),
      expect.objectContaining({ $set: expect.objectContaining({ externalId: 'c-1', messageExternalId: 'msg-1', type: 'text' }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'message.component.appended' }));
  });

  it('skips control frames and delete ops', async () => {
    const { service, messageComponentModel } = makeService();
    await service.handleMessageComponents([
      { headers: { control: 'up-to-date' } },
      { key: 'k', headers: { operation: 'delete' }, value: { session_id: 's1', message_id: 'm', component_id: 'c', ordinal: 0, type: 'text', data: {}, created_at: '' } },
    ]);
    expect(messageComponentModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('handlePlanStepComponents', () => {
  it('upserts and emits task.component.appended', async () => {
    const { service, planStepComponentModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handlePlanStepComponents([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', step_id: 'step-1', component_id: 'c-9', ordinal: 1, type: 'code', data: { content: 'x' }, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(planStepComponentModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'c-9' }),
      expect.objectContaining({ $set: expect.objectContaining({ stepExternalId: 'step-1', type: 'code' }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'task.component.appended' }));
  });
});

describe('handlePlanStepArtifacts', () => {
  it('upserts and emits task.artifact.appended', async () => {
    const { service, planStepArtifactModel, streamService, events } = makeService();
    streamService.findByAiSessionId.mockResolvedValue({ streamId: '507f1f77bcf86cd799439011', ownerUserId: 'u1' });
    await service.handlePlanStepArtifacts([
      { key: 'k', headers: { operation: 'insert' }, value: { session_id: 's1', step_id: 'step-1', artifact_id: 'a-1', file_path: 'key/abc', filename: 'r.pdf', artifact_kind: 'document', mime_type: 'application/pdf', size: 5, created_at: '2026-08-13T10:00:00.000Z' } },
    ]);
    expect(planStepArtifactModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'a-1' }),
      expect.objectContaining({ $set: expect.objectContaining({ stepExternalId: 'step-1', filePath: 'key/abc', filename: 'r.pdf' }) }),
      expect.objectContaining({ upsert: true }),
    );
    expect(events.emit).toHaveBeenCalledWith('u1', '507f1f77bcf86cd799439011', expect.objectContaining({ type: 'task.artifact.appended' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/worky/services/worky-electric-consumer.service.spec.ts`
Expected: FAIL — constructor arity / `handleMessageComponents is not a function`.

- [ ] **Step 3: Add config vars + event types**

In `back/src/config/worky.config.ts`, after line 53 (`electricPlanStepsTable: ...`):

```typescript
    electricMessageComponentsTable: process.env.WORKY_ELECTRIC_MESSAGE_COMPONENTS_TABLE || 'message_components',
    electricPlanStepComponentsTable: process.env.WORKY_ELECTRIC_PLAN_STEP_COMPONENTS_TABLE || 'plan_step_components',
    electricPlanStepArtifactsTable: process.env.WORKY_ELECTRIC_PLAN_STEP_ARTIFACTS_TABLE || 'plan_step_artifacts',
```

In `back/src/modules/worky/interfaces/worky-event.interface.ts`, add to the `WorkyEventType` union (e.g. after `'task.completed'`):

```typescript
  | 'message.component.appended'
  | 'task.component.appended'
  | 'task.artifact.appended'
```

- [ ] **Step 4: Register the 3 schemas in the module**

In `back/src/modules/worky/worky.module.ts`, add three import blocks near the other schema imports (~lines 50-145):

```typescript
import { WorkyMessageComponent, WorkyMessageComponentSchema } from './schemas/worky-message-component.schema';
import { WorkyPlanStepComponent, WorkyPlanStepComponentSchema } from './schemas/worky-plan-step-component.schema';
import { WorkyPlanStepArtifact, WorkyPlanStepArtifactSchema } from './schemas/worky-plan-step-artifact.schema';
```

And add to the `MongooseModule.forFeature([...])` array (near line 214, by the other Electric projections):

```typescript
    { name: WorkyMessageComponent.name, schema: WorkyMessageComponentSchema },
    { name: WorkyPlanStepComponent.name, schema: WorkyPlanStepComponentSchema },
    { name: WorkyPlanStepArtifact.name, schema: WorkyPlanStepArtifactSchema },
```

- [ ] **Step 5: Wire subscriptions + handlers in the consumer**

In `back/src/modules/worky/services/worky-electric-consumer.service.ts`:

(a) Add imports at top:

```typescript
import { WorkyMessageComponent, WorkyMessageComponentDocument } from '../schemas/worky-message-component.schema';
import { WorkyPlanStepComponent, WorkyPlanStepComponentDocument } from '../schemas/worky-plan-step-component.schema';
import { WorkyPlanStepArtifact, WorkyPlanStepArtifactDocument } from '../schemas/worky-plan-step-artifact.schema';
import { PgMessageComponentRow, PgPlanStepComponentRow, PgPlanStepArtifactRow } from '../electric/worky-electric.contract';
import { mapMessageComponent, mapPlanStepComponent, mapPlanStepArtifact } from '../electric/worky-electric.mapper';
```

(b) Add three constructor params (append after `cursorModel`):

```typescript
    @InjectModel(WorkyMessageComponent.name) private readonly messageComponentModel: Model<WorkyMessageComponentDocument>,
    @InjectModel(WorkyPlanStepComponent.name) private readonly planStepComponentModel: Model<WorkyPlanStepComponentDocument>,
    @InjectModel(WorkyPlanStepArtifact.name) private readonly planStepArtifactModel: Model<WorkyPlanStepArtifactDocument>,
```

(c) In `onModuleInit`, after the `plan_steps` subscribe:

```typescript
    await this.subscribe(
      'message_components',
      this.config.get<string>('worky.electricMessageComponentsTable')!,
      (m) => this.handleMessageComponents(m),
    );
    await this.subscribe(
      'plan_step_components',
      this.config.get<string>('worky.electricPlanStepComponentsTable')!,
      (m) => this.handlePlanStepComponents(m),
    );
    await this.subscribe(
      'plan_step_artifacts',
      this.config.get<string>('worky.electricPlanStepArtifactsTable')!,
      (m) => this.handlePlanStepArtifacts(m),
    );
```

(d) Add the three handlers (mirror `handlePlanSteps` exactly — control skip, `isChangeMessage` guard, delete skip, `findByAiSessionId`, `toStreamOid`, map, upsert on `{ streamId, externalId }`, emit, per-row try/catch):

```typescript
  async handleMessageComponents(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) continue;
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      try {
        const row = m.value as unknown as PgMessageComponentRow;
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'message_components', sid: row.session_id });
          continue;
        }
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapMessageComponent(row, target.streamId);
        await this.messageComponentModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.component_id },
            { $set: { ...set, streamId: streamOid } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process message_component row', { error: (err as Error).message });
        continue;
      }
    }
  }

  async handlePlanStepComponents(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) continue;
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      try {
        const row = m.value as unknown as PgPlanStepComponentRow;
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'plan_step_components', sid: row.session_id });
          continue;
        }
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapPlanStepComponent(row, target.streamId);
        await this.planStepComponentModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.component_id },
            { $set: { ...set, streamId: streamOid } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process plan_step_component row', { error: (err as Error).message });
        continue;
      }
    }
  }

  async handlePlanStepArtifacts(messages: unknown[]): Promise<void> {
    for (const m of messages as any[]) {
      if (isControlMessage(m)) continue;
      if (!isChangeMessage(m)) continue;
      if (m.headers.operation === 'delete') continue;
      try {
        const row = m.value as unknown as PgPlanStepArtifactRow;
        const target = await this.streamService.findByAiSessionId(row.session_id);
        if (!target) {
          this.logger.warn('[worky-electric] unknown session', { shape: 'plan_step_artifacts', sid: row.session_id });
          continue;
        }
        const streamOid = this.toStreamOid(target.streamId);
        const { set, event } = mapPlanStepArtifact(row, target.streamId);
        await this.planStepArtifactModel
          .findOneAndUpdate(
            { streamId: streamOid, externalId: row.artifact_id },
            { $set: { ...set, streamId: streamOid } },
            { upsert: true, new: true, setDefaultsOnInsert: true },
          )
          .exec();
        this.events.emit(target.ownerUserId, target.streamId, event);
      } catch (err) {
        this.logger.error('Failed to process plan_step_artifact row', { error: (err as Error).message });
        continue;
      }
    }
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd back && npx jest src/modules/worky/services/worky-electric-consumer.service.spec.ts src/modules/worky/electric/worky-electric.mapper.spec.ts`
Expected: PASS (existing consumer tests still green after the constructor/factory change; 4 new handler tests pass).

- [ ] **Step 7: Commit**

```bash
git add back/src/config/worky.config.ts back/src/modules/worky/interfaces/worky-event.interface.ts back/src/modules/worky/worky.module.ts back/src/modules/worky/services/worky-electric-consumer.service.ts back/src/modules/worky/services/worky-electric-consumer.service.spec.ts
git commit -m "feat(worky): consume message/step component + artifact electric shapes"
```

---

## Task 4: Backend — Attach `components` to message history

**Files:**
- Modify: `back/src/modules/worky/services/worky-planning.service.ts`
- Modify: `back/src/modules/worky/controllers/worky-message.controller.ts`
- Test: `back/src/modules/worky/services/worky-planning.service.spec.ts` (create if absent, or add a focused describe)

**Interfaces:**
- Consumes: `WorkyMessageComponent` model (Task 2).
- Produces: `listMessages` return objects now carry `components: Array<{ id: string; type: string; data: Record<string, unknown> }>` (empty array when none).

- [ ] **Step 1: Write the failing test**

Create/extend `back/src/modules/worky/services/worky-planning.service.spec.ts`. Because `WorkyPlanningService` has many deps, test `listMessages` with hand-rolled mocks for only the models it touches. Add:

```typescript
describe('WorkyPlanningService.listMessages components', () => {
  it('attaches sorted components to each message by messageExternalId', async () => {
    const messages = {
      find: jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([
        { _id: { toString: () => 'mid-1' }, role: 'manager', content: 'hi', planDeltaRef: null, externalId: 'pg-msg-1', createdAt: new Date('2026-08-13T10:00:00Z') },
        { _id: { toString: () => 'mid-2' }, role: 'owner', content: 'yo', planDeltaRef: null, externalId: 'pg-msg-2', createdAt: new Date('2026-08-13T10:01:00Z') },
      ]) }) }) }) }),
    };
    const messageComponents = {
      find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: () => Promise.resolve([
        { externalId: 'c-2', messageExternalId: 'pg-msg-1', ordinal: 1, type: 'code', data: { content: 'x' } },
        { externalId: 'c-1', messageExternalId: 'pg-msg-1', ordinal: 0, type: 'text', data: { content: 'hi' } },
      ]) }) }) }),
    };
    // Minimal service with only the fields listMessages uses. Adapt to the real
    // constructor: pass real deps as needed, or instantiate and override the two
    // model fields directly:
    const service: any = Object.create(WorkyPlanningService.prototype);
    service.messages = messages;
    service.messageComponents = messageComponents;
    service.loadStream = jest.fn().mockResolvedValue({});

    const result = await service.listMessages('user-1', '507f1f77bcf86cd799439011', 200);
    const manager = result.find((r: any) => r.id === 'mid-1');
    expect(manager.components).toEqual([
      { id: 'c-1', type: 'text', data: { content: 'hi' } },
      { id: 'c-2', type: 'code', data: { content: 'x' } },
    ]);
    const owner = result.find((r: any) => r.id === 'mid-2');
    expect(owner.components).toEqual([]);
  });
});
```

> If the real `WorkyPlanningService` constructor is heavy, the `Object.create(prototype)` + field-injection approach above avoids DI. Confirm the private field name for the messages model (the agent reported `private readonly messages`); the new field added in Step 3 is `messageComponents`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/worky/services/worky-planning.service.spec.ts -t "listMessages components"`
Expected: FAIL — `components` undefined (and `service.messageComponents` unused).

- [ ] **Step 3: Implement**

In `worky-planning.service.ts`:

(a) Inject the model (add to constructor + imports):

```typescript
import { WorkyMessageComponent, WorkyMessageComponentDocument } from '../schemas/worky-message-component.schema';
// ...
    @InjectModel(WorkyMessageComponent.name) private readonly messageComponents: Model<WorkyMessageComponentDocument>,
```

(b) Rewrite `listMessages` (lines ~178-197) to fetch + attach components:

```typescript
  async listMessages(
    userId: string,
    streamId: string,
    limit = 200,
  ): Promise<Array<{ id: string; role: string; content: string; planDeltaRef: string | null; createdAt: string; components: Array<{ id: string; type: string; data: Record<string, unknown> }> }>> {
    await this.loadStream(streamId, userId);
    const docs = await this.messages
      .find({ streamId: new Types.ObjectId(streamId) })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()
      .exec();

    const externalIds = docs.map((m) => m.externalId).filter((v): v is string => typeof v === 'string');
    const componentDocs = externalIds.length
      ? await this.messageComponents
          .find({ streamId: new Types.ObjectId(streamId), messageExternalId: { $in: externalIds } })
          .sort({ ordinal: 1 })
          .lean()
          .exec()
      : [];

    const byMessage = new Map<string, Array<{ id: string; type: string; data: Record<string, unknown> }>>();
    for (const c of componentDocs) {
      const key = c.messageExternalId as string;
      const list = byMessage.get(key) ?? [];
      list.push({ id: (c.externalId as string) ?? '', type: c.type as string, data: (c.data as Record<string, unknown>) ?? {} });
      byMessage.set(key, list);
    }

    return docs.map((m) => ({
      id: (m._id as Types.ObjectId).toString(),
      role: m.role as string,
      content: m.content as string,
      planDeltaRef: m.planDeltaRef ? (m.planDeltaRef as Types.ObjectId).toString() : null,
      createdAt: (m.createdAt as Date).toISOString(),
      components: typeof m.externalId === 'string' ? byMessage.get(m.externalId) ?? [] : [],
    }));
  }
```

(c) In `worky-message.controller.ts`, widen the `listMessages` return-type annotation (line ~91) to add `components`:

```typescript
  ): Promise<Array<{ id: string; role: string; content: string; planDeltaRef: string | null; createdAt: string; components: Array<{ id: string; type: string; data: Record<string, unknown> }> }>> {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && npx jest src/modules/worky/services/worky-planning.service.spec.ts -t "listMessages components"`
Expected: PASS. Also run the full worky suite to confirm no regressions: `cd back && npx jest src/modules/worky`.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/services/worky-planning.service.ts back/src/modules/worky/controllers/worky-message.controller.ts back/src/modules/worky/services/worky-planning.service.spec.ts
git commit -m "feat(worky): include message components inline in message history"
```

---

## Task 5: Backend — Step result-content endpoint (`components` + `artifacts`)

**Files:**
- Modify: `back/src/modules/worky/services/worky-task.service.ts`
- Modify: `back/src/modules/worky/controllers/worky-task.controller.ts`
- Test: `back/src/modules/worky/services/worky-task.service.spec.ts` (create/extend)

**Interfaces:**
- Consumes: `WorkyTask`, `WorkyPlanStepComponent`, `WorkyPlanStepArtifact` models.
- Produces: `WorkyTaskService.getResultContent(taskId: string): Promise<{ components: Array<{ id: string; type: string; data: Record<string, unknown> }>; artifacts: Array<{ id: string; filePath: string; filename: string; artifactKind: string | null; mimeType: string | null; size: number | null; createdAt: string }> }>`; route `GET /worky/tasks/:id/result-content`.

- [ ] **Step 1: Write the failing test**

Add to `back/src/modules/worky/services/worky-task.service.spec.ts`:

```typescript
describe('WorkyTaskService.getResultContent', () => {
  it('returns sorted components + artifacts for a task, keyed by externalId', async () => {
    const task = { streamId: { toString: () => 'stream-oid' }, externalId: 'step-1' };
    const tasks = { findById: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(task) }) }) };
    const stepComponents = { find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: () => Promise.resolve([
      { externalId: 'c-1', ordinal: 0, type: 'text', data: { content: 'done' } },
    ]) }) }) }) };
    const stepArtifacts = { find: jest.fn().mockReturnValue({ sort: () => ({ lean: () => ({ exec: () => Promise.resolve([
      { externalId: 'a-1', filePath: 'k/1', filename: 'r.pdf', artifactKind: 'document', mimeType: 'application/pdf', size: 9, createdAt: new Date('2026-08-13T10:00:00Z') },
    ]) }) }) }) };

    const service: any = Object.create(WorkyTaskService.prototype);
    service.tasks = tasks;
    service.stepComponents = stepComponents;
    service.stepArtifacts = stepArtifacts;

    const out = await service.getResultContent('507f1f77bcf86cd799439011');
    expect(out.components).toEqual([{ id: 'c-1', type: 'text', data: { content: 'done' } }]);
    expect(out.artifacts).toEqual([{ id: 'a-1', filePath: 'k/1', filename: 'r.pdf', artifactKind: 'document', mimeType: 'application/pdf', size: 9, createdAt: '2026-08-13T10:00:00.000Z' }]);
  });

  it('returns empty arrays for an invalid task id', async () => {
    const service: any = Object.create(WorkyTaskService.prototype);
    const out = await service.getResultContent('not-an-objectid');
    expect(out).toEqual({ components: [], artifacts: [] });
  });
});
```

> Confirm the real private field name for the tasks model in `worky-task.service.ts` (it may be `taskModel` rather than `tasks`). Match the test's injected field names to the real ones.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/worky/services/worky-task.service.spec.ts -t "getResultContent"`
Expected: FAIL — `getResultContent is not a function`.

- [ ] **Step 3: Implement the service method**

In `worky-task.service.ts`:

(a) Inject the two new models (imports + constructor):

```typescript
import { WorkyPlanStepComponent, WorkyPlanStepComponentDocument } from '../schemas/worky-plan-step-component.schema';
import { WorkyPlanStepArtifact, WorkyPlanStepArtifactDocument } from '../schemas/worky-plan-step-artifact.schema';
// ...
    @InjectModel(WorkyPlanStepComponent.name) private readonly stepComponents: Model<WorkyPlanStepComponentDocument>,
    @InjectModel(WorkyPlanStepArtifact.name) private readonly stepArtifacts: Model<WorkyPlanStepArtifactDocument>,
```

(b) Add the method (use the real tasks-model field name in place of `this.tasks`):

```typescript
  async getResultContent(taskId: string): Promise<{
    components: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    artifacts: Array<{ id: string; filePath: string; filename: string; artifactKind: string | null; mimeType: string | null; size: number | null; createdAt: string }>;
  }> {
    if (!Types.ObjectId.isValid(taskId)) return { components: [], artifacts: [] };
    const task = await this.tasks.findById(new Types.ObjectId(taskId)).lean().exec();
    if (!task || typeof task.externalId !== 'string') return { components: [], artifacts: [] };
    const filter = { streamId: task.streamId as Types.ObjectId, stepExternalId: task.externalId };

    const [componentDocs, artifactDocs] = await Promise.all([
      this.stepComponents.find(filter).sort({ ordinal: 1 }).lean().exec(),
      this.stepArtifacts.find(filter).sort({ createdAt: 1 }).lean().exec(),
    ]);

    return {
      components: componentDocs.map((c) => ({ id: (c.externalId as string) ?? '', type: c.type as string, data: (c.data as Record<string, unknown>) ?? {} })),
      artifacts: artifactDocs.map((a) => ({
        id: (a.externalId as string) ?? '',
        filePath: a.filePath as string,
        filename: a.filename as string,
        artifactKind: (a.artifactKind as string | null) ?? null,
        mimeType: (a.mimeType as string | null) ?? null,
        size: (a.size as number | null) ?? null,
        createdAt: (a.createdAt as Date).toISOString(),
      })),
    };
  }
```

(c) In `worky-task.controller.ts`, add the route (mirror the existing `results` method's guards):

```typescript
  @Get(':id/result-content')
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  async resultContent(@Param('id') id: string) {
    return this.tasks.getResultContent(id);
  }
```

> Use the real injected service field name in the controller (the agent showed `this.taskResults` for results; the task service is likely injected as `this.tasks` or `this.taskService` — match it). Place near the existing `results` method.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && npx jest src/modules/worky/services/worky-task.service.spec.ts -t "getResultContent"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/worky/services/worky-task.service.ts back/src/modules/worky/controllers/worky-task.controller.ts back/src/modules/worky/services/worky-task.service.spec.ts
git commit -m "feat(worky): task result-content endpoint (step components + artifacts)"
```

---

## Task 6: Frontend — worky types

**Files:**
- Modify: `front/src/modules/worky/types.ts`

**Interfaces:**
- Produces: `WorkyMessage.components?: MessageComponent[]`; `WorkyArtifact`; `WorkyTaskResultContent`; three new `WorkyEventType` members.
- Consumes: `MessageComponent` from `@/modules/conversation/types`.

- [ ] **Step 1: Add types (no standalone test — compile-checked; consumed by Tasks 7-9)**

At the top of `front/src/modules/worky/types.ts`:

```typescript
import type { MessageComponent } from '@/modules/conversation/types';
export type { MessageComponent };
```

Extend `WorkyMessage` (lines ~148-154) with:

```typescript
  /** Manager-message components (Electric message_components). Absent/empty → render plain `content`. */
  components?: MessageComponent[];
```

Add new interfaces (near `WorkyTaskResult`):

```typescript
export interface WorkyArtifact {
  id: string;
  filePath: string;
  filename: string;
  artifactKind: string | null;
  mimeType: string | null;
  size: number | null;
  createdAt: string;
}

/** Lazy step-result payload from GET /worky/tasks/:id/result-content. */
export interface WorkyTaskResultContent {
  components: MessageComponent[];
  artifacts: WorkyArtifact[];
}
```

Add to the `WorkyEventType` union (after `'message.appended'`):

```typescript
  | 'message.component.appended'
  | 'task.component.appended'
  | 'task.artifact.appended'
```

- [ ] **Step 2: Verify it compiles**

Run: `cd front && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/worky/types.ts
git commit -m "feat(worky): frontend types for message/step components + artifacts"
```

---

## Task 7: Frontend — API + query hook for result-content

**Files:**
- Modify: `front/src/lib/api/config.ts`
- Modify: `front/src/modules/worky/api.ts`
- Modify: `front/src/modules/worky/query/queryKeys.ts`
- Modify: `front/src/modules/worky/query/hooks.ts`

**Interfaces:**
- Produces: `API_ENDPOINTS.worky.taskResultContent(taskId)`; `getTaskResultContent(taskId): Promise<WorkyTaskResultContent>`; `workyKeys.taskResultContent(taskId)`; `useTaskResultContent(taskId)`.

- [ ] **Step 1: Add the endpoint constant**

In `front/src/lib/api/config.ts`, in the `worky` endpoints group next to `taskResults`:

```typescript
    taskResultContent: (taskId: string) => `/worky/tasks/${taskId}/result-content`,
```

- [ ] **Step 2: Add the api fetcher**

In `front/src/modules/worky/api.ts` (after `getTaskResults`, import the type):

```typescript
import type { WorkyTaskResultContent } from './types';

export async function getTaskResultContent(taskId: string): Promise<WorkyTaskResultContent> {
  const response = await apiClient.get<ApiResponse<WorkyTaskResultContent>>(
    API_ENDPOINTS.worky.taskResultContent(taskId),
  );
  return unwrap(response);
}
```

- [ ] **Step 3: Add the query key + hook**

In `front/src/modules/worky/query/queryKeys.ts`, add to `workyKeys`:

```typescript
  taskResultContent: (id: string) => [...workyKeys.all, 'task-result-content', id] as const,
```

In `front/src/modules/worky/query/hooks.ts` (mirror `useTaskResults`):

```typescript
export function useTaskResultContent(taskId: string | null | undefined) {
  return useQuery({
    queryKey: taskId ? workyKeys.taskResultContent(taskId) : ['worky', 'task-result-content', 'noop'],
    queryFn: () => {
      if (!taskId) throw new Error('taskId is required');
      return api.getTaskResultContent(taskId);
    },
    enabled: Boolean(taskId),
  });
}
```

- [ ] **Step 4: Verify it compiles**

Run: `cd front && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add front/src/lib/api/config.ts front/src/modules/worky/api.ts front/src/modules/worky/query/queryKeys.ts front/src/modules/worky/query/hooks.ts
git commit -m "feat(worky): api + query hook for task result-content"
```

---

## Task 8: Frontend — render manager message components in the chat

**Files:**
- Modify: `front/src/modules/worky/components/ChatMessageThread.tsx`
- Test: `front/src/modules/worky/components/ChatMessageThread.test.tsx` (create)

**Interfaces:**
- Consumes: `mapComponentsToContentParts` (`@/modules/conversation/utils`), `AIMessageContent` + `MessageProvider` (`@/components/ai-elements/*`), `WorkyMessage.components` (Task 6).

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/worky/components/ChatMessageThread.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMessageThread } from './ChatMessageThread';
import { useWorkyStore } from '../store';
import type { WorkyMessage } from '../types';

// Localization + TTS are irrelevant here; mock the module hook to identity.
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../api', () => ({ synthesizeSpeech: vi.fn() }));

const managerMsg = (over: Partial<WorkyMessage>): WorkyMessage => ({
  id: 'm1', role: 'manager', content: 'plain fallback', planDeltaRef: null, createdAt: '2026-08-13T10:00:00.000Z', ...over,
});

beforeEach(() => useWorkyStore.getState().reset());

describe('ChatMessageThread manager components', () => {
  it('renders components when present (not the plain content)', () => {
    useWorkyStore.getState().setMessages([
      managerMsg({ id: 'm1', content: 'plain fallback', components: [{ id: 'c1', type: 'text', data: { content: 'rich component text' } }] }),
    ]);
    render(<ChatMessageThread />);
    expect(screen.getByText('rich component text')).toBeInTheDocument();
    expect(screen.queryByText('plain fallback')).not.toBeInTheDocument();
  });

  it('falls back to plain content when no components', () => {
    useWorkyStore.getState().setMessages([managerMsg({ id: 'm2', content: 'just text' })]);
    render(<ChatMessageThread />);
    expect(screen.getByText('just text')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/worky/components/ChatMessageThread.test.tsx`
Expected: FAIL — "rich component text" not found (bubble still renders `content`).

- [ ] **Step 3: Implement**

In `ChatMessageThread.tsx`, add imports:

```typescript
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
```

Replace the `MessageBubble` content `<p>` (lines ~104-106) with a component-vs-text branch:

```tsx
        {message.components && message.components.length > 0 ? (
          <div className='mt-0.5'>
            <MessageProvider>
              <AIMessageContent parts={mapComponentsToContentParts(message.components)} />
            </MessageProvider>
          </div>
        ) : (
          <p className='mt-0.5 whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90'>
            {message.content}
          </p>
        )}
```

> Owner bubbles: owner messages have no `components` (backend returns `[]`), so they always hit the text branch — no extra guard needed. Keep the TTS effect untouched (it already reads `message.content`, which the manager still populates).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/worky/components/ChatMessageThread.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/components/ChatMessageThread.tsx front/src/modules/worky/components/ChatMessageThread.test.tsx
git commit -m "feat(worky): render manager message components in chat thread"
```

---

## Task 9: Frontend — render step components + artifacts in the task drawer

**Files:**
- Modify: `front/src/modules/worky/components/TaskDetailDrawer.tsx`
- Modify: `front/src/modules/worky/components/mobile/TaskDetailSheet.tsx`
- Test: `front/src/modules/worky/components/TaskDetailDrawer.test.tsx` (create)

**Interfaces:**
- Consumes: `useTaskResultContent` (Task 7), `mapComponentsToContentParts`, `AIMessageContent`, `WorkyArtifact`.
- Produces: a shared helper `buildResultParts(content)` (co-located, exported for the test) that maps `{ components, artifacts }` → `MessageContentPart[]` (artifacts appended as `{ type: 'artifact', filePath, filename }`).

- [ ] **Step 1: Write the failing test**

Create `front/src/modules/worky/components/TaskDetailDrawer.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { buildResultParts } from './TaskDetailDrawer';
import type { WorkyTaskResultContent } from '../types';

describe('buildResultParts', () => {
  it('maps components then appends artifacts as artifact parts', () => {
    const content: WorkyTaskResultContent = {
      components: [{ id: 'c1', type: 'text', data: { content: 'summary' } }],
      artifacts: [{ id: 'a1', filePath: 'key/x', filename: 'out.png', artifactKind: 'image', mimeType: 'image/png', size: 10, createdAt: '2026-08-13T10:00:00.000Z' }],
    };
    const parts = buildResultParts(content);
    expect(parts[0]).toEqual({ type: 'text', content: 'summary' });
    expect(parts).toContainEqual({ type: 'artifact', filePath: 'key/x', filename: 'out.png' });
  });

  it('returns empty array for empty content', () => {
    expect(buildResultParts({ components: [], artifacts: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd front && npx vitest run src/modules/worky/components/TaskDetailDrawer.test.tsx`
Expected: FAIL — `buildResultParts` is not exported.

- [ ] **Step 3: Implement**

In `TaskDetailDrawer.tsx`:

(a) Add imports:

```typescript
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import type { MessageContentPart } from '@/components/ai-elements/ai-message-content';
import { useTaskResultContent } from '../query/hooks';
import type { WorkyTaskResultContent } from '../types';
```

(b) Add the exported helper (top-level in the file):

```typescript
/** Flattens step result-content into renderable parts: components first, then
 *  artifacts as downloadable `artifact` parts (rendered by ArtifactPartRenderer). */
export function buildResultParts(content: WorkyTaskResultContent): MessageContentPart[] {
  const componentParts = mapComponentsToContentParts(content.components);
  const artifactParts: MessageContentPart[] = content.artifacts.map((a) => ({
    type: 'artifact',
    filePath: a.filePath,
    filename: a.filename,
  }));
  return [...componentParts, ...artifactParts];
}
```

(c) In the drawer body, call `useTaskResultContent(task?.id)` alongside the existing `useTaskResults`, and change the Results tab (lines ~69-83) to prefer rich content:

```tsx
  const resultContent = useTaskResultContent(task?.id);
  const richParts = resultContent.data ? buildResultParts(resultContent.data) : [];
```

```tsx
        <TabsContent value='results' className='space-y-3'>
          {richParts.length > 0 ? (
            <div className='rounded-md border border-border bg-background px-3 py-2'>
              <MessageProvider>
                <AIMessageContent parts={richParts} />
              </MessageProvider>
            </div>
          ) : task.result ? (
            <div className='rounded-md border border-border bg-background px-3 py-2'>
              <MessageProvider>
                <AIMessageContent parts={[{ type: 'text', content: task.result }]} />
              </MessageProvider>
            </div>
          ) : results.isLoading || resultContent.isLoading ? (
            <p className='text-xs text-muted-foreground'>{tWorky('taskDetail.results.loading')}</p>
          ) : latestResult ? (
            <TaskResultPanel result={latestResult} />
          ) : (
            <p className='text-xs text-muted-foreground'>{tWorky('taskDetail.results.empty')}</p>
          )}
        </TabsContent>
```

(d) Apply the same rich-parts rendering to the mobile `TaskDetailSheet.tsx` Results section (import `buildResultParts` + `useTaskResultContent` from the same places and mirror the branch). If `TaskDetailSheet` renders results differently, insert the `richParts.length > 0` branch ahead of its existing `task.result` branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd front && npx vitest run src/modules/worky/components/TaskDetailDrawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/worky/components/TaskDetailDrawer.tsx front/src/modules/worky/components/mobile/TaskDetailSheet.tsx front/src/modules/worky/components/TaskDetailDrawer.test.tsx
git commit -m "feat(worky): render step components + artifacts in task detail drawer"
```

---

## Task 10: Frontend — SSE live invalidation for the 3 new events

**Files:**
- Modify: `front/src/modules/worky/components/WorkyStreamPage.tsx`

**Interfaces:**
- Consumes: the 3 new `WorkyEventType` members (Task 6); `workyKeys.messages/board` + the `taskResultContent` key prefix.

- [ ] **Step 1: Add the three cases**

In `WorkyStreamPage.tsx`, insert before `default:` (line ~243) in the SSE `switch`. These are **invalidation-only** (matching `task.updated`) — they read no payload, so the backend `payload`/frontend `data` naming difference is irrelevant:

```tsx
        case 'message.component.appended': {
          void qc.invalidateQueries({ queryKey: workyKeys.messages(streamId) });
          break;
        }
        case 'task.component.appended':
        case 'task.artifact.appended': {
          void qc.invalidateQueries({ queryKey: workyKeys.board(streamId) });
          // Refetch whichever task drawer is open (keyed by Mongo taskId, which the
          // event's stepExternalId doesn't give us — invalidate the whole family).
          void qc.invalidateQueries({ queryKey: ['worky', 'task-result-content'] });
          break;
        }
```

> `qc` is already in the effect's dependency array; no deps change needed. `workyKeys` is already imported.

- [ ] **Step 2: Verify it compiles + full frontend suite is green**

Run: `cd front && npx tsc --noEmit`
Then: `cd front && npx vitest run src/modules/worky`
Expected: no type errors; all worky tests pass (including Tasks 8-9).

- [ ] **Step 3: Manual smoke check (documented, not automated)**

With the backend running against a manager that writes the new tables (or a seeded Postgres), confirm: (a) a manager message with component rows renders rich (code/artifact) after a brief text-fallback flash; (b) opening a completed step's drawer shows its components + downloadable artifacts; (c) voice/TTS/board/clarifications still behave as before. If no manager is available, note this as pending integration verification.

- [ ] **Step 4: Commit**

```bash
git add front/src/modules/worky/components/WorkyStreamPage.tsx
git commit -m "feat(worky): live-invalidate message/step components + artifacts over SSE"
```

---

## Self-Review

**Spec coverage:**
- Data model — 3 Postgres shapes → contracts (Task 1) + projections (Task 2). ✓
- Manager emits components / no token stream — mappers pass through complete rows; no merge logic. ✓
- Dedicated `plan_step_artifacts` for steps; chat files as inline artifact components — Task 2/3 (artifact projection) + Task 8 (message artifact components render via the same mapper `artifact` case). ✓
- Nest adapter (contract/mapper/config/schemas/events/consumer) — Tasks 1-3. ✓
- REST: messages inline (Task 4), step content lazy endpoint (Task 5). ✓
- Artifact download reuse — Task 9 renders `type='artifact'` parts, which use the existing `getArtifactDownloadUrl`; no new download code. ✓
- Frontend reuse via cross-module import — Tasks 8-9 import `mapComponentsToContentParts`; conversation module untouched. ✓
- Chat render swap (Task 8), step render swap (Task 9), SSE routing (Task 10). ✓
- Backward compat — Task 8 (text fallback), Task 9 (`task.result` fallback), owner/voice messages have no components. ✓
- TTS keeps `content` — Task 8 note; effect untouched. ✓
- Testing — mapper (Task 1), consumer (Task 3), listMessages (Task 4), result-content (Task 5), chat render (Task 8), result parts (Task 9). ✓
- Non-regression — no voice/board/clarification files touched; existing consumer tests updated for constructor arity (Task 3). ✓

**Placeholder scan:** No TBD/TODO. Two "confirm the real private field name" notes (Tasks 4, 5) are real-codebase-verification instructions with a concrete fallback approach (`Object.create` + field injection), not placeholders. The manual smoke check (Task 10 Step 3) is explicitly documented-not-automated because it needs a live manager.

**Type consistency:** The `{ id, type, data }` component wire shape is identical across Task 4 (messages), Task 5 (steps), and the frontend `MessageComponent`. `WorkyArtifact`/artifact wire fields (`filePath`, `filename`, `artifactKind`, `mimeType`, `size`, `createdAt`) match between Task 5 (backend map) and Task 6 (frontend type). Event names `message.component.appended` / `task.component.appended` / `task.artifact.appended` match across mapper (Task 1), event union (Task 3 backend + Task 6 frontend), and SSE switch (Task 10). Consumer constructor arity change (Task 3) is reflected in its spec factory. ✓

## Risks / verification-at-implementation

- **Private field names** in `WorkyPlanningService` (messages model) and `WorkyTaskService` (tasks model, injected service name in the controller) must be read from the real files before wiring Tasks 4/5 — the plan flags each spot.
- **JSONB decoding** by `@electric-sql/client` (object vs string) is handled by `normalizeJson` (Task 1) defensively.
- **`tsc`/`jest` type-checking order** between Task 1 (mappers reference new event types) and Task 3 (adds them): if the backend Jest config type-checks strictly, do Task 3 Step 3 before Task 1 Step 5 (noted in Task 1).
- **Manager contract:** the three Postgres tables are produced by the external manager team; our side is fully testable with synthetic Electric rows, but end-to-end needs the manager to emit them.
```
