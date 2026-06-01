# Conversation V2 — Per-Session System Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every V2 conversation a dedicated system workspace that holds both user uploads and AI-generated artifacts, created eagerly at session creation and cascade-deleted on session deletion.

**Architecture:** Backend creates a workspace via the existing `WorkspaceService.createSystemWorkspace` at `POST /sessions`, persists `systemWorkspaceId` on the session pointer, cascades delete via existing `WorkspaceDocumentService.deleteAllByWorkspace` + `WorkspaceService.deleteSystemWorkspace`. A new `WorkspaceDocumentService.createFromAiArtifact` method registers AI-emitted file paths (from assistant `message` event attachments) as `WorkspaceDocument` rows pointing at the AI's path. The frontend gains a "Files in this conversation" right-panel mode reading from the existing workspace documents endpoint.

**Tech Stack:** NestJS, Mongoose (backend); React, Zustand (frontend); Jest, Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-05-25-conversation-v2-system-workspace-design.md`

---

## File map

**Backend — modify:**
- `back/src/modules/conversation-v2/schemas/conversation-v2-session.schema.ts` (add `systemWorkspaceId`)
- `back/src/modules/conversation-v2/services/conversation-v2-session.service.ts` (extend `createForUser` signature)
- `back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts` (update spec)
- `back/src/modules/conversation-v2/conversation-v2.controller.ts` (eager create + cascade delete + response shape)
- `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts` (new tests)
- `back/src/modules/conversation-v2/conversation-v2-stream.controller.ts` (AI artifact harvester)
- `back/src/modules/conversation-v2/conversation-v2-stream.controller.spec.ts` (new test)
- `back/src/modules/conversation-v2/conversation-v2.module.ts` (inject `WorkspaceService`)
- `back/src/modules/workspace/workspace-document.service.ts` (new `createFromAiArtifact` method)
- `back/src/modules/workspace/workspace-document.service.spec.ts` (new test) — create if absent

**Frontend — modify:**
- `front/src/modules/conversation-v2/api.ts` (add `systemWorkspaceId` to `SessionPointer`)
- `front/src/modules/conversation-v2/store.ts` (add state + actions + `'files'` mode)
- `front/src/modules/conversation-v2/store.test.ts` (new tests)
- `front/src/modules/conversation-v2/ConversationV2SessionPage.tsx` (wire `setSystemWorkspaceId`)
- `front/src/modules/conversation-v2/SharedConversationV2Page.tsx` (same)
- `front/src/modules/conversation-v2/components/RightPanel/RightPanel.tsx` (render `FilesPanel` when mode is `'files'`)
- `front/src/modules/conversation-v2/components/Composer.tsx` (files button)
- `front/src/modules/conversation-v2/locales/en.json` + `fr.json` (i18n keys)

**Frontend — create:**
- `front/src/modules/conversation-v2/components/RightPanel/FilesPanel.tsx`
- `front/src/modules/conversation-v2/components/RightPanel/FilesPanel.test.tsx`

---

## Task 1: Add `systemWorkspaceId` to the session schema

**Files:**
- Modify: `back/src/modules/conversation-v2/schemas/conversation-v2-session.schema.ts`

- [ ] **Step 1: Add the field**

Open the file and add this prop immediately after the existing `eventCount` field, before the class's closing `}`:

```ts
  // Per-session workspace that holds AI-generated artifacts (harvested from
  // assistant message events) and user-uploaded files. Created eagerly at
  // POST /sessions and cascade-deleted on DELETE /sessions. Optional because
  // sessions created before this rework don't have one.
  @Prop({ type: Types.ObjectId, ref: 'Workspace', default: null })
  systemWorkspaceId?: Types.ObjectId | null;
```

Make sure `Types` is in the file's imports already (it should be — search for `Types` in the file; it's typically imported alongside `Document, HydratedDocument` from `'mongoose'`). If not, add it.

- [ ] **Step 2: Run the existing v2 test suite to confirm no regression**

```bash
cd back && npx jest --testPathPattern="conversation-v2" --no-coverage
```

Expected: all tests still pass (this is an additive optional field).

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/conversation-v2/schemas/conversation-v2-session.schema.ts
git commit -m "feat(conversation-v2): add systemWorkspaceId to session pointer schema"
```

---

## Task 2: Failing test for the extended `createForUser` signature

**Files:**
- Modify: `back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts`

- [ ] **Step 1: Inspect the existing spec to find the create test**

```bash
cd back && grep -n "createForUser" src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts
```

Find the existing test that asserts `createForUser` persists workspace ids. We'll mirror that pattern.

- [ ] **Step 2: Add a new test**

Append inside the existing `describe('ConversationV2SessionService', ...)` block:

```ts
  it('createForUser persists systemWorkspaceId when provided', async () => {
    findOneAndUpdate.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve({ sessionId: 's1' }) }),
    });
    await svc.createForUser('u1', 's1', ['ws-a'], 'sys-ws-1');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: 's1' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          systemWorkspaceId: 'sys-ws-1',
        }),
      }),
      { upsert: true, new: true },
    );
  });

  it('createForUser sets systemWorkspaceId to null when not provided', async () => {
    findOneAndUpdate.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve({ sessionId: 's2' }) }),
    });
    await svc.createForUser('u1', 's2');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: 's2' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          systemWorkspaceId: null,
        }),
      }),
      { upsert: true, new: true },
    );
  });
```

If the existing spec uses a different mock variable name than `findOneAndUpdate`, use that name. Read the file first.

- [ ] **Step 3: Run the new tests to confirm they fail**

```bash
cd back && npx jest conversation-v2-session.service --no-coverage
```

Expected: the two new tests FAIL (`createForUser` doesn't accept a 4th parameter or doesn't set `systemWorkspaceId`).

- [ ] **Step 4: Commit the failing tests**

```bash
git add back/src/modules/conversation-v2/services/conversation-v2-session.service.spec.ts
git commit -m "test(conversation-v2): failing tests for systemWorkspaceId persistence"
```

---

## Task 3: Extend `createForUser` to accept `systemWorkspaceId`

**Files:**
- Modify: `back/src/modules/conversation-v2/services/conversation-v2-session.service.ts`

- [ ] **Step 1: Update the method signature and `$setOnInsert`**

Find `createForUser` and change it to:

