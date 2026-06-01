# Conversation V2 — ObjectId Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch Conversation V2's canonical session identifier from the AI service's UUID `session_id` to the Mongo document's `_id` (ObjectId). Demote the AI's id to optional `aiSessionId` metadata used only by the gRPC client.

**Architecture:** Doc-first creation (insert empty pointer → get `_id` → create system workspace using `_id` → call gRPC.CreateSession → patch the doc with `aiSessionId`). Controllers look up pointers by `_id`, then resolve `aiSessionId` from the pointer when they need to call gRPC. Frontend is unchanged — wire-side field name `sessionId` stays, only the value format changes (24-char hex instead of 36-char UUID).

**Tech Stack:** NestJS, Mongoose (backend); React, Zustand (frontend); Jest, Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-05-25-conversation-v2-objectid-migration-design.md`

---

## File map

**Backend — modify:**
- `back/src/modules/conversation-v2/schemas/conversation-v2-session.schema.ts` (rename `sessionId` → `aiSessionId`; index changes)
- `back/src/modules/conversation-v2/services/conversation-v2-session.service.ts` (`createDraft`, `attachAiSession`, `deleteDraft`; rewrite lookups by `_id`; remove `createForUser`; update `toSummary`)
- `back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts`
- `back/src/modules/conversation-v2/conversation-v2.controller.ts` (`createSession` rewrite; response shape uses `_id`)
- `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`
- `back/src/modules/conversation-v2/conversation-v2-stream.controller.ts` (resolve pointer + aiSessionId for gRPC)
- `back/src/modules/conversation-v2/conversation-v2-stream.controller.spec.ts`
- `back/src/modules/conversation-v2/guards/conversation-v2-owner.guard.ts` (tolerate malformed hex)
- `back/src/modules/conversation-v2/guards/conversation-v2-owner.guard.spec.ts`

**Frontend:** no changes.

---

## Task 1: Rename `sessionId` → `aiSessionId` on the schema

**Files:**
- Modify: `back/src/modules/conversation-v2/schemas/conversation-v2-session.schema.ts`

- [ ] **Step 1: Replace the prop and the index**

Find the existing `sessionId` prop:

```ts
  @Prop({ required: true, unique: true })
  sessionId!: string;
```

Replace with:

```ts
  // AI service's session id (returned by gRPC.CreateSession). Optional
  // because it's only set AFTER gRPC succeeds — doc-first creation inserts
  // the pointer with aiSessionId=null, then patches it. Stored only for
  // gRPC routing; never exposed externally. The document's `_id` is the
  // canonical session id.
  @Prop({ type: String, default: null })
  aiSessionId?: string | null;
```

Also find any other indexes/references to `sessionId` in the same file. Specifically, look near the bottom for compound index declarations like `ConversationV2SessionSchema.index({ ownerId: 1, ... })`. There likely isn't a separate `sessionId` index (uniqueness was enforced inline via `unique: true`).

Add a new sparse index for the rare debug path:

```ts
ConversationV2SessionSchema.index({ aiSessionId: 1 }, { sparse: true });
```

Leave the `{ ownerId, deletedAt, lastEventAt }` index alone.

- [ ] **Step 2: Compile-check**

```bash
cd G:/YellowStorm/back && npx tsc --noEmit 2>&1 | head -20
```

Expected: MANY errors across `conversation-v2.controller.ts`, `conversation-v2-stream.controller.ts`, `conversation-v2-session.service.ts`, and their specs — every reference to `pointer.sessionId` or `model.findOne({ sessionId })` is now broken. That's expected; subsequent tasks fix them. **Don't try to fix them now in this task — leave the broken state and commit.**

- [ ] **Step 3: Commit the schema-only change**

```bash
git add back/src/modules/conversation-v2/schemas/conversation-v2-session.schema.ts
git commit -m "refactor(conversation-v2)!: rename sessionId to aiSessionId on pointer schema

BREAKING: callers that read pointer.sessionId must switch to pointer._id
(canonical) or pointer.aiSessionId (gRPC routing). Subsequent commits
update all internal callers."
```

The `!` in the subject signals a breaking internal API change; we're not yet at green compile, callers land in the next tasks.

---

## Task 2: Failing tests for `createDraft`, `attachAiSession`, `deleteDraft`

**Files:**
- Modify: `back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts`

- [ ] **Step 1: Read the existing spec to find the mock variable name**

```bash
cd G:/YellowStorm/back && head -60 src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts
```

Note the mock variable name used for the model (likely `m` or `findOneAndUpdate`, etc.). Mirror it in the new tests.

- [ ] **Step 2: Replace the spec's existing mock setup**

The existing mock only declares `findOneAndUpdate`, `find`, `findOne`. Add `create`, `updateOne`, `deleteOne` mocks too, because the new methods use them. Find the existing `beforeEach` and update the mock to include all the methods we need. A clean replacement:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';

describe('ConversationV2SessionService', () => {
  let svc: ConversationV2SessionService;
  let create: jest.Mock;
  let findOne: jest.Mock;
  let findOneAndUpdate: jest.Mock;
  let updateOne: jest.Mock;
  let deleteOne: jest.Mock;
  let find: jest.Mock;

  beforeEach(async () => {
    create = jest.fn();
    findOne = jest.fn();
    findOneAndUpdate = jest.fn();
    updateOne = jest.fn();
    deleteOne = jest.fn();
    find = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2SessionService,
        {
          provide: getModelToken(ConversationV2Session.name),
          useValue: { create, findOne, findOneAndUpdate, updateOne, deleteOne, find },
        },
      ],
    }).compile();

    svc = mod.get(ConversationV2SessionService);
  });

  // ... ALL EXISTING TESTS STAY HERE, unchanged in structure but updated for _id lookups in Task 3 ...
});
```

