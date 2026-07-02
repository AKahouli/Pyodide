# User Groups + Mass-Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user create private User Groups (named lists of registered users) and use a group to mass-share a workspace with all its members in one action.

**Architecture:** New `user-group` NestJS module (schema + service + controller) mirroring the existing `team` module, owner-scoped CRUD + member add/remove. New front `groups` module (api/store/types/components) mirroring `team`, with a Groups sidebar tab and `/groups` page. Mass-share reuses the *existing* workspace-share flow: a group selector in the existing Share Workspace Dialog expands a group's members into the dialog's pending-shares list, which the current `POST /workspaces/:id/shares` endpoint already loops over. **No new sharing logic.**

**Tech Stack:** NestJS + Mongoose (backend, Jest), React + Zustand + Vite + shadcn/ui (frontend, Vitest), i18next for translations.

## Global Constraints

- Groups are **private to their creator**. Every backend read/write filters by `createdBy === currentUser`; a non-owner gets `NotFoundException` (do not leak existence).
- Group name is **unique per owner**, 2–100 chars, trimmed. Description optional, max 2000.
- Members are **registered users only**, stored as `ObjectId[]` refs to `User`, added via the existing `GET /users/search`.
- Share model is **snapshot**: expanding a group into pending shares is a one-time copy; later group edits never touch already-created shares.
- Backend tests run with `cd back && npx jest <pattern>`. Frontend tests run with `cd front && npx vitest run <pattern>`.
- Follow existing module conventions exactly (file layout, `ApiResponse<T>` envelope, `toResponse` mappers, `useModuleTranslation`, toast on store mutations).

---

## File Structure

**Backend — new module `back/src/modules/user-group/`**
- `schemas/user-group.schema.ts` — `UserGroup` mongoose schema
- `interfaces/user-group.interface.ts` — response shapes
- `dto/create-user-group.dto.ts`, `dto/update-user-group.dto.ts`, `dto/add-members.dto.ts`, `dto/index.ts`
- `user-group.service.ts` — owner-scoped CRUD + members
- `user-group.service.spec.ts` — unit tests
- `user-group.controller.ts` — REST endpoints
- `user-group.module.ts` — module wiring
- `index.ts` — public exports

**Backend — modified**
- `back/src/modules/exceptions/constants/error-codes.ts` — add `USER_GROUP_*` codes + messages
- `back/src/app.module.ts` — register `UserGroupModule`

**Frontend — new module `front/src/modules/groups/`**
- `types.ts`, `api.ts`, `store.ts`, `store.test.ts`, `index.ts`
- `translation.ts` — `translateGroup` helper (mirror team)
- `locales/en.json`, `locales/fr.json`
- `components/GroupsButton.tsx`, `components/GroupsPage.tsx`, `components/CreateEditGroupDialog.tsx`, `components/GroupMemberInput.tsx`, `components/index.ts`

**Frontend — modified**
- `front/src/lib/api/config.ts` — add `userGroups` endpoints
- `front/src/Router.tsx` — add `/groups` route
- `front/src/modules/sidebar/components/AppSidebar.tsx` — add `<GroupsButton />`
- `front/src/modules/workspace/components/ShareWorkspaceDialog/index.tsx` — add group selector
- `front/src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.tsx` — new
- `front/src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.test.tsx` — new
- `front/src/modules/workspace/locales/en.json`, `fr.json` — add group-share strings

---

## Task 1: Backend — error codes + UserGroup schema + module registration

**Files:**
- Modify: `back/src/modules/exceptions/constants/error-codes.ts` (after line 298, and after line 665)
- Create: `back/src/modules/user-group/schemas/user-group.schema.ts`
- Create: `back/src/modules/user-group/user-group.module.ts`
- Create: `back/src/modules/user-group/index.ts`
- Modify: `back/src/app.module.ts`

**Interfaces:**
- Produces: `UserGroup` / `UserGroupDocument` (fields `name: string`, `description: string`, `members: Types.ObjectId[]`, `createdBy: Types.ObjectId`, `createdAt`, `updatedAt`); `UserGroupModule`; error codes `USER_GROUP_NOT_FOUND`, `USER_GROUP_ALREADY_EXISTS`.

- [ ] **Step 1: Add error codes**

In `error-codes.ts`, after line 298 (`TEAM_AUTO_BUILDER_NOT_CONFIGURED = 'ERR_3313',`) and its blank line, insert:

```typescript
  // User Group errors (3350-3399)
  USER_GROUP_NOT_FOUND = 'ERR_3350',
  USER_GROUP_ALREADY_EXISTS = 'ERR_3351',
```

Then in the messages map, after line 665 (`[ErrorCode.TEAM_AGENT_NOT_FOUND]: ...`), insert:

```typescript
  [ErrorCode.USER_GROUP_NOT_FOUND]: 'User group not found.',
  [ErrorCode.USER_GROUP_ALREADY_EXISTS]: 'A group with this name already exists.',
```

- [ ] **Step 2: Create the schema**

Create `back/src/modules/user-group/schemas/user-group.schema.ts`:

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UserGroupDocument = HydratedDocument<UserGroup>;

/**
 * A UserGroup is a named, private list of registered users owned by its
 * creator. It is a convenience for sharing: expanding a group yields the
 * member emails that the existing workspace-share flow consumes. Groups are
 * never shared between users.
 */