```ts
  async createForUser(
    ownerId: string,
    sessionId: string,
    workspaceIds: string[] = [],
    systemWorkspaceId?: string,
  ): Promise<ConversationV2SessionDocument> {
    const now = new Date();
    return this.model
      .findOneAndUpdate(
        { sessionId },
        {
          $setOnInsert: {
            ownerId,
            sessionId,
            title: '',
            status: 'active',
            lastEventAt: now,
            isShared: false,
            shareTokenHash: null,
            deletedAt: null,
            workspaceIds,
            systemWorkspaceId: systemWorkspaceId ?? null,
          },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec() as unknown as ConversationV2SessionDocument;
  }
```

- [ ] **Step 2: Run the tests to confirm they pass**

```bash
cd back && npx jest conversation-v2-session.service --no-coverage
```

Expected: PASS — both new tests + all existing tests.

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/conversation-v2/services/conversation-v2-session.service.ts
git commit -m "feat(conversation-v2): persist systemWorkspaceId on session pointer"
```

---

## Task 4: Failing test for `WorkspaceDocumentService.createFromAiArtifact`

**Files:**
- Create or modify: `back/src/modules/workspace/workspace-document.service.spec.ts`

- [ ] **Step 1: Check if a spec file exists**

```bash
ls back/src/modules/workspace/workspace-document.service.spec.ts 2>&1
```

If it exists, append the test to it. If not, create a minimal new spec file with the test below.

- [ ] **Step 2: Write the failing test**

If creating a new spec file, write:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { WorkspaceDocumentService } from './workspace-document.service';
import { WorkspaceDoc, DocumentStatus } from './schemas/workspace-document.schema';
import { UploadSession } from './schemas/upload-session.schema';
import { WorkspaceService } from './workspace.service';
import { DocumentService } from '../document/document.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IndexingService } from '../indexing/indexing.service';
import { LoggerService } from '../logger';

describe('WorkspaceDocumentService.createFromAiArtifact', () => {
  let svc: WorkspaceDocumentService;
  let create: jest.Mock;
  let updateStorageUsage: jest.Mock;

  beforeEach(async () => {
    create = jest.fn().mockResolvedValue({});
    updateStorageUsage = jest.fn().mockResolvedValue(undefined);

    const mod = await Test.createTestingModule({
      providers: [
        WorkspaceDocumentService,
        { provide: getModelToken(WorkspaceDoc.name), useValue: { create } },
        { provide: getModelToken(UploadSession.name), useValue: {} },
        {
          provide: WorkspaceService,
          useValue: {
            updateStorageUsage,
            findById: jest.fn().mockResolvedValue({
              id: 'ws-1',
              createdBy: 'u1',
            }),
          },
        },
        { provide: DocumentService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: IndexingService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: (_: string, dflt?: unknown) => dflt },
        },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();

    svc = mod.get(WorkspaceDocumentService);
  });

  it('creates a WorkspaceDocument row pointing at the AI-emitted path', async () => {
    await svc.createFromAiArtifact('ws-1', {
      id: 'f1',
      name: 'report.pdf',
      content_type: 'application/pdf',
      path: 'u1/files_generated/report.pdf',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'report.pdf',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        path: 'u1/files_generated/report.pdf',
        size: 0,
        status: DocumentStatus.COMPLETED,
      }),
    );
    expect(updateStorageUsage).toHaveBeenCalledWith('ws-1', 0, 1);
  });

  it('falls back to application/octet-stream when content_type is empty', async () => {
    await svc.createFromAiArtifact('ws-1', {
      id: 'f2',
      name: 'data.bin',
      content_type: '',
      path: 'u1/files_generated/data.bin',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/octet-stream' }),
    );
  });
});
```

If the spec file already exists, append just the `describe('WorkspaceDocumentService.createFromAiArtifact', ...)` block (and required imports) at the end.

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd back && npx jest workspace-document.service --no-coverage
```

Expected: FAIL — `svc.createFromAiArtifact is not a function`.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/workspace/workspace-document.service.spec.ts
git commit -m "test(workspace): failing test for createFromAiArtifact"
```

---

## Task 5: Implement `WorkspaceDocumentService.createFromAiArtifact`

**Files:**
- Modify: `back/src/modules/workspace/workspace-document.service.ts`

- [ ] **Step 1: Add the method**

Append this method to the `WorkspaceDocumentService` class (anywhere logical — near other create methods is best):

```ts
  /**
   * Register an AI-generated file as a WorkspaceDocument in the session's
   * system workspace. The file already exists at `fileInfo.path` in S3
   * (the AI service wrote it there); this just adds a metadata row so the
   * workspace UI can list it. Size defaults to 0 because the backend doesn't
   * HEAD the object — accurate sizes aren't needed for the listing UI.
   */
  async createFromAiArtifact(
    systemWorkspaceId: string,
    fileInfo: { id: string; name: string; content_type: string; path: string },
  ): Promise<void> {
    const workspace = await this.workspaceService.findById(systemWorkspaceId);
    const createdBy = workspace?.createdBy
      ? new Types.ObjectId(String(workspace.createdBy))
      : null;
    if (!createdBy) {
      this.logger.warn('createFromAiArtifact: workspace not found, skipping', {
        systemWorkspaceId,
        path: fileInfo.path,
      });
      return;
    }

    await this.documentModel.create({
      workspaceId: new Types.ObjectId(systemWorkspaceId),
      createdBy,
      filename: fileInfo.name,
      originalName: fileInfo.name,
      mimeType: fileInfo.content_type || 'application/octet-stream',
      path: fileInfo.path,
      size: 0,
      status: DocumentStatus.COMPLETED,
      uploadedAt: new Date(),
    });

    await this.workspaceService.updateStorageUsage(systemWorkspaceId, 0, 1);

    this.logger.log('AI artifact registered as WorkspaceDocument', {
      systemWorkspaceId,
      path: fileInfo.path,
    });
  }
```

The `findById` method exists on `WorkspaceService` (search if unsure: `grep -n "findById" back/src/modules/workspace/workspace.service.ts`). It returns the workspace including `createdBy`.

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd back && npx jest workspace-document.service --no-coverage
```

Expected: PASS — both new test cases.

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/workspace/workspace-document.service.ts
git commit -m "feat(workspace): add createFromAiArtifact for AI-emitted files"
```

---

## Task 6: Wire `WorkspaceService` into ConversationV2 controllers

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`
- Modify: `back/src/modules/conversation-v2/conversation-v2-stream.controller.ts`

`WorkspaceModule` already exports `WorkspaceService` and the V2 module already imports `forwardRef(() => WorkspaceModule)`, so we just need to inject it into the controllers that use it.

- [ ] **Step 1: Inject `WorkspaceService` in `ConversationV2Controller`**

Add the import at the top:

```ts
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { ConfigService } from '@nestjs/config';
```

Extend the constructor:

```ts
  constructor(
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly sessions: ConversationV2SessionService,
    private readonly share: ConversationV2ShareService,
    private readonly workspaceShare: WorkspaceShareService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly eventStore: ConversationV2EventStoreService,
    private readonly workspaceService: WorkspaceService,
    private readonly config: ConfigService,
  ) {}
