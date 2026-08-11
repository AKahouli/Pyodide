# Agent → PostgreSQL — Plan 4: Consumer Decoupling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repoint every remaining consumer of the Mongoose Agent model (`@InjectModel(Agent.name)`) — 10 external services/guards + 3 agent-module-internal users — plus the one `conversation` populate, onto `AgentRepository`/`AgentService`. After this plan, **nothing reads agents from Mongo**; Postgres is the sole source of truth in practice.

**Architecture:** Extract `AgentRepository` into a lightweight `AgentRepositoryModule` (it depends only on the global `DRIZZLE_DB`), so consumer modules can inject it **without importing the full `AgentModule`** — which would create circular dependencies (`AgentModule` imports `ToolModule`/`SkillModule`/`ConnectorModule`). Each consumer swaps its Mongoose call for the equivalent repository method. A handful of new repository methods cover the delete-by-owner, scoped-pull, and reconciler cases.

**Tech Stack:** NestJS 10, Drizzle `AgentRepository`, Jest. Integration tests run against `agentstore_test`.

## Global Constraints

- **No new Mongoose agent reads.** After this plan, only `AgentRepository` (Drizzle) touches agent data. `AgentModule` keeps `forFeature([Agent, SharedAgent])` until Plan 5 (SharedAgent still Mongoose; the Agent registration is removed in Plan 5 once nothing references the model).
- **Avoid circular deps.** Consumers inject `AgentRepository` via `AgentRepositoryModule`, NOT via `AgentModule`, unless they already import `AgentModule` and need `AgentService` proper.
- **Behavior parity.** Field access is preserved; `AgentRecord` exposes every field these consumers read (`_id` (string), `name`, `description`, `role`, `isActive`, `isDefault`, `createdBy`, `agentType` (id string), `guardrails`, `deploymentSettings`, `knowledgeBases`, `llmModel`, `a2a*`, `instruction`, `connectors`).
- **IDs:** programmatic creators (worky, humain, reconciler) generate `new Types.ObjectId().toString()` and resolve `agentTypeSlug` before calling `create`.
- **Two shape risks (verify during execution):** `conversation.getTaggedAgents` and widget `request.widgetAgent` — confirm callers tolerate the `IAgentResponse`/`AgentRecord` shape.

## Prerequisites (satisfied)

- Plan 3 merged: `AgentService` runs on `AgentRepository`; `AgentRepository` provided+exported by `AgentModule`; `agentstore` backfilled; `agentstore_test` for tests.

---

## Consumer → method map (reference)

| # | File | Was | Becomes |
|---|---|---|---|
| 3 | `tool/tool.service.ts` | `updateMany({tools:id},{$pull})` | `pullToolFromAll(id)` |
| 4 | `workspace/workspace.service.ts` | `updateMany({knowledgeBases:id},{$pull})` | `pullKnowledgeBaseFromAll(id)` |
| 5 | `skill/skill.service.ts` | `updateMany({skills},{$pull})` + `{disabledSkills}` | `pullSkillFromAll(id)` + `pullDisabledSkillFromAll(id)` |
| 7 | `governance-consumer-scope.service.ts` | `find({_id∈,isActive}).select('name description')` | `findByIds(ids,{activeOnly:true})` → read `_id/name/description` |
| 8 | `governed-conversation.service.ts` | same (allowedAgentIds) | `findByIds(allowedAgentIds,{activeOnly:true})` |
| 9 | `governance-scope-overview.service.ts` | `find({_id∈}).lean()` (reads `guardrails.promptInjection.*`) | `findByIds(ids)` → read `guardrails` |
| 1 | `worky-stream.service.ts` | `create(...)`, `deleteOne({_id,createdBy})`, `findOne({name,createdBy})` | `create(input)`, `deleteByIdAndOwner(id,ownerId)`, `findByNameAndOwner(name,ownerId)` |
| 2 | `worky-ephemeral-worker.service.ts` | `create(...)`, `findById(mgr).select({agentType:1})` | `create(input)`, `findById(mgr)` → read `.agentType` |
| 6 | `humain-agent.service.ts` | `findOne({createdBy,agentType})`+save, `create(...)` | `findByOwnerAndType(userId,typeId)`, `updateById`, `create(input)` |
| 10 | `widget-token.guard.ts` | `findById(id).lean()` | `findById(id)` (reads `isActive`,`deploymentSettings`) |
| 11 | `conversation.service.ts` getTaggedAgents | `.populate('groupMeta.taggedAgents')` | `agentService.findByIdsUnrestricted(ids)` |
| 12 | `a2a-publish.service.ts` | `findByIdAndUpdate($set/$unset a2a)`, `findById` | `updateById(id,{a2a...})`, `findById` |
| 13 | `agent-permission.guard.ts` | `findById(id).select('createdBy isActive isDefault')` | `findById(id)` |
| 14 | `playbook-assistant-connector-reconciler.service.ts` | find/upsert/updateMany/bulkWrite | new repo methods (Task 8) |

