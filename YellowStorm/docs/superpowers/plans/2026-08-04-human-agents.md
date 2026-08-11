# Human Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every user exactly one "human agent" — an `Agent` of type `humain` that mirrors their profile — created automatically on registration/login and kept in sync when they edit their profile.

**Architecture:** A new self-contained `humain-agent` NestJS module owns a `HumainAgentService` with two idempotent operations (`ensureForUser`, `syncFromProfile`) that upsert one agent per user keyed by `{ createdBy, agentType: humain }`. It injects the `Agent` and `AgentType` Mongoose models directly (no service-level imports), so it has **zero circular dependencies** and can be imported by both `UserModule` and `AuthModule`. `role`/`description` are added to the user profile (source of truth) and pushed into the agent on every profile change. Auth hooks create the agent lazily on register and on every login.

**Tech Stack:** NestJS 10, Mongoose 8 (MongoDB), Jest (backend); React 18 + Vite, react-hook-form + Zod, i18next, Vitest (frontend).

## Global Constraints

- **Human-agent maintenance must NEVER break auth or profile flows.** Every code path that upserts a human agent swallows and logs its own errors; it never throws to the caller.
- **The `humain` agent type is assumed to already exist** (created in the admin panel). Do NOT add boot-time seeding. If the type is missing at runtime, log a warning and no-op.
- **`Agent.role` is `required` (non-empty) and `maxlength 50000`.** Never write an empty string to it — use the generated placeholder `You are {name}, a human agent.` when the profile role is empty.
- **`Agent.name` is `minlength 2, maxlength 50`; `Agent.description` is `maxlength 1000`; profile `role` is `maxlength 200`, profile `description` is `maxlength 1000`.** Clamp/derive accordingly.
- **No shared types between `back/` and `front/`** — every new field must be added on both sides.
- Backend tests run with `npm test` (Jest) from `back/`. Frontend tests run with `npm test` (Vitest) from `front/`.
- Follow existing patterns: services take mocked collaborators in `*.spec.ts` via direct `new Service(...)` construction (see `back/src/modules/agent/agent.service.public.spec.ts`).

---

### Task 1: `HumainAgentService` + `humain-agent` module (backend core)

The heart of the feature. Fully standalone and unit-tested with mocks. Depends on nothing from later tasks.

**Files:**
- Create: `back/src/modules/humain-agent/humain-agent.service.ts`
- Create: `back/src/modules/humain-agent/humain-agent.module.ts`
- Test: `back/src/modules/humain-agent/humain-agent.service.spec.ts`

**Interfaces:**
- Produces:
  - `interface HumainAgentInput { userId: string; email: string; firstName?: string; lastName?: string; role?: string; description?: string; }`
  - `class HumainAgentService` with `ensureForUser(input: HumainAgentInput): Promise<void>` and `syncFromProfile(input: HumainAgentInput): Promise<void>`
  - `class HumainAgentModule` (exports `HumainAgentService`)
- Consumes: `Agent`/`AgentSchema` from `../agent/schemas/agent.schema`, `AgentType`/`AgentTypeSchema` from `../agent-type/schemas/agent-type.schema`, `LoggerService` from `../logger` (global module).

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/humain-agent/humain-agent.service.spec.ts`:

```ts
import { Types } from 'mongoose';
import { HumainAgentService } from './humain-agent.service';

