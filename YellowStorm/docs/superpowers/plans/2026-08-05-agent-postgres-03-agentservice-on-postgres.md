# Agent → PostgreSQL — Plan 3: AgentService on Postgres

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint every `AgentService` method from the Mongoose `agentModel` to the Drizzle `AgentRepository` (Plan 2), adding agent-type hydration at the service layer and DTO↔repository-input mapping, so agent reads/writes run on Postgres while the service's public contract (`IAgentResponse`, `IAgentForStream`, `IGrpcAgent`) is byte-for-byte unchanged.

**Architecture:** `AgentRepository` returns `AgentRecord`s with `agentType` as a bare id. A new `hydrate()` helper batch-loads the referenced `agent_types` from Mongo (via `AgentTypeService`) and injects a populated `{_id, name, slug, skills}` object into each record, so the existing `toResponse`/`toStreamAgent` mappers work untouched. Writes go through `dtoToCreateInput`/`dtoToUpdateInput`, which generate the ObjectId id, resolve `agentTypeSlug`, and remap `model`→`llmModel` and `connectorActionSelections`.

**Tech Stack:** NestJS 10, Drizzle `AgentRepository`, Mongoose (`AgentTypeService` only), Jest.

## Global Constraints

- **Public contract frozen.** `IAgentResponse`, `IAgentForStream`, `IGrpcAgent` shapes and all endpoint behavior stay identical. The mappers `toResponse`/`toStreamAgent` are NOT changed; they keep receiving a doc whose `agentType` is a populated `{_id, name, slug, skills}` object.
- **IDs:** new agents get `new Types.ObjectId().toString()` generated in `AgentService` and passed to `repo.create({ id })`. Never let Postgres generate ids.
- **agent_types stays in Mongo.** Hydration reads it via `AgentTypeService`; `agentTypeSlug` is denormalized onto the PG row at write time.
- **Scope = `AgentService` only.** The agent module's other Mongoose consumers (`a2a-publish.service`, `agent-permission.guard`, `playbook-assistant-connector-reconciler`) and the 10 external consumers are repointed in Plan 4. `AgentModule` keeps `MongooseModule.forFeature([Agent, SharedAgent])` registered until Plan 5.
- **Behavior parity is the bar.** `agent.service.spec.ts` + `agent.service.public.spec.ts` are rewritten to drive an `AgentRepository` test double but keep their existing behavioral assertions.
- **Data is already in PG** (Plan 2 backfilled 808 agents). Integration smoke-checks may run against the real DB.

## Prerequisites (satisfied)

- Plan 2 merged: `AgentRepository` provided/exported by `AgentModule`; backfill complete; `agentstore` holds all agents; `agentstore_test` exists for tests.

---

## File Structure (this plan)

- `back/src/modules/agent-type/agent-type.service.ts` — **Modify.** Add `getManyForHydration(ids)`.
- `back/src/modules/agent-type/agent-type.service.spec.ts` — **Modify/Create.** Unit test for the new method.
- `back/src/modules/agent/agent.service.ts` — **Modify.** Inject `AgentRepository`; add `hydrate`, `hydrateOne`, `dtoToCreateInput`, `dtoToUpdateInput`, `resolveAgentTypeSlug`; repoint all methods; drop `@InjectModel(Agent.name)`.
- `back/src/modules/agent/agent.service.spec.ts` — **Modify.** Swap the `agentModel` double for an `AgentRepository` double.
- `back/src/modules/agent/agent.service.public.spec.ts` — **Modify.** Same.

---

## Task 1: `AgentTypeService.getManyForHydration(ids)`

**Files:**
- Modify: `back/src/modules/agent-type/agent-type.service.ts`
- Test: `back/src/modules/agent-type/agent-type.service.spec.ts`

**Interfaces:**
- Produces: `getManyForHydration(ids: string[]): Promise<Map<string, { id: string; name: string; slug: string; skills: string[] }>>` — one Mongo query (`_id ∈ ids`), returns a map keyed by agent-type id string. Missing ids are simply absent from the map.