```

- [ ] **Step 2: Inject `WorkspaceService` and `WorkspaceDocumentService` in `ConversationV2StreamController`**

Currently the stream controller doesn't have either. Add the imports:

```ts
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
```

Extend the constructor — append the two new params after the existing ones:

```ts
  constructor(
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly config: ConfigService,
    private readonly pointerWriter: ConversationV2PointerWriterService,
    private readonly sessions: ConversationV2SessionService,
    private readonly eventStore: ConversationV2EventStoreService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly workspaceService: WorkspaceService,
  ) {}
```

- [ ] **Step 3: Compile-check**

```bash
cd back && npx tsc --noEmit
```

Expected: no errors. (The existing test specs for these controllers will likely error in test runs because the new dependencies aren't provided in their TestingModule providers — that's expected and gets fixed in subsequent tasks.)

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts back/src/modules/conversation-v2/conversation-v2-stream.controller.ts
git commit -m "feat(conversation-v2): inject WorkspaceService into controllers"
```

---

## Task 7: Failing test for `createSession` creating + returning the system workspace

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Add `WorkspaceService` and `ConfigService` mocks**

At the top of the file, alongside the other top-level mocks (`mockClient`, `mockSessions`, etc.), add:

```ts
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { ConfigService } from '@nestjs/config';

const mockWorkspaceService: jest.Mocked<
  Pick<WorkspaceService, 'createSystemWorkspace' | 'deleteSystemWorkspace'>
> = {
  createSystemWorkspace: jest.fn(),
  deleteSystemWorkspace: jest.fn(),
} as never;

const mockConfig: jest.Mocked<Pick<ConfigService, 'get'>> = {
  get: jest.fn((_: string, dflt?: unknown) => dflt) as never,
} as never;
```

Add them to the `providers` array in the `Test.createTestingModule({...})` call:

```ts
{ provide: WorkspaceService, useValue: mockWorkspaceService },
{ provide: ConfigService, useValue: mockConfig },
```

Add them to the `beforeEach` reset spread (where existing mocks are reset):

```ts
mockWorkspaceService.createSystemWorkspace.mockReset();
mockWorkspaceService.deleteSystemWorkspace.mockReset();
mockConfig.get.mockReset();
mockConfig.get.mockImplementation((_: string, dflt?: unknown) => dflt);
```

- [ ] **Step 2: Add the failing test**

Append inside the existing describe block (near the other POST /sessions tests):

```ts
  it('POST /sessions creates a system workspace and returns its id', async () => {
    mockClient.createSession.mockResolvedValueOnce('sess-3');
    mockWorkspaceService.createSystemWorkspace.mockResolvedValueOnce({
      id: 'sys-ws-3',
    } as never);
    mockSessions.createForUser.mockResolvedValueOnce({ sessionId: 'sess-3' } as never);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    const result = await controller.createSession({ id: 'u1' } as never);

    expect(result).toEqual({
      sessionId: 'sess-3',
      workspaceIds: [],
      systemWorkspaceId: 'sys-ws-3',
    });
    expect(mockWorkspaceService.createSystemWorkspace).toHaveBeenCalledWith(
      'u1',
      'sess-3',
      expect.any(Number),
    );
    expect(mockSessions.createForUser).toHaveBeenCalledWith('u1', 'sess-3', [], 'sys-ws-3');
  });

  it('POST /sessions rolls back the gRPC session when system-workspace creation fails', async () => {
    mockClient.createSession.mockResolvedValueOnce('sess-4');
    mockWorkspaceService.createSystemWorkspace.mockRejectedValueOnce(new Error('mongo down'));
    mockClient.stopSession.mockResolvedValueOnce(undefined);
    mockWorkspaceShare.assertUserHasAccess.mockResolvedValueOnce(undefined);

    await expect(controller.createSession({ id: 'u1' } as never)).rejects.toThrow('mongo down');
    expect(mockClient.stopSession).toHaveBeenCalledWith('u1', 'sess-4');
    expect(mockSessions.createForUser).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run the test to confirm it fails**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage
```

Expected: at least the two new tests FAIL (the existing implementation doesn't create the system workspace).

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "test(conversation-v2): failing tests for system-workspace creation"
```

---

## Task 8: Implement system workspace creation + rollback in `createSession`

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`

- [ ] **Step 1: Replace the `createSession` method body**

Find the existing `createSession` and replace it with:

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

    const sessionId = await this.grpcClient.createSession(user.id, workspaceIds);

    let systemWorkspaceId: string;
    try {
      const allocatedStorage = this.config.get<number>(
        'conversation.systemWorkspaceStorageBytes',
        52428800,
      );
      const ws = await this.workspaceService.createSystemWorkspace(
        user.id,
        sessionId,
        allocatedStorage,
      );
      systemWorkspaceId = ws.id;
    } catch (err) {
      // Roll back the gRPC session so it doesn't leak.
      this.grpcClient.stopSession(user.id, sessionId).catch(() => undefined);
      throw err;
    }

    await this.sessions.createForUser(user.id, sessionId, workspaceIds, systemWorkspaceId);
    return { sessionId, workspaceIds, systemWorkspaceId };
  }
```

- [ ] **Step 2: Run the tests**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage
```

Expected: PASS — all tests including the two new ones.

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts
git commit -m "feat(conversation-v2): eager system workspace creation on POST /sessions"
```

---

## Task 9: Failing test for `deleteSession` cascade

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Add the test**

Append inside the existing describe block:

```ts
  it('DELETE /sessions/:id cascade-deletes the system workspace when present', async () => {
    mockSessions.getOne.mockResolvedValueOnce({
      sessionId: 's1',
      systemWorkspaceId: 'sys-ws-1',
    } as never);
    mockWorkspaceDocuments.deleteAllByWorkspace = jest.fn().mockResolvedValueOnce(undefined) as never;
    mockWorkspaceService.deleteSystemWorkspace.mockResolvedValueOnce(undefined);
    mockSessions.softDelete.mockResolvedValueOnce({} as never);

    const result = await controller.deleteSession({ id: 'u1' } as never, 's1');

    expect(result).toEqual({ deleted: true });
    expect(mockWorkspaceDocuments.deleteAllByWorkspace).toHaveBeenCalledWith('sys-ws-1');
    expect(mockWorkspaceService.deleteSystemWorkspace).toHaveBeenCalledWith('sys-ws-1');
    expect(mockSessions.softDelete).toHaveBeenCalledWith('u1', 's1');
  });

  it('DELETE /sessions/:id skips cascade when the session has no system workspace', async () => {
    mockSessions.getOne.mockResolvedValueOnce({
      sessionId: 's2',
      systemWorkspaceId: null,
    } as never);
    mockSessions.softDelete.mockResolvedValueOnce({} as never);

    const result = await controller.deleteSession({ id: 'u1' } as never, 's2');

    expect(result).toEqual({ deleted: true });
    expect(mockWorkspaceService.deleteSystemWorkspace).not.toHaveBeenCalled();
    expect(mockSessions.softDelete).toHaveBeenCalledWith('u1', 's2');
  });