describe('HumainAgentService', () => {
  const humainTypeId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const makeLogger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

  const makeAgentTypeModel = (humainType: unknown) => ({
    findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(humainType) }) }),
  });

  const makeAgentModel = () => ({
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) }),
  });

  it('creates a human agent on ensureForUser, keyed by createdBy + agentType, with a placeholder role when profile role is empty', async () => {
    const agentTypeModel = makeAgentTypeModel({ _id: humainTypeId });
    const agentModel = makeAgentModel();
    const service = new HumainAgentService(agentModel as never, agentTypeModel as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'jane.doe@acme.io', firstName: 'Jane', lastName: 'Doe' });

    expect(agentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = agentModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ createdBy: new Types.ObjectId(userId), agentType: humainTypeId });
    expect(update.$setOnInsert).toEqual(expect.objectContaining({
      name: 'Jane Doe',
      slug: 'jane-doe',
      role: 'You are Jane Doe, a human agent.',
      description: '',
    }));
    expect(update.$set).toBeUndefined();
    expect(options).toEqual({ upsert: true, new: true, setDefaultsOnInsert: true });
  });

  it('falls back to the email local-part for the name when no profile name exists', async () => {
    const agentModel = makeAgentModel();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'solo@acme.io' });

    const update = agentModel.findOneAndUpdate.mock.calls[0][1];
    expect(update.$setOnInsert.name).toBe('solo');
    expect(update.$setOnInsert.slug).toBe('solo');
  });

  it('overwrites name/role/description on syncFromProfile via $set', async () => {
    const agentModel = makeAgentModel();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.syncFromProfile({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'Product Manager', description: 'Leads discovery' });

    const update = agentModel.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toEqual({ name: 'Jane Doe', slug: 'jane-doe', role: 'Product Manager', description: 'Leads discovery' });
    expect(update.$setOnInsert).toEqual({ createdBy: new Types.ObjectId(userId), agentType: humainTypeId });
  });

  it('no-ops (does not touch the agent model) and warns when the humain type is missing', async () => {
    const agentModel = makeAgentModel();
    const logger = makeLogger();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel(null) as never, logger as never);

    await service.ensureForUser({ userId, email: 'jane@acme.io' });

    expect(agentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws when the agent model rejects — logs a warning instead', async () => {
    const agentModel = { findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('E11000 duplicate key')) }) };
    const logger = makeLogger();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, logger as never);

    await expect(service.ensureForUser({ userId, email: 'jane@acme.io' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/humain-agent/humain-agent.service.spec.ts`
Expected: FAIL — `Cannot find module './humain-agent.service'`.

- [ ] **Step 3: Write the service implementation**

Create `back/src/modules/humain-agent/humain-agent.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../logger';
import { Agent, AgentDocument } from '../agent/schemas/agent.schema';
import { AgentType, AgentTypeDocument } from '../agent-type/schemas/agent-type.schema';
import { collapseRepeatedChar, collapseWhitespace, stripLeadingTrailingChar } from '../../common/utils';

/** Agent-type slug for the per-user "human" agent. Assumed created in the admin panel. */
const HUMAIN_AGENT_TYPE_SLUG = 'humain';

export interface HumainAgentInput {
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  description?: string;
}

/**
 * Mirror of the agent schema's slug derivation (kept local to avoid cross-module coupling).
 * IMPLEMENTER: copy the body of `deriveAgentSlug` VERBATIM from
 * `back/src/modules/agent/schemas/agent.schema.ts:67-83` (it contains a
 * combining-diacritics regex `/[̀-ͯ]/g` that must be copied exactly,
 * not retyped). The signature is `function deriveAgentSlug(value: string): string`.
 */
function deriveAgentSlug(value: string): string {
  /* copy verbatim from agent.schema.ts:67-83 */
}

@Injectable()
export class HumainAgentService {
  constructor(
    @InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,
    @InjectModel(AgentType.name) private readonly agentTypeModel: Model<AgentTypeDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(HumainAgentService.name);
  }

  /** Create the user's human agent if it does not exist yet. Does not modify an existing one. */
  async ensureForUser(input: HumainAgentInput): Promise<void> {
    await this.upsert(input, false);
  }

  /** Create the human agent if missing, and overwrite its name/role/description from the profile. */
  async syncFromProfile(input: HumainAgentInput): Promise<void> {
    await this.upsert(input, true);
  }

  private async upsert(input: HumainAgentInput, overwriteProfileFields: boolean): Promise<void> {
    try {
      const humainType = await this.agentTypeModel
        .findOne({ slug: HUMAIN_AGENT_TYPE_SLUG, isActive: true })
        .lean()
        .exec();
      if (!humainType) {
        this.logger.warn('Humain agent type not found; skipping human agent upsert', { userId: input.userId });
        return;
      }

      const createdBy = new Types.ObjectId(input.userId);
      const agentType = humainType._id;
      const name = this.deriveName(input);
      const slug = deriveAgentSlug(name);
      const role = this.deriveRole(input, name);
      const description = (input.description ?? '').slice(0, 1000);

      const update = overwriteProfileFields
        ? { $set: { name, slug, role, description }, $setOnInsert: { createdBy, agentType } }
        : { $setOnInsert: { name, slug, role, description, createdBy, agentType } };

      await this.agentModel
        .findOneAndUpdate({ createdBy, agentType }, update, { upsert: true, new: true, setDefaultsOnInsert: true })
        .exec();

      this.logger.log('Human agent upserted', { userId: input.userId, overwriteProfileFields });
    } catch (error) {
      // Never throw: human-agent maintenance must not break auth/profile flows.
      this.logger.warn('Failed to upsert human agent', { userId: input.userId, error: (error as Error).message });
    }
  }

  private deriveName(input: HumainAgentInput): string {
    const full = [input.firstName?.trim(), input.lastName?.trim()].filter(Boolean).join(' ').trim();
    let base = full || input.email.split('@')[0]?.trim() || 'User';
    if (base.length < 2) base = `${base}-agent`; // satisfy the 2-char minimum
    return base.slice(0, 50);
  }

  private deriveRole(input: HumainAgentInput, name: string): string {
    const role = input.role?.trim();
    if (role) return role.slice(0, 50000);
    return `You are ${name}, a human agent.`;
  }
}
```

> Note: verify `collapseRepeatedChar`, `collapseWhitespace`, `stripLeadingTrailingChar` are exported from `back/src/common/utils` (they are used by `agent.schema.ts:3`). If the barrel path differs, match the import used in `agent.schema.ts`.

- [ ] **Step 4: Write the module**

Create `back/src/modules/humain-agent/humain-agent.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HumainAgentService } from './humain-agent.service';
import { Agent, AgentSchema } from '../agent/schemas/agent.schema';
import { AgentType, AgentTypeSchema } from '../agent-type/schemas/agent-type.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Agent.name, schema: AgentSchema },
      { name: AgentType.name, schema: AgentTypeSchema },
    ]),
  ],
  providers: [HumainAgentService],
  exports: [HumainAgentService],
})
export class HumainAgentModule {}
```

> `LoggerService` needs no import here — `LoggerModule` is `@Global()` (`back/src/modules/logger/logger.module.ts:9`).
> Registering `Agent`/`AgentType` via `forFeature` in a second module is safe — Mongoose registers the model once per connection; each importing module gets the injectable.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd back && npx jest src/modules/humain-agent/humain-agent.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify the module compiles / type-checks**

Run: `cd back && npx tsc --noEmit`
Expected: no errors referencing `humain-agent`.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/humain-agent
git commit -m "feat(humain-agent): add HumainAgentService with idempotent per-user upsert"
```