- [ ] **Step 1: Write the failing test**

Create/extend `back/src/modules/agent-type/agent-type.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AgentTypeService } from './agent-type.service';
import { AgentType } from './schemas/agent-type.schema';
import { AgentTypePrompt } from './schemas/agent-type-prompt.schema';
import { SkillService } from '../skill/skill.service';
import { LoggerService } from '../logger';

describe('AgentTypeService.getManyForHydration', () => {
  it('returns a map of id -> {id,name,slug,skills} for the requested ids', async () => {
    const t1 = new Types.ObjectId(); const s1 = new Types.ObjectId();
    const docs = [{ _id: t1, name: 'Mono', slug: 'mono-agent', skills: [s1] }];
    const agentTypeModel = {
      find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve(docs) }) }) }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: getModelToken(AgentType.name), useValue: agentTypeModel },
        { provide: getModelToken(AgentTypePrompt.name), useValue: {} },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();
    const service = moduleRef.get(AgentTypeService);

    const map = await service.getManyForHydration([t1.toString()]);
    expect(map.get(t1.toString())).toEqual({ id: t1.toString(), name: 'Mono', slug: 'mono-agent', skills: [s1.toString()] });
  });

  it('returns an empty map for empty input without querying', async () => {
    const agentTypeModel = { find: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: getModelToken(AgentType.name), useValue: agentTypeModel },
        { provide: getModelToken(AgentTypePrompt.name), useValue: {} },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } },
      ],
    }).compile();
    const service = moduleRef.get(AgentTypeService);
    expect((await service.getManyForHydration([])).size).toBe(0);
    expect(agentTypeModel.find).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/modules/agent-type/agent-type.service.spec.ts`
Expected: FAIL — `service.getManyForHydration is not a function`.

- [ ] **Step 3: Implement the method**

Add to `AgentTypeService` (after `resolvePromptsInBatch`):

```typescript
  /**
   * Batch lookup used by AgentService to hydrate agents (which live in Postgres)
   * with their agent-type name/slug/skills (which live in Mongo).
   */
  async getManyForHydration(
    ids: string[],
  ): Promise<Map<string, { id: string; name: string; slug: string; skills: string[] }>> {
    const map = new Map<string, { id: string; name: string; slug: string; skills: string[] }>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return map;

    const docs = await this.agentTypeModel
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select('name slug skills')
      .lean()
      .exec();

    for (const d of docs as Array<Record<string, unknown>>) {
      const id = (d._id as { toString(): string }).toString();
      map.set(id, {
        id,
        name: (d.name as string) ?? '',
        slug: (d.slug as string) ?? '',
        skills: ((d.skills as Array<{ toString(): string }>) ?? []).map((s) => s.toString()),
      });
    }
    return map;
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/modules/agent-type/agent-type.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent-type/agent-type.service.ts back/src/modules/agent-type/agent-type.service.spec.ts
git commit -m "feat(agent-type): add getManyForHydration batch lookup"
```

---

## Task 2: Add hydration + DTO-mapping helpers to `AgentService` (additive)

**Files:**
- Modify: `back/src/modules/agent/agent.service.ts`

**Interfaces (new private members on `AgentService`):**
- `private readonly agentRepository: AgentRepository` (constructor injection).
- `private async hydrate(records: AgentRecord[]): Promise<Array<Record<string, unknown>>>` — returns each record with `agentType` replaced by `{ _id, name, slug, skills }` (or `{ _id }` if the type is missing), ready for `toResponse`/`toStreamAgent`.
- `private async hydrateOne(record: AgentRecord | null): Promise<Record<string, unknown> | null>`.
- `private async resolveAgentTypeSlug(agentTypeId: string): Promise<string>` — from `AgentTypeService.getManyForHydration`.
- `private dtoToCreateInput(userId, dto, opts: { isDefault: boolean; agentTypeSlug: string }): CreateAgentInput`.
- `private dtoToUpdateInput(dto, existing: AgentRecord, opts?: { agentTypeSlug?: string; normalizedSlug?: string }): UpdateAgentInput`.

