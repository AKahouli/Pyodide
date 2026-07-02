# Public Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-workspace Public/Private switch so a public workspace is readable by every logged-in user (read-only), usable everywhere, and discoverable in a Public section of the Workspaces hub.

**Architecture:** Add `isPublic` to the workspace model. `WorkspaceAccessGuard` grants `read` to any user for a public workspace (before checking shares — so shares go dormant while public); `WritePermissionGuard` already blocks writes for `read`. A new owner-only `PATCH /workspaces/:id/visibility` toggles the flag; a new `GET /workspaces/public` lists others' public workspaces. The frontend adds a store slice, a switch in the Share dialog, a hub Public section, and a Public group in the workspace pickers.

**Tech Stack:** NestJS + Mongoose (backend, Jest), React + Zustand + Vite + shadcn/ui (frontend, Vitest), i18next.

## Global Constraints

- Public = readable by **all logged-in users**, **read-only** (owner keeps full control; public users cannot write/add). No anonymous access.
- **Access precedence in `WorkspaceAccessGuard`:** owner → `'owner'`; else `isPublic` → `'read'`; else active share → its permission; else Forbidden. Public dominates shares (shares dormant while public).
- **Toggle is reversible**; making public **does not delete** shares or reset `shareCount` (they reactivate when private again).
- Only the **owner** toggles; **system** workspaces cannot be made public. Personal workspaces may be.
- `GET /workspaces/public` excludes the requester's own workspaces and system workspaces.
- A public workspace **cannot be shared**: `WorkspaceShareService.share()` rejects when `isPublic`.
- Backend tests: `cd back && npx jest <pattern>`. Frontend tests: `cd front && npx vitest run <path>`.
- Follow existing patterns exactly (guard structure, `mapToResponse`, `ApiResponse<T>` envelope, store Map-cache slices, `useModuleTranslation`).
- Frontend `tsc` has ~40 PRE-EXISTING unrelated errors in `CommunityGraphPanel.tsx` (missing d3 types) — ignore those; only new errors count. Frontend store tests use factory mocks (a broken d3 install breaks bare automock).

---

## File Structure

**Backend — modified**
- `schemas/workspace.schema.ts` — add `isPublic`
- `interfaces/workspace.interface.ts` — `WorkspaceResponse.isPublic`; new `PublicWorkspaceResponse` + `PaginatedPublicWorkspaces`
- `workspace.service.ts` — `mapToResponse` adds `isPublic`; new `setVisibility`, `findPublic`
- `guards/workspace-access.guard.ts` — public precedence
- `workspace-share.service.ts` — `hasAccess`/`assertUserHasAccess` accept public; `share()` rejects public
- `dto/update-visibility.dto.ts` — new
- `workspace.controller.ts` — `PATCH /:id/visibility`, `GET /public`
- `exceptions/constants/error-codes.ts` — new codes + messages

**Backend — new tests**
- `guards/workspace-access.guard.spec.ts`
- `workspace-share.service.spec.ts` (access + share-reject)
- `workspace.service.public.spec.ts` (setVisibility + findPublic)

**Frontend — modified**
- `lib/api/config.ts` — `workspaces.public`, `workspaces.visibility`
- `modules/workspace/types.ts` — `Workspace.isPublic`, `PublicWorkspaceResponse`
- `modules/workspace/api.ts` — `getPublicWorkspaces`, `setVisibility`
- `modules/workspace/store.ts` — public slice + `setWorkspaceVisibility`
- `modules/workspace/store.test.ts` (or new `store.public.test.ts`)
- `components/ShareWorkspaceDialog/index.tsx` — Public switch
- `hooks/useWorkspaceHubFilters.ts` — `public` filter + items + count
- `components/hub/WorkspaceHubOverview.tsx` — Public count chip
- `components/WorkspaceHubPage.tsx` — fetch public on mount
- `components/hub/WorkspaceCard.tsx` — Public badge
- `components/WorkspaceSelect.tsx` + `components/WorkspacePicker.tsx` — Public group
- `modules/workspace/locales/en.json` + `fr.json` — new strings

---

## Task 1: Backend — schema flag, response field, error codes

**Files:**
- Modify: `back/src/modules/workspace/schemas/workspace.schema.ts` (after line 49, the `shareCount` prop)
- Modify: `back/src/modules/workspace/interfaces/workspace.interface.ts` (`WorkspaceResponse`, add new interfaces)
- Modify: `back/src/modules/workspace/workspace.service.ts` (`mapToResponse`, ~line 676)
- Modify: `back/src/modules/exceptions/constants/error-codes.ts` (after line 133, and messages after line 477)

**Interfaces:**
- Produces: `Workspace.isPublic: boolean`; `WorkspaceResponse.isPublic: boolean`; `PublicWorkspaceResponse`, `PaginatedPublicWorkspaces`; `ErrorCode.WORKSPACE_PUBLIC_NO_SHARE`, `ErrorCode.WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM`.

- [ ] **Step 1: Add the schema prop**

In `workspace.schema.ts`, immediately after the `shareCount` prop (line 48-49):

```ts
  @Prop({ type: Boolean, default: false, index: true })
  isPublic!: boolean;
```

- [ ] **Step 2: Add error codes + messages**

In `error-codes.ts`, after line 133 (`WORKSPACE_SHARE_USER_NOT_FOUND = 'ERR_1958',`):

```ts
  WORKSPACE_PUBLIC_NO_SHARE = 'ERR_1959',
  WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM = 'ERR_1960',
```

And in the messages map, after line 477 (`[ErrorCode.WORKSPACE_READ_ONLY]: ...`):

```ts
  [ErrorCode.WORKSPACE_PUBLIC_NO_SHARE]:
    'This workspace is public and cannot be shared. Make it private first.',
  [ErrorCode.WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM]: 'System workspaces cannot be made public.',
```

- [ ] **Step 3: Extend the response interfaces**

In `interfaces/workspace.interface.ts`, add `isPublic: boolean;` to `WorkspaceResponse` right after the `shareCount: number;` line (line 38). Then append these new interfaces at the end of the file:

```ts
export interface PublicWorkspaceOwnerInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface PublicWorkspaceResponse {
  id: string;
  name: string;
  alias: string;
  storagePrefix: string;
  description?: string;
  owner: PublicWorkspaceOwnerInfo;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPublicWorkspaces {
  workspaces: PublicWorkspaceResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
```

- [ ] **Step 4: Include isPublic in mapToResponse**

In `workspace.service.ts` `mapToResponse` (the returned object, ~line 690), add after the `shareCount:` line:

```ts
      isPublic: workspace.isPublic || false,
```

- [ ] **Step 5: Verify backend compiles**

Run: `cd back && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/workspace/schemas/workspace.schema.ts back/src/modules/workspace/interfaces/workspace.interface.ts back/src/modules/workspace/workspace.service.ts back/src/modules/exceptions/constants/error-codes.ts
git commit -m "feat(workspace): add isPublic flag, response field and error codes"
```

---

## Task 2: Backend — public read access (guard + share-service access) (TDD)