---

### Task 2: Profile `role`/`description` + UserService sync hook (backend)

Add the profile fields end-to-end (schema, interface, DTOs, controller) and wire `HumainAgentService.syncFromProfile` into `completeProfile`/`updateProfile`.

**Files:**
- Modify: `back/src/modules/user/schemas/user.schema.ts:6-16` (UserProfile)
- Modify: `back/src/modules/user/interfaces/user.interface.ts:3-7,54-60` (IUserProfile, CompleteProfileData)
- Modify: `back/src/modules/user/dto/complete-profile.dto.ts`
- Modify: `back/src/modules/user/dto/update-profile.dto.ts`
- Modify: `back/src/modules/user/user.controller.ts:38-63,69-80` (passthrough)
- Modify: `back/src/modules/user/user.service.ts:40-47,154-220` (constructor dep + hooks)
- Modify: `back/src/modules/user/user.module.ts:10-24` (import HumainAgentModule)
- Test: `back/src/modules/user/user.service.spec.ts` (new)

**Interfaces:**
- Consumes: `HumainAgentService.syncFromProfile(input: HumainAgentInput)` from Task 1.
- Produces: `UserProfile.role`, `UserProfile.description`; `IUserProfile.role?`, `IUserProfile.description?`; `CompleteProfileData.role?`, `CompleteProfileData.description?`. `UserService` now takes `HumainAgentService` as its 4th constructor argument.

- [ ] **Step 1: Add fields to the UserProfile schema**

In `back/src/modules/user/schemas/user.schema.ts`, inside `class UserProfile` (after `company`, line 15):

```ts
  @Prop({ trim: true, maxlength: 200, default: '' })
  role?: string;

  @Prop({ trim: true, maxlength: 1000, default: '' })
  description?: string;
```