```

You may need to ensure `mockWorkspaceDocuments` has `deleteAllByWorkspace` declared in its `jest.Mocked<Pick<...>>` type and is reset in `beforeEach`. If the existing mock only has `generateReadUrl`, extend it:

```ts
const mockWorkspaceDocuments: jest.Mocked<
  Pick<WorkspaceDocumentService, 'generateReadUrl' | 'deleteAllByWorkspace'>
> = {
  generateReadUrl: jest.fn(),
  deleteAllByWorkspace: jest.fn(),
} as never;
```

…and add `mockWorkspaceDocuments.deleteAllByWorkspace.mockReset()` in `beforeEach`.

- [ ] **Step 2: Run the test**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage
```

Expected: the two new tests FAIL (the existing `deleteSession` doesn't cascade).

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "test(conversation-v2): failing tests for system workspace cascade delete"
```

---

## Task 10: Implement cascade delete in `deleteSession`

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`

- [ ] **Step 1: Update the method**

Replace the existing `deleteSession` with:

```ts
  @Delete('sessions/:id')
  @UseGuards(ConversationV2OwnerGuard)
  async deleteSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (pointer?.systemWorkspaceId) {
      const wsId = pointer.systemWorkspaceId.toString();
      await this.workspaceDocuments.deleteAllByWorkspace(wsId);
      await this.workspaceService.deleteSystemWorkspace(wsId);
    }
    await this.sessions.softDelete(user.id, id);
    return { deleted: true };
  }
```

- [ ] **Step 2: Run the tests**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts
git commit -m "feat(conversation-v2): cascade-delete system workspace on session delete"
```

---

## Task 11: Update `GET /sessions/:id` response to include `systemWorkspaceId`

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Update the failing test**

Find the existing test `'GET /sessions/:id returns pointer-only payload, no gRPC call'` and replace it with:

```ts
  it('GET /sessions/:id returns pointer payload including systemWorkspaceId', async () => {
    mockSessions.getOne.mockResolvedValueOnce({
      sessionId: 's1',
      title: 't',
      status: 'active',
      isShared: false,
      workspaceIds: ['ws-a'],
      lastEventAt: new Date('2026-01-01T00:00:00Z'),
      eventCount: 5,
      systemWorkspaceId: 'sys-ws-1',
    } as never);
    const result = await controller.getSession({ id: 'u1' } as never, 's1');
    expect(result.sessionId).toBe('s1');
    expect(result.workspaceIds).toEqual(['ws-a']);
    expect(result.eventCount).toBe(5);
    expect(result.systemWorkspaceId).toBe('sys-ws-1');
    expect(mockClient.getSession).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to confirm the new assertion fails**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage -t "systemWorkspaceId"
```

Expected: FAIL — `result.systemWorkspaceId` is undefined.

- [ ] **Step 3: Update the `getSession` method's response shape**

In `conversation-v2.controller.ts`, replace the `getSession` method:

```ts
  @Get('sessions/:id')
  @UseGuards(ConversationV2OwnerGuard)
  async getSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{
    sessionId: string;
    title: string;
    status: string;
    isShared: boolean;
    workspaceIds: string[];
    lastEventAt: Date;
    eventCount: number;
    systemWorkspaceId: string | null;
  }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer) throw new NotFoundException('Session not found');
    return {
      sessionId: pointer.sessionId,
      title: pointer.title,
      status: pointer.status,
      isShared: pointer.isShared,
      workspaceIds: pointer.workspaceIds ?? [],
      lastEventAt: pointer.lastEventAt,
      eventCount: (pointer as unknown as { eventCount?: number }).eventCount ?? 0,
      systemWorkspaceId:
        (pointer as unknown as { systemWorkspaceId?: { toString(): string } | null })
          .systemWorkspaceId?.toString() ?? null,
    };
  }
```

- [ ] **Step 4: Run the tests**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "feat(conversation-v2): include systemWorkspaceId in GET /sessions/:id"
```

---

## Task 12: Update `GET /share/v2/:token` response to include `systemWorkspaceId`

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.ts`
- Modify: `back/src/modules/conversation-v2/conversation-v2.controller.spec.ts`

- [ ] **Step 1: Update the share test**

Replace the existing share test with:

```ts
  it('GET /share/v2/:token returns session (incl. systemWorkspaceId) + events from Mongo', async () => {
    mockShare.hashToken.mockReturnValueOnce('hsh');
    mockSessions.getByShareToken.mockResolvedValueOnce({
      ownerId: 'u1',
      sessionId: 's1',
      title: 't',
      status: 'completed',
      isShared: true,
      workspaceIds: [],
      systemWorkspaceId: 'sys-ws-1',
    } as never);
    mockEventStore.listSince.mockResolvedValueOnce([
      { sessionId: 's1', sequence: 1, eventId: 'e1', type: 'message', emittedAt: 1, payload: { role: 'user', content: 'hi' } },
    ] as never);

    const result = await controller.getShared('tok');
    expect(result.session.sessionId).toBe('s1');
    expect(result.session.systemWorkspaceId).toBe('sys-ws-1');
    expect(result.events).toHaveLength(1);
    expect(mockClient.getSession).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Update the share method's response shape**

Replace `getShared` in `conversation-v2.controller.ts`:

```ts
  @Get('share/v2/:token')
  @Public()
  async getShared(@Param('token') token: string): Promise<{
    session: {
      sessionId: string;
      title: string;
      status: string;
      isShared: boolean;
      workspaceIds: string[];
      systemWorkspaceId: string | null;
    };
    events: PersistedEventRow[];
  }> {
    const hash = this.share.hashToken(token);
    const pointer = await this.sessions.getByShareToken(hash);
    if (!pointer) throw new NotFoundException('Shared session not found');
    const events = await this.eventStore.listSince(pointer.sessionId, 0, 5000);
    return {
      session: {
        sessionId: pointer.sessionId,
        title: pointer.title,
        status: pointer.status,
        isShared: pointer.isShared,
        workspaceIds: pointer.workspaceIds ?? [],
        systemWorkspaceId:
          (pointer as unknown as { systemWorkspaceId?: { toString(): string } | null })
            .systemWorkspaceId?.toString() ?? null,
      },
      events,
    };
  }
```

- [ ] **Step 3: Run the tests**

```bash
cd back && npx jest conversation-v2.controller.spec --no-coverage
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2.controller.ts back/src/modules/conversation-v2/conversation-v2.controller.spec.ts
git commit -m "feat(conversation-v2): include systemWorkspaceId in /share/v2/:token"
```

---

## Task 13: Failing test for AI artifact harvester in stream controller

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2-stream.controller.spec.ts`

- [ ] **Step 1: Add the mocks**

At the top of the file alongside the existing mocks:

```ts
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';

const mockWorkspaceDocuments: jest.Mocked<
  Pick<WorkspaceDocumentService, 'createFromAiArtifact'>
> = {
  createFromAiArtifact: jest.fn().mockResolvedValue(undefined),
} as never;

const mockWorkspaceService: jest.Mocked<
  Pick<WorkspaceService, 'createSystemWorkspace' | 'deleteSystemWorkspace'>
> = {
  createSystemWorkspace: jest.fn(),
  deleteSystemWorkspace: jest.fn(),
} as never;
```

Add to the `providers` array of the test module:

```ts
{ provide: WorkspaceDocumentService, useValue: mockWorkspaceDocuments },
{ provide: WorkspaceService, useValue: mockWorkspaceService },
```

Reset mocks in `beforeEach`:

```ts
mockWorkspaceDocuments.createFromAiArtifact.mockReset();
mockWorkspaceDocuments.createFromAiArtifact.mockResolvedValue(undefined);
```

If the existing `mockSessions` doesn't return `systemWorkspaceId` from `getOne`, update its mock to do so in this test setup.

- [ ] **Step 2: Add the failing test**

```ts
  it('harvests AI-emitted attachments into the system workspace', async () => {
    // Pointer returns a systemWorkspaceId so the harvester is enabled for
    // this stream.
    mockSessions.getOne = jest.fn().mockResolvedValue({
      sessionId: 's1',
      ownerId: 'u1',
      systemWorkspaceId: 'sys-ws-1',
    });
    mockSessions.createForUser = jest.fn().mockResolvedValue({});

    const chatSubject = new Subject<unknown>();
    grpcClient.chat.mockReturnValueOnce(chatSubject.asObservable() as never);

    const res = new FakeRes() as unknown as Response;
    const streamPromise = controller.stream(
      { id: 'u1' } as never,
      's1',
      { message: 'hi' } as never,
      res,
    );
    await new Promise((r) => setImmediate(r));

    chatSubject.next({
      type: 'message',
      payload: {
        event_id: 'a1',
        timestamp: 1,
        role: 'assistant',
        content: 'here is the file',
        attachments: [
          { id: 'f1', name: 'report.pdf', content_type: 'application/pdf', path: 'u1/files_generated/report.pdf' },
          { id: 'f2', name: 'data.csv',   content_type: 'text/csv',         path: 'u1/files_generated/data.csv' },
        ],
      },
    });
    await new Promise((r) => setImmediate(r));

    chatSubject.complete();
    await streamPromise;

    expect(mockWorkspaceDocuments.createFromAiArtifact).toHaveBeenCalledTimes(2);
    expect(mockWorkspaceDocuments.createFromAiArtifact).toHaveBeenCalledWith(
      'sys-ws-1',
      expect.objectContaining({ path: 'u1/files_generated/report.pdf' }),
    );
    expect(mockWorkspaceDocuments.createFromAiArtifact).toHaveBeenCalledWith(
      'sys-ws-1',
      expect.objectContaining({ path: 'u1/files_generated/data.csv' }),
    );
  });

  it('skips the harvester when the session has no system workspace', async () => {
    mockSessions.getOne = jest.fn().mockResolvedValue({
      sessionId: 's2',
      ownerId: 'u1',
      systemWorkspaceId: null,
    });

    const chatSubject = new Subject<unknown>();
    grpcClient.chat.mockReturnValueOnce(chatSubject.asObservable() as never);

    const res = new FakeRes() as unknown as Response;
    const streamPromise = controller.stream(
      { id: 'u1' } as never,
      's2',
      { message: 'hi' } as never,
      res,
    );
    await new Promise((r) => setImmediate(r));

    chatSubject.next({
      type: 'message',
      payload: {
        event_id: 'a1',
        timestamp: 1,
        role: 'assistant',
        content: 'reply',
        attachments: [{ id: 'f1', name: 'x.pdf', content_type: 'application/pdf', path: 'p' }],
      },
    });
    await new Promise((r) => setImmediate(r));

    chatSubject.complete();
    await streamPromise;

    expect(mockWorkspaceDocuments.createFromAiArtifact).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd back && npx jest conversation-v2-stream.controller --no-coverage
```

Expected: at least the two new tests FAIL.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2-stream.controller.spec.ts
git commit -m "test(conversation-v2): failing tests for AI artifact harvester"
```

---

## Task 14: Implement AI artifact harvester in stream controller

**Files:**
- Modify: `back/src/modules/conversation-v2/conversation-v2-stream.controller.ts`

- [ ] **Step 1: Resolve `systemWorkspaceId` once at stream start**

Inside the `stream` method, after the existing `await this.sessions.createForUser(...)` call and BEFORE the userEvent persistence block, resolve the pointer's system workspace id:

```ts
    // Resolve the session's system workspace once so we can harvest AI-emitted
    // attachments into it during this stream. Null for legacy sessions
    // without a system workspace — the harvester skips in that case.
    const pointer = await this.sessions.getOne(user.id, sessionId);
    const systemWorkspaceId =
      (pointer as unknown as { systemWorkspaceId?: { toString(): string } | null } | null)
        ?.systemWorkspaceId?.toString() ?? null;
```

- [ ] **Step 2: Add the harvester inside `processEvent`**

Inside the existing `processEvent` async closure, after the `pointerWriter.apply(...)` line and before `sseWrite(...)`, add:

```ts
          // Harvest AI-emitted attachments into the session's system workspace.
          // Fire-and-forget: never fails the SSE write. AI's no-dup contract
          // means we don't dedupe.
          if (
            systemWorkspaceId &&
            event.type === 'message' &&
            (event.payload as { role?: string }).role === 'assistant'
          ) {
            const attachments = (event.payload as { attachments?: unknown[] }).attachments;
            if (Array.isArray(attachments)) {
              for (const fileInfo of attachments as Array<{
                id: string;
                name: string;
                content_type: string;
                path: string;
              }>) {
                this.workspaceDocuments
                  .createFromAiArtifact(systemWorkspaceId, fileInfo)
                  .catch((e) =>
                    this.logger?.warn?.(
                      `Artifact registration failed: ${(e as Error).message}`,
                    ),
                  );
              }
            }
          }
```

If `this.logger` isn't available on the controller, inline a `console.warn` fallback or add a `LoggerService` injection mirroring other controllers' pattern.

- [ ] **Step 3: Run the tests**

```bash
cd back && npx jest conversation-v2-stream.controller --no-coverage
```

Expected: PASS — all tests including the two new ones.

- [ ] **Step 4: Run the full v2 suite**

```bash
cd back && npx jest --testPathPattern="conversation-v2" --no-coverage
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/conversation-v2/conversation-v2-stream.controller.ts
git commit -m "feat(conversation-v2): harvest AI-emitted attachments into the system workspace"
```

---

## Task 15: Frontend — add `systemWorkspaceId` to `SessionPointer`

**Files:**
- Modify: `front/src/modules/conversation-v2/api.ts`

- [ ] **Step 1: Extend the type**

Find the `export interface SessionPointer { ... }` block and add the field:

```ts
export interface SessionPointer {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  workspaceIds: string[];
  lastEventAt: string;
  eventCount: number;
  systemWorkspaceId: string | null;
}
```

- [ ] **Step 2: Compile-check**

```bash
cd front && npx tsc --noEmit
```

Expected: clean. (Backend now returns the field; existing callers ignore it harmlessly.)

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/conversation-v2/api.ts
git commit -m "feat(conversation-v2-front): add systemWorkspaceId to SessionPointer"
```

---

## Task 16: Frontend store — `systemWorkspaceId` + `'files'` mode

**Files:**
- Modify: `front/src/modules/conversation-v2/store.ts`
- Modify: `front/src/modules/conversation-v2/store.test.ts`

- [ ] **Step 1: Failing tests**

Append inside the existing describe block in `store.test.ts`:

```ts
  it('setSystemWorkspaceId updates state', () => {
    useConversationV2Store.getState().setSystemWorkspaceId('sys-ws-1');
    expect(useConversationV2Store.getState().systemWorkspaceId).toBe('sys-ws-1');
    useConversationV2Store.getState().setSystemWorkspaceId(null);
    expect(useConversationV2Store.getState().systemWorkspaceId).toBeNull();
  });

  it('openFilesPanel sets rightPanelMode to "files"', () => {
    useConversationV2Store.getState().openFilesPanel();
    expect(useConversationV2Store.getState().rightPanelMode).toBe('files');
  });

  it('closeRightPanel returns mode to "closed" from files mode', () => {
    useConversationV2Store.getState().openFilesPanel();
    useConversationV2Store.getState().closeRightPanel();
    expect(useConversationV2Store.getState().rightPanelMode).toBe('closed');
  });
```

- [ ] **Step 2: Run to confirm failures**

```bash
cd front && npx vitest run src/modules/conversation-v2/store.test.ts
```

Expected: 3 new tests FAIL.

- [ ] **Step 3: Implement the changes**

In `store.ts`:

a) Extend `State`:

```ts
interface State {
  // ... existing ...
  systemWorkspaceId: string | null;
  rightPanelMode: 'closed' | 'tool' | 'files';
}
```

b) Add the field to `initial`:

```ts
  systemWorkspaceId: null,
```

(`rightPanelMode` is already in initial with `'closed'`.)

c) Extend `Actions`:

```ts
interface Actions {
  // ... existing ...
  setSystemWorkspaceId: (id: string | null) => void;
  openFilesPanel: () => void;
}
```

d) Implement inside the `create()` factory:

```ts
      setSystemWorkspaceId: (id) =>
        set({ systemWorkspaceId: id }, false, 'setSystemWorkspaceId'),
      openFilesPanel: () =>
        set({ rightPanelMode: 'files', selectedToolCallId: null }, false, 'openFilesPanel'),
```

Place near the other panel-related actions (`openToolPanel`, `closeRightPanel`, `jumpToLive`).

- [ ] **Step 4: Run the tests**

```bash
cd front && npx vitest run src/modules/conversation-v2/store.test.ts
```

Expected: PASS — all tests including the three new ones.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/conversation-v2/store.ts front/src/modules/conversation-v2/store.test.ts
git commit -m "feat(conversation-v2-front): add systemWorkspaceId state and files panel mode"
```

---

## Task 17: Wire `setSystemWorkspaceId` into page loaders

**Files:**
- Modify: `front/src/modules/conversation-v2/ConversationV2SessionPage.tsx`
- Modify: `front/src/modules/conversation-v2/SharedConversationV2Page.tsx`

- [ ] **Step 1: Update the session page**

Find the catch-up async IIFE in `ConversationV2SessionPage.tsx`. Right after `setSessionId(pointer.sessionId)`, add:

```ts
        store.setSystemWorkspaceId(pointer.systemWorkspaceId);
```

(If the page destructures actions from `useConversationV2Store(useShallow(...))`, add `setSystemWorkspaceId` to the destructuring and call it as `setSystemWorkspaceId(pointer.systemWorkspaceId)` rather than via `store`.)

- [ ] **Step 2: Update the shared page**

In `SharedConversationV2Page.tsx`, after `setSessionId(session.sessionId)` (or wherever `setSessionId` is called), add the matching call:

```ts
setSystemWorkspaceId(session.systemWorkspaceId);
```

- [ ] **Step 3: Compile-check + tests**

```bash
cd front && npx tsc --noEmit
cd front && npx vitest run src/modules/conversation-v2/
```

Expected: clean + green.

- [ ] **Step 4: Commit**

```bash
git add front/src/modules/conversation-v2/ConversationV2SessionPage.tsx front/src/modules/conversation-v2/SharedConversationV2Page.tsx
git commit -m "feat(conversation-v2-front): populate systemWorkspaceId on page load"
```

---

## Task 18: Create the `FilesPanel` component

**Files:**
- Create: `front/src/modules/conversation-v2/components/RightPanel/FilesPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { FileIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { apiClient, ApiResponse } from '@/lib/api';
import { useFileViewerStore, openFileViewerFromUrl, getMimeTypeFromFilename } from '@/modules/file-viewer';
import { conversationV2Api } from '../../api';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';

interface WorkspaceDocumentRow {
  id: string;
  originalName: string;
  mimeType: string;
  path: string;
  size: number;
  createdAt: string;
}

interface DocumentsResponse {
  documents: WorkspaceDocumentRow[];
}

export function FilesPanel() {
  const { t } = useConversationV2Translation();
  const { systemWorkspaceId, events } = useConversationV2Store(
    useShallow((s) => ({
      systemWorkspaceId: s.systemWorkspaceId,
      events: s.events,
    })),
  );

  // Refresh whenever the count of assistant attachments changes — cheap
  // heuristic that catches AI-generated artifacts as they arrive.
  const attachmentCount = useMemo(
    () =>
      events.reduce((acc, e) => {
        if (e.type === 'message' && e.role === 'assistant' && Array.isArray(e.attachments)) {
          return acc + e.attachments.length;
        }
        return acc;
      }, 0),
    [events],
  );

  const [items, setItems] = useState<WorkspaceDocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const closeFileViewer = useFileViewerStore((s) => s.closeViewer);

  useEffect(() => {
    if (!systemWorkspaceId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiClient
      .get<ApiResponse<DocumentsResponse>>(`/workspaces/${systemWorkspaceId}/documents`)
      .then((res) => {
        if (cancelled) return;
        setItems(res.data.data.documents ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [systemWorkspaceId, attachmentCount]);

  const openFile = async (doc: WorkspaceDocumentRow) => {
    try {
      const { url } = await conversationV2Api.getFileSignedUrl(doc.path);
      const mimeType =
        getMimeTypeFromFilename(doc.originalName) ?? doc.mimeType ?? 'application/octet-stream';
      closeFileViewer();
      openFileViewerFromUrl(url, doc.originalName, mimeType, { displayMode: 'sidebar' });
    } catch {
      /* swallow — surfaced via the file-viewer's own error state if needed */
    }
  };

  if (!systemWorkspaceId) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('files.unavailable')}
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('files.loading')}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className='flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground'>
        {t('files.empty')}
      </div>
    );
  }

  return (
    <ul className='flex flex-1 flex-col gap-1 overflow-auto p-2'>
      {items.map((doc) => (
        <li key={doc.id}>
          <button
            type='button'
            onClick={() => openFile(doc)}
            className='flex w-full items-center gap-2 rounded-md border border-border bg-card p-2 text-left text-sm hover:bg-accent/40'
          >
            <FileIcon className='size-4 shrink-0 text-muted-foreground' />
            <span className='truncate'>{doc.originalName}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Compile-check**

```bash
cd front && npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/conversation-v2/components/RightPanel/FilesPanel.tsx
git commit -m "feat(conversation-v2-front): add FilesPanel for system workspace docs"
```

---

## Task 19: Render `FilesPanel` inside `RightPanel`

**Files:**
- Modify: `front/src/modules/conversation-v2/components/RightPanel/RightPanel.tsx`

- [ ] **Step 1: Update the component**

The current `RightPanel.tsx` returns `null` when `mode === 'closed' || !selectedToolCallId`. We need to also render when `mode === 'files'`. Replace the body with:

```tsx
import { PlayIcon, XIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '@/components/ui/button';
import { useConversationV2Store } from '../../store';
import { useConversationV2Translation } from '../../translation';
import { ToolDetailDispatch } from './tool-views/ToolDetailDispatch';
import { FilesPanel } from './FilesPanel';

export function RightPanel() {
  const { t } = useConversationV2Translation();
  const { mode, close, selectedToolCallId, liveToolCallId, jumpToLive, streaming } =
    useConversationV2Store(
      useShallow((s) => ({
        mode: s.rightPanelMode,
        close: s.closeRightPanel,
        selectedToolCallId: s.selectedToolCallId,
        liveToolCallId: s.liveToolCallId,
        jumpToLive: s.jumpToLive,
        streaming: s.streaming,
      })),
    );

  if (mode === 'closed') return null;
  if (mode === 'tool' && !selectedToolCallId) return null;

  const realTime = selectedToolCallId === liveToolCallId;
  const showJumpToLive =
    mode === 'tool' && streaming && !!liveToolCallId && !realTime;

  return (
    <aside className='flex h-full w-[44%] min-w-[28rem] max-w-[44rem] shrink-0 flex-col border-l bg-card/40'>
      <header className='flex shrink-0 items-center justify-between border-b px-4 py-3'>
        <span className='text-sm font-semibold'>
          {mode === 'files' ? t('files.title') : t('rightPanel.title')}
        </span>
        <Button
          variant='ghost'
          size='icon-sm'
          aria-label={t('rightPanel.close')}
          onClick={close}
        >
          <XIcon className='size-4' />
        </Button>
      </header>
      <div className='relative flex min-h-0 flex-1 flex-col p-3'>
        {mode === 'tool' ? <ToolDetailDispatch /> : <FilesPanel />}
        {showJumpToLive && (
          <div className='pointer-events-none absolute inset-x-0 bottom-3 flex justify-center'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={jumpToLive}
              className='pointer-events-auto gap-1 rounded-full shadow-md'
            >
              <PlayIcon className='size-4' />
              {t('rightPanel.jumpToLive')}
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Compile-check + run existing right-panel test**

```bash
cd front && npx tsc --noEmit
cd front && npx vitest run src/modules/conversation-v2/components/RightPanel/
```

Expected: clean + green. If the existing `RightPanel.test.tsx` snapshots break, update the snapshot only if the change is purely additive (use `-u` flag if needed).

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/conversation-v2/components/RightPanel/RightPanel.tsx
git commit -m "feat(conversation-v2-front): render FilesPanel when rightPanelMode is files"
```

---

## Task 20: Add the Files button to the Composer

**Files:**
- Modify: `front/src/modules/conversation-v2/components/Composer.tsx`

- [ ] **Step 1: Add the button**

Open `Composer.tsx`. Add the necessary store subscriptions at the top of the component (alongside the existing ones):

```ts
  const systemWorkspaceId = useConversationV2Store((s) => s.systemWorkspaceId);
  const rightPanelMode = useConversationV2Store((s) => s.rightPanelMode);
  const openFilesPanel = useConversationV2Store((s) => s.openFilesPanel);
  const closeRightPanel = useConversationV2Store((s) => s.closeRightPanel);
  const events = useConversationV2Store((s) => s.events);

  const filesCount = useMemo(
    () =>
      events.reduce((acc, e) => {
        if (e.type === 'message' && e.role === 'assistant' && Array.isArray(e.attachments)) {
          return acc + e.attachments.length;
        }
        return acc;
      }, 0),
    [events],
  );
```

Import `useMemo` from React if not already imported, and `PaperclipIcon` from `lucide-react`.

Inside `<PromptInputTools>` (next to the existing model selector / pause / stop buttons), add:

```tsx
<PromptInputButton
  type='button'
  onClick={() =>
    rightPanelMode === 'files' ? closeRightPanel() : openFilesPanel()
  }
  disabled={!systemWorkspaceId}
  title={!systemWorkspaceId ? t('files.unavailable') : undefined}
>
  <PaperclipIcon className='size-4' />
  <span>{t('files.button')}</span>
  {filesCount > 0 && (
    <span className='ml-1 rounded bg-muted px-1 text-xs'>{filesCount}</span>
  )}
</PromptInputButton>
```

Place it before the pause/stop buttons so the order is: model selector → files → pause → stop.

- [ ] **Step 2: Compile-check + tests**

```bash
cd front && npx tsc --noEmit
cd front && npx vitest run src/modules/conversation-v2/
```

Expected: clean + green.

- [ ] **Step 3: Commit**

```bash
git add front/src/modules/conversation-v2/components/Composer.tsx
git commit -m "feat(conversation-v2-front): files button in composer toggles files panel"
```

---

## Task 21: i18n keys

**Files:**
- Modify: `front/src/modules/conversation-v2/locales/en.json` (or whichever path the project uses)
- Modify: `front/src/modules/conversation-v2/locales/fr.json`

- [ ] **Step 1: Find the locale files**

```bash
cd front && find src/modules/conversation-v2 -name "*.json" -path "*locales*"
```

The path may differ. Use whatever the existing convention is.

- [ ] **Step 2: Add the keys**

In `en.json`, add a `files` block at the top level:

```json
"files": {
  "button": "Files",
  "title": "Files in this conversation",
  "empty": "No files yet.",
  "loading": "Loading files…",
  "unavailable": "Files unavailable for this session"
}
```

In `fr.json`:

```json
"files": {
  "button": "Fichiers",
  "title": "Fichiers de cette conversation",
  "empty": "Aucun fichier pour le moment.",
  "loading": "Chargement des fichiers…",
  "unavailable": "Fichiers indisponibles pour cette session"
}
```

If the locale convention nests under an explicit `conversation-v2` namespace, place these inside that namespace.

- [ ] **Step 3: Compile-check + smoke run**

```bash
cd front && npx tsc --noEmit
cd front && npx vitest run src/modules/conversation-v2/
```

Expected: clean + green.

- [ ] **Step 4: Commit**

```bash
git add front/src/modules/conversation-v2/locales/
git commit -m "feat(conversation-v2-front): i18n keys for files panel"
```

---

## Task 22: End-to-end smoke (manual)

**Files:** none — this is a manual verification step.

- [ ] **Step 1: Bring up backend + frontend**

```bash
cd back && npm run start:dev
cd front && npm run dev
```

- [ ] **Step 2: Smoke checklist**

- [ ] Create a brand-new V2 session. Confirm `POST /conversation-v2/sessions` returns `systemWorkspaceId` in the JSON body (browser DevTools → Network).
- [ ] Send a message that you expect to produce a file artifact (e.g., "summarize this and save as a PDF" if your AI service supports that — or a message that triggers any `message`-event attachment).
- [ ] Confirm the Files button in the composer becomes active and the counter increments as artifacts arrive.
- [ ] Click the Files button — the right panel opens to `'files'` mode showing the documents. Click a file to open it in the file viewer sidebar.
- [ ] Click Files again — panel closes.
- [ ] Delete the session via the UI. Confirm the workspace + documents are gone:

  ```bash
  # In a Mongo shell or via the Node REPL
  db.workspaces.findOne({ name: /^system-/, isSystem: true, conversationId: null })
  # Should NOT find the just-deleted session's workspace
  ```
- [ ] Open an old (pre-rework) session. Confirm the Files button is disabled (tooltip says "Files unavailable").
- [ ] Run lint + tests:

  ```bash
  cd back && npm run lint && npm run test
  cd front && npm run test
  ```

- [ ] **Step 3: Document any deviations**

If something surfaces during smoke testing, update the spec's §10 Open/Deferred section or open a follow-up.

---

## Self-review

**Spec coverage** (one task per spec section):
- §3.1 Lifecycle → Tasks 1, 3, 8, 10
- §3.2 AI artifact harvest → Tasks 4, 5, 13, 14
- §3.3 User uploads → reuses existing endpoints, no task needed (verified in spec)
- §3.4 Endpoint shape changes → Tasks 8, 10, 11, 12
- §4 Schemas → Tasks 1, 3
- §5.1 createFromAiArtifact → Tasks 4, 5
- §5.2 createSession diff → Tasks 7, 8
- §5.3 createForUser signature → Tasks 2, 3
- §5.4 deleteSession diff → Tasks 9, 10
- §5.5 Stream controller harvester → Tasks 13, 14
- §5.6 Response shapes → Tasks 11, 12
- §5.7 Module wiring → Task 6
- §6 Frontend → Tasks 15–21
- §7 Migration → no migration; documented inline
- §8 Error handling → covered by Tasks 7 (rollback), 13 (skip when null), 14 (fire-and-forget)
- §9 Testing → Tasks 2, 4, 7, 9, 13, 16, 22

No spec section uncovered.

**Placeholder scan:** No `TBD` / `TODO` / `implement later` / vague handwaves. The few "search the existing file for X" lines (Task 2 for mock variable name, Task 5 for `findById` confirmation, Task 21 for locale path) are concrete pointers the implementer can resolve in seconds — not placeholders for design decisions.

**Type consistency:**
- `systemWorkspaceId: string | null` is consistent across `SessionPointer` (front), the controller response shapes, and the schema's stored `Types.ObjectId | null` (serialized via `.toString()` at the boundary).
- `createFromAiArtifact(systemWorkspaceId: string, fileInfo: { id, name, content_type, path })` is the same signature everywhere it's referenced (Tasks 4, 5, 13, 14).
- `createForUser(ownerId, sessionId, workspaceIds, systemWorkspaceId?)` is consistent (Tasks 2, 3, 7).
- `rightPanelMode: 'closed' | 'tool' | 'files'` is consistent in the store, RightPanel, and Composer.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-conversation-v2-system-workspace.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