**Files:**
- Modify: `back/src/modules/workspace/guards/workspace-access.guard.ts`
- Modify: `back/src/modules/workspace/workspace-share.service.ts` (`hasAccess` ~line 95, `assertUserHasAccess` ~line 48)
- Test: `back/src/modules/workspace/guards/workspace-access.guard.spec.ts` (new)
- Test: `back/src/modules/workspace/workspace-share.service.spec.ts` (new — access methods only)

**Interfaces:**
- Consumes: `Workspace.isPublic` (Task 1).
- Produces: `WorkspaceAccessGuard` grants `request.workspaceRole = 'read'` for a public workspace to a non-owner; `hasAccess`/`assertUserHasAccess` treat public workspaces as accessible.

- [ ] **Step 1: Write the failing guard test**

Create `back/src/modules/workspace/guards/workspace-access.guard.spec.ts`:

```ts
import { Types } from 'mongoose';
import { ExecutionContext } from '@nestjs/common';
import { WorkspaceAccessGuard } from './workspace-access.guard';
import { ForbiddenException } from '../../exceptions';

const OWNER = new Types.ObjectId();
const OTHER = new Types.ObjectId();

function ctxFor(user: { _id: Types.ObjectId }, workspaceId: string): { ctx: ExecutionContext; req: any } {
  const req: any = { user, params: { id: workspaceId } };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

function makeGuard(workspace: any, share: any) {
  const workspaceModel: any = { findById: () => ({ exec: () => Promise.resolve(workspace) }) };
  const shareModel: any = { findOne: () => ({ lean: () => ({ exec: () => Promise.resolve(share) }) }) };
  return new WorkspaceAccessGuard(workspaceModel, shareModel);
}

describe('WorkspaceAccessGuard — public access', () => {
  const wsId = new Types.ObjectId().toString();

  it('grants read to a non-owner when the workspace is public (no share needed)', async () => {
    const guard = makeGuard({ _id: wsId, createdBy: OWNER, isPublic: true }, null);
    const { ctx, req } = ctxFor({ _id: OTHER }, wsId);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.workspaceRole).toBe('read');
  });

  it('downgrades a readwrite-shared user to read while the workspace is public (dormant share)', async () => {
    const guard = makeGuard(
      { _id: wsId, createdBy: OWNER, isPublic: true },
      { permission: 'readwrite' },
    );
    const { ctx, req } = ctxFor({ _id: OTHER }, wsId);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.workspaceRole).toBe('read');
  });

  it('still forbids a non-owner on a private workspace with no share', async () => {
    const guard = makeGuard({ _id: wsId, createdBy: OWNER, isPublic: false }, null);
    const { ctx } = ctxFor({ _id: OTHER }, wsId);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives the owner the owner role regardless of isPublic', async () => {
    const guard = makeGuard({ _id: wsId, createdBy: OWNER, isPublic: true }, null);
    const { ctx, req } = ctxFor({ _id: OWNER }, wsId);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.workspaceRole).toBe('owner');
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd back && npx jest workspace-access.guard.spec.ts`
Expected: FAIL (the readwrite-dormant and public-no-share cases fail because the current guard checks shares before public and forbids when no share).

- [ ] **Step 3: Update the guard**

In `guards/workspace-access.guard.ts`, replace the block from the owner check through the share check (lines 62-83) with:

```ts
    if (workspace.createdBy.toString() === userId) {
      request.workspace = workspace;
      request.workspaceRole = 'owner';
      return true;
    }

    // Public workspaces are readable by any authenticated user. This takes
    // precedence over shares: while public, an explicit share is dormant and
    // everyone (even a readwrite-shared user) gets read-only access.
    if (workspace.isPublic) {
      request.workspace = workspace;
      request.workspaceRole = 'read';
      return true;
    }

    const share = await this.shareModel
      .findOne({ workspaceId: new Types.ObjectId(workspaceId), sharedWithUserId: user._id })
      .lean()
      .exec();

    if (!share) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }

    request.workspace = workspace;
    request.workspaceRole = share.permission;

    return true;
```

- [ ] **Step 4: Run the guard test — expect PASS**

Run: `cd back && npx jest workspace-access.guard.spec.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Write the failing share-service access test**

Create `back/src/modules/workspace/workspace-share.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { WorkspaceShareService } from './workspace-share.service';
import { Workspace } from './schemas/workspace.schema';
import { WorkspaceShare } from './schemas/workspace-share.schema';
import { LoggerService } from '../logger';
import { UserService } from '../user';
import { NotificationsService } from '../notifications/notifications.service';

const USER = new Types.ObjectId().toString();
const WS = new Types.ObjectId().toString();

function build(overrides: { workspaceModel?: any; shareModel?: any } = {}) {
  const workspaceModel: any = {
    exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
    find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }),
    findById: jest.fn(),
    updateOne: jest.fn().mockReturnValue({ exec: () => Promise.resolve({}) }),
    ...overrides.workspaceModel,
  };
  const shareModel: any = {
    exists: jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) }),
    find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) }),
    ...overrides.shareModel,
  };
  const svc = new WorkspaceShareService(
    workspaceModel,
    shareModel,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() } as unknown as LoggerService,
    {} as unknown as UserService,
    {} as unknown as NotificationsService,
  );
  return { svc, workspaceModel, shareModel };
}

describe('WorkspaceShareService — public access', () => {
  it('hasAccess returns true for a non-owner when the workspace is public', async () => {
    const { svc, workspaceModel, shareModel } = build();
    // owner check + share check both false; public existence check true
    workspaceModel.exists = jest
      .fn()
      // first call: owner exists? -> null
      .mockReturnValueOnce({ exec: () => Promise.resolve(null) })
      // third call (public): exists -> truthy
      .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: WS }) });
    shareModel.exists = jest.fn().mockReturnValue({ exec: () => Promise.resolve(null) });
    await expect(svc.hasAccess(USER, WS)).resolves.toBe(true);
  });

  it('assertUserHasAccess passes when a requested workspace is public', async () => {
    const { svc, workspaceModel } = build();
    // owned: none; shared: none; public: the requested id
    workspaceModel.find = jest
      .fn()
      // owned
      .mockReturnValueOnce({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }) })
      // public
      .mockReturnValueOnce({ select: () => ({ lean: () => ({ exec: () => Promise.resolve([{ _id: new Types.ObjectId(WS) }]) }) }) });
    await expect(svc.assertUserHasAccess(USER, [WS])).resolves.toBeUndefined();
  });
});
```

Note: the exact number/shape of `exists`/`find` calls depends on how you implement Step 6 — adjust the mock sequencing in this test to match your final implementation (the assertions on the public path are what matter). Keep both behavioral assertions.

- [ ] **Step 6: Run it — expect FAIL, then implement**

Run: `cd back && npx jest workspace-share.service.spec.ts`
Expected: FAIL (public not yet considered).

In `workspace-share.service.ts`:

**`hasAccess`** (currently owner OR share) — add a public check. Replace the `Promise.all([...])` + return (lines 103-112) with:

```ts
    const [owned, shared, isPublic] = await Promise.all([
      this.workspaceModel.exists({ _id: workspaceObjectId, createdBy: userObjectId }).exec(),
      this.shareModel.exists({ workspaceId: workspaceObjectId, sharedWithUserId: userObjectId }).exec(),
      this.workspaceModel.exists({ _id: workspaceObjectId, isPublic: true }).exec(),
    ]);

    return Boolean(owned || shared || isPublic);