---

## Task 1: Extract `AgentRepositoryModule` + add new repository methods

**Files:**
- Create: `back/src/modules/agent/repositories/agent-repository.module.ts`
- Modify: `back/src/modules/agent/agent.module.ts` (import the new module; drop the direct `AgentRepository` provider)
- Modify: `back/src/modules/agent/repositories/agent.repository.ts` (new methods)
- Modify: `back/src/modules/agent/repositories/agent.repository.spec.ts` (tests for new methods)

**Interfaces (new on `AgentRepository`):**
- `deleteByIdAndOwner(id: string, ownerId: string): Promise<void>`
- `findActiveDefaultsByType(agentTypeId: string, limit: number): Promise<AgentRecord[]>`
- `pullConnectorFromAllExcept(connectorId: string, exceptAgentId: string): Promise<void>`
- `findIdsByInstructionLike(pattern: string, exceptAgentId: string): Promise<Array<{ id: string; instruction: string }>>`

- [ ] **Step 1: Create `AgentRepositoryModule`**

```typescript
import { Global, Module } from '@nestjs/common';
import { AgentRepository } from './agent.repository';

// AgentRepository depends only on DRIZZLE_DB (from the global PostgresModule),
// so this module is safe to import anywhere without circular-dependency risk.
@Global()
@Module({
  providers: [AgentRepository],
  exports: [AgentRepository],
})
export class AgentRepositoryModule {}
```

> `@Global()` means every module can inject `AgentRepository` once this module is imported once (in `AppModule` or `AgentModule`). This is the simplest way to eliminate the per-consumer import churn and cycle risk. If a non-global design is preferred, drop `@Global()` and add `imports: [AgentRepositoryModule]` to each consumer module instead.

- [ ] **Step 2: Wire it into `AgentModule`**

In `agent.module.ts`: add `AgentRepositoryModule` to `imports`, and REMOVE `AgentRepository` from the `providers` array (it now comes from the imported module). Keep `AgentRepository` in `exports` (re-export) OR rely on the global module — simplest: remove it from both `providers` and `exports` here and let the global module provide it. Register `AgentRepositoryModule` in `AppModule` imports as well (near `PostgresModule`) so it is initialized globally.

- [ ] **Step 3: Add the new repository methods**

Add to `AgentRepository`:

```typescript
  async deleteByIdAndOwner(id: string, ownerId: string): Promise<void> {
    await this.db.delete(agents).where(and(eq(agents.id, id), eq(agents.createdBy, ownerId)));
  }

  async findActiveDefaultsByType(agentTypeId: string, limit: number): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.agentTypeId, agentTypeId), eq(agents.isDefault, true), eq(agents.isActive, true)))
      .limit(limit);
    return this.assemble(rows);
  }

  async pullConnectorFromAllExcept(connectorId: string, exceptAgentId: string): Promise<void> {
    await this.db.transaction(async (tx: Tx) => {
      await tx.delete(agentConnectors).where(and(eq(agentConnectors.connectorId, connectorId), sql`${agentConnectors.agentId} <> ${exceptAgentId}`));
      await tx.delete(agentConnectorActions).where(and(eq(agentConnectorActions.connectorId, connectorId), sql`${agentConnectorActions.agentId} <> ${exceptAgentId}`));
    });
  }

  async findIdsByInstructionLike(pattern: string, exceptAgentId: string): Promise<Array<{ id: string; instruction: string }>> {
    const rows = await this.db.select({ id: agents.id, instruction: agents.instruction }).from(agents)
      .where(and(ilike(agents.instruction, pattern), sql`${agents.id} <> ${exceptAgentId}`));
    return rows.map((r) => ({ id: trim24(r.id), instruction: r.instruction }));
  }
```

- [ ] **Step 4: Integration tests for the new methods**