- [ ] **Step 2: Add fields to the interfaces**

In `back/src/modules/user/interfaces/user.interface.ts`, extend `IUserProfile`:

```ts
export interface IUserProfile {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  description?: string;
}
```

and extend `CompleteProfileData`:

```ts
export interface CompleteProfileData {
  firstName: string;
  lastName: string;
  company: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
  role?: string;
  description?: string;
}
```

(`UpdateUserData.profile` is `Partial<IUserProfile>`, so it inherits the new fields automatically.)

- [ ] **Step 3: Add fields to the DTOs**

In `back/src/modules/user/dto/complete-profile.dto.ts`, add (after `company`):

```ts
  @ApiProperty({ description: 'Job role / title', required: false, maxLength: 200 })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  role?: string;

  @ApiProperty({ description: 'Short description / bio', required: false, maxLength: 1000 })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
```

Add `IsOptional` to the imports: `import { IsString, IsBoolean, MaxLength, MinLength, IsOptional } from 'class-validator';`

In `back/src/modules/user/dto/update-profile.dto.ts`, add (after `company`, before the consent fields):

```ts
  @ApiPropertyOptional({ description: 'Job role / title', maxLength: 200 })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  role?: string;

  @ApiPropertyOptional({ description: 'Short description / bio', maxLength: 1000 })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  description?: string;
```

- [ ] **Step 4: Thread the fields through the controller**

In `back/src/modules/user/user.controller.ts` `updateProfile` (around line 43), widen the local `profile` type and copy the new fields:

```ts
    const profile: { firstName?: string; lastName?: string; company?: string; role?: string; description?: string } = {};
    if (dto.firstName !== undefined) profile.firstName = dto.firstName;
    if (dto.lastName !== undefined) profile.lastName = dto.lastName;
    if (dto.company !== undefined) profile.company = dto.company;
    if (dto.role !== undefined) profile.role = dto.role;
    if (dto.description !== undefined) profile.description = dto.description;
```

In `completeProfile` (around line 73), add `role`/`description` to the object passed to `userService.completeProfile`:

```ts
    const updatedUser = await this.userService.completeProfile(user._id.toString(), {
      firstName: dto.firstName,
      lastName: dto.lastName,
      company: dto.company,
      privacyPolicy: dto.privacyPolicy,
      dataSharing: dto.dataSharing,
      role: dto.role,
      description: dto.description,
    });
```

- [ ] **Step 5: Write the failing UserService test**

Create `back/src/modules/user/user.service.spec.ts`:

```ts
import { Types } from 'mongoose';
import { UserService } from './user.service';

describe('UserService human-agent sync', () => {
  const makeUserDoc = () => ({
    _id: new Types.ObjectId(),
    email: 'jane@acme.io',
    profile: {} as Record<string, unknown>,
    consents: {} as Record<string, unknown>,
    profileComplete: false,
    appearance: {},
    save: jest.fn().mockResolvedValue(undefined),
  });

  const makeService = (userDoc: unknown) => {
    const userModel = { findById: jest.fn().mockResolvedValue(userDoc) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    const humainAgentService = { ensureForUser: jest.fn().mockResolvedValue(undefined), syncFromProfile: jest.fn().mockResolvedValue(undefined) };
    const service = new UserService(userModel as never, logger as never, configService as never, humainAgentService as never);
    return { service, humainAgentService };
  };

  it('persists role/description and syncs the human agent on completeProfile', async () => {
    const userDoc = makeUserDoc();
    const { service, humainAgentService } = makeService(userDoc);

    await service.completeProfile(userDoc._id.toString(), {
      firstName: 'Jane', lastName: 'Doe', company: 'Acme', privacyPolicy: true, dataSharing: false,
      role: 'Product Manager', description: 'Leads discovery',
    });

    expect(userDoc.profile.role).toBe('Product Manager');
    expect(userDoc.profile.description).toBe('Leads discovery');
    expect(humainAgentService.syncFromProfile).toHaveBeenCalledWith(expect.objectContaining({
      userId: userDoc._id.toString(), email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe',
      role: 'Product Manager', description: 'Leads discovery',
    }));
  });

  it('syncs the human agent when updateProfile changes profile fields', async () => {
    const userDoc = makeUserDoc();
    const { service, humainAgentService } = makeService(userDoc);

    await service.updateProfile(userDoc._id.toString(), { profile: { role: 'Designer' } });

    expect(humainAgentService.syncFromProfile).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd back && npx jest src/modules/user/user.service.spec.ts`