- [ ] **Step 1: Add imports + constructor injection**

In `agent.service.ts` imports add:

```typescript
import { AgentRepository, CreateAgentInput, UpdateAgentInput } from './repositories/agent.repository';
import { AgentRecord } from './repositories/agent-record.mapper';
```

Add to the constructor parameter list (leave `@InjectModel(Agent.name) agentModel` in place for now — removed in Task 5):

```typescript
    private readonly agentRepository: AgentRepository,
```

- [ ] **Step 2: Add the helpers** (paste into the "Private mapping helpers" section)

```typescript
  /** Replace each record's bare agentType id with a populated {_id,name,slug,skills}. */
  private async hydrate(records: AgentRecord[]): Promise<Array<Record<string, unknown>>> {
    const typeIds = [...new Set(records.map((r) => r.agentType).filter(Boolean))];
    const typeMap = await this.agentTypeService.getManyForHydration(typeIds);
    return records.map((r) => {
      const t = typeMap.get(r.agentType);
      return {
        ...r,
        agentType: t
          ? { _id: t.id, name: t.name, slug: t.slug, skills: t.skills }
          : { _id: r.agentType, name: '', slug: '', skills: [] },
      };
    });
  }

  private async hydrateOne(record: AgentRecord | null): Promise<Record<string, unknown> | null> {
    if (!record) return null;
    const [one] = await this.hydrate([record]);
    return one;
  }

  private async resolveAgentTypeSlug(agentTypeId: string): Promise<string> {
    const map = await this.agentTypeService.getManyForHydration([agentTypeId]);
    return map.get(agentTypeId)?.slug ?? '';
  }

  private dtoToCreateInput(
    userId: string,
    dto: CreateAgentDto,
    opts: { id: string; isDefault: boolean; slug: string; agentTypeSlug: string },
  ): CreateAgentInput {
    return {
      id: opts.id,
      name: dto.name,
      slug: opts.slug,
      agentType: dto.agentType,
      agentTypeSlug: opts.agentTypeSlug,
      role: dto.role,
      description: dto.description ?? '',
      temperature: dto.temperature ?? 0,
      llmModel: dto.model,
      instruction: dto.instruction ?? '',
      ignorePrePrompt: dto.ignorePrePrompt ?? false,
      knowledgeBases: dto.knowledgeBases ?? [],
      tools: dto.tools ?? [],
      skills: dto.skills ?? [],
      disabledSkills: dto.disabledSkills ?? [],
      connectors: dto.connectors ?? [],
      connectorActionSelections: this.normalizeConnectorActionSelectionsForInput(dto.connectors, dto.connectorActionSelections),
      guardrails: (dto.guardrails as Record<string, unknown>) ?? {},
      deploymentSettings: this.normalizeDeploymentSettings(dto.deploymentSettings) as unknown as Record<string, unknown>,
      enable_temporary_child_agents: dto.enable_temporary_child_agents ?? false,
      max_temporary_child_agents: dto.max_temporary_child_agents ?? 4,
      isDefault: opts.isDefault,
      isActive: dto.isActive ?? true,
      isDefaultForType: dto.isDefaultForType ?? false,
      createdBy: userId,
    };
  }

  /** connectorActionSelections for the repository input: {connectorId, actionKeys} scoped to attached connectors. */
  private normalizeConnectorActionSelectionsForInput(
    connectorIds: string[] | undefined,
    selections?: Array<{ connectorId: string; actionKeys: string[] }>,
  ): Array<{ connectorId: string; actionKeys: string[] }> {
    if (!connectorIds?.length || !selections?.length) return [];
    const allowed = new Set(connectorIds);
    return selections
      .filter((s) => allowed.has(s.connectorId))
      .map((s) => ({ connectorId: s.connectorId, actionKeys: [...new Set((s.actionKeys || []).filter((k) => k?.trim()))] }))
      .filter((s) => s.actionKeys.length > 0);
  }

  private dtoToUpdateInput(
    dto: UpdateAgentDto,
    existing: AgentRecord,
    opts: { agentTypeSlug?: string; normalizedSlug?: string },
  ): UpdateAgentInput {
    const patch: UpdateAgentInput = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (opts.normalizedSlug !== undefined) patch.slug = opts.normalizedSlug;
    if (dto.agentType !== undefined) { patch.agentType = dto.agentType; patch.agentTypeSlug = opts.agentTypeSlug ?? ''; }
    if (dto.role !== undefined) patch.role = dto.role;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.temperature !== undefined) patch.temperature = dto.temperature;
    if ('model' in dto) patch.llmModel = dto.model || '';
    if (dto.instruction !== undefined) patch.instruction = dto.instruction;
    if (dto.ignorePrePrompt !== undefined) patch.ignorePrePrompt = dto.ignorePrePrompt;
    if (dto.enable_temporary_child_agents !== undefined) patch.enable_temporary_child_agents = dto.enable_temporary_child_agents;
    if (dto.max_temporary_child_agents !== undefined) patch.max_temporary_child_agents = dto.max_temporary_child_agents;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    if (dto.isDefaultForType !== undefined) patch.isDefaultForType = dto.isDefaultForType;
    if (dto.knowledgeBases !== undefined) patch.knowledgeBases = dto.knowledgeBases;
    if (dto.tools !== undefined) patch.tools = dto.tools;
    if (dto.skills !== undefined) patch.skills = dto.skills;
    if (dto.disabledSkills !== undefined) patch.disabledSkills = dto.disabledSkills;
    if (dto.connectors !== undefined) patch.connectors = dto.connectors;
    if (dto.connectorActionSelections !== undefined) {
      patch.connectorActionSelections = this.normalizeConnectorActionSelectionsForInput(
        dto.connectors ?? existing.connectors, dto.connectorActionSelections,
      );
    }
    if (dto.deploymentSettings !== undefined) {
      patch['deploymentSettings' as keyof UpdateAgentInput] = undefined; // placeholder; see note
    }
    return patch;
  }
```