Add a `describeIntegration('AgentRepository plan-4 methods')` block covering: `deleteByIdAndOwner` deletes only when owner matches (and is a no-op for a wrong owner); `findActiveDefaultsByType` returns up to `limit` active defaults of a type; `pullConnectorFromAllExcept` removes the connector from all agents except the excepted one; `findIdsByInstructionLike` matches by `ILIKE` and excludes the given id. Run:

`npx jest src/modules/agent/repositories/agent.repository.spec.ts`
Expected: PASS.

- [ ] **Step 5: Build + commit**

```bash
npm run build   # succeeds
git add back/src/modules/agent/repositories/agent-repository.module.ts back/src/modules/agent/agent.module.ts back/src/modules/agent/repositories/agent.repository.ts back/src/modules/agent/repositories/agent.repository.spec.ts back/src/app.module.ts
git commit -m "feat(agent): extract global AgentRepositoryModule and add plan-4 repository methods"
```

---

## Task 2: Repoint the `$pull` consumers (tool, workspace, skill)

**Files:** `tool/tool.service.ts`, `tool/tool.module.ts`, `workspace/workspace.service.ts`, `workspace/workspace.module.ts`, `skill/skill.service.ts`, `skill/skill.module.ts`.

For each service:
- Replace `@InjectModel(Agent.name) private readonly agentModel: Model<AgentDocument>` with `private readonly agentRepository: AgentRepository` (import from `../agent/repositories/agent.repository`).
- **tool** L204: `this.agentModel.updateMany({ tools: … }, { $pull: { tools: … } })` → `await this.agentRepository.pullToolFromAll(id);`
- **workspace** L557: → `await this.agentRepository.pullKnowledgeBaseFromAll(workspaceId);`
- **skill** L236-237: the `Promise.all([...])` two agent updates → `this.agentRepository.pullSkillFromAll(skillId)` and `this.agentRepository.pullDisabledSkillFromAll(skillId)` (keep the `agentTypeModel` skill pull as-is).

For each module: remove `{ name: Agent.name, schema: AgentSchema }` from `MongooseModule.forFeature([...])` (and the now-unused `Agent`/`AgentSchema` imports). No `AgentModule` import needed — `AgentRepositoryModule` is global.

- [ ] **Step 1:** Apply the three service + three module edits.
- [ ] **Step 2: Build** — `npm run build` → succeeds.
- [ ] **Step 3: Run the affected specs** — `npx jest src/modules/tool src/modules/skill src/modules/workspace` → pass (update mocks that referenced the agent model to mock `agentRepository.pull*`).
- [ ] **Step 4: Commit** — `git commit -m "refactor(agent): repoint tool/skill/workspace pulls to AgentRepository"`

---

## Task 3: Repoint governance read consumers

**Files:** `governance/services/governance-consumer-scope.service.ts`, `governed-conversation.service.ts`, `governance-scope-overview.service.ts`, `governance/governance.module.ts`.

- Swap `agentModel` for `agentRepository` in each service.
- **consumer-scope** L53: `find({_id∈ ids, isActive:true}).select('name description').lean()` → `const agents = await this.agentRepository.findByIds(ids.map(String), { activeOnly: true });` then build the `agentById` map from `agent._id`/`agent.name`/`agent.description` (record fields — `_id` is already a string, so drop `.toString()` or keep it, both work).
- **governed-conversation** L62: → `await this.agentRepository.findByIds(allowedAgentIds.map(String), { activeOnly: true })`; read `_id`/`name`/`description`; `.length` unchanged.
- **scope-overview** L166 (`findMappedAgents`): `find({_id∈ ids}).lean()` → `await this.agentRepository.findByIds(ids.map(String))` (no `activeOnly` — parity with the original, which had no isActive filter). Callers read only `guardrails.promptInjection.*` and `.length` — `AgentRecord.guardrails` is the jsonb object, structurally identical.
- **governance.module.ts**: remove the `Agent` `forFeature` registration (+ unused imports).

- [ ] **Step 1:** Apply edits.
- [ ] **Step 2: Build** → succeeds.
- [ ] **Step 3:** Run `npx jest src/modules/governance` → pass (update any spec mocking the agent model).
- [ ] **Step 4: Commit** — `refactor(governance): repoint agent reads to AgentRepository`

---

## Task 4: Repoint worky (stream + ephemeral worker)