@Schema({
  timestamps: true,
  collection: 'user_groups',
})
export class UserGroup extends Document {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  /** Users that belong to the group. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members!: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserGroupSchema = SchemaFactory.createForClass(UserGroup);

// A user cannot have two groups with the same name.
UserGroupSchema.index({ name: 1, createdBy: 1 }, { unique: true });

UserGroupSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
```

- [ ] **Step 3: Create the module (service/controller added in later tasks)**

Create `back/src/modules/user-group/user-group.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserGroup, UserGroupSchema } from './schemas/user-group.schema';
import { UserGroupService } from './user-group.service';
import { UserGroupController } from './user-group.controller';
import { UserModule } from '../user/user.module';
import { LoggerModule } from '../logger';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserGroup.name, schema: UserGroupSchema }]),
    UserModule,
    LoggerModule,
  ],
  controllers: [UserGroupController],
  providers: [UserGroupService],
  exports: [UserGroupService],
})
export class UserGroupModule {}
```

Note: confirm the logger import path by checking how `workspace.module.ts` imports `LoggerModule`. If the logger is a global module imported differently, match that file. If `LoggerModule` is not exported from `../logger`, remove it from `imports` (the `LoggerService` is injectable app-wide in this codebase — mirror `workspace.module.ts`).

- [ ] **Step 4: Create the public barrel**

Create `back/src/modules/user-group/index.ts`:

```typescript
export * from './user-group.module';
export * from './user-group.service';
export * from './schemas/user-group.schema';
export * from './interfaces/user-group.interface';
```

- [ ] **Step 5: Register the module in AppModule**

In `back/src/app.module.ts`, add an import near the other module imports (line ~51, next to `TeamModule`):

```typescript
import { UserGroupModule } from './modules/user-group';
```

And add `UserGroupModule,` to the `imports: [...]` array, right after `TeamModule,` (line ~109).

- [ ] **Step 6: Verify it compiles (service/controller are created next; this step only checks the edits so far are syntactically valid once those exist — skip build until Task 4). For now, verify the error-codes + schema edits typecheck:**

Run: `cd back && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i user-group`
Expected: only "Cannot find module './user-group.service'" / "'./user-group.controller'" style errors (created in Tasks 3–4). No errors inside `error-codes.ts` or `user-group.schema.ts`.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/user-group/schemas back/src/modules/user-group/user-group.module.ts back/src/modules/user-group/index.ts back/src/modules/exceptions/constants/error-codes.ts back/src/app.module.ts
git commit -m "feat(user-group): add UserGroup schema, module skeleton and error codes"
```

---

## Task 2: Backend — DTOs + response interfaces

**Files:**
- Create: `back/src/modules/user-group/interfaces/user-group.interface.ts`
- Create: `back/src/modules/user-group/dto/create-user-group.dto.ts`
- Create: `back/src/modules/user-group/dto/update-user-group.dto.ts`
- Create: `back/src/modules/user-group/dto/add-members.dto.ts`
- Create: `back/src/modules/user-group/dto/index.ts`

**Interfaces:**
- Produces:
  - `IUserGroupMember` = `{ id: string; email: string; firstName?: string; lastName?: string }`
  - `IUserGroupResponse` = `{ id: string; name: string; description: string; members: IUserGroupMember[]; memberCount: number; createdAt: Date; updatedAt: Date }`
  - `CreateUserGroupDto` = `{ name: string; description?: string; memberIds?: string[] }`
  - `UpdateUserGroupDto` = `{ name?: string; description?: string }`
  - `AddMembersDto` = `{ userIds: string[] }`

- [ ] **Step 1: Create the interfaces**

Create `back/src/modules/user-group/interfaces/user-group.interface.ts`:

```typescript
export interface IUserGroupMember {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface IUserGroupResponse {
  id: string;
  name: string;
  description: string;
  members: IUserGroupMember[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}
```

- [ ] **Step 2: Create CreateUserGroupDto**

Create `back/src/modules/user-group/dto/create-user-group.dto.ts`:

```typescript
import { IsString, IsOptional, IsArray, IsMongoId, MinLength, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserGroupDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'User IDs that belong to the group', type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  memberIds?: string[];
}
```

- [ ] **Step 3: Create UpdateUserGroupDto**

Create `back/src/modules/user-group/dto/update-user-group.dto.ts`:

```typescript
import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserGroupDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
```

- [ ] **Step 4: Create AddMembersDto**

Create `back/src/modules/user-group/dto/add-members.dto.ts`:

```typescript
import { IsArray, IsMongoId, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddMembersDto {
  @ApiProperty({ description: 'User IDs to add to the group', type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  userIds!: string[];
}
```

- [ ] **Step 5: Create the DTO barrel**

Create `back/src/modules/user-group/dto/index.ts`:

```typescript
export * from './create-user-group.dto';
export * from './update-user-group.dto';
export * from './add-members.dto';
```

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/user-group/interfaces back/src/modules/user-group/dto
git commit -m "feat(user-group): add DTOs and response interfaces"
```

---

## Task 3: Backend — UserGroupService (TDD)

**Files:**
- Create: `back/src/modules/user-group/user-group.service.ts`
- Test: `back/src/modules/user-group/user-group.service.spec.ts`

**Interfaces:**
- Consumes: `UserGroup`/`UserGroupDocument` (Task 1), DTOs + interfaces (Task 2), `ErrorCode.USER_GROUP_*` (Task 1), `LoggerService` from `../logger`.
- Produces:
  - `create(userId: string, dto: CreateUserGroupDto): Promise<IUserGroupResponse>`
  - `findAllForUser(userId: string): Promise<IUserGroupResponse[]>`
  - `findById(userId: string, id: string): Promise<IUserGroupResponse>`
  - `update(userId: string, id: string, dto: UpdateUserGroupDto): Promise<IUserGroupResponse>`
  - `delete(userId: string, id: string): Promise<void>`
  - `addMembers(userId: string, id: string, userIds: string[]): Promise<IUserGroupResponse>`
  - `removeMember(userId: string, id: string, memberId: string): Promise<IUserGroupResponse>`

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/user-group/user-group.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserGroupService } from './user-group.service';
import { UserGroup } from './schemas/user-group.schema';
import { LoggerService } from '../logger';

const OWNER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
const MEMBER_A = new Types.ObjectId().toString();
const MEMBER_B = new Types.ObjectId().toString();

/** A populated member doc, as mongoose returns after .populate(). */
function memberDoc(id: string, email: string) {
  return { _id: new Types.ObjectId(id), email, profile: { firstName: 'F', lastName: 'L' } };
}

/** Build a lean group object mimicking a populated find result. */
function leanGroup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'My Group',
    description: '',
    members: [],
    createdBy: new Types.ObjectId(OWNER),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UserGroupService', () => {
  let service: UserGroupService;
  let model: any;

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UserGroupService,
        { provide: getModelToken(UserGroup.name), useValue: model },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(UserGroupService);
  });

  describe('create', () => {
    it('rejects a duplicate name for the same owner', async () => {
      model.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(leanGroup()) }) });
      await expect(service.create(OWNER, { name: 'My Group' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a group and returns a mapped response with memberCount', async () => {
      model.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
      const created = leanGroup({ name: 'New', members: [new Types.ObjectId(MEMBER_A)] });
      // create() returns a doc; then service re-fetches populated:
      model.create.mockResolvedValue({ _id: created._id });
      model.findById.mockReturnValue({
        populate: () => ({ lean: () => ({ exec: () => Promise.resolve({ ...created, members: [memberDoc(MEMBER_A, 'a@x.io')] }) }) }),
      });

      const res = await service.create(OWNER, { name: 'New', memberIds: [MEMBER_A] });
      expect(res.name).toBe('New');
      expect(res.memberCount).toBe(1);
      expect(res.members[0]).toEqual({ id: MEMBER_A, email: 'a@x.io', firstName: 'F', lastName: 'L' });
    });
  });

  describe('findById', () => {
    it('throws NotFound when the group belongs to another user', async () => {
      model.findById.mockReturnValue({
        populate: () => ({ lean: () => ({ exec: () => Promise.resolve(leanGroup({ createdBy: new Types.ObjectId(OTHER) })) }) }),
      });
      await expect(service.findById(OWNER, new Types.ObjectId().toString())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for a malformed id', async () => {
      await expect(service.findById(OWNER, 'not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('addMembers', () => {
    it('adds members idempotently via $addToSet and returns the populated group', async () => {
      const id = new Types.ObjectId().toString();
      model.findById
        .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: new Types.ObjectId(id), createdBy: new Types.ObjectId(OWNER) }) })
        .mockReturnValueOnce({
          populate: () => ({ lean: () => ({ exec: () => Promise.resolve(leanGroup({ members: [memberDoc(MEMBER_A, 'a@x.io'), memberDoc(MEMBER_B, 'b@x.io')] })) }) }),
        });
      model.updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

      const res = await service.addMembers(OWNER, id, [MEMBER_A, MEMBER_B]);
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $addToSet: { members: { $each: expect.any(Array) } } },
      );
      expect(res.memberCount).toBe(2);
    });

    it('throws Forbidden when a non-owner tries to add members', async () => {
      const id = new Types.ObjectId().toString();
      model.findById.mockReturnValue({ exec: () => Promise.resolve({ _id: new Types.ObjectId(id), createdBy: new Types.ObjectId(OTHER) }) });
      await expect(service.addMembers(OWNER, id, [MEMBER_A])).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('pulls the member and returns the populated group', async () => {
      const id = new Types.ObjectId().toString();
      model.findById
        .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: new Types.ObjectId(id), createdBy: new Types.ObjectId(OWNER) }) })
        .mockReturnValueOnce({ populate: () => ({ lean: () => ({ exec: () => Promise.resolve(leanGroup({ members: [] })) }) }) });
      model.updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

      const res = await service.removeMember(OWNER, id, MEMBER_A);
      expect(model.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, { $pull: { members: expect.anything() } });
      expect(res.memberCount).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd back && npx jest user-group.service.spec.ts`
Expected: FAIL — "Cannot find module './user-group.service'".

- [ ] **Step 3: Write the service**

Create `back/src/modules/user-group/user-group.service.ts`:

```typescript
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserGroup, UserGroupDocument } from './schemas/user-group.schema';
import { CreateUserGroupDto, UpdateUserGroupDto } from './dto';
import { IUserGroupMember, IUserGroupResponse } from './interfaces/user-group.interface';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { LoggerService } from '../logger';