```

**`assertUserHasAccess`** — add public ids to the accessible set. Change the `Promise.all([...])` (lines 62-73) to also query public workspaces, and fold them into `accessibleIds`:

```ts
    const [owned, shared, publicWs] = await Promise.all([
      this.workspaceModel
        .find({ _id: { $in: objectIds }, createdBy: userObjectId })
        .select('_id')
        .lean()
        .exec(),
      this.shareModel
        .find({ workspaceId: { $in: objectIds }, sharedWithUserId: userObjectId })
        .select('workspaceId')
        .lean()
        .exec(),
      this.workspaceModel
        .find({ _id: { $in: objectIds }, isPublic: true })
        .select('_id')
        .lean()
        .exec(),
    ]);

    const accessibleIds = new Set<string>([
      ...owned.map((w) => w._id.toString()),
      ...shared.map((s) => s.workspaceId.toString()),
      ...publicWs.map((w) => w._id.toString()),
    ]);
```

(Leave the subsequent `missing` computation and throw as-is.)

- [ ] **Step 7: Run both backend test files — expect PASS**

Run: `cd back && npx jest workspace-access.guard.spec.ts workspace-share.service.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add back/src/modules/workspace/guards/workspace-access.guard.ts back/src/modules/workspace/workspace-share.service.ts back/src/modules/workspace/guards/workspace-access.guard.spec.ts back/src/modules/workspace/workspace-share.service.spec.ts
git commit -m "feat(workspace): grant public read access in guard and access checks"
```

---

## Task 3: Backend — publish toggle (setVisibility + endpoint) and share-reject (TDD)

**Files:**
- Create: `back/src/modules/workspace/dto/update-visibility.dto.ts`
- Modify: `back/src/modules/workspace/workspace.service.ts` (add `setVisibility`)
- Modify: `back/src/modules/workspace/workspace-share.service.ts` (`share()` reject when public)
- Modify: `back/src/modules/workspace/workspace.controller.ts` (add `PATCH /:id/visibility`)
- Test: `back/src/modules/workspace/workspace.service.public.spec.ts` (new — `setVisibility`)
- Test: add to `workspace-share.service.spec.ts` (share-reject case)

**Interfaces:**
- Consumes: `Workspace.isPublic`, `ErrorCode.WORKSPACE_PUBLIC_*` (Task 1); `WorkspaceResponse` (Task 1).
- Produces: `WorkspaceService.setVisibility(workspaceId: string, ownerId: string, isPublic: boolean): Promise<WorkspaceResponse>`; `UpdateVisibilityDto { isPublic: boolean }`; `PATCH /workspaces/:id/visibility`.

- [ ] **Step 1: Create the DTO**

Create `back/src/modules/workspace/dto/update-visibility.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateVisibilityDto {
  @ApiProperty({ description: 'Whether the workspace is public (readable by all logged-in users)' })
  @IsBoolean()
  isPublic!: boolean;
}
```

- [ ] **Step 2: Write the failing setVisibility test**

Create `back/src/modules/workspace/workspace.service.public.spec.ts`:

```ts
import { Types } from 'mongoose';
import { ForbiddenException, NotFoundException } from '../exceptions';

// A thin harness: we test setVisibility/findPublic in isolation by constructing
// the service with mocked models. Import lazily to avoid pulling heavy deps.
import { WorkspaceService } from './workspace.service';

const OWNER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
const WS = new Types.ObjectId().toString();

function makeService(over: { workspaceModel?: any } = {}) {
  const workspaceModel: any = over.workspaceModel ?? {};
  // Only the deps used by setVisibility/findPublic need to be real; the rest can be stubs.
  const svc = Object.create(WorkspaceService.prototype) as WorkspaceService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).workspaceModel = workspaceModel;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (svc as any).logger = { setContext: () => {}, log: () => {}, warn: () => {} };
  return { svc, workspaceModel };
}