**Files:** `worky/services/worky-stream.service.ts`, `worky/services/worky-ephemeral-worker.service.ts`, `worky/worky.module.ts`.

Both already have `AgentModule` imported; switch their injected model to `AgentRepository` (global). Build a `CreateAgentInput` for each `create()`:

- **worky-stream** `createManagerAgent()`: generate `const id = new Types.ObjectId().toString();` resolve `agentTypeSlug` (worky seeds the `manager` type via `agentTypeService.findOrCreateBySlug` — pass that slug, or `await this.agentTypeService.getManyForHydration([managerTypeId])`). Call `await this.agentRepository.create({ id, name, slug, agentType: managerTypeId, agentTypeSlug, role, description, temperature, llmModel, instruction, ignorePrePrompt, knowledgeBases: [], tools: [], skills: [], disabledSkills: [], connectors: [], connectorActionSelections: [], guardrails: {}, deploymentSettings: {}, enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: false, isActive: true, isDefaultForType: false, createdBy: ownerUserId });` then read `agent._id`.
- **worky-stream** `delete()` L214: → `await this.agentRepository.deleteByIdAndOwner(stream.managerAgentId, stream.ownerUserId);`
- **worky-stream** `uniqueAgentName()` L458: `findOne({name,createdBy})` presence → `const existing = await this.agentRepository.findByNameAndOwner(name, userId); if (!existing) return name;`
- **worky-ephemeral** L124: `findById(mgr).select({agentType:1})` → `const mgr = await this.agentRepository.findById(stream.managerAgentId); const agentTypeId = mgr?.agentType ?? new Types.ObjectId().toString();` then `create({ id, agentType: agentTypeId, agentTypeSlug: <resolve or ''>, ... })` (resolve slug from `getManyForHydration([agentTypeId])`; `''` acceptable for a hidden ephemeral worker if the type is unknown).
- **worky.module.ts**: remove the `Agent` `forFeature` (keep `AgentModule` import — worky uses `AgentService` elsewhere).

- [ ] **Step 1:** Apply edits.
- [ ] **Step 2: Build** → succeeds.
- [ ] **Step 3:** `npx jest src/modules/worky` → pass (update model mocks to `agentRepository`).
- [ ] **Step 4: Commit** — `refactor(worky): repoint agent create/delete to AgentRepository`

---

## Task 5: Repoint humain-agent

**Files:** `humain-agent/humain-agent.service.ts`, `humain-agent/humain-agent.module.ts`.

- Swap `agentModel` for `agentRepository` (global).
- `upsert()`: `const existing = await this.agentRepository.findByOwnerAndType(input.userId, agentTypeId);` — note `findByOwnerAndType(userId, typeId)`. If `!existing`: `const id = new Types.ObjectId().toString(); const agentTypeSlug = idStr(humainType.slug);` → `await this.agentRepository.create({ id, name, slug, agentType: agentTypeId, agentTypeSlug, role, description, temperature: 0, llmModel: undefined, instruction: '', ignorePrePrompt: false, knowledgeBases: [], tools: [], skills: [], disabledSkills: [], connectors: [], connectorActionSelections: [], guardrails: {}, deploymentSettings: {}, enable_temporary_child_agents: false, max_temporary_child_agents: 4, isDefault: false, isActive: true, isDefaultForType: false, createdBy: input.userId });`. If exists and `overwriteProfileFields`: `await this.agentRepository.updateById(existing._id, { name, slug, role, description });`. (`humainType` is already fetched in the service; it exposes `slug`.)
- **humain-agent.module.ts**: remove the `Agent` `forFeature` (+ unused imports).

- [ ] **Step 1-4:** Apply, build, `npx jest src/modules/humain-agent` (update mocks), commit `refactor(humain-agent): repoint upsert to AgentRepository`.

---

## Task 6: Repoint widget-token guard (+ verify widget shape compat)

**Files:** `widget-chat/guards/widget-token.guard.ts`, `widget-chat/widget-chat.module.ts`.