const MEMBER_POPULATE = { path: 'members', select: 'email profile.firstName profile.lastName' };

/**
 * User groups are private, user-owned lists of registered users. They exist to
 * make sharing faster: expanding a group yields member emails that the existing
 * workspace-share flow consumes. Every operation is scoped to the owner; a
 * non-owner is treated as if the group does not exist.
 */
@Injectable()
export class UserGroupService {
  constructor(
    @InjectModel(UserGroup.name)
    private readonly groupModel: Model<UserGroupDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(UserGroupService.name);
  }

  async create(userId: string, dto: CreateUserGroupDto): Promise<IUserGroupResponse> {
    const owner = new Types.ObjectId(userId);
    const existing = await this.groupModel.findOne({ name: dto.name, createdBy: owner }).lean().exec();
    if (existing) {
      throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
    }

    const created = await this.groupModel.create({
      name: dto.name,
      description: dto.description ?? '',
      members: this.toMemberObjectIds(dto.memberIds),
      createdBy: owner,
    });

    this.logger.log('User group created', { groupId: created._id.toString(), userId });
    return this.getPopulated(created._id.toString());
  }

  async findAllForUser(userId: string): Promise<IUserGroupResponse[]> {
    const groups = await this.groupModel
      .find({ createdBy: new Types.ObjectId(userId) })
      .populate(MEMBER_POPULATE)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    return groups.map((g) => this.toResponse(g as unknown as Record<string, unknown>));
  }