> **deploymentSettings/guardrails on update:** `UpdateAgentInput` (Plan 2) does not include `deploymentSettings`/`guardrails` columns. Add them to `UpdateAgentInput` and to `AgentRepository.updateById`'s `scalarMap` as `['deploymentSettings','deploymentSettings']` / `['guardrails','guardrails']` (they are jsonb columns `deploymentSettings`/`guardrails`). Then in `dtoToUpdateInput` set `patch.deploymentSettings = this.normalizeDeploymentSettings(dto.deploymentSettings, existing.deploymentSettings)` and `patch.guardrails = dto.guardrails` when present. Update the Plan-2 repository + its type accordingly in this task and re-run the repository spec.

- [ ] **Step 3: Extend `AgentRepository` for jsonb updates**

In `agent.repository.ts`, add to `UpdateAgentInput`: `guardrails?: Record<string, unknown>; deploymentSettings?: Record<string, unknown>;` and to `updateById`'s `scalarMap`: `['guardrails','guardrails'], ['deploymentSettings','deploymentSettings']`. Add an integration test in `agent.repository.spec.ts` asserting `updateById` persists a new `guardrails`/`deploymentSettings` jsonb. Run:

`npx jest src/modules/agent/repositories/agent.repository.spec.ts -t update`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds (helpers are additive; still unused).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent/agent.service.ts back/src/modules/agent/repositories/agent.repository.ts back/src/modules/agent/repositories/agent.repository.spec.ts
git commit -m "feat(agent): add hydration and DTO->repository-input helpers to AgentService"
```

---

## Task 3: Repoint read methods to `AgentRepository`

**Files:** Modify `back/src/modules/agent/agent.service.ts`.

Apply these transformations. Each `agentModel...populate('agentType'...).lean()` read becomes a repository call whose result is `hydrate`d before `toResponse`/`toStreamAgent`. Ownership/share logic and pagination wrappers are unchanged.

| Method | Was | Becomes |
|---|---|---|
| `findUserAgents` | `find(filter).populate.sort.skip.limit.lean` + `countDocuments` | `const { items, total } = await this.agentRepository.listUserAgents({ userId, search: query.search, agentType: query.agentType, isActive: query.isActive, page, limit }); const hydrated = await this.hydrate(items); return new PaginatedResponseDto(hydrated.map((a) => this.toResponse(a)), total, page, limit);` |
| `findHumainAgentsPublic` | humain type + `find(filter)…` | `listHumainPublic({ agentTypeId: humainType.id, name, role, description, page, limit })` → hydrate → toResponse |
| `findUserAgentById` | `findById(agentId).populate.lean` | `const rec = await this.agentRepository.findById(agentId);` then same null/isDefault/share logic on `rec`; `return this.toResponse((await this.hydrateOne(rec))!)` (+ shareInfo) |
| `findDefaultAgents` | `find({isDefault:true}…)` | `listDefaultAgents({...})` → hydrate → toResponse |
| `findDefaultAgentById` | `findOne({_id,isDefault:true}).populate` | `findByIdDefault(agentId)` → hydrateOne → toResponse |
| `findDefaultByAgentType` | `findOne({agentType,isDefault,isActive}).populate` | `findDefaultByType(agentTypeId)` → hydrateOne → toResponse (null-safe) |
| `findDefaultAgentByName` | `findOne({name ci,isDefault,isActive}).populate` | `findDefaultByNameActive(name)` → hydrateOne → toResponse |
| `getAgentsForUser` | `find({active, owner-or-default}).populate('name slug skills').lean` | `const recs = await this.agentRepository.findForUser(userId); return (await this.hydrate(recs)).map((a) => this.toStreamAgent(a));` |
| `buildAgentsForStream` shared fetches (`_id ∈ missing/authorized`) | `find({_id:$in, isActive}).populate` | `await this.agentRepository.findByIds(ids, { activeOnly: true })` → hydrate → toStreamAgent |
| `buildGrpcAgentsForPlaybook` | `find({_id:$in, isActive}).populate('name slug skills')` | `findByIds(agentIds, { activeOnly: true })` → hydrate → toStreamAgent |
| `getAllForUserResponse` | `find({active, owner-or-default}).populate` + shared `find({_id:$in})` | `findForUser(userId)` and `findByIds([...shareMap.keys()], { activeOnly: true })` → hydrate → toResponse |
| `canWriteAgent` | `findById(id).select('createdBy isDefault').lean` | `const rec = await this.agentRepository.findById(agentId); if (!rec||rec.isDefault) return false; ...` (rec has createdBy/isDefault) |
| `findByIds` | `find({_id:$in, active, owner-or-default}).populate` | `findByIdsForUser(ids, userId)` → hydrate → toResponse |
| `findByIdsUnrestricted` | `find({_id:$in, isActive}).populate` | `findByIds(ids, { activeOnly: true })` → hydrate → toResponse |
| `countByAgentType` | `countDocuments({agentType})` | `this.agentRepository.countByAgentType(agentTypeId)` |
| `listActiveDefaultAgentOptions` | `find({isDefault,isActive}).populate('name').sort` | `const recs = await this.agentRepository.findActiveDefaults(); const h = await this.hydrate(recs); return h.map((a) => ({ id: a._id, name: a.name, description: a.description || undefined, agentTypeName: (a.agentType as any)?.name, model: a.llmModel }));` |
| `assertActiveDefaultAgent` | `findOne({_id,isDefault,isActive}).select('_id')` | `if (!Types.ObjectId.isValid(agentId)) throw…; if (!(await this.agentRepository.existsActiveDefault(agentId))) throw…` |
| `findActiveDefaultAgentIdBySlug` | `findOne({slug,isDefault,isActive}).select('_id')` | `this.agentRepository.findActiveDefaultIdBySlug(slug)` |
| `resolveDefaultMonoAgent` | `agentTypeService.findAllActive()` + `findOne({agentType,isDefault,isActive}).populate` | keep the type resolution; then `const rec = await this.agentRepository.findDefaultByType(monoType.id); if (!rec) { warn; return undefined; } return this.toStreamAgent((await this.hydrateOne(rec))!);` |

> Notes:
> - `toResponse`/`toStreamAgent` read `_id` as `{toString()}`; `AgentRecord._id` is a plain string — `.toString()` on a string is a no-op, so they work unchanged.
> - `findDefaultByAgentType`/`findDefaultAgentByName` currently build `toResponse(agent, {id,name})` from the populated type; after hydration the populated `agentType` object is present, so plain `this.toResponse(hydrated)` yields the same result. Drop the manual `{id,name}` arg.

- [ ] **Step 1:** Apply every row above in `agent.service.ts`.
- [ ] **Step 2: Build** — `npm run build` → succeeds.
- [ ] **Step 3:** (specs are rewritten in Task 6; do not run agent.service.spec yet.) Commit:

```bash
git add back/src/modules/agent/agent.service.ts
git commit -m "refactor(agent): repoint AgentService read methods to AgentRepository"
```

---

## Task 4: Repoint write methods + uniqueness helpers

**Files:** Modify `back/src/modules/agent/agent.service.ts`.

| Method | Transformation |
|---|---|
| `createPersonal` | Validate type via `agentTypeService.findById`. Uniqueness: `const existing = await this.agentRepository.findByNameAndOwner(dto.name, userId); if (existing) throw Conflict`. `normalizedSlug` unchanged; `await this.ensureSlugUniqueness(...)`; `ensureDefaultForTypeUniqueness` if needed; `skillService.findByIds(...)`. Then `const id = new Types.ObjectId().toString(); const agentTypeSlug = await this.resolveAgentTypeSlug(dto.agentType); const rec = await this.agentRepository.create(this.dtoToCreateInput(userId, dto, { id, isDefault: false, slug: normalizedSlug, agentTypeSlug })); return this.toResponse((await this.hydrateOne(rec))!);` |
| `createDefault` | Same but uniqueness via `findByNameDefault(dto.name)`, `ensureSlugUniqueness(slug, true)`, `ensureDefaultForTypeUniqueness(dto.agentType, false)`, `dtoToCreateInput(adminUserId, dto, { id, isDefault: true, slug, agentTypeSlug })`. |
| `updatePersonal` | `const agent = await this.agentRepository.findById(agentId); if (!agent) throw…; if (agent.isDefault) throw…`. Share/ownership checks unchanged (use `agent.createdBy`). Type validation via `agentTypeService.findById` if `dto.agentType`. Name-dup via `findByNameAndOwner(dto.name, ownerId)`. `normalizedSlug`/`ensureSlugUniqueness`/`ensureDefaultForTypeUniqueness` unchanged (use `agent.agentType`). `const agentTypeSlug = dto.agentType ? await this.resolveAgentTypeSlug(dto.agentType) : undefined; const patch = this.dtoToUpdateInput(dto, agent, { agentTypeSlug, normalizedSlug }); const updated = await this.agentRepository.updateById(agentId, patch); if (!updated) throw…; return this.toResponse((await this.hydrateOne(updated))!);` |
| `updateDefault` | Same shape with `findByIdDefault(agentId)`, name-dup via `findByNameDefault`, `ensureSlugUniqueness(slug, true, undefined, agentId)`, `ensureDefaultForTypeUniqueness(effectiveType, false, undefined, agentId)`. |
| `deletePersonal` | `const agent = await this.agentRepository.findById(agentId); if (!agent) throw…; if (agent.isDefault) throw…; if (agent.createdBy !== userId) throw…; await this.agentRepository.deleteById(agentId); await this.teamService.removeAgentFromAllTeams(agentId); await this.agentShareService.removeAllSharesForAgent(agentId);` |
| `deleteDefault` | `const agent = await this.agentRepository.findByIdDefault(agentId); if (!agent) throw…; await this.agentRepository.deleteById(agentId);` |
| `ensureDefaultForTypeUniqueness` | Replace the `updateMany({agentType,isDefaultForType,…}, {$set:{isDefaultForType:false}})` with `await this.agentRepository.clearDefaultForType({ agentTypeId, isPersonal, userId, excludeId: excludeAgentId });` |
| `ensureSlugUniqueness` | Replace `findOne(filter).lean` with `const existing = await this.agentRepository.findBySlug({ slug, isDefault, userId, excludeId: excludeAgentId }); if (existing) throw Conflict;` |

> `createPersonal`/`createDefault` currently return `this.toResponse(agent, { id: agentType.id, name: agentType.name })` using the just-fetched `agentType`. After the repo returns a record, hydrate it (its `agentType` id resolves to the same type) and call `this.toResponse(hydrated)`.

- [ ] **Step 1:** Apply all rows in `agent.service.ts`.
- [ ] **Step 2: Build** — `npm run build` → succeeds.
- [ ] **Step 3: Commit**

```bash
git add back/src/modules/agent/agent.service.ts
git commit -m "refactor(agent): repoint AgentService write methods to AgentRepository"
```

---

## Task 5: Drop the Mongoose model from `AgentService`

**Files:** Modify `back/src/modules/agent/agent.service.ts`.

- [ ] **Step 1:** Remove the `@InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>,` constructor param and the now-unused `Agent`, `AgentDocument`, `Model`, `FilterQuery` imports (keep `Types` — still used for id generation and `ObjectId.isValid`). Leave `AgentModule`'s `MongooseModule.forFeature([Agent, SharedAgent])` intact (other services still use it).

- [ ] **Step 2: Build** — `npm run build`. Expected: succeeds with zero references to `this.agentModel` remaining. If the compiler flags a leftover `this.agentModel`, that method was missed in Tasks 3–4 — fix it.

- [ ] **Step 3: Grep guard**

Run: `grep -n "agentModel" back/src/modules/agent/agent.service.ts` → expect **no matches**.

- [ ] **Step 4: Commit**

```bash
git add back/src/modules/agent/agent.service.ts
git commit -m "refactor(agent): remove Mongoose agent model from AgentService"
```

---

## Task 6: Rewrite `AgentService` specs onto an `AgentRepository` double

**Files:**
- Modify: `back/src/modules/agent/agent.service.spec.ts`
- Modify: `back/src/modules/agent/agent.service.public.spec.ts`

**Approach:** the specs currently build a chainable `agentModel` mock and assert on it. Replace that with an `agentRepository` mock exposing the methods the service now calls, and an `agentTypeService.getManyForHydration` mock returning a populated type. Keep each test's *behavioral* intent (uniqueness conflict throws, share gating, pagination shape, stream roster resolution) but assert against repository calls.

- [ ] **Step 1:** In `createService()` (spec helper ~line 44), replace the `agentModel` object with:

```typescript
    const agentRepository = {
      create: jest.fn(), findById: jest.fn(), findByIdDefault: jest.fn(),
      listUserAgents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listDefaultAgents: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      listHumainPublic: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      findForUser: jest.fn().mockResolvedValue([]), findByIds: jest.fn().mockResolvedValue([]),
      findByIdsForUser: jest.fn().mockResolvedValue([]), findDefaultByType: jest.fn(),
      findDefaultByNameActive: jest.fn(), findActiveDefaults: jest.fn().mockResolvedValue([]),
      existsActiveDefault: jest.fn(), findActiveDefaultIdBySlug: jest.fn(),
      countByAgentType: jest.fn().mockResolvedValue(0), findByNameAndOwner: jest.fn(),
      findByNameDefault: jest.fn(), findBySlug: jest.fn(), findByOwnerAndType: jest.fn(),
      updateById: jest.fn(), deleteById: jest.fn(), clearDefaultForType: jest.fn(),
    };