- Swap `agentModel` for `agentRepository` (global). L83: `findById(id).lean()` → `const agent = await this.agentRepository.findById(widgetToken.agentId);`. Reads `isActive`, `deploymentSettings.embedEnabled/restEnabled` — `AgentRecord` has these. Stash `agent` on `request.widgetAgent` as today.
- **Verify shape compatibility** (the guard stashes the doc for downstream): the widget-chat flow reads `agent.deploymentSettings.widget`, `agent.knowledgeBases`, `agent.createdBy`, `agent.isActive`, `agent.deploymentSettings.{embedEnabled,restEnabled}` — all present on `AgentRecord` (jsonb `deploymentSettings`, string[] `knowledgeBases`, string `createdBy`). Confirm no widget code reads `agent.agentType` as a populated object or `agent.tools` as ObjectIds; if it does, adapt (record has `agentType` as id string and `tools` as string[]).
- **widget-chat.module.ts**: remove the `Agent` `forFeature` (keep `AgentModule` import).

- [ ] **Step 1:** Apply edits; grep the widget-chat module for `.agentType`/`.tools`/`.skills`/`.connectors` off the widget agent doc and reconcile any populated-shape assumptions.
- [ ] **Step 2: Build** → succeeds.
- [ ] **Step 3:** `npx jest src/modules/widget-chat` → pass.
- [ ] **Step 4: Commit** — `refactor(widget-chat): repoint widget-token guard to AgentRepository`

---

## Task 7: Rewrite the conversation `taggedAgents` populate

**Files:** `conversation/services/conversation.service.ts`.

`getTaggedAgents()` (L669) currently `findById(convId).select('groupMeta.taggedAgents groupMeta.isGroup').populate('groupMeta.taggedAgents').lean()` then spreads each populated agent doc.

- Split into: (1) fetch the conversation WITHOUT populate — `.select('groupMeta.taggedAgents groupMeta.isGroup').lean()` — giving the `taggedAgents` id array; (2) `const agents = await this.agentService.findByIdsUnrestricted(taggedAgentIds.map(String));` (conversation already imports `AgentModule` via forwardRef; inject `AgentService`). Return the agents in the same envelope the callers expect.
- **Verify caller shape:** `findByIdsUnrestricted` returns `IAgentResponse` (`id`, `agentType: {id,name}`, `tools: string[]`, …). The old populate returned raw Agent docs. **Find every caller of `getTaggedAgents`** and confirm they read fields present on `IAgentResponse` (they mostly need `id`/`name`); adapt the return mapping if a caller depended on a raw field (e.g. `agentType` as ObjectId). This is the one place a field-shape change is possible — reconcile explicitly, do not assume.

- [ ] **Step 1:** Apply; inject `AgentService` (via `@Inject(forwardRef(() => AgentService))` if a cycle warning appears).
- [ ] **Step 2: Build** → succeeds.
- [ ] **Step 3:** `npx jest src/modules/conversation` (+ any conversation-v2 that calls getTaggedAgents) → pass.
- [ ] **Step 4: Commit** — `refactor(conversation): resolve tagged agents via AgentService instead of populate`

---

## Task 8: Repoint the agent-module-internal users (a2a-publish, permission guard, reconciler)

**Files:** `agent/services/a2a-publish.service.ts`, `agent/guards/agent-permission.guard.ts`, `agent/services/playbook-assistant-connector-reconciler.service.ts`. All are in `AgentModule` — inject `AgentRepository` directly (already available).

**a2a-publish.service.ts:**
- L90-100 publish `$set` → `await this.agentRepository.updateById(agentId, { a2aPublished: true, a2aAgentId, a2aAgentCardUrl, a2aApiKeyHeader, a2aPublishedAt });`
- L125-132 rotate → `updateById(agentId, { a2aApiKeyHeader, a2aAgentCardUrl });`
- L156-166 revoke `$set/$unset` → `updateById(agentId, { a2aPublished: false, a2aAgentId: null, a2aAgentCardUrl: null, a2aApiKeyHeader: null, a2aPublishedAt: null });` (null clears — parity with `$unset`).
- L190 `findById(agentId)` → `await this.agentRepository.findById(agentId)` (reads `isDefault`, `createdBy`, `llmModel`, `a2aPublished`, `a2aAgentId` — all on the record).

**agent-permission.guard.ts:**
- L61-65 `findById(id).select('createdBy isActive isDefault').lean()` → `const agent = await this.agentRepository.findById(agentId);` (reads `createdBy`, `isDefault`). Stash on `request.agentContext.agent` as today; downstream reads must tolerate `AgentRecord` (verify none depends on a populated `agentType`).