If the existing spec has many tests already, don't delete them — just preserve them and ensure the mock object exposes everything they need plus the new methods. (Existing tests will be updated in Task 3 to use `_id`-based queries; for THIS task we only need the mock surface area extended.)

- [ ] **Step 3: Add the three new failing tests**

Append inside the `describe`:

```ts
  it('createDraft inserts an empty pointer with aiSessionId=null and returns the new doc', async () => {
    const fakeId = new Types.ObjectId();
    create.mockResolvedValueOnce({ _id: fakeId, ownerId: 'u1', aiSessionId: null });

    const doc = await svc.createDraft('u1', ['ws-a']);

    expect(doc._id).toBe(fakeId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        aiSessionId: null,
        title: '',
        status: 'active',
        isShared: false,
        shareTokenHash: null,
        deletedAt: null,
        workspaceIds: ['ws-a'],
        eventSequence: 0,
        eventCount: 0,
        systemWorkspaceId: null,
      }),
    );
  });

  it('attachAiSession only patches docs whose aiSessionId is still null', async () => {
    const id = new Types.ObjectId();
    updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    await svc.attachAiSession(id, 'ai-session-1', '507f1f77bcf86cd799439011');

    expect(updateOne).toHaveBeenCalledWith(
      { _id: id, aiSessionId: null },
      {
        $set: {
          aiSessionId: 'ai-session-1',
          systemWorkspaceId: expect.any(Types.ObjectId),
        },
      },
    );
  });

  it('deleteDraft only removes docs that are still drafts (aiSessionId null AND deletedAt null)', async () => {
    const id = new Types.ObjectId();
    deleteOne.mockResolvedValueOnce({ deletedCount: 1 });
    await svc.deleteDraft(id);

    expect(deleteOne).toHaveBeenCalledWith({
      _id: id,
      aiSessionId: null,
      deletedAt: null,
    });
  });
```

- [ ] **Step 4: Run the tests to confirm they fail**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2-session.service --no-coverage 2>&1 | tail -25
```

Expected: the three new tests FAIL (`svc.createDraft is not a function`, `svc.attachAiSession is not a function`, `svc.deleteDraft is not a function`). Existing tests likely also fail because they reference the old `sessionId` field — those get fixed in Task 3.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts
git commit -m "test(conversation-v2): failing tests for createDraft, attachAiSession, deleteDraft"
```

---

## Task 3: Implement service changes — new methods + `_id`-based lookups + remove `createForUser`

**Files:**
- Modify: `back/src/modules/conversation-v2/services/conversation-v2-session.service.ts`
- Modify: `back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts` (update existing tests)

- [ ] **Step 1: Replace the entire service body**