Expected: FAIL — `UserService` constructor has 3 params / `syncFromProfile` not called.

- [ ] **Step 7: Wire HumainAgentService into UserService**

In `back/src/modules/user/user.service.ts`, add the import and constructor param:

```ts
import { HumainAgentService } from '../humain-agent/humain-agent.service';
```

```ts
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly humainAgentService: HumainAgentService,
  ) {
```

In `completeProfile`, set the new fields before `await user.save()` (after line 206):

```ts
    user.profile.role = data.role ?? user.profile.role ?? '';
    user.profile.description = data.description ?? user.profile.description ?? '';
```

and after `await user.save();` (after line 215), add the sync:

```ts
    await this.humainAgentService.syncFromProfile({
      userId,
      email: user.email,
      firstName: user.profile.firstName,
      lastName: user.profile.lastName,
      role: user.profile.role,
      description: user.profile.description,
    });
```

In `updateProfile`, after `await user.save();` (after line 182), add a conditional sync (only when profile fields changed):

```ts
    if (data.profile) {
      await this.humainAgentService.syncFromProfile({
        userId,
        email: user.email,
        firstName: user.profile.firstName,
        lastName: user.profile.lastName,
        role: user.profile.role,
        description: user.profile.description,
      });
    }
```

- [ ] **Step 8: Import HumainAgentModule into UserModule**

In `back/src/modules/user/user.module.ts`, add to `imports`:

```ts
import { HumainAgentModule } from '../humain-agent/humain-agent.module';
```

```ts
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    forwardRef(() => UsageModule),
    forwardRef(() => AuthorizationModule),
    HumainAgentModule,
  ],
```

> `HumainAgentModule` imports only Mongoose models — it does not import `UserModule`, so no circular dependency is introduced.

- [ ] **Step 9: Run tests + type-check**

Run: `cd back && npx jest src/modules/user/user.service.spec.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 10: Commit**

```bash
git add back/src/modules/user
git commit -m "feat(user): add profile role/description and sync human agent on profile change"
```

---

### Task 3: Auth hooks — create human agent on register and login (backend)

**Files:**
- Modify: `back/src/modules/auth/auth.service.ts:34-57,112-122,170-186` (constructor + register + login)
- Modify: `back/src/modules/auth/auth.module.ts:17-39` (import HumainAgentModule)
- Test: `back/src/modules/auth/auth.service.humain.spec.ts` (new)

**Interfaces:**
- Consumes: `HumainAgentService.ensureForUser(input)` from Task 1; `UserProfile.role`/`description` from Task 2.
- Produces: `AuthService` now takes `HumainAgentService` as its 11th (last) constructor argument.

- [ ] **Step 1: Write the failing test**

Create `back/src/modules/auth/auth.service.humain.spec.ts`:

```ts
import { Types } from 'mongoose';
import { AuthService } from './auth.service';