**playbook-assistant-connector-reconciler.service.ts** (feature-flagged; heaviest):
- L65 `find({agentType,isDefault,isActive}).limit(2)` → `const monoAgents = await this.agentRepository.findActiveDefaultsByType(monoType.id, 2);` (read `.length`, `[0].createdBy`, `[0].llmModel`).
- L106-132 upsert-by-slug → `const existing = await this.agentRepository.findBySlug({ slug: PLAYBOOK_ASSISTANT_AGENT_SLUG, isDefault: true }); const payload = { ...all $set fields..., agentTypeSlug: <resolve> }; if (existing) { await this.agentRepository.updateById(existing._id, payload); dedicatedAgentId = existing._id; } else { const id = new Types.ObjectId().toString(); await this.agentRepository.create({ id, ...payload, createdBy: sourceCreatedBy, isActive: true, isDefault: true, isDefaultForType: true }); dedicatedAgentId = id; }`.
- L134-137 scoped `updateMany` `$pull connectors + connectorActionSelections` where `_id≠dedicated` → `await this.agentRepository.pullConnectorFromAllExcept(connectorId, dedicatedAgentId);`
- L138-141 `find({instruction:/\[Playbook MCP\]/}).select('_id instruction')` → `const legacy = await this.agentRepository.findIdsByInstructionLike('%[Playbook MCP]%', dedicatedAgentId);`
- L143-148 `bulkWrite` instruction `$set` → `for (const a of legacy) { await this.agentRepository.updateById(a.id, { instruction: <stripped> }); }`

- [ ] **Step 1:** Apply all three files' edits.
- [ ] **Step 2: Build** → succeeds; grep `agent.service.ts` module dir for any remaining `@InjectModel(Agent.name)` — expect only `AgentModule`'s `forFeature` registration (removed in Plan 5) and `AgentShareService`'s `SharedAgent`.
- [ ] **Step 3:** `npx jest src/modules/agent` → pass (update the reconciler + a2a specs' agent-model mocks to `agentRepository`).
- [ ] **Step 4: Commit** — `refactor(agent): repoint a2a-publish, permission guard, and reconciler to AgentRepository`

---

## Task 9: Full verification

- [ ] **Step 1: Grep guard** — `grep -rn "InjectModel(Agent.name\|InjectModel(\s*Agent\.name" back/src` → the ONLY remaining hits should be `AgentModule`'s own `forFeature` array (a schema registration, not an injection) — i.e. **no service/guard injects the Agent model** anymore.
- [ ] **Step 2: Build** — `npm run build` → succeeds.
- [ ] **Step 3: Broad test pass** — `npx jest src/modules/agent src/modules/agent-type src/modules/postgres src/modules/tool src/modules/skill src/modules/workspace src/modules/governance src/modules/worky src/modules/humain-agent src/modules/widget-chat src/modules/conversation` → all pass.
- [ ] **Step 4: Live smoke (recommended).** Boot the app (or a standalone context) pointed at `agentstore` + Mongo and exercise: a tool delete (→ `agent_tools` rows drop), a widget-token check, and a governance scope overview — confirm no Mongo agent reads occur and behavior is intact.
- [ ] **Step 5: Commit** any fixups.

## Definition of Done (Plan 4)

- No service or guard injects `@InjectModel(Agent.name)`; all agent reads/writes flow through `AgentRepository`/`AgentService`.
- `AgentRepositoryModule` provides the repository globally; consumer modules no longer register the Agent schema.
- The conversation tagged-agents path and widget flow work against the Postgres-backed shapes.
- Full module test suite passes. Plan 5 can now remove the Agent Mongoose schema.

## Self-Review notes

- **Cycle avoidance:** `AgentRepositoryModule` is global and dependency-light, so tool/skill/workspace/governance/humain inject the repository without importing `AgentModule` (which would cycle through Tool/Skill/Connector).
- **Parity:** every consumer's read set is covered by `AgentRecord`; the two shape-sensitive spots (conversation `getTaggedAgents`, widget `request.widgetAgent`) get explicit verification steps rather than assumed compatibility.
- **New methods** are minimal and each has an integration test (Task 1).
- **Reconciler** is the heaviest and feature-flagged; its upsert-by-slug uses `findBySlug` + `create`/`updateById`, and its scoped pull + instruction rewrite use the two new methods.
- **Not in scope:** removing `forFeature([Agent])` from `AgentModule` and deleting `agent.schema.ts` — that is Plan 5, after this plan proves nothing injects the model.