Rewrite `back/src/modules/conversation-v2/services/conversation-v2-session.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, FlattenMaps, Model, Types } from 'mongoose';
import {
  ConversationV2Session,
  ConversationV2SessionDocument,
  ConversationV2SessionStatus,
} from '../schemas/conversation-v2-session.schema';
import { ListSessionsDto } from '../dto/list-sessions.dto';

type LeanSession = FlattenMaps<ConversationV2SessionDocument> & { _id: Types.ObjectId };

export interface PointerSummary {
  sessionId: string;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: string;
  isShared: boolean;
  workspaceIds: string[];
}

@Injectable()
export class ConversationV2SessionService {
  constructor(
    @InjectModel(ConversationV2Session.name)
    private readonly model: Model<ConversationV2SessionDocument>,
  ) {}

  /**
   * Insert an empty pointer (draft) and return it. The returned doc has a
   * fresh _id but no aiSessionId or systemWorkspaceId yet — those are
   * populated by `attachAiSession` after gRPC + workspace creation succeed.
   */
  async createDraft(
    ownerId: string,
    workspaceIds: string[] = [],
  ): Promise<ConversationV2SessionDocument> {
    return this.model.create({
      ownerId,
      aiSessionId: null,
      title: '',
      status: 'active',
      lastEventAt: new Date(),
      isShared: false,
      shareTokenHash: null,
      deletedAt: null,
      workspaceIds,
      eventSequence: 0,
      eventCount: 0,
      systemWorkspaceId: null,
    });
  }

  /**
   * Finalize a draft pointer: set the gRPC session id and the system
   * workspace id. Filter requires `aiSessionId: null` so a second writer
   * (e.g. retry) doesn't clobber an already-finalized session.
   */
  async attachAiSession(
    id: Types.ObjectId,
    aiSessionId: string,
    systemWorkspaceId: string,
  ): Promise<void> {
    await this.model.updateOne(
      { _id: id, aiSessionId: null },
      {
        $set: {
          aiSessionId,
          systemWorkspaceId: new Types.ObjectId(systemWorkspaceId),
        },
      },
    );
  }

  /**
   * Hard-delete a draft pointer. Safety: refuses to touch any pointer that
   * isn't still a draft (aiSessionId set OR deletedAt set means it's a real
   * session — `softDelete` is the right path for those).
   */
  async deleteDraft(id: Types.ObjectId): Promise<void> {
    await this.model.deleteOne({
      _id: id,
      aiSessionId: null,
      deletedAt: null,
    });
  }

  async list(ownerId: string, dto: ListSessionsDto): Promise<PointerSummary[]> {
    const filter: FilterQuery<ConversationV2SessionDocument> = {
      ownerId,
      deletedAt: null,
    };
    if (dto.cursor) filter.lastEventAt = { $lt: new Date(dto.cursor) };
    if (dto.q) filter.title = { $regex: dto.q, $options: 'i' };

    const docs = await this.model
      .find(filter)
      .sort({ lastEventAt: -1 })
      .limit(dto.limit ?? 20)
      .lean()
      .exec();
    return docs.map(this.toSummary);
  }

  async getOne(ownerId: string, id: string): Promise<ConversationV2SessionDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOne({ _id: new Types.ObjectId(id), ownerId, deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  async getByShareToken(shareTokenHash: string): Promise<ConversationV2SessionDocument | null> {
    return this.model
      .findOne({ shareTokenHash, isShared: true, deletedAt: null })
      .lean()
      .exec() as unknown as ConversationV2SessionDocument | null;
  }

  async rename(ownerId: string, id: string, title: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: { title } },
        { new: true },
      )
      .lean()
      .exec();
  }

  async setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: { isShared, shareTokenHash } },
        { new: true },
      )
      .lean()
      .exec();
  }

  async softDelete(ownerId: string, id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), ownerId, deletedAt: null },
        { $set: { deletedAt: new Date() } },
        { new: true },
      )
      .lean()
      .exec();
  }

  private toSummary = (doc: LeanSession): PointerSummary => {
    const lastEventAt = doc.lastEventAt as Date | string | undefined;
    const d = lastEventAt ? new Date(lastEventAt) : new Date(0);
    return {
      sessionId: doc._id.toString(),
      title: (doc.title as string | undefined) ?? '',
      status: doc.status as ConversationV2SessionStatus,
      lastEventAt: d.toISOString(),
      isShared: (doc.isShared as boolean | undefined) ?? false,
      workspaceIds: (doc.workspaceIds as string[] | undefined) ?? [],
    };
  };
}
```

Note `createForUser` is removed. The fallback call in `ConversationV2StreamController.stream` referencing it gets removed in Task 7.

- [ ] **Step 2: Update existing tests to use `_id`-based mocks**

The existing tests in `conversation-v2-session.service.spec.ts` (the ones in place BEFORE Task 2 added the three new tests) reference the old `sessionId`-based queries. Update each one. Example pattern: where an existing test had

```ts
findOneAndUpdate.mockReturnValueOnce(...);
await svc.rename('u1', 's1', 'New');
expect(findOneAndUpdate).toHaveBeenCalledWith(
  { sessionId: 's1', ownerId: 'u1', deletedAt: null },
  { $set: { title: 'New' } },
  { new: true },
);
```

…the call now uses an ObjectId hex for the second arg:

```ts
const id = '507f1f77bcf86cd799439011';
findOneAndUpdate.mockReturnValueOnce(...);
await svc.rename('u1', id, 'New');
expect(findOneAndUpdate).toHaveBeenCalledWith(
  { _id: new Types.ObjectId(id), ownerId: 'u1', deletedAt: null },
  { $set: { title: 'New' } },
  { new: true },
);
```

Walk through every existing test in the spec and apply the same transformation. Tests for `getOne`, `softDelete`, `setShared`, `rename`: change the second arg to a valid 24-char hex and the filter expectation to `{ _id: new Types.ObjectId(id), ... }`.

Add a new test for `getOne` with malformed hex returning null:

```ts
  it('getOne returns null for a malformed id without hitting the DB', async () => {
    const result = await svc.getOne('u1', 'not-a-real-id');
    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });
```

Add a `toSummary` test asserting `sessionId` is mapped from `_id`:

```ts
  it('list maps doc._id to result.sessionId', async () => {
    const id = new Types.ObjectId();
    const limit = jest.fn().mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve([
          { _id: id, title: 't', status: 'active', lastEventAt: new Date(0), isShared: false, workspaceIds: [] },
        ]),
      }),
    });
    const sort = jest.fn().mockReturnValue({ limit });
    find.mockReturnValueOnce({ sort });

    const result = await svc.list('u1', { limit: 20 } as any);
    expect(result[0].sessionId).toBe(id.toString());
  });
```