describe('AuthService human-agent creation', () => {
  const buildUser = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId(),
    email: 'jane@acme.io',
    emailVerified: true,
    emailVerificationToken: 'verify-token',
    status: 'active',
    roles: [],
    permissionsVersion: 1,
    profile: { firstName: 'Jane', lastName: 'Doe', role: 'PM', description: 'bio' },
    appearance: { colorTheme: 'default', language: 'en' },
    consents: {},
    ...overrides,
  });

  // sessionModel doubles as a constructor (new sessionModel({...})) and a static query object.
  const makeSessionModel = () => {
    const saved = { _id: new Types.ObjectId(), save: jest.fn().mockResolvedValue(undefined) };
    const model: any = jest.fn().mockImplementation(() => saved);
    model.countDocuments = jest.fn().mockResolvedValue(0);
    model.find = jest.fn().mockReturnValue({ sort: () => ({ limit: () => ({ exec: jest.fn().mockResolvedValue([]) }) }) });
    model.findOne = jest.fn().mockResolvedValue(null);
    return model;
  };

  const build = (user: ReturnType<typeof buildUser>) => {
    const humainAgentService = { ensureForUser: jest.fn().mockResolvedValue(undefined), syncFromProfile: jest.fn().mockResolvedValue(undefined) };
    const userService = {
      create: jest.fn().mockResolvedValue(user),
      findByEmail: jest.fn().mockResolvedValue(user),
      validatePassword: jest.fn().mockResolvedValue(true),
      assignPlan: jest.fn().mockResolvedValue(undefined),
      updateLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    const jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    const configService = { get: jest.fn((_key: string, def: unknown) => def) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const emailService = { isAvailable: jest.fn().mockReturnValue(false) };
    const usageService = { getDefaultPlan: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), slug: 'free', workspaceStorageBytes: 100 }) };
    const authorizationService = { getUserPermissions: jest.fn().mockResolvedValue([]), getUserRoleNames: jest.fn().mockResolvedValue([]) };
    const systemService = { isRegistrationEnabled: jest.fn().mockReturnValue(true) };
    const workspaceInitializer = { getOrCreatePersonalWorkspace: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(
      makeSessionModel() as never,
      userService as never,
      jwtService as never,
      configService as never,
      logger as never,
      emailService as never,
      usageService as never,
      authorizationService as never,
      systemService as never,
      workspaceInitializer as never,
      humainAgentService as never,
    );
    return { service, humainAgentService, userService };
  };

  it('creates a human agent on register', async () => {
    const user = buildUser();
    const { service, humainAgentService } = build(user);

    await service.register({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never);

    expect(humainAgentService.ensureForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id.toString(), email: user.email }),
    );
  });

  it('ensures a human agent on login (covers already-registered users)', async () => {
    const user = buildUser();
    const { service, humainAgentService } = build(user);

    await service.login({ email: 'jane@acme.io', password: 'Str0ng!pass' } as never, '127.0.0.1', 'jest-agent');

    expect(humainAgentService.ensureForUser).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user._id.toString(), email: user.email, firstName: 'Jane', role: 'PM' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && npx jest src/modules/auth/auth.service.humain.spec.ts`
Expected: FAIL — `AuthService` constructor has 10 params / `ensureForUser` not called.

- [ ] **Step 3: Add HumainAgentService to the AuthService constructor**

In `back/src/modules/auth/auth.service.ts`, add the import:

```ts
import { HumainAgentService } from '../humain-agent/humain-agent.service';
```

and append the constructor param after `workspaceInitializer` (line 47):

```ts
    @Inject(forwardRef(() => WorkspaceInitializerService))
    private readonly workspaceInitializer: WorkspaceInitializerService,
    private readonly humainAgentService: HumainAgentService,
  ) {
```

- [ ] **Step 4: Hook register()**

In `register()`, after the workspace-creation `try/catch` block (after line 111, before the `this.logger.log('User registered', ...)`), add:

```ts
    await this.humainAgentService.ensureForUser({
      userId: user._id.toString(),
      email: user.email,
    });
```

- [ ] **Step 5: Hook login()**

In `login()`, after `await this.userService.updateLastLogin(user._id.toString());` (line 172), add:

```ts
    await this.humainAgentService.ensureForUser({
      userId: user._id.toString(),
      email: user.email,
      firstName: user.profile?.firstName,
      lastName: user.profile?.lastName,
      role: user.profile?.role,
      description: user.profile?.description,
    });
```

- [ ] **Step 6: Import HumainAgentModule into AuthModule**

In `back/src/modules/auth/auth.module.ts`:

```ts
import { HumainAgentModule } from '../humain-agent/humain-agent.module';
```

Add `HumainAgentModule` to the `imports` array (after `forwardRef(() => WorkspaceModule)`).

- [ ] **Step 7: Run tests + type-check**

Run: `cd back && npx jest src/modules/auth/auth.service.humain.spec.ts && npx tsc --noEmit`
Expected: PASS (2 tests), no type errors.

- [ ] **Step 8: Run the full backend suite to catch regressions**

Run: `cd back && npm test`
Expected: PASS (no existing tests broken by the new constructor args — the reconciler and public-agent specs construct their services directly and are unaffected).

- [ ] **Step 9: Commit**

```bash
git add back/src/modules/auth
git commit -m "feat(auth): create/ensure human agent on register and login"
```

---

### Task 4: Profile-completion form — collect role/description (frontend)

**Files:**
- Modify: `front/src/modules/auth/types.ts:6-9,64-71` (UserProfile, CompleteProfileData)
- Modify: `front/src/modules/auth/components/ProfileCompletionPage.tsx`
- Modify: `front/src/modules/auth/components/ProfileCompletionPage.test.tsx:72-78`
- Modify: `front/src/modules/auth/locales/en.json`, `front/src/modules/auth/locales/fr.json`

**Interfaces:**
- Consumes: backend `POST /users/complete-profile` now accepts optional `role`/`description` (Task 2).
- Produces: `CompleteProfileData` gains `role?: string; description?: string`; `UserProfile` gains the same.

- [ ] **Step 1: Extend the frontend types**

In `front/src/modules/auth/types.ts`, extend `UserProfile` (lines 6-9) and `CompleteProfileData` (lines 64-71):

```ts
export interface UserProfile {
  firstName?: string;
  lastName?: string;
  company?: string;
  role?: string;
  description?: string;
}
```

```ts
export interface CompleteProfileData {
  firstName: string;
  lastName: string;
  company: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
  role?: string;
  description?: string;
}
```

- [ ] **Step 2: Update the existing test to expect the new fields**

In `front/src/modules/auth/components/ProfileCompletionPage.test.tsx`, the assertion at line 72 (`expect(completeProfileMock).toHaveBeenCalledWith({...})`) must include the new fields. Add to the expected object (and fill the inputs in the test's form interaction — follow the existing pattern that fills firstName/lastName/company):

```ts
      expect(completeProfileMock).toHaveBeenCalledWith({
        firstName: 'John',
        lastName: 'Doe',
        company: 'Acme',
        privacyPolicy: true,
        dataSharing: false,
        role: 'Engineer',
        description: 'Builds things',
      });
```

Add the field-fill interactions before submit, mirroring how the test types into `firstName` (use the label text keys `profileCompletion.role.label` / `profileCompletion.description.label`, or the placeholder, consistent with the existing queries in this test).

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd front && npx vitest run src/modules/auth/components/ProfileCompletionPage.test.tsx`
Expected: FAIL — `role`/`description` missing from the submitted payload (and the new inputs are not found).

- [ ] **Step 4: Add role/description to the form**

In `front/src/modules/auth/components/ProfileCompletionPage.tsx`:

1. Extend `ProfileFormValues` (line 24):

```ts
type ProfileFormValues = {
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  description: string;
  privacyPolicy: boolean;
  dataSharing: boolean;
};
```

2. Extend the Zod schema (lines 38-46) — both optional (empty allowed):

```ts
        role: z.string().max(200, t('profileCompletion.error.roleMax')).optional().default(''),
        description: z.string().max(1000, t('profileCompletion.error.descriptionMax')).optional().default(''),
```

3. Extend `defaultValues` (lines 57-63): `role: user?.profile?.role || ''`, `description: user?.profile?.description || ''`.

4. Add two `FormField`s after the `company` field (after line 194), following the exact `company` field pattern (label/placeholder from i18n, `disabled={isSubmitting}`, same input classes). Use a `<textarea>`-style input for description if the design system provides `Textarea` (`@/components/ui/textarea`); otherwise reuse `Input`.

5. Extend the `onSubmit` payload (lines 102-108):

```ts
      await completeProfile({
        firstName: data.firstName,
        lastName: data.lastName,
        company: data.company,
        role: data.role,
        description: data.description,
        privacyPolicy: data.privacyPolicy,
        dataSharing: data.dataSharing,
      });
```

- [ ] **Step 5: Add i18n keys**

In `front/src/modules/auth/locales/en.json`, under the `profileCompletion` object, add:

```json
"role": { "label": "Your role", "placeholder": "e.g. Product Manager" },
"description": { "label": "About you", "placeholder": "A short description of what you do" },
"error": { "roleMax": "Role must be at most 200 characters", "descriptionMax": "Description must be at most 1000 characters" }
```

(Merge the `roleMax`/`descriptionMax` keys into the existing `profileCompletion.error` object rather than replacing it.)

In `front/src/modules/auth/locales/fr.json`, add the French equivalents:

```json
"role": { "label": "Votre rôle", "placeholder": "ex. Chef de produit" },
"description": { "label": "À propos de vous", "placeholder": "Une brève description de votre activité" },
"error": { "roleMax": "Le rôle doit contenir au plus 200 caractères", "descriptionMax": "La description doit contenir au plus 1000 caractères" }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd front && npx vitest run src/modules/auth/components/ProfileCompletionPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Type-check the frontend**

Run: `cd front && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add front/src/modules/auth
git commit -m "feat(auth-ui): collect human-agent role and description on profile completion"
```

---

### Task 5: Profile edit page — role/description fields (frontend)

Lets users change their role/description later; the backend `PUT /users/me` hook (Task 2) syncs the human agent.

**Files:**
- Modify: `front/src/modules/profile/components/ProfileSection.tsx`
- Modify: `front/src/modules/profile/api.ts` and/or `front/src/modules/profile/types.ts` (whichever declares the update payload type)
- Modify: `front/src/modules/profile/locales/en.json`, `front/src/modules/profile/locales/fr.json`
- Test: `front/src/modules/profile/components/ProfileSection.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `PUT /users/me` accepts optional `role`/`description` (Task 2). `user.profile.role`/`description` from the auth `UserProfile` type (Task 4).

- [ ] **Step 1: Extend the profile update payload type**

Open `front/src/modules/profile/api.ts` and `front/src/modules/profile/types.ts`. Find the type used by `profileApi.updateProfile`'s argument (it currently carries `firstName`/`lastName`/`company`). Add `role?: string; description?: string;` to that type. If `updateProfile` forwards to the auth `updateProfile(data: Partial<CompleteProfileData>)`, the fields are already accepted once `CompleteProfileData` was extended in Task 4 — just widen the local profile type.

- [ ] **Step 2: Write/extend the failing test**

In `front/src/modules/profile/components/ProfileSection.test.tsx`, add a test that fills `role`/`description` and asserts they are included in the `updateProfile` call payload (mirror the existing submit-assertion pattern in that file). If the file has no submit test yet, add one following `ProfileCompletionPage.test.tsx` as the reference.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd front && npx vitest run src/modules/profile/components/ProfileSection.test.tsx`
Expected: FAIL — new inputs not found / payload missing `role`/`description`.

- [ ] **Step 4: Add the fields to ProfileSection**

In `front/src/modules/profile/components/ProfileSection.tsx`:

1. Extend `buildProfileSchema` (lines 24-29):

```ts
    role: z.string().max(200, translate('profileSection.validation.roleMax')).optional(),
    description: z.string().max(1000, translate('profileSection.validation.descriptionMax')).optional(),
```

2. Extend both `defaultValues` (lines 47-51) and the `form.reset` object in the `useEffect` (lines 57-61) with `role: user?.profile?.role || ''` and `description: user?.profile?.description || ''`.

3. Add two `FormField`s after the `company` field (after line 134), following the `company` field pattern (use `Textarea` from `@/components/ui/textarea` for description if available, else `Input`).

- [ ] **Step 5: Add i18n keys**

In `front/src/modules/profile/locales/en.json`, under `profileSection.fields`, add `role` and `description` (`label`, `placeholder`), and under `profileSection.validation` add `roleMax`, `descriptionMax`. Add French equivalents in `fr.json`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd front && npx vitest run src/modules/profile/components/ProfileSection.test.tsx`
Expected: PASS.

- [ ] **Step 7: Run the frontend suite + type-check**

Run: `cd front && npm test && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add front/src/modules/profile
git commit -m "feat(profile-ui): edit human-agent role and description from profile settings"
```

---

## Manual verification (after all tasks)

1. **New user:** register → verify email → on the profile-completion page, fill role + description → submit. In MongoDB, confirm one `agents` document with `agentType` = the `humain` type, `createdBy` = the user, and `role`/`description` matching the form.
2. **Existing user (no human agent):** ensure a user with no human agent exists, then log in. Confirm exactly one `humain` agent is created with an empty-derived (placeholder) role and empty description.
3. **Idempotency:** log in again → confirm no second agent is created.
4. **Edit:** change role/description in profile settings → confirm the same agent document updates (no duplicate).
5. **Public listing:** `GET /public/agents?role=...` (with `X-API-Key`) returns the human agents, filterable by the new role/description.
```