```

Add `agentTypeService.getManyForHydration = jest.fn().mockResolvedValue(new Map());` to the existing `agentTypeService` mock. Pass `agentRepository` into the `new AgentService(...)` constructor position matching Task 2, and drop the `agentModel` argument. Return `agentRepository` from `createService()`.

- [ ] **Step 2:** Update the `mockFindById`/`mockFindOne` helpers and each test. Mechanical mapping:
  - `agentModel.findById(...)…` returning a doc → `agentRepository.findById.mockResolvedValue(record)` (a plain `AgentRecord`, no populate chain).
  - `agentModel.findOne({name,createdBy})` (uniqueness) → `agentRepository.findByNameAndOwner.mockResolvedValue(existingOrNull)`; assert `agentRepository.findByNameAndOwner` was called with `(name, userId)`.
  - `agentModel.find(...)` for stream/list → the matching `listUserAgents`/`findForUser`/`findByIds` mock returning `AgentRecord[]`.
  - `agentModel.create(...)` → `agentRepository.create.mockResolvedValue(record)`; assert called with an input whose `id` is a 24-hex string and `agentTypeSlug` is set.
  - For hydration-dependent assertions, seed `agentTypeService.getManyForHydration.mockResolvedValue(new Map([[typeId, { id: typeId, name: 'T', slug: 's', skills: [] }]]))`.
  - Records are plain objects with the `AgentRecord` fields (`_id`, `agentType` as id, `tools: []`, etc.) — no `.populate`/`.lean`/`.exec`.

- [ ] **Step 3:** Apply the same swaps to `agent.service.public.spec.ts` (it exercises `findHumainAgentsPublic` → `listHumainPublic`).

- [ ] **Step 4: Run the specs**

Run: `npx jest src/modules/agent/agent.service.spec.ts src/modules/agent/agent.service.public.spec.ts`
Expected: PASS. Fix any behavioral drift (a failing test means a Task 3/4 transformation changed observable behavior — reconcile against the original semantics, not by loosening the test).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent/agent.service.spec.ts back/src/modules/agent/agent.service.public.spec.ts
git commit -m "test(agent): drive AgentService specs through AgentRepository double"
```