- [ ] **Step 3: Run the tests**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2-session.service --no-coverage 2>&1 | tail -15
```

Expected: PASS — all service tests including the 3 new ones from Task 2.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/services/conversation-v2-session.service.ts back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts
git commit -m "feat(conversation-v2): switch SessionService to _id-based lookups + draft lifecycle"
```

---

## Task 4: Update `ConversationV2Controller.createSession` test — failing tests for doc-first creation

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Update the existing POST /sessions tests**

The existing two POST /sessions tests mock `mockClient.createSession` to return a UUID-style string and assert `mockSessions.createForUser` is called with that string. Both need rewriting because:
- `createForUser` doesn't exist anymore.
- The new flow uses `createDraft` → `createSystemWorkspace` → `createSession` (gRPC) → `attachAiSession`.

Add the new mock methods to `mockSessions`:

```ts
const mockSessions: jest.Mocked<
  Pick<
    ConversationV2SessionService,
    'createDraft' | 'attachAiSession' | 'deleteDraft' |
    'list' | 'getOne' | 'getByShareToken' | 'rename' | 'setShared' | 'softDelete'
  >
> = {
  createDraft: jest.fn(),
  attachAiSession: jest.fn(),
  deleteDraft: jest.fn(),
  list: jest.fn(),
  getOne: jest.fn(),
  getByShareToken: jest.fn(),
  rename: jest.fn(),
  setShared: jest.fn(),
  softDelete: jest.fn(),
} as never;
```

Drop `createForUser` from the Pick if it's there.

In the `beforeEach` reset spread, ensure all three new mocks are reset.

- [ ] **Step 2: Rewrite the two existing POST /sessions tests**

```ts
import { Types } from 'mongoose';

// ... inside describe ...

  const newDocId = new Types.ObjectId('507f1f77bcf86cd799439011');

  it('POST /sessions creates draft, workspace, gRPC session, and attaches them in order', async () => {
    mockSessions.createDraft.mockResolvedValueOnce({ _id: newDocId, ownerId: 'u1' } as never);
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({ id: 'sys-ws-1' } as never);
    mockClient.createSession.mockResolvedValueOnce('ai-session-1');
    mockSessions.attachAiSession.mockResolvedValueOnce(undefined);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    const result = await controller.createSession({ id: 'u1' } as never);

    expect(result).toEqual({
      sessionId: newDocId.toString(),
      workspaceIds: [],
      systemWorkspaceId: 'sys-ws-1',
    });
    expect(mockSessions.createDraft).toHaveBeenCalledWith('u1', []);
    expect(mockWorkspaceService.createSystemWorkspace).toHaveBeenCalledWith(
      'u1', newDocId.toString(), expect.any(Number),
    );
    expect(mockClient.createSession).toHaveBeenCalledWith('u1', []);
    expect(mockSessions.attachAiSession).toHaveBeenCalledWith(
      newDocId, 'ai-session-1', 'sys-ws-1',
    );
  });

  it('POST /sessions forwards workspaceIds through every step', async () => {
    mockSessions.createDraft.mockResolvedValueOnce({ _id: newDocId, ownerId: 'u1' } as never);
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({ id: 'sys-ws-1' } as never);
    mockClient.createSession.mockResolvedValueOnce('ai-session-2');
    mockSessions.attachAiSession.mockResolvedValueOnce(undefined);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    const result = await controller.createSession(
      { id: 'u1' } as never,
      { workspaceIds: ['ws-a', 'ws-b'] } as never,
    );

    expect(result.workspaceIds).toEqual(['ws-a', 'ws-b']);
    expect(mockWorkspaceShare.assertUserHasAccess).toHaveBeenCalledWith('u1', ['ws-a', 'ws-b']);
    expect(mockSessions.createDraft).toHaveBeenCalledWith('u1', ['ws-a', 'ws-b']);
    expect(mockClient.createSession).toHaveBeenCalledWith('u1', ['ws-a', 'ws-b']);
  });
```

- [ ] **Step 3: Update the existing rollback test + add two more**

The existing rollback test (`rolls back the gRPC session when system-workspace creation fails`) is now wrong — gRPC happens AFTER workspace in the new order. Replace it with three rollback tests:

```ts
  it('POST /sessions rolls back the draft when workspace creation fails', async () => {
    mockSessions.createDraft.mockResolvedValueOnce({ _id: newDocId } as never);
    mockWorkspaceService.createSystemWorkspace.mockRejectedValueOnce(new Error('mongo down'));
    mockSessions.deleteDraft.mockResolvedValueOnce(undefined);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    await expect(controller.createSession({ id: 'u1' } as never)).rejects.toThrow('mongo down');
    expect(mockSessions.deleteDraft).toHaveBeenCalledWith(newDocId);
    expect(mockClient.createSession).not.toHaveBeenCalled();
    expect(mockSessions.attachAiSession).not.toHaveBeenCalled();
  });

  it('POST /sessions rolls back workspace + draft when gRPC.CreateSession fails', async () => {
    mockSessions.createDraft.mockResolvedValueOnce({ _id: newDocId } as never);
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({ id: 'sys-ws-1' } as never);
    mockClient.createSession.mockRejectedValueOnce(new Error('grpc down'));
    mockWorkspaceService.deleteSystemWorkspace.mockResolvedValueOnce(undefined);
    mockSessions.deleteDraft.mockResolvedValueOnce(undefined);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    await expect(controller.createSession({ id: 'u1' } as never)).rejects.toThrow('grpc down');
    expect(mockWorkspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('sys-ws-1');
    expect(mockSessions.deleteDraft).toHaveBeenCalledWith(newDocId);
    expect(mockSessions.attachAiSession).not.toHaveBeenCalled();
  });

  it('POST /sessions rolls back gRPC + workspace + draft when attachAiSession fails', async () => {
    mockSessions.createDraft.mockResolvedValueOnce({ _id: newDocId } as never);
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({ id: 'sys-ws-1' } as never);
    mockClient.createSession.mockResolvedValueOnce('ai-session-1');
    mockSessions.attachAiSession.mockRejectedValueOnce(new Error('attach failed'));
    mockClient.stopSession.mockResolvedValueOnce(undefined);
    mockWorkspaceService.deleteSystemWorkspace.mockResolvedValueOnce(undefined);
    mockSessions.deleteDraft.mockResolvedValueOnce(undefined);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    await expect(controller.createSession({ id: 'u1' } as never)).rejects.toThrow('attach failed');
    expect(mockClient.stopSession).toHaveBeenCalledWith('u1', 'ai-session-1');
    expect(mockWorkspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('sys-ws-1');
    expect(mockSessions.deleteDraft).toHaveBeenCalledWith(newDocId);
  });
```

- [ ] **Step 4: Run tests to confirm failures**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2.controller.spec --no-coverage 2>&1 | tail -30
```

Expected: the rewritten POST /sessions tests FAIL — current implementation still uses the old flow. Other tests may also fail because they reference `pointer.sessionId` (legacy). Those get fixed in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "test(conversation-v2): failing tests for doc-first createSession with 3 rollbacks"
```

---