  async findById(userId: string, id: string): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedLean(userId, id);
    return this.toResponse(group);
  }

  async update(userId: string, id: string, dto: UpdateUserGroupDto): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedDoc(userId, id);

    if (dto.name !== undefined && dto.name !== group.name) {
      const clash = await this.groupModel
        .findOne({ name: dto.name, createdBy: group.createdBy, _id: { $ne: group._id } })
        .lean()
        .exec();
      if (clash) {
        throw new ConflictException(ErrorCode.USER_GROUP_ALREADY_EXISTS);
      }
      group.name = dto.name;
    }
    if (dto.description !== undefined) group.description = dto.description;

    await group.save();
    this.logger.log('User group updated', { groupId: id, userId });
    return this.getPopulated(id);
  }

  async delete(userId: string, id: string): Promise<void> {
    const group = await this.loadOwnedDoc(userId, id);
    await this.groupModel.findByIdAndDelete(group._id).exec();
    this.logger.log('User group deleted', { groupId: id, userId });
  }

  async addMembers(userId: string, id: string, userIds: string[]): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedDoc(userId, id);
    const objectIds = this.toMemberObjectIds(userIds);
    if (objectIds.length > 0) {
      await this.groupModel
        .updateOne({ _id: group._id }, { $addToSet: { members: { $each: objectIds } } })
        .exec();
    }
    this.logger.log('User group members added', { groupId: id, userId, count: objectIds.length });
    return this.getPopulated(id);
  }

  async removeMember(userId: string, id: string, memberId: string): Promise<IUserGroupResponse> {
    const group = await this.loadOwnedDoc(userId, id);
    if (Types.ObjectId.isValid(memberId)) {
      await this.groupModel
        .updateOne({ _id: group._id }, { $pull: { members: new Types.ObjectId(memberId) } })
        .exec();
    }
    this.logger.log('User group member removed', { groupId: id, userId, memberId });
    return this.getPopulated(id);
  }

  // ===== Helpers =====

  private toMemberObjectIds(ids?: string[]): Types.ObjectId[] {
    return [...new Set(ids || [])]
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }

  /** Load a hydrated doc the user owns (for writes). NotFound if missing OR not owner. */
  private async loadOwnedDoc(userId: string, id: string): Promise<UserGroupDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    const group = await this.groupModel.findById(id).exec();
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    if (group.createdBy.toString() !== userId) {
      throw new ForbiddenException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return group;
  }

  /** Load a lean, populated group the user owns (for reads). */
  private async loadOwnedLean(userId: string, id: string): Promise<Record<string, unknown>> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    const group = await this.groupModel.findById(id).populate(MEMBER_POPULATE).lean().exec();
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    if ((group as unknown as { createdBy: Types.ObjectId }).createdBy.toString() !== userId) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return group as unknown as Record<string, unknown>;
  }

  private async getPopulated(id: string): Promise<IUserGroupResponse> {
    const group = await this.groupModel.findById(id).populate(MEMBER_POPULATE).lean().exec();
    if (!group) {
      throw new NotFoundException(ErrorCode.USER_GROUP_NOT_FOUND);
    }
    return this.toResponse(group as unknown as Record<string, unknown>);
  }

  private toResponse(group: Record<string, unknown>): IUserGroupResponse {
    const rawMembers = (group.members as unknown[]) || [];
    const members: IUserGroupMember[] = rawMembers
      // A ref to a deleted user populates as null — drop it.
      .filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object' && '_id' in m)
      .map((m) => {
        const profile = (m.profile as { firstName?: string; lastName?: string } | undefined) ?? {};
        return {
          id: (m._id as { toString(): string }).toString(),
          email: (m.email as string) ?? '',
          firstName: profile.firstName,
          lastName: profile.lastName,
        };
      });

    return {
      id: (group._id as { toString(): string }).toString(),
      name: group.name as string,
      description: (group.description as string) || '',
      members,
      memberCount: members.length,
      createdAt: group.createdAt as Date,
      updatedAt: group.updatedAt as Date,
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd back && npx jest user-group.service.spec.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/user-group/user-group.service.ts back/src/modules/user-group/user-group.service.spec.ts
git commit -m "feat(user-group): add owner-scoped service with tests"
```

---

## Task 4: Backend — UserGroupController + build check

**Files:**
- Create: `back/src/modules/user-group/user-group.controller.ts`

**Interfaces:**
- Consumes: `UserGroupService` (Task 3), DTOs (Task 2), `CurrentUser` decorator + `UserDocument` (existing).
- Produces REST endpoints under `/user-groups` (see Global routes below).

- [ ] **Step 1: Create the controller**

Create `back/src/modules/user-group/user-group.controller.ts`:

```typescript
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserGroupService } from './user-group.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { CreateUserGroupDto, UpdateUserGroupDto, AddMembersDto } from './dto';
import { IUserGroupResponse } from './interfaces/user-group.interface';

@ApiTags('User Groups')
@ApiBearerAuth()
@Controller('user-groups')
export class UserGroupController {
  constructor(private readonly userGroupService: UserGroupService) {}

  @Get()
  @ApiOperation({ summary: 'List the current user groups' })
  async findAll(@CurrentUser() user: UserDocument): Promise<IUserGroupResponse[]> {
    return this.userGroupService.findAllForUser(user._id.toString());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a group by id (with populated members)' })
  async findById(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.findById(user._id.toString(), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a group' })
  async create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateUserGroupDto,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.create(user._id.toString(), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a group name/description' })
  async update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateUserGroupDto,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.update(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group' })
  async delete(@CurrentUser() user: UserDocument, @Param('id') id: string): Promise<void> {
    return this.userGroupService.delete(user._id.toString(), id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add members to a group' })
  async addMembers(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: AddMembersDto,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.addMembers(user._id.toString(), id, dto.userIds);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member from a group' })
  async removeMember(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Param('userId') memberId: string,
  ): Promise<IUserGroupResponse> {
    return this.userGroupService.removeMember(user._id.toString(), id, memberId);
  }
}
```

Note: verify the `CurrentUser` decorator path matches other controllers (`workspace-share.controller.ts` uses `../auth/decorators/current-user.decorator`). If a global auth guard is applied app-wide (check `app.module.ts` / `main.ts` for `APP_GUARD`), no `@UseGuards` is needed here — mirror `team.controller.ts`, which has none. If team controllers use an explicit `@UseGuards(JwtAuthGuard)`, add the same.

- [ ] **Step 2: Full backend build**

Run: `cd back && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Re-run service tests (guard against regressions)**

Run: `cd back && npx jest user-group`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/user-group/user-group.controller.ts
git commit -m "feat(user-group): add REST controller"
```

**Global routes produced by this module (for the frontend tasks):**
- `GET    /user-groups`
- `GET    /user-groups/:id`
- `POST   /user-groups` — body `{ name, description?, memberIds? }`
- `PATCH  /user-groups/:id` — body `{ name?, description? }`
- `DELETE /user-groups/:id`
- `POST   /user-groups/:id/members` — body `{ userIds: string[] }`
- `DELETE /user-groups/:id/members/:userId`

All return the `ApiResponse<T>` envelope (`{ data: IUserGroupResponse }`), like every other endpoint.

---

## Task 5: Frontend — API endpoints + types + api client

**Files:**
- Modify: `front/src/lib/api/config.ts` (after the `teams` block, ~line 304)
- Create: `front/src/modules/groups/types.ts`
- Create: `front/src/modules/groups/api.ts`

**Interfaces:**
- Produces:
  - `GroupMember` = `{ id: string; email: string; firstName?: string; lastName?: string }`
  - `UserGroup` = `{ id, name, description, members: GroupMember[], memberCount, createdAt, updatedAt }`
  - `CreateGroupData` = `{ name: string; description?: string; memberIds?: string[] }`
  - `UpdateGroupData` = `{ name?: string; description?: string }`
  - `UserSearchResult` = `{ id, email, firstName?, lastName? }`
  - api functions: `getGroups`, `createGroup`, `updateGroup`, `deleteGroup`, `addMembers`, `removeMember`, `searchUsers`

- [ ] **Step 1: Add endpoints to config**

In `front/src/lib/api/config.ts`, immediately after the `teams: { ... },` block (ends ~line 304), insert:

```typescript
  userGroups: {
    list: '/user-groups',
    byId: (id: string) => `/user-groups/${id}`,
    members: (id: string) => `/user-groups/${id}/members`,
    memberById: (id: string, userId: string) => `/user-groups/${id}/members/${userId}`,
  },
```

- [ ] **Step 2: Create types**

Create `front/src/modules/groups/types.ts`:

```typescript
/**
 * Groups Module - Types
 *
 * A UserGroup is a private, user-owned list of registered users. Groups are a
 * convenience for sharing: a group can be expanded into its members' emails and
 * fed into the existing workspace-share flow.
 */

export interface GroupMember {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface UserGroup {
  id: string;
  name: string;
  description: string;
  members: GroupMember[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGroupData {
  name: string;
  description?: string;
  memberIds?: string[];
}

export interface UpdateGroupData {
  name?: string;
  description?: string;
}

/** A user returned by the autocomplete search when picking members. */
export interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface GroupsState {
  groups: UserGroup[];
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;
}

export interface GroupsActions {
  fetchGroups: () => Promise<void>;
  createGroup: (data: CreateGroupData) => Promise<UserGroup>;
  updateGroup: (id: string, data: UpdateGroupData) => Promise<UserGroup>;
  deleteGroup: (id: string) => Promise<void>;
  addMembers: (id: string, userIds: string[]) => Promise<UserGroup>;
  removeMember: (id: string, userId: string) => Promise<UserGroup>;
  reset: () => void;
}

export type GroupsStore = GroupsState & GroupsActions;
```

- [ ] **Step 3: Create the api client**

Create `front/src/modules/groups/api.ts`:

```typescript
/**
 * Groups API Functions
 */

import apiClient, { type ApiResponse } from '@/lib/api/client';
import { API_ENDPOINTS } from '@/lib/api/config';
import type { UserGroup, CreateGroupData, UpdateGroupData, UserSearchResult } from './types';

export async function getGroups(): Promise<UserGroup[]> {
  const response = await apiClient.get<ApiResponse<UserGroup[]>>(API_ENDPOINTS.userGroups.list);
  return response.data.data;
}

export async function createGroup(data: CreateGroupData): Promise<UserGroup> {
  const response = await apiClient.post<ApiResponse<UserGroup>>(API_ENDPOINTS.userGroups.list, data);
  return response.data.data;
}

export async function updateGroup(id: string, data: UpdateGroupData): Promise<UserGroup> {
  const response = await apiClient.patch<ApiResponse<UserGroup>>(API_ENDPOINTS.userGroups.byId(id), data);
  return response.data.data;
}

export async function deleteGroup(id: string): Promise<void> {
  await apiClient.delete(API_ENDPOINTS.userGroups.byId(id));
}

export async function addMembers(id: string, userIds: string[]): Promise<UserGroup> {
  const response = await apiClient.post<ApiResponse<UserGroup>>(
    API_ENDPOINTS.userGroups.members(id),
    { userIds },
  );
  return response.data.data;
}

export async function removeMember(id: string, userId: string): Promise<UserGroup> {
  const response = await apiClient.delete<ApiResponse<UserGroup>>(
    API_ENDPOINTS.userGroups.memberById(id, userId),
  );
  return response.data.data;
}

export async function searchUsers(query: string, limit = 10): Promise<UserSearchResult[]> {
  const response = await apiClient.get<ApiResponse<UserSearchResult[]>>(
    API_ENDPOINTS.users.search,
    { params: { q: query, limit } },
  );
  return response.data.data;
}
```

- [ ] **Step 4: Commit**

```bash
git add front/src/lib/api/config.ts front/src/modules/groups/types.ts front/src/modules/groups/api.ts
git commit -m "feat(groups): add API endpoints, types and client"
```

---

## Task 6: Frontend — groups store (TDD)

**Files:**
- Create: `front/src/modules/groups/store.ts`
- Create: `front/src/modules/groups/translation.ts`
- Test: `front/src/modules/groups/store.test.ts`

**Interfaces:**
- Consumes: api functions (Task 5), `GroupsStore`/`GroupsState` (Task 5).
- Produces: `useGroupsStore`, and selector hooks `useGroups`, `useGroupsLoading`, `useGroupsInitialized`.

- [ ] **Step 1: Create the translation helper**

Create `front/src/modules/groups/translation.ts` (mirror `team/translation.ts` — verify its exact shape and copy it, swapping the namespace to `groups`). Minimal version:

```typescript
import i18n from '@/modules/localization/i18n';
import en from './locales/en.json';
import fr from './locales/fr.json';

// Register this module's namespace once.
i18n.addResourceBundle('en', 'groups', en, true, true);
i18n.addResourceBundle('fr', 'groups', fr, true, true);

/** Translate a key inside the `groups` namespace (for use outside React). */
export function translateGroup(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, { ns: 'groups', ...options });
}
```

Note: confirm the i18n import path and `addResourceBundle` usage against `team/translation.ts`. If the team module registers locales differently (e.g. via a central loader), follow that pattern instead — the locale files in Task 7 must be wired the same way team's are.

- [ ] **Step 2: Write the failing test**

Create `front/src/modules/groups/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./api');
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import * as api from './api';
import { useGroupsStore } from './store';
import type { UserGroup } from './types';

const groupA: UserGroup = {
  id: 'a', name: 'A', description: '', members: [], memberCount: 0,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('groups store', () => {
  beforeEach(() => {
    useGroupsStore.getState().reset();
    vi.clearAllMocks();
  });

  it('fetchGroups loads groups and sets initialized', async () => {
    vi.mocked(api.getGroups).mockResolvedValue([groupA]);
    await useGroupsStore.getState().fetchGroups();
    expect(useGroupsStore.getState().groups).toEqual([groupA]);
    expect(useGroupsStore.getState().isInitialized).toBe(true);
  });

  it('createGroup prepends the new group', async () => {
    const created = { ...groupA, id: 'b', name: 'B' };
    vi.mocked(api.createGroup).mockResolvedValue(created);
    useGroupsStore.setState({ groups: [groupA] });
    await useGroupsStore.getState().createGroup({ name: 'B' });
    expect(useGroupsStore.getState().groups.map((g) => g.id)).toEqual(['b', 'a']);
  });

  it('deleteGroup removes the group', async () => {
    vi.mocked(api.deleteGroup).mockResolvedValue();
    useGroupsStore.setState({ groups: [groupA] });
    await useGroupsStore.getState().deleteGroup('a');
    expect(useGroupsStore.getState().groups).toEqual([]);
  });

  it('addMembers replaces the group with the server copy', async () => {
    const updated = { ...groupA, memberCount: 1, members: [{ id: 'u1', email: 'u@x.io' }] };
    vi.mocked(api.addMembers).mockResolvedValue(updated);
    useGroupsStore.setState({ groups: [groupA] });
    await useGroupsStore.getState().addMembers('a', ['u1']);
    expect(useGroupsStore.getState().groups[0].memberCount).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd front && npx vitest run src/modules/groups/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 4: Write the store**

Create `front/src/modules/groups/store.ts`:

```typescript
/**
 * Groups Store
 * Zustand store for user-group management. Mirrors the team store conventions
 * (optimistic list updates, toast on mutations, selector hooks).
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import type { GroupsStore, GroupsState } from './types';
import * as api from './api';
import { translateGroup } from './translation';

const initialState: GroupsState = {
  groups: [],
  isLoading: false,
  isInitialized: false,
  error: null,
};

export const useGroupsStore = create<GroupsStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchGroups: async () => {
        if (get().isLoading) return;
        set({ isLoading: true, error: null });
        try {
          const groups = await api.getGroups();
          set({ groups, isLoading: false, isInitialized: true, error: null });
        } catch (err) {
          const message = err instanceof Error ? err.message : translateGroup('store.errors.fetchFailed');
          set({ isLoading: false, error: message });
          throw err;
        }
      },

      createGroup: async (data) => {
        const group = await api.createGroup(data);
        set((state) => ({ groups: [group, ...state.groups] }));
        toast.success(translateGroup('store.toasts.created', { name: group.name }));
        return group;
      },

      updateGroup: async (id, data) => {
        const group = await api.updateGroup(id, data);
        set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
        toast.success(translateGroup('store.toasts.updated', { name: group.name }));
        return group;
      },

      deleteGroup: async (id) => {
        const group = get().groups.find((g) => g.id === id);
        await api.deleteGroup(id);
        set((state) => ({ groups: state.groups.filter((g) => g.id !== id) }));
        toast.success(translateGroup('store.toasts.deleted', { name: group?.name ?? '' }));
      },

      addMembers: async (id, userIds) => {
        const group = await api.addMembers(id, userIds);
        set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
        return group;
      },

      removeMember: async (id, userId) => {
        const group = await api.removeMember(id, userId);
        set((state) => ({ groups: state.groups.map((g) => (g.id === id ? group : g)) }));
        return group;
      },

      reset: () => set(initialState),
    }),
    { name: 'groups-store' },
  ),
);

// ===== Selector Hooks =====
export const useGroups = () => useGroupsStore(useShallow((state) => state.groups));
export const useGroupsLoading = () => useGroupsStore((state) => state.isLoading);
export const useGroupsInitialized = () => useGroupsStore((state) => state.isInitialized);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd front && npx vitest run src/modules/groups/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add front/src/modules/groups/store.ts front/src/modules/groups/translation.ts front/src/modules/groups/store.test.ts
git commit -m "feat(groups): add zustand store with tests"
```

---

## Task 7: Frontend — Groups UI (button, page, dialog, member input, route, sidebar, locales)

**Files:**
- Create: `front/src/modules/groups/locales/en.json`, `front/src/modules/groups/locales/fr.json`
- Create: `front/src/modules/groups/components/GroupMemberInput.tsx`
- Create: `front/src/modules/groups/components/CreateEditGroupDialog.tsx`
- Create: `front/src/modules/groups/components/GroupsPage.tsx`
- Create: `front/src/modules/groups/components/GroupsButton.tsx`
- Create: `front/src/modules/groups/components/index.ts`
- Create: `front/src/modules/groups/index.ts`
- Modify: `front/src/Router.tsx`
- Modify: `front/src/modules/sidebar/components/AppSidebar.tsx`

**Interfaces:**
- Consumes: store hooks + `createGroup/updateGroup/deleteGroup/addMembers/removeMember` (Task 6), `searchUsers` (Task 5).
- Produces: `GroupsPage`, `GroupsButton` (both exported from `@/modules/groups`).

- [ ] **Step 1: Create locale files**

Create `front/src/modules/groups/locales/en.json`:

```json
{
  "button": { "groups": "Groups", "manage": "Manage groups" },
  "page": {
    "title": "Groups",
    "subtitle": "Create groups of people to share workspaces with them at once.",
    "newGroup": "New group",
    "emptyState": "You have no groups yet.",
    "createFirst": "Create your first group",
    "memberCount_one": "{{count}} member",
    "memberCount_other": "{{count}} members",
    "noDescription": "No description",
    "deleteDialog": {
      "title": "Delete group",
      "description": "Delete \"{{name}}\"? Workspaces already shared with its members keep their access.",
      "cancel": "Cancel",
      "confirm": "Delete"
    }
  },
  "dialog": {
    "createTitle": "Create group",
    "editTitle": "Edit group",
    "nameLabel": "Name",
    "namePlaceholder": "e.g. Marketing team",
    "descriptionLabel": "Description",
    "descriptionPlaceholder": "Optional",
    "membersLabel": "Members",
    "searchPlaceholder": "Search users by email",
    "noMembers": "No members yet.",
    "cancel": "Cancel",
    "save": "Save",
    "create": "Create"
  },
  "store": {
    "errors": { "fetchFailed": "Failed to load groups." },
    "toasts": {
      "created": "Group \"{{name}}\" created",
      "updated": "Group \"{{name}}\" updated",
      "deleted": "Group \"{{name}}\" deleted"
    }
  }
}
```

Create `front/src/modules/groups/locales/fr.json`:

```json
{
  "button": { "groups": "Groupes", "manage": "Gérer les groupes" },
  "page": {
    "title": "Groupes",
    "subtitle": "Créez des groupes de personnes pour partager des espaces de travail en une seule fois.",
    "newGroup": "Nouveau groupe",
    "emptyState": "Vous n'avez pas encore de groupe.",
    "createFirst": "Créer votre premier groupe",
    "memberCount_one": "{{count}} membre",
    "memberCount_other": "{{count}} membres",
    "noDescription": "Aucune description",
    "deleteDialog": {
      "title": "Supprimer le groupe",
      "description": "Supprimer « {{name}} » ? Les espaces déjà partagés avec ses membres conservent leur accès.",
      "cancel": "Annuler",
      "confirm": "Supprimer"
    }
  },
  "dialog": {
    "createTitle": "Créer un groupe",
    "editTitle": "Modifier le groupe",
    "nameLabel": "Nom",
    "namePlaceholder": "ex. Équipe marketing",
    "descriptionLabel": "Description",
    "descriptionPlaceholder": "Facultatif",
    "membersLabel": "Membres",
    "searchPlaceholder": "Rechercher des utilisateurs par e-mail",
    "noMembers": "Aucun membre pour le moment.",
    "cancel": "Annuler",
    "save": "Enregistrer",
    "create": "Créer"
  },
  "store": {
    "errors": { "fetchFailed": "Échec du chargement des groupes." },
    "toasts": {
      "created": "Groupe « {{name}} » créé",
      "updated": "Groupe « {{name}} » mis à jour",
      "deleted": "Groupe « {{name}} » supprimé"
    }
  }
}
```

- [ ] **Step 2: Create the member input**

Create `front/src/modules/groups/components/GroupMemberInput.tsx`. A search box that adds picked users as chips. Reuses the debounced-search pattern from the workspace `UserSearchInput`.

```tsx
import { useCallback, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { searchUsers } from '../api';
import type { GroupMember, UserSearchResult } from '../types';

interface GroupMemberInputProps {
  members: GroupMember[];
  onAdd: (user: GroupMember) => void;
  onRemove: (userId: string) => void;
  disabled?: boolean;
}

function displayName(u: { firstName?: string; lastName?: string; email: string }) {
  return u.firstName && u.lastName ? `${u.firstName} ${u.lastName}` : u.email;
}

export function GroupMemberInput({ members, onAdd, onRemove, disabled }: Readonly<GroupMemberInputProps>) {
  const { t } = useModuleTranslation('groups');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  const runSearch = useCallback((value: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (value.length < 3) {
      setResults([]);
      setShowResults(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    timeoutRef.current = setTimeout(async () => {
      const id = ++requestRef.current;
      try {
        const found = await searchUsers(value);
        if (requestRef.current === id) {
          setResults(found);
          setShowResults(found.length > 0);
        }
      } catch {
        if (requestRef.current === id) {
          setResults([]);
          setShowResults(false);
        }
      } finally {
        if (requestRef.current === id) setIsSearching(false);
      }
    }, 300);
  }, []);

  const handleSelect = (u: UserSearchResult) => {
    if (!members.some((m) => m.id === u.id)) {
      onAdd({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName });
    }
    setQuery('');
    setResults([]);
    setShowResults(false);
  };

  return (
    <div className='space-y-2'>
      <div className={cn('relative rounded-md border bg-background px-2 py-1', disabled && 'opacity-50')}>
        <Search className='absolute left-3 top-3 h-4 w-4 text-muted-foreground' />
        <div className='flex flex-wrap items-center gap-2 pl-8 pr-8'>
          {members.map((m) => (
            <div key={m.id} className='flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs font-medium'>
              <span className='max-w-40 truncate'>{displayName(m)}</span>
              <button
                type='button'
                onClick={() => onRemove(m.id)}
                disabled={disabled}
                className='text-muted-foreground hover:text-destructive focus:outline-none'
              >
                <X className='h-3 w-3' />
              </button>
            </div>
          ))}
          <input
            type='text'
            value={query}
            onChange={(e) => { setQuery(e.target.value); runSearch(e.target.value); }}
            placeholder={t('dialog.searchPlaceholder')}
            disabled={disabled}
            className='flex-1 min-w-32 border-0 bg-transparent py-2 text-sm placeholder:text-muted-foreground focus:outline-none'
          />
        </div>
        {isSearching && (
          <div className='absolute right-3 top-3'>
            <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
          </div>
        )}
        {showResults && results.length > 0 && (
          <div className='absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border bg-background shadow-lg'>
            {results.map((u) => (
              <button
                type='button'
                key={u.id}
                onClick={() => handleSelect(u)}
                className='flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted'
              >
                <div className='flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 font-medium text-primary'>
                  {displayName(u).charAt(0).toUpperCase()}
                </div>
                <div className='flex flex-col'>
                  <span className='text-sm font-medium'>{displayName(u)}</span>
                  <span className='text-xs text-muted-foreground'>{u.email}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      {members.length === 0 && <p className='text-xs text-muted-foreground'>{t('dialog.noMembers')}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create the create/edit dialog**

Create `front/src/modules/groups/components/CreateEditGroupDialog.tsx`. Manages name, description, and the working member list. On submit it creates or updates and reconciles members via `addMembers`/`removeMember` diffing against the original.

```tsx
import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';
import { useGroupsStore } from '../store';
import { GroupMemberInput } from './GroupMemberInput';
import type { GroupMember, UserGroup } from '../types';

interface CreateEditGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: UserGroup | null;
}

export function CreateEditGroupDialog({ open, onOpenChange, group }: Readonly<CreateEditGroupDialogProps>) {
  const { t } = useModuleTranslation('groups');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(group?.name ?? '');
      setDescription(group?.description ?? '');
      setMembers(group?.members ?? []);
    }
  }, [open, group]);

  const canSubmit = name.trim().length >= 2 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const store = useGroupsStore.getState();
      if (group) {
        await store.updateGroup(group.id, { name: name.trim(), description });
        // Reconcile members against the original list.
        const originalIds = new Set(group.members.map((m) => m.id));
        const nextIds = new Set(members.map((m) => m.id));
        const toAdd = members.filter((m) => !originalIds.has(m.id)).map((m) => m.id);
        const toRemove = group.members.filter((m) => !nextIds.has(m.id)).map((m) => m.id);
        if (toAdd.length > 0) await store.addMembers(group.id, toAdd);
        for (const id of toRemove) await store.removeMember(group.id, id);
      } else {
        await store.createGroup({
          name: name.trim(),
          description,
          memberIds: members.map((m) => m.id),
        });
      }
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>{group ? t('dialog.editTitle') : t('dialog.createTitle')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-1'>
            <Label htmlFor='group-name'>{t('dialog.nameLabel')}</Label>
            <Input id='group-name' value={name} onChange={(e) => setName(e.target.value)} placeholder={t('dialog.namePlaceholder')} maxLength={100} />
          </div>
          <div className='space-y-1'>
            <Label htmlFor='group-desc'>{t('dialog.descriptionLabel')}</Label>
            <Textarea id='group-desc' value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('dialog.descriptionPlaceholder')} maxLength={2000} rows={2} />
          </div>
          <div className='space-y-1'>
            <Label>{t('dialog.membersLabel')}</Label>
            <GroupMemberInput
              members={members}
              onAdd={(u) => setMembers((prev) => (prev.some((m) => m.id === u.id) ? prev : [...prev, u]))}
              onRemove={(id) => setMembers((prev) => prev.filter((m) => m.id !== id))}
              disabled={submitting}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>{t('dialog.cancel')}</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {group ? t('dialog.save') : t('dialog.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Note: confirm `@/components/ui/textarea` and `@/components/ui/label` exist (shadcn). If not present, check what the team `CreateEditTeamDialog` uses for its description field and mirror it (it may use a plain `Input` or an existing `Textarea`).

- [ ] **Step 4: Create the page**

Create `front/src/modules/groups/components/GroupsPage.tsx` (mirror `TeamsPage`, minus org-chart/share):

```tsx
import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useModuleTranslation } from '@/modules/localization';
import { useGroupsStore, useGroups, useGroupsLoading, useGroupsInitialized } from '../store';
import { CreateEditGroupDialog } from './CreateEditGroupDialog';
import type { UserGroup } from '../types';

export function GroupsPage() {
  const { t } = useModuleTranslation('groups');
  const groups = useGroups();
  const isLoading = useGroupsLoading();
  const isInitialized = useGroupsInitialized();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserGroup | null>(null);
  const [deleting, setDeleting] = useState<UserGroup | null>(null);

  useEffect(() => {
    useGroupsStore.getState().fetchGroups().catch(() => {});
  }, []);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (g: UserGroup) => { setEditing(g); setDialogOpen(true); };
  const handleDelete = async () => {
    if (!deleting) return;
    await useGroupsStore.getState().deleteGroup(deleting.id);
    setDeleting(null);
  };

  const showSpinner = isLoading && !isInitialized;

  return (
    <div className='mx-auto w-full max-w-5xl p-6'>
      <div className='mb-6 flex items-center justify-between'>
        <div>
          <h1 className='flex items-center gap-2 text-2xl font-semibold'>
            <Users className='size-6' /> {t('page.title')}
          </h1>
          <p className='text-sm text-muted-foreground'>{t('page.subtitle')}</p>
        </div>
        <Button onClick={openCreate}><Plus className='mr-2 size-4' /> {t('page.newGroup')}</Button>
      </div>

      {showSpinner ? (
        <div className='flex justify-center py-16'><Loader2 className='size-6 animate-spin text-muted-foreground' /></div>
      ) : groups.length === 0 ? (
        <div className='rounded-lg border border-dashed py-16 text-center'>
          <Users className='mx-auto mb-3 size-8 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>{t('page.emptyState')}</p>
          <Button variant='outline' className='mt-4' onClick={openCreate}>
            <Plus className='mr-2 size-4' /> {t('page.createFirst')}
          </Button>
        </div>
      ) : (
        <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          {groups.map((g) => (
            <div key={g.id} className='flex flex-col rounded-lg border bg-card p-4 shadow-sm'>
              <div className='mb-2 flex items-start justify-between gap-2'>
                <button type='button' onClick={() => openEdit(g)} className='truncate text-left font-medium hover:underline'>
                  {g.name}
                </button>
                <Badge variant='secondary' className='shrink-0'>
                  {t('page.memberCount', { count: g.memberCount })}
                </Badge>
              </div>
              <p className='mb-4 line-clamp-2 flex-1 text-sm text-muted-foreground'>
                {g.description || t('page.noDescription')}
              </p>
              <div className='flex justify-end gap-1'>
                <Button variant='ghost' size='icon' onClick={() => openEdit(g)} aria-label={t('dialog.editTitle')}>
                  <Pencil className='size-4' />
                </Button>
                <Button variant='ghost' size='icon' className='text-destructive hover:text-destructive' onClick={() => setDeleting(g)} aria-label={t('page.deleteDialog.confirm')}>
                  <Trash2 className='size-4' />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateEditGroupDialog open={dialogOpen} onOpenChange={setDialogOpen} group={editing} />

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('page.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('page.deleteDialog.description', { name: deleting?.name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('page.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className='bg-destructive text-destructive-foreground hover:bg-destructive/90'>
              {t('page.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 5: Create the sidebar button**

Create `front/src/modules/groups/components/GroupsButton.tsx`:

```tsx
import { UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useModuleTranslation } from '@/modules/localization';

export function GroupsButton() {
  const navigate = useNavigate();
  const { t } = useModuleTranslation('groups');
  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={t('button.groups')} onClick={() => navigate('/groups')}>
        <UsersRound />
        <span>{t('button.groups')}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
```

- [ ] **Step 6: Create the component + module barrels**

Create `front/src/modules/groups/components/index.ts`:

```typescript
export { GroupsButton } from './GroupsButton';
export { GroupsPage } from './GroupsPage';
export { CreateEditGroupDialog } from './CreateEditGroupDialog';
export { GroupMemberInput } from './GroupMemberInput';
```

Create `front/src/modules/groups/index.ts`:

```typescript
export { GroupsButton, GroupsPage, CreateEditGroupDialog, GroupMemberInput } from './components';
export {
  useGroupsStore, useGroups, useGroupsLoading, useGroupsInitialized,
} from './store';
export * as groupsApi from './api';
export type {
  UserGroup, GroupMember, CreateGroupData, UpdateGroupData, UserSearchResult,
} from './types';
```

- [ ] **Step 7: Register the route**

In `front/src/Router.tsx`, add a lazy import near the other module lazy imports (~line 51, next to `TeamsPage`):

```tsx
const GroupsPage = React.lazy(() =>
  import("./modules/groups").then((m) => ({ default: m.GroupsPage }))
);
```

Then add a route entry alongside the `teams` route (~line 212). Match the exact wrapper the sibling routes use (Suspense/guard). Following the `teams` shape:

```tsx
      {
        path: 'groups',
        element: (
          <React.Suspense fallback={<PageLoader />}>
            <GroupsPage />
          </React.Suspense>
        ),
      },
```

Note: copy the precise `element` wrapper from the adjacent `teams` route (line ~212–218) — use the same fallback component and Suspense usage it uses, whatever its exact name. Do not invent `PageLoader` if the file uses a different loader.

- [ ] **Step 8: Add the button to the sidebar**

In `front/src/modules/sidebar/components/AppSidebar.tsx`:
- Add the import near the other module button imports (line ~42):

```tsx
import { GroupsButton } from '@/modules/groups';
```

- Render it right after `<TeamButton />` (line ~280):

```tsx
            <TeamButton />

            <GroupsButton />
```

- [ ] **Step 9: Typecheck + build the frontend**

Run: `cd front && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Run the groups store test again (guard against regressions)**

Run: `cd front && npx vitest run src/modules/groups`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add front/src/modules/groups front/src/Router.tsx front/src/modules/sidebar/components/AppSidebar.tsx
git commit -m "feat(groups): add Groups tab, page, dialog and member input"
```

---

## Task 8: Frontend — mass-share integration in the Share Workspace Dialog (TDD)

**Files:**
- Create: `front/src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.tsx`
- Test: `front/src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.test.tsx`
- Modify: `front/src/modules/workspace/components/ShareWorkspaceDialog/index.tsx`
- Modify: `front/src/modules/workspace/locales/en.json`, `front/src/modules/workspace/locales/fr.json`

**Interfaces:**
- Consumes: `useGroups`, `useGroupsStore` (Task 6); the dialog's existing `handleAddPending(share: { email, permission })` and `pendingShares` (existing).
- Produces:
  - `expandGroupToPending(group: UserGroup, permission: WorkspacePermission, existingEmails: string[], ownerEmail: string): { email: string; permission: WorkspacePermission }[]` — pure helper, exported for testing.
  - `GroupShareSelector` component.

- [ ] **Step 1: Write the failing test for the pure expansion helper**

Create `front/src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { expandGroupToPending } from './GroupShareSelector';
import type { UserGroup } from '@/modules/groups';

const group: UserGroup = {
  id: 'g1',
  name: 'Team',
  description: '',
  memberCount: 3,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  members: [
    { id: 'u1', email: 'Alice@x.io' },
    { id: 'u2', email: 'bob@x.io' },
    { id: 'u3', email: 'owner@x.io' },
  ],
};

describe('expandGroupToPending', () => {
  it('maps members to pending shares with the chosen permission', () => {
    const result = expandGroupToPending(group, 'readwrite', [], 'nobody@x.io');
    expect(result).toEqual([
      { email: 'alice@x.io', permission: 'readwrite' },
      { email: 'bob@x.io', permission: 'readwrite' },
      { email: 'owner@x.io', permission: 'readwrite' },
    ]);
  });

  it('skips the workspace owner (case-insensitive)', () => {
    const result = expandGroupToPending(group, 'read', [], 'OWNER@x.io');
    expect(result.map((r) => r.email)).toEqual(['alice@x.io', 'bob@x.io']);
  });

  it('skips emails already pending (case-insensitive)', () => {
    const result = expandGroupToPending(group, 'read', ['ALICE@x.io'], 'nobody@x.io');
    expect(result.map((r) => r.email)).toEqual(['bob@x.io', 'owner@x.io']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd front && npx vitest run src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.test.tsx`
Expected: FAIL — cannot resolve `./GroupShareSelector`.

- [ ] **Step 3: Create the selector component + helper**

Create `front/src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useModuleTranslation } from '@/modules/localization';
import { useGroups, useGroupsStore, type UserGroup } from '@/modules/groups';
import type { WorkspacePermission } from '../../types';

/**
 * Expand a group into pending-share entries, dropping the workspace owner and
 * any email already pending. Emails are lowercased so dedup is case-insensitive.
 * Pure + exported for testing.
 */
export function expandGroupToPending(
  group: UserGroup,
  permission: WorkspacePermission,
  existingEmails: string[],
  ownerEmail: string,
): { email: string; permission: WorkspacePermission }[] {
  const taken = new Set(existingEmails.map((e) => e.toLowerCase()));
  taken.add(ownerEmail.toLowerCase());
  const out: { email: string; permission: WorkspacePermission }[] = [];
  for (const m of group.members) {
    const email = m.email.toLowerCase().trim();
    if (!email || taken.has(email)) continue;
    taken.add(email);
    out.push({ email, permission });
  }
  return out;
}

interface GroupShareSelectorProps {
  existingEmails: string[];
  ownerEmail: string;
  onExpand: (shares: { email: string; permission: WorkspacePermission }[]) => void;
  disabled?: boolean;
}

export function GroupShareSelector({ existingEmails, ownerEmail, onExpand, disabled }: Readonly<GroupShareSelectorProps>) {
  const { t } = useModuleTranslation('workspace');
  const groups = useGroups();
  const [groupId, setGroupId] = useState('');
  const [permission, setPermission] = useState<WorkspacePermission>('read');

  useEffect(() => {
    useGroupsStore.getState().fetchGroups().catch(() => {});
  }, []);

  if (groups.length === 0) return null;

  const handleAdd = () => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    onExpand(expandGroupToPending(group, permission, existingEmails, ownerEmail));
    setGroupId('');
  };

  return (
    <div className='flex items-end gap-2 rounded-md border bg-muted/30 p-2'>
      <Users className='mt-2 h-4 w-4 shrink-0 text-muted-foreground' />
      <div className='flex-1'>
        <Select value={groupId} onValueChange={setGroupId} disabled={disabled}>
          <SelectTrigger className='h-8'>
            <SelectValue placeholder={t('sharing.groups.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name} ({g.memberCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Select value={permission} onValueChange={(v) => setPermission(v as WorkspacePermission)} disabled={disabled}>
        <SelectTrigger className='h-8 w-28'><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value='read'>{t('sharing.permission.read')}</SelectItem>
          <SelectItem value='readwrite'>{t('sharing.permission.readwrite')}</SelectItem>
        </SelectContent>
      </Select>
      <Button type='button' size='sm' variant='secondary' onClick={handleAdd} disabled={disabled || !groupId}>
        {t('sharing.groups.add')}
      </Button>
    </div>
  );
}
```

Note: confirm `@/components/ui/select` exists (shadcn Select). If the codebase uses a different select primitive, mirror what other workspace dialogs use.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd front && npx vitest run src/modules/workspace/components/ShareWorkspaceDialog/GroupShareSelector.test.tsx`
Expected: PASS (all three cases).

- [ ] **Step 5: Wire the selector into the dialog**

In `front/src/modules/workspace/components/ShareWorkspaceDialog/index.tsx`:

Add the import near the top (after the `ShareRow` import, line ~21):

```tsx
import { GroupShareSelector } from './GroupShareSelector';
```

Add a bulk-add handler next to `handleAddPending` (after line ~71). It appends multiple entries, keeping the existing id-generation:

```tsx
  const handleAddGroupShares = useCallback(
    (shares: { email: string; permission: WorkspacePermission }[]) => {
      if (shares.length === 0) return;
      setPendingShares((prev) => [
        ...prev,
        ...shares.map((s) => ({
          ...s,
          id: `${Date.now().toString()}-${Math.random().toString(36).substring(2, 11)}-${s.email}`,
        })),
      ]);
    },
    [],
  );
```

Render the selector right above `<UserSearchInput ... />` (line ~129), passing the current pending emails and the owner email:

```tsx
            <GroupShareSelector
              existingEmails={pendingShares.map((s) => s.email)}
              ownerEmail={user?.email ?? ''}
              onExpand={handleAddGroupShares}
              disabled={isSharingInProgress}
            />

            <UserSearchInput
```

(The existing `user` from `useAuth()` — already destructured at line ~32 — provides `user.email`.)

- [ ] **Step 6: Add workspace locale strings**

In `front/src/modules/workspace/locales/en.json`, inside the existing `sharing` object, add a `groups` block (place it next to the other `sharing.*` keys):

```json
      "groups": {
        "selectPlaceholder": "Share with a group…",
        "add": "Add"
      }
```

In `front/src/modules/workspace/locales/fr.json`, inside `sharing`:

```json
      "groups": {
        "selectPlaceholder": "Partager avec un groupe…",
        "add": "Ajouter"
      }
```

Note: open each file and insert the block inside the existing `"sharing": { ... }` object (do not create a second `sharing` key). Verify `sharing.permission.read` / `sharing.permission.readwrite` already exist (they are used by `UserSearchInput`) — reuse them.

- [ ] **Step 7: Typecheck + run the affected tests**

Run: `cd front && npx tsc --noEmit`
Expected: no errors.

Run: `cd front && npx vitest run src/modules/workspace/components/ShareWorkspaceDialog`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add front/src/modules/workspace/components/ShareWorkspaceDialog front/src/modules/workspace/locales/en.json front/src/modules/workspace/locales/fr.json
git commit -m "feat(workspace): expand a group into pending shares in the share dialog"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Backend build + tests**

Run: `cd back && npx tsc --noEmit -p tsconfig.json && npx jest user-group`
Expected: build clean; all `user-group` tests PASS.

- [ ] **Step 2: Frontend typecheck + module tests**

Run: `cd front && npx tsc --noEmit && npx vitest run src/modules/groups src/modules/workspace/components/ShareWorkspaceDialog`
Expected: typecheck clean; all tests PASS.

- [ ] **Step 3: Lint the touched backend files**

Run: `cd back && npx eslint "src/modules/user-group/**/*.ts"`
Expected: no errors (warnings acceptable if pre-existing style).

- [ ] **Step 4: Manual smoke test (document result)**

Start the app (per project run instructions). Verify:
1. A **Groups** tab appears in the sidebar.
2. Create a group, add 2 members via search, save → group card shows "2 members".
3. Edit the group (rename, add/remove a member) → persists after reload.
4. Open a workspace's Share dialog → the **"Share with a group…"** row appears; picking the group + permission + Add populates the pending list with the members (owner excluded, no duplicates); clicking **Share** shares with all of them.
5. Delete the group → card disappears; previously shared workspace access is unaffected.

Record the outcome in the PR description. Do not claim success without running these.

- [ ] **Step 5: Final commit (if any lint/format fixes were needed)**

```bash
git add -A
git commit -m "chore(user-groups): lint and verification fixes"
```

---

## Notes for the implementer

- **Envelope:** every backend endpoint returns `{ data: ... }` automatically via the global response interceptor — the frontend `api.ts` reads `response.data.data`. Don't wrap responses manually in the controller.
- **Populate cross-module:** `members` populate relies on the `User` model being registered on the connection (it is, via `UserModule` in `AppModule`). No extra schema registration needed in `user-group.module.ts`.
- **Verify-before-adapt:** several steps carry a "Note:" to confirm an import path or shadcn primitive against a sibling file (`team.controller.ts`, `TeamsPage.tsx`, `team/translation.ts`, the `teams` route). Do that check rather than assuming; the surrounding patterns are the source of truth.
- **YAGNI:** no group sharing between users, no dynamic/live shares, no backend "share-with-group" endpoint — expansion is client-side by design.