describe('WorkspaceService.setVisibility', () => {
  it('rejects making a system workspace public', async () => {
    const { svc } = makeService({
      workspaceModel: {
        findById: () => ({ exec: () => Promise.resolve({ _id: WS, createdBy: new Types.ObjectId(OWNER), isSystem: true, save: jest.fn() }) }),
      },
    });
    await expect(svc.setVisibility(WS, OWNER, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404s when the workspace does not exist', async () => {
    const { svc } = makeService({
      workspaceModel: { findById: () => ({ exec: () => Promise.resolve(null) }) },
    });
    await expect(svc.setVisibility(WS, OWNER, true)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('forbids a non-owner', async () => {
    const { svc } = makeService({
      workspaceModel: {
        findById: () => ({ exec: () => Promise.resolve({ _id: WS, createdBy: new Types.ObjectId(OTHER), isSystem: false, save: jest.fn() }) }),
      },
    });
    await expect(svc.setVisibility(WS, OWNER, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sets isPublic and saves, returning the mapped response', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const doc: any = {
      _id: new Types.ObjectId(WS),
      name: 'W', alias: 'w', storagePrefix: 'w', description: '',
      createdBy: new Types.ObjectId(OWNER), documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: false,
      createdAt: new Date(), updatedAt: new Date(), save,
    };
    const { svc } = makeService({ workspaceModel: { findById: () => ({ exec: () => Promise.resolve(doc) }) } });
    const res = await svc.setVisibility(WS, OWNER, true);
    expect(doc.isPublic).toBe(true);
    expect(save).toHaveBeenCalled();
    expect(res.isPublic).toBe(true);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL**

Run: `cd back && npx jest workspace.service.public.spec.ts`
Expected: FAIL (`setVisibility` is not a function).

- [ ] **Step 4: Implement setVisibility**

In `workspace.service.ts`, add this method (near `update`, and before `mapToResponse`). It uses the same `ErrorCode`/exception imports already present in the file:

```ts
  /**
   * Toggle a workspace's public visibility. Owner-only (the controller's
   * WorkspaceOwnerGuard enforces this; we re-check defensively). System
   * workspaces cannot be made public. Shares are left untouched — while public
   * they are dormant (see WorkspaceAccessGuard), and reactivate when private.
   */
  async setVisibility(
    workspaceId: string,
    ownerId: string,
    isPublic: boolean,
  ): Promise<WorkspaceResponse> {
    const workspace = await this.workspaceModel.findById(workspaceId).exec();
    if (!workspace) {
      throw new NotFoundException(ErrorCode.WORKSPACE_NOT_FOUND, 'Workspace not found');
    }
    if (workspace.createdBy.toString() !== ownerId) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_FORBIDDEN,
        'You do not have access to this workspace',
      );
    }
    if (isPublic && workspace.isSystem) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_PUBLIC_FORBIDDEN_SYSTEM,
        'System workspaces cannot be made public',
      );
    }

    workspace.isPublic = isPublic;
    await workspace.save();
    this.logger.log('Workspace visibility updated', { workspaceId, ownerId, isPublic });
    return this.mapToResponse(workspace);
  }
```

Confirm `ForbiddenException`, `NotFoundException`, and `ErrorCode` are already imported at the top of `workspace.service.ts` (they are used elsewhere in the file). If not, add them from `../exceptions` and `../exceptions/constants/error-codes` respectively.

- [ ] **Step 5: Run the setVisibility test — expect PASS**

Run: `cd back && npx jest workspace.service.public.spec.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Reject sharing a public workspace + test**

In `workspace-share.service.ts` `share()` method, right after the `isSystem` check (after line 140), add:

```ts
    if (workspace.isPublic) {
      throw new ForbiddenException(
        ErrorCode.WORKSPACE_PUBLIC_NO_SHARE,
        'This workspace is public and cannot be shared',
      );
    }
```

Add a test to `workspace-share.service.spec.ts` (inside the existing describe, extend the `build()` harness to inject a `findById` on the workspace model):

```ts
  it('share() rejects a public workspace', async () => {
    const { svc } = build({
      workspaceModel: {
        findById: () => ({ exec: () => Promise.resolve({ _id: new Types.ObjectId(WS), createdBy: new Types.ObjectId(USER), isSystem: false, isPublic: true }) }),
      },
    });
    await expect(
      svc.share(WS, USER, { shares: [{ email: 'a@x.io', permission: 'read' }] }),
    ).rejects.toMatchObject({ }); // ForbiddenException with WORKSPACE_PUBLIC_NO_SHARE
  });
```

Refine the assertion to `rejects.toBeInstanceOf(ForbiddenException)` and import `ForbiddenException` from `../exceptions` in the spec. Ensure the `build()` harness's `userService.findById` returns a truthy owner if the code reaches it — but the public check runs before user lookup, so the mocked ownerId === createdBy path returns before needing the user. Adjust mocks so the method reaches the `isPublic` throw.

- [ ] **Step 7: Add the controller endpoint**

In `workspace.controller.ts`:
- Import the DTO at the top with the other DTO imports:

```ts
import { UpdateVisibilityDto } from './dto/update-visibility.dto';
```

- Add this handler after the existing `@Patch(':id')` update handler (after line ~167), reusing `WorkspaceOwnerGuard`:

```ts
  /**
   * Toggle workspace public visibility (owner only)
   */
  @Patch(':id/visibility')
  @UseGuards(WorkspaceOwnerGuard)
  @ApiOperation({ summary: 'Set workspace public/private visibility' })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async setVisibility(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    return this.workspaceService.setVisibility(id, user._id.toString(), dto.isPublic);
  }
```

- [ ] **Step 8: Run the share-service tests + build**

Run: `cd back && npx jest workspace-share.service.spec.ts workspace.service.public.spec.ts && npx tsc --noEmit -p tsconfig.json`
Expected: tests PASS; build clean.

- [ ] **Step 9: Commit**

```bash
git add back/src/modules/workspace/dto/update-visibility.dto.ts back/src/modules/workspace/workspace.service.ts back/src/modules/workspace/workspace-share.service.ts back/src/modules/workspace/workspace.controller.ts back/src/modules/workspace/workspace.service.public.spec.ts back/src/modules/workspace/workspace-share.service.spec.ts
git commit -m "feat(workspace): add visibility toggle endpoint and block sharing public workspaces"
```

---

## Task 4: Backend — public workspaces listing (TDD)

**Files:**
- Modify: `back/src/modules/workspace/workspace.service.ts` (add `findPublic`)
- Modify: `back/src/modules/workspace/workspace.controller.ts` (add `GET /public`)
- Test: add a `findPublic` describe to `back/src/modules/workspace/workspace.service.public.spec.ts`

**Interfaces:**
- Consumes: `PublicWorkspaceResponse`, `PaginatedPublicWorkspaces` (Task 1).
- Produces: `WorkspaceService.findPublic(userId: string, params: WorkspaceQueryParams): Promise<PaginatedPublicWorkspaces>`; `GET /workspaces/public`.

- [ ] **Step 1: Write the failing findPublic test**

Add to `workspace.service.public.spec.ts`:

```ts
describe('WorkspaceService.findPublic', () => {
  it('queries public non-system workspaces excluding the requester and maps owner info', async () => {
    const ownerId = new Types.ObjectId();
    const ownerDoc = { _id: ownerId, email: 'o@x.io', profile: { firstName: 'O', lastName: 'W' } };
    const wsDoc = {
      _id: new Types.ObjectId(WS), name: 'Pub', alias: 'pub', storagePrefix: 'pub', description: 'd',
      createdBy: ownerDoc, documentCount: 2, usedStorage: 5, allocatedStorage: 100,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const find = jest.fn().mockReturnValue({
      populate: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: () => ({ exec: () => Promise.resolve([wsDoc]) }) }) }) }) }),
    });
    const countDocuments = jest.fn().mockReturnValue({ exec: () => Promise.resolve(1) });
    const { svc, workspaceModel } = makeService({ workspaceModel: { find, countDocuments } });

    const res = await svc.findPublic(OWNER, { page: 1, limit: 20 });

    // Query must exclude requester's own + system + only public
    const filterArg = find.mock.calls[0][0];
    expect(filterArg.isPublic).toBe(true);
    expect(filterArg.isSystem).toEqual({ $ne: true });
    expect(filterArg.createdBy).toEqual({ $ne: expect.anything() });
    expect(res.workspaces).toHaveLength(1);
    expect(res.workspaces[0].owner.email).toBe('o@x.io');
    expect(res.workspaces[0]).not.toHaveProperty('permission');
    expect(res.pagination.total).toBe(1);
    void workspaceModel;
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd back && npx jest workspace.service.public.spec.ts -t findPublic`
Expected: FAIL (`findPublic` is not a function).

- [ ] **Step 3: Implement findPublic**

In `workspace.service.ts`, add (near `findAllByUser`). It follows the same pagination shape as `findAllByUser`/`findSharedWithUser`:

```ts
  /**
   * List public workspaces visible to any logged-in user, excluding the
   * requester's own (those show under "my workspaces") and system workspaces.
   */
  async findPublic(
    userId: string,
    params: WorkspaceQueryParams,
  ): Promise<PaginatedPublicWorkspaces> {
    const { page = 1, limit = 20, search } = params;
    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {
      isPublic: true,
      isSystem: { $ne: true },
      createdBy: { $ne: new Types.ObjectId(userId) },
    };
    if (search) {
      const escaped = escapeRegex(search);
      query.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
      ];
    }

    const [workspaces, total] = await Promise.all([
      this.workspaceModel
        .find(query)
        .populate('createdBy', 'email profile.firstName profile.lastName')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.workspaceModel.countDocuments(query).exec(),
    ]);

    const mapped: PublicWorkspaceResponse[] = workspaces.map((ws) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const owner = (ws as any).createdBy;
      return {
        id: ws._id.toString(),
        name: ws.name,
        alias: ws.alias,
        storagePrefix: ws.storagePrefix,
        description: ws.description,
        owner: {
          id: owner._id.toString(),
          email: owner.email,
          firstName: owner.profile?.firstName,
          lastName: owner.profile?.lastName,
        },
        documentCount: ws.documentCount,
        usedStorage: ws.usedStorage,
        allocatedStorage: ws.allocatedStorage,
        createdAt: ws.createdAt.toISOString(),
        updatedAt: ws.updatedAt.toISOString(),
      };
    });

    return {
      workspaces: mapped,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
```

Add `PublicWorkspaceResponse` and `PaginatedPublicWorkspaces` to the interface import at the top of `workspace.service.ts` (the file already imports from `./interfaces/workspace.interface`). Confirm `escapeRegex` is already imported (it is used by `findAllByUser`).

- [ ] **Step 4: Run the findPublic test — expect PASS**

Run: `cd back && npx jest workspace.service.public.spec.ts -t findPublic`
Expected: PASS.

- [ ] **Step 5: Add the controller endpoint (before `@Get(':id')`)**

In `workspace.controller.ts`, add this handler right after the `@Get('personal')` handler (after line 124) and BEFORE `@Get(':id')` so the literal path is matched first:

```ts
  /**
   * List public workspaces (visible to all logged-in users)
   */
  @Get('public')
  @ApiOperation({ summary: 'List public workspaces' })
  async getPublic(
    @CurrentUser() user: UserDocument,
    @Query() query: WorkspaceQueryDto,
  ) {
    return this.workspaceService.findPublic(user._id.toString(), query);
  }
```

- [ ] **Step 6: Full backend build + all new tests**

Run: `cd back && npx tsc --noEmit -p tsconfig.json && npx jest workspace-access.guard workspace-share.service workspace.service.public`
Expected: build clean; all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/workspace/workspace.service.ts back/src/modules/workspace/workspace.controller.ts back/src/modules/workspace/workspace.service.public.spec.ts
git commit -m "feat(workspace): add GET /workspaces/public listing"
```

---

## Task 5: Frontend — types, api, endpoints

**Files:**
- Modify: `front/src/lib/api/config.ts` (`workspaces` block, ~line 92-98)
- Modify: `front/src/modules/workspace/types.ts` (`Workspace`, add `PublicWorkspaceResponse`)
- Modify: `front/src/modules/workspace/api.ts` (add two functions)

**Interfaces:**
- Produces: `API_ENDPOINTS.workspaces.public`, `.visibility(id)`; `Workspace.isPublic: boolean`; `PublicWorkspaceResponse`; `getPublicWorkspaces(params?)`, `setVisibility(id, isPublic)`.

- [ ] **Step 1: Add endpoints**

In `front/src/lib/api/config.ts`, inside the `workspaces` object (after `sharedWithMe: '/workspaces/shared-with-me',`, line 97):

```ts
    public: '/workspaces/public',
    visibility: (id: string) => `/workspaces/${id}/visibility`,
```

- [ ] **Step 2: Add the type field + PublicWorkspaceResponse**

In `front/src/modules/workspace/types.ts`, add `isPublic: boolean;` to the `Workspace` interface right after `shareCount: number;` (line 37). Then, after the `SharedWorkspaceResponse` interface, add:

```ts
export interface PublicWorkspaceOwner {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface PublicWorkspaceResponse {
  id: string;
  name: string;
  alias: string;
  storagePrefix: string;
  description?: string;
  owner: PublicWorkspaceOwner;
  documentCount: number;
  usedStorage: number;
  allocatedStorage: number;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedPublicWorkspaces {
  workspaces: PublicWorkspaceResponse[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
```

- [ ] **Step 3: Add the api functions**

In `front/src/modules/workspace/api.ts`, add (near `getSharedWorkspaces`). Import the two new types from `./types` alongside existing imports, and `Workspace` if not already imported:

```ts
export async function getPublicWorkspaces(
  params?: WorkspaceQueryParams,
): Promise<PaginatedPublicWorkspaces> {
  const response = await apiClient.get<ApiResponse<PaginatedPublicWorkspaces>>(
    API_ENDPOINTS.workspaces.public,
    { params },
  );
  return response.data.data;
}

export async function setVisibility(id: string, isPublic: boolean): Promise<Workspace> {
  const response = await apiClient.patch<ApiResponse<Workspace>>(
    API_ENDPOINTS.workspaces.visibility(id),
    { isPublic },
  );
  return response.data.data;
}
```

Confirm `PaginatedPublicWorkspaces` and `Workspace` are imported in `api.ts` (add to the `./types` import list if missing).

- [ ] **Step 4: Typecheck (ignore pre-existing d3 errors)**

Run: `cd front && npx tsc --noEmit 2>&1 | grep -v CommunityGraphPanel | grep "error TS"`
Expected: no output (no new errors).

- [ ] **Step 5: Commit**

```bash
git add front/src/lib/api/config.ts front/src/modules/workspace/types.ts front/src/modules/workspace/api.ts
git commit -m "feat(workspace): add public workspaces + visibility API"
```

---

## Task 6: Frontend — store slice (public list + setVisibility) (TDD)

**Files:**
- Modify: `front/src/modules/workspace/store.ts`
- Test: `front/src/modules/workspace/store.public.test.ts` (new)

**Interfaces:**
- Consumes: `getPublicWorkspaces`, `setVisibility` (Task 5); `updateWorkspaceInCache` (existing, line 1074).
- Produces: state `publicWorkspaces: Map<number, PublicWorkspaceResponse[]>`, `publicCurrentPage`, `publicTotalPages`, `totalPublicWorkspaces`; actions `fetchPublicWorkspaces(page?)`, `setWorkspaceVisibility(id, isPublic)`; selectors `usePublicWorkspaces()`, `usePublicPagination()`.

- [ ] **Step 1: Write the failing store test**

Create `front/src/modules/workspace/store.public.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./api');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/modules/localization/i18nInstance', () => ({
  i18nInstance: { isInitialized: false, t: (k: string) => k },
}));

import * as api from './api';
import { useWorkspaceStore, usePublicWorkspaces } from './store';
import { renderHook } from '@testing-library/react';
import type { PublicWorkspaceResponse, Workspace } from './types';

const pub: PublicWorkspaceResponse = {
  id: 'p1', name: 'Pub', alias: 'pub', storagePrefix: 'pub',
  owner: { id: 'o1', email: 'o@x.io' },
  documentCount: 0, usedStorage: 0, allocatedStorage: 100,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('workspace store — public slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ publicWorkspaces: new Map(), publicCurrentPage: 1 });
  });

  it('fetchPublicWorkspaces caches the page', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue({
      workspaces: [pub], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await useWorkspaceStore.getState().fetchPublicWorkspaces(1);
    const { result } = renderHook(() => usePublicWorkspaces());
    expect(result.current).toEqual([pub]);
    expect(useWorkspaceStore.getState().totalPublicWorkspaces).toBe(1);
  });

  it('setWorkspaceVisibility calls api and updates the workspace in cache', async () => {
    const ws: Workspace = {
      id: 'w1', name: 'W', alias: 'w', storagePrefix: 'w', createdBy: 'me',
      documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: false,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
    useWorkspaceStore.setState({ workspaces: new Map([[1, [ws]]]), currentPage: 1 });
    vi.mocked(api.setVisibility).mockResolvedValue({ ...ws, isPublic: true });

    await useWorkspaceStore.getState().setWorkspaceVisibility('w1', true);

    expect(api.setVisibility).toHaveBeenCalledWith('w1', true);
    const cached = useWorkspaceStore.getState().workspaces.get(1)!.find((w) => w.id === 'w1');
    expect(cached!.isPublic).toBe(true);
  });
});
```

Note: confirm `@testing-library/react`'s `renderHook` is the pattern used by other store tests; if the repo's store tests read state directly instead (e.g. `useWorkspaceStore.getState()`), assert via `get(currentPage)` directly instead of `renderHook`. Match the sibling store-test style.

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd front && npx vitest run src/modules/workspace/store.public.test.ts`
Expected: FAIL (`fetchPublicWorkspaces`/`usePublicWorkspaces` undefined).

- [ ] **Step 3: Add state fields**

In `store.ts`, in the state interface after the shared-workspaces block (after line 111, `totalSharedWorkspaces: number;`):

```ts
  // Public workspaces (cached by page)
  publicWorkspaces: Map<number, PublicWorkspaceResponse[]>;
  publicCurrentPage: number;
  publicTotalPages: number;
  totalPublicWorkspaces: number;
```

In the actions interface, after `fetchSharedWorkspaces` (line 260):

```ts
  fetchPublicWorkspaces: (page?: number) => Promise<void>;
  setWorkspaceVisibility: (id: string, isPublic: boolean) => Promise<void>;
```

In the initial state, after `sharedWorkspaces: new Map(),` (line 310) — add matching initial values:

```ts
  publicWorkspaces: new Map(),
  publicCurrentPage: 1,
  publicTotalPages: 1,
  totalPublicWorkspaces: 0,
```

Add `PublicWorkspaceResponse` to the `./types` import at the top of `store.ts`.

- [ ] **Step 4: Add the actions**

In `store.ts`, right after the `fetchSharedWorkspaces` action (after line 1492), add:

```ts
      fetchPublicWorkspaces: async (page = 1) => {
        const state = get();
        if (state.publicWorkspaces.has(page)) {
          set({ publicCurrentPage: page });
          return;
        }
        set({ isLoadingWorkspaces: true, error: null });
        try {
          const result = await workspaceApi.getPublicWorkspaces({ page, limit: DEFAULT_PAGE_LIMIT });
          const newCache = new Map(state.publicWorkspaces);
          newCache.set(page, result.workspaces);
          set({
            publicWorkspaces: newCache,
            publicCurrentPage: page,
            publicTotalPages: result.pagination.totalPages,
            totalPublicWorkspaces: result.pagination.total,
            isLoadingWorkspaces: false,
          });
        } catch (err) {
          const fallback = tError('fetchPublicWorkspaces', 'Failed to fetch public workspaces');
          const message = getApiErrorMessage(err, fallback);
          set({ error: message, isLoadingWorkspaces: false });
        }
      },

      setWorkspaceVisibility: async (id, isPublic) => {
        const updated = await workspaceApi.setVisibility(id, isPublic);
        get().updateWorkspaceInCache(updated);
        // Keep the open share modal in sync so its switch reflects the new state.
        const { shareModalWorkspace } = get();
        if (shareModalWorkspace?.id === id) {
          set({ shareModalWorkspace: { ...shareModalWorkspace, isPublic } });
        }
        // Public listing changed — drop its cache so the hub/pickers refetch.
        set({ publicWorkspaces: new Map(), publicCurrentPage: 1 });
        toast.success(
          translate(isPublic ? 'store.toasts.madePublic' : 'store.toasts.madePrivate'),
        );
      },
```

Note: match the file's existing helpers — it already uses `workspaceApi`, `DEFAULT_PAGE_LIMIT`, `tError`, `getApiErrorMessage`, and `toast`. For the toast text, use whatever translation helper the store already uses for toasts (search the file for an existing `toast.success(` to copy the exact `translate(...)`/`t(...)` call convention). If the store uses raw strings elsewhere, use raw strings `'Workspace is now public'` / `'Workspace is now private'` and skip the locale keys.

- [ ] **Step 5: Add selectors**

At the bottom of `store.ts` near `useSharedWorkspaces` (after line 2083):

```ts
export const usePublicWorkspaces = () => {
  const publicWorkspaces = useWorkspaceStore((state) => state.publicWorkspaces);
  const publicCurrentPage = useWorkspaceStore((state) => state.publicCurrentPage);
  return publicWorkspaces.get(publicCurrentPage) ?? [];
};

export const usePublicPagination = () => {
  const currentPage = useWorkspaceStore((state) => state.publicCurrentPage) ?? 1;
  const totalPages = useWorkspaceStore((state) => state.publicTotalPages) ?? 1;
  return { currentPage, totalPages };
};
```

- [ ] **Step 6: Add locale keys (if you used translate() for toasts)**

In `front/src/modules/workspace/locales/en.json` add flat keys (matching the file's flat-key convention):

```json
  "store.toasts.madePublic": "Workspace is now public",
  "store.toasts.madePrivate": "Workspace is now private",
```

In `fr.json`:

```json
  "store.toasts.madePublic": "Le workspace est maintenant public",
  "store.toasts.madePrivate": "Le workspace est maintenant privé",
```

- [ ] **Step 7: Run the store test — expect PASS**

Run: `cd front && npx vitest run src/modules/workspace/store.public.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add front/src/modules/workspace/store.ts front/src/modules/workspace/store.public.test.ts front/src/modules/workspace/locales/en.json front/src/modules/workspace/locales/fr.json
git commit -m "feat(workspace): add public workspaces store slice and visibility action"
```

---

## Task 7: Frontend — Public/Private switch in the Share dialog

**Files:**
- Modify: `front/src/modules/workspace/components/ShareWorkspaceDialog/index.tsx`
- Modify: `front/src/modules/workspace/locales/en.json` + `fr.json`

**Interfaces:**
- Consumes: `setWorkspaceVisibility` (Task 6); `shareModalWorkspace.isPublic` (Task 5 type).

- [ ] **Step 1: Confirm the Switch primitive exists**

Check `front/src/components/ui/switch.tsx` exists (shadcn `Switch`). If it does not, mirror the toggle primitive used elsewhere in the app (search `components/ui` for `switch` or `toggle`). Only proceed once you know the import.

- [ ] **Step 2: Wire the switch into the dialog**

In `ShareWorkspaceDialog/index.tsx`:
- Add imports:

```tsx
import { Switch } from '@/components/ui/switch';
```

- Read the visibility action + current flag near the other store hooks (after line 44):

```tsx
  const setWorkspaceVisibility = useWorkspaceStore((state) => state.setWorkspaceVisibility);
  const isPublic = shareModalWorkspace?.isPublic ?? false;
  const [visibilityBusy, setVisibilityBusy] = useState(false);
```

- Add a handler (near `handleShare`):

```tsx
  const handleToggleVisibility = async (next: boolean) => {
    if (!shareModalWorkspace) return;
    setVisibilityBusy(true);
    try {
      await setWorkspaceVisibility(shareModalWorkspace.id, next);
    } catch {
      // store surfaces the error
    } finally {
      setVisibilityBusy(false);
    }
  };
```

- Render the switch at the TOP of the scroll area, before `<GroupShareSelector .../>` / `<UserSearchInput .../>` (around line 128-135):

```tsx
            <div className='flex items-start justify-between gap-4 rounded-md border p-3'>
              <div className='space-y-0.5'>
                <p className='text-sm font-medium'>{t('sharing.visibility.title')}</p>
                <p className='text-xs text-muted-foreground'>
                  {isPublic ? t('sharing.visibility.publicHint') : t('sharing.visibility.privateHint')}
                </p>
              </div>
              <Switch
                checked={isPublic}
                onCheckedChange={handleToggleVisibility}
                disabled={visibilityBusy || isSharingInProgress}
                aria-label={t('sharing.visibility.title')}
              />
            </div>

            {isPublic && (
              <p className='rounded-md bg-muted/50 p-3 text-xs text-muted-foreground'>
                {t('sharing.visibility.publicNote')}
              </p>
            )}
```

- Disable the sharing controls while public: wrap the existing `GroupShareSelector` + `UserSearchInput` + invite button in a conditional so they only render when `!isPublic` (or pass `disabled={isPublic || isSharingInProgress}` to each and hide the invite button when `isPublic`). Simplest: wrap them:

```tsx
            {!isPublic && (
              <>
                {/* existing GroupShareSelector + UserSearchInput + invite button block */}
              </>
            )}
```

Keep the "people with access" list rendering as-is (it still shows dormant shares).

- [ ] **Step 3: Add locale keys**

`en.json`:

```json
  "sharing.visibility.title": "Public workspace",
  "sharing.visibility.privateHint": "Only you and people you share with can access this workspace.",
  "sharing.visibility.publicHint": "Anyone signed in can view this workspace (read-only).",
  "sharing.visibility.publicNote": "This workspace is public — everyone can read it. Existing shares are paused. Turn it off to manage individual access."
```

`fr.json`:

```json
  "sharing.visibility.title": "Workspace public",
  "sharing.visibility.privateHint": "Seuls vous et les personnes avec qui vous partagez peuvent accéder à ce workspace.",
  "sharing.visibility.publicHint": "Toute personne connectée peut consulter ce workspace (lecture seule).",
  "sharing.visibility.publicNote": "Ce workspace est public — tout le monde peut le consulter. Les partages existants sont suspendus. Désactivez pour gérer les accès individuels."
```

- [ ] **Step 4: Typecheck**

Run: `cd front && npx tsc --noEmit 2>&1 | grep -v CommunityGraphPanel | grep "error TS"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add front/src/modules/workspace/components/ShareWorkspaceDialog/index.tsx front/src/modules/workspace/locales/en.json front/src/modules/workspace/locales/fr.json
git commit -m "feat(workspace): add public/private switch to the share dialog"
```

---

## Task 8: Frontend — Public section in the Workspaces hub

**Files:**
- Modify: `front/src/modules/workspace/hooks/useWorkspaceHubFilters.ts`
- Modify: `front/src/modules/workspace/components/WorkspaceHubPage.tsx`
- Modify: `front/src/modules/workspace/components/hub/WorkspaceHubOverview.tsx`
- Modify: `front/src/modules/workspace/components/hub/WorkspaceCard.tsx`

**Interfaces:**
- Consumes: `usePublicWorkspaces`, `fetchPublicWorkspaces` (Task 6); `Workspace.isPublic`.
- Produces: `OwnershipFilter` includes `'public'`; hub renders a Public group; cards show a Public badge.

- [ ] **Step 1: Extend the filters hook**

In `useWorkspaceHubFilters.ts`:
- Import the public selector: change the store import (line 4) to also pull `usePublicWorkspaces`, and import the `PublicWorkspaceResponse` type.

```ts
import { useWorkspaces, useSharedWorkspaces, usePublicWorkspaces } from '../store';
import type { Workspace, SharedWorkspaceResponse, PublicWorkspaceResponse } from '../types';
```

- Extend the type + guard:

```ts
export type OwnershipFilter = 'all' | 'personal' | 'mine' | 'shared' | 'public';
```

```ts
function isOwnership(value: string | null): value is OwnershipFilter {
  return (
    value === 'all' || value === 'personal' || value === 'mine' ||
    value === 'shared' || value === 'public'
  );
}
```

- Add a mapper (near `toItemFromShared`):

```ts
function toItemFromPublic(w: PublicWorkspaceResponse): WorkspaceHubItem {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    documentCount: w.documentCount,
    usedStorage: w.usedStorage,
    allocatedStorage: w.allocatedStorage,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    isShared: false,
    isPersonal: false,
    isReadOnly: true,
    sharedByName: w.owner.firstName || w.owner.email,
  };
}
```

- Add `isPublicItem?: boolean` to `WorkspaceHubItem` and set `isPublicItem: true` in `toItemFromPublic` (so cards can badge public discovery items). Also set `isPublicItem: w.isPublic` in `toItemFromOwned` (owner's own public workspace). Add the field to the interface (after `shareCount?`).

- Extend `WorkspaceHubFilteredGroups`, the source memo, filteredGroups, counts:

```ts
export interface WorkspaceHubFilteredGroups {
  personal: WorkspaceHubItem[];
  mine: WorkspaceHubItem[];
  shared: WorkspaceHubItem[];
  public: WorkspaceHubItem[];
}
```

In the hook body, after `sharedWorkspaces`:

```ts
  const publicWorkspaces = usePublicWorkspaces();
```

```ts
  const publicItems = useMemo(() => publicWorkspaces.map(toItemFromPublic), [publicWorkspaces]);
```

In `filteredGroups`:

```ts
    const publicGroup =
      owner === 'all' || owner === 'public'
        ? sortItems(publicItems.filter((w) => matches(w, rawSearch)), sort)
        : [];
    return { personal, mine, shared, public: publicGroup };
```

Add `publicItems` to the memo deps. Extend `isEmpty` to include `filteredGroups.public.length === 0`. Extend `counts` with `public: publicItems.length`. Update the `counts` type in `UseWorkspaceHubFiltersResult` to `{ personal: number; mine: number; shared: number; public: number }`.

- [ ] **Step 2: Fetch public workspaces on mount**

In `WorkspaceHubPage.tsx`, add the fetch action (after line 28) and call it in the mount effect (line 41-44):

```tsx
  const fetchPublicWorkspaces = useWorkspaceStore((s) => s.fetchPublicWorkspaces);
```

```tsx
  useEffect(() => {
    fetchWorkspaces(1);
    fetchSharedWorkspaces(1);
    fetchPublicWorkspaces(1);
  }, [fetchWorkspaces, fetchSharedWorkspaces, fetchPublicWorkspaces]);
```

Also update the `showInitialLoader` guard (line 71-72) to include public counts, and the grid render to include the public group. The grid is rendered via `WorkspaceHubGrid groups={filters.filteredGroups}`. Open `components/hub/WorkspaceHubGrid.tsx` and add a `public` group section mirroring how it renders `shared` (same card component, a heading like "Public"). If `WorkspaceHubGrid` iterates the groups object generically, no change is needed beyond the new key; if it lists groups explicitly, add the `public` block after `shared`. Verify and mirror the existing `shared` rendering exactly.

- [ ] **Step 3: Overview count chip**

In `components/hub/WorkspaceHubOverview.tsx`, it receives `counts` and `onSelectOwner`. Add a "Public" chip/segment mirroring the existing "Shared" one: a selectable segment with `counts.public` that calls `onSelectOwner('public')`. Match the exact markup of the existing shared segment (find where `counts.shared` / `'shared'` is rendered and duplicate it for `public`). Update the component's `counts` prop type to include `public: number`.

- [ ] **Step 4: Public badge on cards**

In `components/hub/WorkspaceCard.tsx`, when the item is public (`item.isPublicItem`), render a small "Public" `Badge`. Find where existing badges (e.g. shared/read-only) are rendered and add:

```tsx
{item.isPublicItem && (
  <Badge variant='outline' className='text-[10px]'>{t('hub.publicBadge')}</Badge>
)}
```

Use the card's existing translation/`Badge` imports; if the card uses hardcoded French strings (as the hub does), use a literal `Public` to match the surrounding style instead of `t(...)`.

- [ ] **Step 5: Typecheck + run store tests (guard against regressions)**

Run: `cd front && npx tsc --noEmit 2>&1 | grep -v CommunityGraphPanel | grep "error TS"`
Expected: no output.
Run: `cd front && npx vitest run src/modules/workspace/store.public.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add front/src/modules/workspace/hooks/useWorkspaceHubFilters.ts front/src/modules/workspace/components/WorkspaceHubPage.tsx front/src/modules/workspace/components/hub/WorkspaceHubOverview.tsx front/src/modules/workspace/components/hub/WorkspaceHubGrid.tsx front/src/modules/workspace/components/hub/WorkspaceCard.tsx
git commit -m "feat(workspace): add Public section and badge to the workspaces hub"
```

---

## Task 9: Frontend — Public group in the workspace pickers

**Files:**
- Modify: `front/src/modules/workspace/components/WorkspaceSelect.tsx`
- Modify: `front/src/modules/workspace/components/WorkspacePicker.tsx`

**Interfaces:**
- Consumes: `usePublicWorkspaces`, `fetchPublicWorkspaces` (Task 6).

- [ ] **Step 1: WorkspaceSelect — load + render Public group**

In `WorkspaceSelect.tsx`:
- Import the selector + action: change line 9 to include `usePublicWorkspaces`, and pull `fetchPublicWorkspaces` from the store (line 25).

```tsx
import { useWorkspaceStore, useWorkspaces, useWorkspaceLoading, useSharedWorkspaces, usePublicWorkspaces } from '../store';
```

```tsx
  const publicWorkspaces = usePublicWorkspaces();
  const { fetchWorkspaces, fetchSharedWorkspaces, fetchPublicWorkspaces } = useWorkspaceStore();
```

- Fetch on mount (after the shared effect, line 40):

```tsx
  useEffect(() => {
    if (publicWorkspaces.length === 0 && !isLoadingWorkspaces) {
      fetchPublicWorkspaces(1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchPublicWorkspaces]);
```

- Render a third group in `renderContent()` after the shared group (after line 114):

```tsx
        {publicWorkspaces.length > 0 && (
          <CommandGroup heading={t('select.publicGroup', { defaultValue: 'Publics' })}>
            {publicWorkspaces.map((workspace) =>
              renderItem(workspace, t('select.publicBy', { defaultValue: 'Public · {{name}}', name: ownerName(workspace.owner) })),
            )}
          </CommandGroup>
        )}
```

- Update the empty/loader guards (lines 86, 94) to also consider `publicWorkspaces.length` so the picker isn't shown empty when only public workspaces exist.

- [ ] **Step 2: WorkspacePicker — same third group**

`WorkspacePicker.tsx` is the second selector (it takes `sharedWorkspaces` as a prop and renders own + shared groups). Mirror the Task-1 change:
- Pull `usePublicWorkspaces` + `fetchPublicWorkspaces` (near line 22-25), fetch on mount (near line 36-41), pass `publicWorkspaces` down to the inner list component, and render a "Public" group after the shared group (near line 153-155), mirroring the shared-group markup exactly. Add a `publicWorkspaces: PublicWorkspaceResponse[]` prop to the inner component's props type (near line 126) and import `PublicWorkspaceResponse` from `../types`.

- [ ] **Step 3: Typecheck**

Run: `cd front && npx tsc --noEmit 2>&1 | grep -v CommunityGraphPanel | grep "error TS"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add front/src/modules/workspace/components/WorkspaceSelect.tsx front/src/modules/workspace/components/WorkspacePicker.tsx
git commit -m "feat(workspace): show public workspaces in the workspace pickers"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend build + all workspace tests**

Run: `cd back && npx tsc --noEmit -p tsconfig.json && npx jest workspace-access.guard workspace-share.service workspace.service.public`
Expected: build clean; all tests PASS.

- [ ] **Step 2: Frontend typecheck + store test**

Run: `cd front && npx tsc --noEmit 2>&1 | grep -v CommunityGraphPanel | grep "error TS"` (expect no output)
Run: `cd front && npx vitest run src/modules/workspace`
Expected: workspace tests PASS.

- [ ] **Step 3: Manual smoke test (document the result)**

Start the app (per project run instructions) and verify:
1. Open a workspace's Share dialog → a **Public workspace** switch shows; turning it ON disables the sharing controls and shows the "paused shares" note.
2. As a **different** logged-in user, the workspace now appears in the **Public** section of the Workspaces hub and in the conversation workspace picker's **Public** group; opening it loads read-only (no upload/add).
3. That other user cannot add files (write blocked).
4. Turn it back OFF as the owner → it disappears from the other user's Public section; any prior explicit shares work again.
5. Attempting to share while public is rejected.

Record the outcome in the PR description. Do not claim success without running these.

---

## Notes for the implementer

- **Envelope:** backend endpoints return `{ data: ... }` via the global interceptor; the frontend reads `response.data.data`. Don't wrap manually.
- **Guard ordering:** `PATCH /:id/visibility` and the update `@Patch(':id')` both use `WorkspaceOwnerGuard`; `GET /public` must be declared before `@Get(':id')` so the literal path wins (same reason `shared-with-me`/`personal` are declared first).
- **Dormant shares need no data change** — the guard's public-before-share precedence is the entire mechanism. Do not delete or modify shares on publish.
- **Verify-before-adapt:** several frontend steps carry a "Note:"/"mirror the existing X" — check the sibling markup (`shared` group, existing badges, store toast convention, `Switch` primitive) and match it rather than assuming. The surrounding code is the source of truth.
- **YAGNI:** no anonymous access, no fork/copy, no favoriting, no admin moderation.