## Task 5: Implement `createSession` doc-first with 3 rollback branches

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`

- [ ] **Step 1: Replace the `createSession` method**

Find the existing method and replace with:

```ts
  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateSessionDto = new CreateSessionDto(),
  ): Promise<{
    sessionId: string;
    workspaceIds: string[];
    systemWorkspaceId: string;
  }> {
    const workspaceIds = body.workspaceIds ?? [];
    await this.workspaceShare.assertUserHasAccess(user.id, workspaceIds);

    const draft = await this.sessions.createDraft(user.id, workspaceIds);
    const draftId = draft._id as Types.ObjectId;

    let systemWorkspaceId: string;
    try {
      const allocatedStorage = this.config.get<number>(
        'conversation.systemWorkspaceStorageBytes',
        52428800,
      );
      const ws = await this.workspaceService.createSystemWorkspace(
        user.id,
        draftId.toString(),
        allocatedStorage,
      );
      systemWorkspaceId = ws.id;
    } catch (err) {
      await this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    let aiSessionId: string;
    try {
      aiSessionId = await this.grpcClient.createSession(user.id, workspaceIds);
    } catch (err) {
      this.workspaceService.deleteSystemWorkspace(systemWorkspaceId).catch(() => undefined);
      this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    try {
      await this.sessions.attachAiSession(draftId, aiSessionId, systemWorkspaceId);
    } catch (err) {
      this.grpcClient.stopSession(user.id, aiSessionId).catch(() => undefined);
      this.workspaceService.deleteSystemWorkspace(systemWorkspaceId).catch(() => undefined);
      this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    return {
      sessionId: draftId.toString(),
      workspaceIds,
      systemWorkspaceId,
    };
  }
```

Add `Types` to the mongoose imports if it's not there:

```ts
import { Types } from 'mongoose';
```

- [ ] **Step 2: Run the controller tests**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2.controller.spec --no-coverage 2>&1 | tail -15
```

Expected: the 5 POST /sessions tests now PASS. Tests for other endpoints (`GET /sessions/:id`, `DELETE`, `share`) may still fail because they reference `pointer.sessionId` — those get fixed in Task 6.

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts
git commit -m "feat(conversation-v2): doc-first createSession with 3 rollback branches"
```

---

## Task 6: Update `getSession`, `deleteSession`, `getShared` to use `_id`-based responses

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Update existing tests to use `_id`-shaped pointer mocks**

Find each test that mocks `mockSessions.getOne` or `mockSessions.getByShareToken`. Today they return pointers with `sessionId: 's1'`. Update them to return pointers with `_id: new Types.ObjectId(...)` and drop the `sessionId` field. The same id should appear in the response's `sessionId`.

Example transformation for the existing `GET /sessions/:id returns pointer payload including systemWorkspaceId` test:

```ts
  it('GET /sessions/:id returns pointer payload including systemWorkspaceId', async () => {
    const id = new Types.ObjectId();
    mockSessions.getOne.mockResolvedValueOnce({
      _id: id,
      title: 't',
      status: 'active',
      isShared: false,
      workspaceIds: ['ws-a'],
      lastEventAt: new Date('2026-01-01T00:00:00Z'),
      eventCount: 5,
      systemWorkspaceId: 'sys-ws-1',
    } as never);
    const result = await controller.getSession({ id: 'u1' } as never, id.toString());
    expect(result.sessionId).toBe(id.toString());
    expect(result.workspaceIds).toEqual(['ws-a']);
    expect(result.eventCount).toBe(5);
    expect(result.systemWorkspaceId).toBe('sys-ws-1');
  });
```

Do the same for the share test and the delete tests.

- [ ] **Step 2: Update the controller methods**

In `conversation-v2.controller.ts`:

a) `getSession` — return `sessionId: pointer._id.toString()` instead of `pointer.sessionId`:

```ts
    return {
      sessionId: (pointer._id as Types.ObjectId).toString(),
      title: pointer.title,
      status: pointer.status,
      isShared: pointer.isShared,
      workspaceIds: pointer.workspaceIds ?? [],
      lastEventAt: pointer.lastEventAt,
      eventCount: (pointer as unknown as { eventCount?: number }).eventCount ?? 0,
      systemWorkspaceId:
        (pointer as unknown as { systemWorkspaceId?: { toString(): string } | string | null })
          .systemWorkspaceId?.toString() ?? null,
    };
```

b) `deleteSession` — the cascade logic stays; just confirm there's no `pointer.sessionId` reference (only `pointer.systemWorkspaceId.toString()` and `this.sessions.softDelete(user.id, id)` which already takes the URL `:id`).

c) `getShared` — replace `sessionId: pointer.sessionId` with `sessionId: (pointer._id as Types.ObjectId).toString()`:

```ts
      session: {
        sessionId: (pointer._id as Types.ObjectId).toString(),
        title: pointer.title,
        // ... rest unchanged ...
      },
```

d) `listEvents` and `share`'s event listing — they pass the `:id` URL string directly to `eventStore.listSince`. No change needed; the events table just stores a different-looking string now.

Also: where the share endpoint calls `this.eventStore.listSince(pointer.sessionId, ...)`, change to `this.eventStore.listSince((pointer._id as Types.ObjectId).toString(), ...)`.

- [ ] **Step 3: Run tests**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2.controller.spec --no-coverage 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "feat(conversation-v2): controller responses use pointer._id as sessionId"
```

---

## Task 7: Stream controller — pointer lookup + use `aiSessionId` for gRPC

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2-stream.controller.ts`
- Modify: `back/src/modules/conversation-v2/conversation-v2-stream.controller.spec.ts`

- [ ] **Step 1: Update the stream method**

In `conversation-v2-stream.controller.ts`, replace the early part of the `stream` method. Find the existing block that does `await this.sessions.createForUser(user.id, sessionId).catch(...)` followed by the system-workspace pointer lookup. Replace both with:

```ts
    // Resolve the pointer once: we need its _id (passed to gRPC = aiSessionId,
    // passed to event store = doc._id.toString()) and its systemWorkspaceId
    // for the AI artifact harvester.
    const pointer = await this.sessions.getOne(user.id, sessionId);
    if (!pointer) throw new NotFoundException('Session not found');
    if (!pointer.aiSessionId) throw new BadRequestException('Session not ready');

    const aiSessionId = pointer.aiSessionId;
    const systemWorkspaceId =
      (pointer as unknown as { systemWorkspaceId?: { toString(): string } | string | null })
        .systemWorkspaceId?.toString() ?? null;
```

(Remove the old `await this.sessions.createForUser(user.id, sessionId).catch(() => undefined);` — doc-first creation guarantees the pointer exists.)

Then update every gRPC call. The grpcClient methods take a sessionId string — replace what we pass from the URL `:id` with `aiSessionId`:

```ts
      chatSub = this.grpcClient
        .chat(user.id, aiSessionId, query.message, query.model)  // was: sessionId
        // ... rest ...
```

The event store calls (`eventStore.append(sessionId, ...)`, etc.) keep using `sessionId` from the URL (which is the `_id` hex now).

- [ ] **Step 2: Update streamLive the same way**

In the `streamLive` method, replace the existing logic with the same pattern:

```ts
    const pointer = await this.sessions.getOne(user.id, sessionId);
    if (!pointer) throw new NotFoundException('Session not found');
    // streamLive doesn't make gRPC calls, so aiSessionId isn't required.
    // ... rest of the existing flow, eventStore.listSince still uses sessionId (URL :id) ...
```

Add `NotFoundException` and `BadRequestException` to the controller's `@nestjs/common` imports if missing.

- [ ] **Step 3: Update the spec to mock `getOne` returning a pointer with `aiSessionId`**

In `conversation-v2-stream.controller.spec.ts`, update the `mockSessions.getOne` default in `beforeEach`:

```ts
mockSessions.getOne = jest.fn().mockResolvedValue({
  _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
  ownerId: 'u1',
  aiSessionId: 'ai-session-1',
  systemWorkspaceId: null,
});
```

Where existing tests pass `'s1'` as the second arg to `controller.stream(...)`, change them to pass `'507f1f77bcf86cd799439011'` (a valid 24-char hex).

Add a new test for the "Session not ready" path:

```ts
  it('stream rejects when pointer has no aiSessionId yet', async () => {
    mockSessions.getOne.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      ownerId: 'u1',
      aiSessionId: null,
    });
    const res = new FakeRes() as unknown as Response;
    await expect(
      controller.stream({ id: 'u1' } as never, '507f1f77bcf86cd799439011', { message: 'hi' } as never, res),
    ).rejects.toThrow('Session not ready');
  });
```

Update the existing `'forwards optional model query param into grpcClient.chat'` test so it asserts gRPC is called with `'ai-session-1'`, not the URL `:id`:

```ts
expect(grpcClient.chat).toHaveBeenCalledWith('u1', 'ai-session-1', 'hi', 'azure/gpt-4.1');
```

Same for the model=undefined variant.

- [ ] **Step 4: Run tests**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2-stream.controller --no-coverage 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2-stream.controller.ts back/src/modules/conversation-v2/conversation-v2-stream.controller.spec.ts
git commit -m "feat(conversation-v2): stream controller resolves aiSessionId from pointer"
```

---

## Task 8: Stop/Pause/Resume/VNC routes — use `aiSessionId`

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Update the four routes**

In `conversation-v2.controller.ts`, find `stopSession`, `pauseSession`, `resumeSession`, `vncSignedUrl`. Each currently does something like:

```ts
  await this.grpcClient.stopSession(user.id, id);
```

Where `id` is the URL `:id`. Now we need to resolve the pointer's `aiSessionId`. The `ConversationV2OwnerGuard` already fetched the pointer; ideally we'd reuse it, but the guard doesn't expose it. Easiest path: another `getOne` call. Replace each route body:

```ts
  @Post('sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async stopSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer || !pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.stopSession(user.id, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }
```

Apply the same pattern to `pauseSession`, `resumeSession`, `vncSignedUrl`. The `getOne` failure case returns 404; missing `aiSessionId` (shouldn't happen post-creation) also returns 404 for safety.

- [ ] **Step 2: Update the corresponding tests**

For each of the four routes' tests in `conversation-v2.controller.spec.ts`, add a `mockSessions.getOne.mockResolvedValueOnce(...)` that returns a pointer with `aiSessionId` set, and assert that gRPC is called with `pointer.aiSessionId`:

```ts
  it('POST /sessions/:id/stop returns success', async () => {
    mockSessions.getOne.mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      ownerId: 'u1',
      aiSessionId: 'ai-1',
    } as never);
    mockClient.stopSession.mockResolvedValueOnce(undefined);
    await expect(controller.stopSession({ id: 'u1' } as never, 's1')).resolves.toEqual({ success: true });
    expect(mockClient.stopSession).toHaveBeenCalledWith('u1', 'ai-1');
  });
```

Same for pause, resume, vnc.

- [ ] **Step 3: Run tests**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2.controller.spec --no-coverage 2>&1 | tail -15
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "feat(conversation-v2): stop/pause/resume/vnc resolve aiSessionId from pointer"
```

---

## Task 9: OwnerGuard tolerates malformed hex

**Files:**
- Modify: `back/src/modules/conversation-v2/guards/conversation-v2-owner.guard.ts`
- Modify: `back/src/modules/conversation-v2/guards/conversation-v2-owner.guard.spec.ts` (or create if absent)

- [ ] **Step 1: Inspect the guard**

```bash
cd G:/YellowStorm/back && cat src/modules/conversation-v2/guards/conversation-v2-owner.guard.ts
```

The guard currently calls `this.sessions.getOne(userId, sessionId)`. Task 3 made `getOne` return `null` for malformed hex, so the guard already returns 404 cleanly via the existing `if (!pointer) throw new NotFoundException('Session not found');`. We just need to add a test for that path.

- [ ] **Step 2: Add the test**

Open the spec file (or create one if it doesn't exist). If it doesn't exist:

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Types } from 'mongoose';
import { ConversationV2OwnerGuard } from './conversation-v2-owner.guard';
import { ConversationV2SessionService } from '../services/conversation-v2-session.service';

describe('ConversationV2OwnerGuard', () => {
  let guard: ConversationV2OwnerGuard;
  let mockSessions: { getOne: jest.Mock };

  beforeEach(async () => {
    mockSessions = { getOne: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2OwnerGuard,
        { provide: ConversationV2SessionService, useValue: mockSessions },
      ],
    }).compile();
    guard = mod.get(ConversationV2OwnerGuard);
  });

  function ctx(userId: string | undefined, id: string | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: userId ? { id: userId } : undefined, params: { id } }),
      }),
    } as ExecutionContext;
  }

  it('returns 404 when getOne returns null (covers malformed id)', async () => {
    mockSessions.getOne.mockResolvedValueOnce(null);
    await expect(guard.canActivate(ctx('u1', 'not-a-hex'))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 when userId or id is missing', async () => {
    await expect(guard.canActivate(ctx(undefined, 'x'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(guard.canActivate(ctx('u1', undefined))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 403 when pointer.ownerId does not match the request user', async () => {
    const id = new Types.ObjectId();
    mockSessions.getOne.mockResolvedValueOnce({
      _id: id, ownerId: 'someone-else', aiSessionId: 'ai-1',
    });
    await expect(guard.canActivate(ctx('u1', id.toString()))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows the owner through', async () => {
    const id = new Types.ObjectId();
    mockSessions.getOne.mockResolvedValueOnce({
      _id: id, ownerId: 'u1', aiSessionId: 'ai-1',
    });
    await expect(guard.canActivate(ctx('u1', id.toString()))).resolves.toBe(true);
  });
});
```

If the spec already exists, append the four tests above to its describe block.

- [ ] **Step 3: Run the guard spec**

```bash
cd G:/YellowStorm/back && npx jest conversation-v2-owner.guard --no-coverage 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/guards/
git commit -m "test(conversation-v2): guard tolerates malformed hex via getOne null-return"
```

---

## Task 10: Run the full v2 suite + frontend tests to verify nothing broke

**Files:** none — verification.

- [ ] **Step 1: Backend**

```bash
cd G:/YellowStorm/back && npx tsc --noEmit
cd G:/YellowStorm/back && npx jest --testPathPattern="conversation-v2|workspace" --no-coverage 2>&1 | tail -10
```

Expected: tsc clean. All tests green.

- [ ] **Step 2: Frontend**

```bash
cd G:/YellowStorm/front && npx tsc --noEmit
cd G:/YellowStorm/front && npx vitest run src/modules/conversation-v2/ 2>&1 | tail -10
```

Expected: tsc clean. All tests green. (Frontend is intentionally unchanged.)

- [ ] **Step 3: If anything failed, STOP and report**

This is a verification gate. Any failure here means a previous task missed a reference to the old `sessionId` field. Investigate and fix.

---

## Task 11: Manual smoke test (deferred to deploy operator)

**Files:** none — manual verification.

- [ ] **Step 1: Bring up backend + frontend**

```bash
cd G:/YellowStorm/back && npm run start:dev
cd G:/YellowStorm/front && npm run dev
```

- [ ] **Step 2: Smoke checklist**

- [ ] Create a brand-new V2 session. `POST /conversation-v2/sessions` should return a `sessionId` that is a 24-char hex string. Inspect via browser DevTools → Network.
- [ ] The URL after navigating to the new session should be `/#/conversation-v2/<hex>` (or whatever the front's hash router uses).
- [ ] Send a message. Confirm live streaming still works.
- [ ] On Mongo, confirm the `conversation_v2_sessions` document has:
  - `_id`: ObjectId
  - `aiSessionId`: a non-null string (the AI's id)
  - `systemWorkspaceId`: ObjectId
  - No `sessionId` field
- [ ] Confirm the `workspaces` document (system workspace) has:
  - `name`/`alias`/`storagePrefix`: `system-<hex>` (the V2 session's _id)
  - `conversationId`: ObjectId matching the V2 session's _id (the `Types.ObjectId.isValid` guard now succeeds)
- [ ] Delete the session via the UI. Confirm both the pointer and the workspace are gone (and workspace docs cascade-deleted).
- [ ] Send a follow-up message in an existing session, reload, confirm history renders.
- [ ] Open an old (pre-rework) UUID-based session if any survived the tombstone — it should 404 cleanly (malformed hex from the URL → guard returns 404, no 500).

- [ ] **Step 3: Run lint + tests one more time**

```bash
cd G:/YellowStorm/back && npm run lint && npm run test
cd G:/YellowStorm/front && npm run test
```

All green.

---

## Self-review

**Spec coverage:**
- §3.1 Identity model → Tasks 1, 3 (schema + service)
- §3.2 Creation flow → Tasks 4, 5
- §3.3 Read/write flow → Tasks 6, 7, 8
- §3.4 Endpoint table → covered by Tasks 5–8
- §4 Schemas → Task 1 + Task 3 (toSummary mapping)
- §5.1 Service methods → Tasks 2, 3
- §5.2 createSession rewrite → Tasks 4, 5
- §5.3 Other controller methods → Task 6
- §5.4 Stream controller → Task 7
- §5.5 OwnerGuard → Task 9
- §5.6 EventStore (no signature changes) → covered implicitly; tests in Tasks 6, 7 verify
- §5.7 WorkspaceService (no change) → no task needed
- §6 Frontend (no change) → no task needed
- §7 Migration & rollout (clean slate) → no task needed; manual smoke covers verification
- §8 Error handling → Tasks 5 (rollback), 7 (Session not ready), 9 (malformed hex)
- §9 Testing → Tasks 2, 4, 7, 9

All spec sections mapped.

**Placeholder scan:** Task 3 step 2 says "Walk through every existing test in the spec and apply the same transformation" — this is a deliberate instruction rather than a placeholder; the existing-test list isn't enumerable without reading the file, and the transformation pattern is identical for every case. Acceptable.

**Type consistency:** `_id: Types.ObjectId`, `id: string` (URL param), `sessionId: string` (response field, `_id.toString()`), `aiSessionId: string | null`. Used consistently across all tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-conversation-v2-objectid-migration.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