---

## Task 7: Full verification

- [ ] **Step 1: Build** — `npm run build` → succeeds.
- [ ] **Step 2: Unit + integration** — `npx jest src/modules/agent src/modules/agent-type src/modules/postgres` → all pass (agent service specs, repository integration, mapper, agent-type).
- [ ] **Step 3: Live smoke test (real DB, optional but recommended).** With the app pointed at `agentstore` + Mongo, start it and exercise a read and a write end-to-end (e.g. `GET /agents` for a user, create an agent, confirm it appears in `agentstore.agents` via `psql`/node, update it, delete it). Confirm the created row's `agent_type_slug` is populated and junctions match the payload.
- [ ] **Step 4: Commit** any smoke-test fixups.

## Definition of Done (Plan 3)

- `AgentService` has **zero** references to `agentModel`; all reads/writes go through `AgentRepository`, with agent types hydrated from Mongo.
- `IAgentResponse`/`IAgentForStream`/`IGrpcAgent` outputs are unchanged; `agent.service.spec.ts` + `agent.service.public.spec.ts` pass against the repository double.
- Creating/updating agents writes to Postgres (`agentstore`), including `agent_type_slug` and junction rows; deleting cascades.
- External consumers + the agent module's other Mongoose users are untouched (Plan 4).

## Self-Review notes

- **Hydration parity:** `toResponse`/`toStreamAgent` are unchanged and still receive a populated `agentType` object — the only behavioral-parity-critical invariant. `getManyForHydration` returns exactly the `name`/`slug`/`skills` the old `populate('agentType', 'name slug skills')` provided.
- **Write parity:** id generation moves into the service (`new Types.ObjectId().toString()`), matching the old Mongoose-generated `_id` format so the ~15 Mongo referrers stay valid. `agent_type_slug` is resolved on every create/update.
- **jsonb update gap:** Task 2/Step 3 closes the Plan-2 omission (guardrails/deploymentSettings weren't in `UpdateAgentInput`).
- **Risk:** the 769-line spec rewrite is the largest surface; Task 6 keeps behavioral assertions and only swaps the datastore double. A failing test signals a real behavior change to reconcile, not a test to loosen.
