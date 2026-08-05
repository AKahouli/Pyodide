# Agent Collection → PostgreSQL — Migration Design

**Date:** 2026-08-04
**Scope:** `back/` NestJS backend. Migrate the **`agents` collection only** from MongoDB/Mongoose to an app-owned PostgreSQL database, so other AI-related services can query agent data directly (no HTTP endpoints) and index it natively.
**Status:** Approved design. Implementation plan to follow.
**Related:** `2026-08-03-mongodb-to-postgresql-migration-feasibility.md` (full-migration feasibility study — this design is a scoped, surgical first slice, not the whole migration).

---

## 1. Goal & motivation

Move agent records into PostgreSQL so that **other AI services can read/join/index agent data directly at the database level** instead of going through backend endpoints. PostgreSQL also provides the indexing (b-tree, GIN, and later `tsvector`/`pgvector`) that MongoDB Community edition cannot.

This is deliberately **agent-only**. The rest of the system stays on MongoDB. Both datastores run side by side.

---

## 2. Why agent-only is feasible (the key findings)

The agent document is *not* isolated in the codebase, yet an agent-only migration is still clean — because of two concrete facts established during the study:

1. **The agent id is referenced by ~15 Mongo collections that are NOT moving** — `conversation`, `message`, `team`, `telegram` (×3), `whatsapp` (×2), `evaluation` (×2), `playbook`, `governance` (×3), `widget-chat` (×3), `worky` (×2), `shared-agent`. **Almost all of these only *store* the agent id and filter by it** (`find({ agent: id })`). Those keep working untouched **if and only if the agent's existing `ObjectId` value is preserved** as its PostgreSQL identity.

2. **Only ONE place in the entire codebase performs a cross-module `.populate()` of an agent reference**: `conversation.service.ts:673` (`populate('groupMeta.taggedAgents')`). This is the single read-path join that breaks and must be rewritten as an explicit fetch. Everything else that "joins" agents is inside the agent module itself.

The remaining coupling is the **9 external modules that inject the Mongoose agent model directly** (`@InjectModel(Agent.name)`) — a bounded, enumerable worklist (§6).

**Conclusion:** agent-only is doable precisely because (a) we preserve the ObjectId so 15 referrers are untouched, and (b) there is exactly one cross-datastore populate to rewrite.

---

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| **Scope** | `agents` collection only. `AgentType`, `SharedAgent`, teams, etc. stay in Mongo. |
| **Schema shape** | **Full relational** — junction tables for the reference arrays; jsonb only for non-relational config blobs. |
| **AgentType** | Stays in Mongo. Composed at the service layer. A denormalized `agent_type_slug` is added to the PG agent row so external readers need no Mongo hop. |
| **Cutover** | **Hard cutover — PostgreSQL becomes the sole source of truth.** One-time backfill, then remove the Agent Mongoose schema. No dual-write. |
| **ID strategy** | **Preserve the existing 24-char ObjectId hex** as the PG primary key (`text`). New agents generate an ObjectId-format string app-side so the 15 Mongo referrers stay valid without schema changes. |
| **ORM / migrations** | Drizzle ORM + `drizzle-kit` (matches the raw parameterized SQL already used in `memory-cards`; first-class `jsonb`; fills the current zero-migration-tooling gap). |
| **Environment** | Dev. No zero-downtime constraint. |

---

## 4. Target architecture

### 4.1 New `PostgresModule` (parallel to the Mongoose `DatabaseModule`)
A new `@Global()` module that stands up **Drizzle ORM over a `pg` pool**, mirroring the shape of the existing `modules/database/database.module.ts` but for PostgreSQL:
- Config in a new `config/postgres.config.ts` (host/port/db/user/password/pool sizing), validated in `config/config.schema.ts`.
- A connection/pool provider plus a Drizzle db instance exposed via an injectable token.
- `drizzle-kit` config for schema migrations (the app currently has **zero** migration tooling and **zero** `.sql` files — this establishes the template).
- The existing Mongoose `DatabaseModule` is **unchanged** and keeps serving every other collection. The app runs both datastores simultaneously.

### 4.2 Agent PostgreSQL schema (full relational)

**`agents`** (one row per agent):
- PK `id text` = existing ObjectId hex.
- Scalars: `name`, `slug`, `role`, `description`, `temperature`, `llm_model`, `instruction`, `ignore_pre_prompt`, `enable_temporary_child_agents`, `max_temporary_child_agents`, `is_default`, `is_active`, `is_default_for_type`, `created_by` (text — points at Mongo `User`), `created_at`, `updated_at`.
- A2A fields: `a2a_published`, `a2a_agent_id`, `a2a_agent_card_url`, `a2a_api_key_header`, `a2a_published_at`.
- `agent_type_id text` (opaque ref to Mongo `AgentType`) **and** denormalized `agent_type_slug text` for external readers.
- `guardrails jsonb`, `deployment_settings jsonb` (non-relational config blobs — nested booleans/strings/`widget` map).

**Junction tables** (compose the reference arrays; ref ids are `text` pointing at Mongo docs — **app-enforced, no DB FK** to Mongo-owned tables):
- `agent_tools (agent_id, tool_id)`
- `agent_skills (agent_id, skill_id)`
- `agent_disabled_skills (agent_id, skill_id)`
- `agent_connectors (agent_id, connector_id)`
- `agent_knowledge_bases (agent_id, workspace_id)`
- `agent_connector_actions (agent_id, connector_id, action_keys text[])` — models `connectorActionSelections`.

**FK note:** `agent_id` in every junction table has a real FK to `agents(id)` (`ON DELETE CASCADE`). The *other* side (tool/skill/connector/workspace/user/agent_type ids) has **no** DB FK because those rows live in Mongo; integrity there is app-enforced, exactly as it is today.

**Indexes** ported from `agent.schema.ts`:
- `(created_by, is_active)`, `(is_default, is_active)`, `(agent_type_id, created_by, is_default_for_type)`, `(agent_type_id, is_default, is_default_for_type)`.
- Unique `(name, created_by)`.
- The two **partial-unique slug indexes** → PG `CREATE UNIQUE INDEX ... WHERE ...`:
  - `(created_by, slug) WHERE is_default = false AND slug <> ''`
  - `(slug, is_default) WHERE is_default = true AND slug <> ''`

### 4.3 The decoupling seam: `AgentRepository`
- A Drizzle-backed **`AgentRepository`** inside the agent module is the single boundary to PG. It assembles the `agents` row + its junction rows back into the agent shape the app already expects (so `AgentService`'s public contract is preserved).
- `AgentService` depends on `AgentRepository` instead of `@InjectModel(Agent.name)`.
- The `slug` derivation, defaults, and `toJSON`-style `id` mapping currently living in the Mongoose schema move into the repository/service layer.

---

## 5. Cross-datastore read handling

| Site | Today | After |
|---|---|---|
| `conversation.service.ts:673` | `.populate('groupMeta.taggedAgents')` | Explicit `AgentService.findByIds(taggedAgentIds)` batch fetch, merged in code. **The only populate rewrite.** |
| `agent.service` internal reads | `.populate('agentType', 'name skills')` | agentType lives in Mongo → compose at the service layer via the already-imported `AgentTypeService` (fetch name + skills). Write `agent_type_slug` on save. |
| All other `ref: 'Agent'` fields (15 schemas) | store + filter by id | **Unchanged** — ids preserved, filters still match. |

---

## 6. Decoupling worklist — external consumers of the agent model

These modules currently `@InjectModel(Agent.name)` and must switch to depending on `AgentService` (or a narrow read port it exports), with their `MongooseModule.forFeature([Agent])` registrations removed:

1. `worky/services/worky-stream.service.ts`
2. `worky/services/worky-ephemeral-worker.service.ts`
3. `tool/tool.service.ts`
4. `humain-agent/humain-agent.service.ts`
5. `governance/services/governance-consumer-scope.service.ts`
6. `governance/services/governed-conversation.service.ts`
7. `governance/services/governance-scope-overview.service.ts`
8. `workspace/workspace.service.ts`
9. `skill/skill.service.ts`
10. `widget-chat/guards/widget-token.guard.ts`

Inside the agent module, these also move off the Mongoose model onto the repository: `agent.service.ts`, `guards/agent-permission.guard.ts`, `services/a2a-publish.service.ts`, `services/playbook-assistant-connector-reconciler.service.ts`.

> Each consumer must be checked for whether `AgentService` already exposes the read it needs (by-id, by-ids, by-createdBy, filters). Any missing read becomes a new repository method. This is the main volume of the work.

---

## 7. Cutover plan (hard, PG is source of truth)

1. Stand up `PostgresModule` + Drizzle schema + `drizzle-kit` migration (creates `agents` + junction tables + indexes).
2. **Backfill script** (one-time): read every Mongo `agents` doc → insert PG `agents` (preserve `_id` → text PK) → explode `tools/skills/disabledSkills/connectors/knowledgeBases` into junction rows → move `guardrails`/`deploymentSettings` to jsonb → resolve `agent_type_slug` from the referenced AgentType.
3. Introduce `AgentRepository`; repoint `AgentService` and the §6 consumers; rewrite the one conversation populate.
4. Verify (counts match; agent read/write endpoints and the §6 consumers pass tests).
5. **Remove** the Agent Mongoose schema, its `forFeature` registrations, and dead Mongoose agent code. PG is now the sole source of truth.

New agents continue to be created with an ObjectId-format string id so Mongo `ref: 'Agent'` fields remain storable.

---

## 8. What else must migrate? **Nothing.**

Agent-only is the complete scope:
- **AgentType** — stays in Mongo, composed at the service layer; slug denormalized onto the agent row.
- **SharedAgent / agent sharing** — stays in Mongo (external readers don't need sharing/ACL logic).
- **Teams, conversation, governance, telegram, whatsapp, widget-chat, worky, evaluation, playbook** — stay in Mongo; they keep referencing agents by the preserved ObjectId.

No other collection is *required* to move for the agent migration to be correct.

---

## 9. Risks & mitigations

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | No FK enforcement on agent→(tool/skill/connector/workspace/user) — they live in Mongo | Medium | Same as today (Mongo never enforced these); keep app-level checks. Junction `agent_id` side keeps a real FK. |
| R2 | Backfill hits orphaned refs (ids pointing at deleted Mongo docs) | Medium | Backfill tolerates missing referents (store the id anyway; no cross-DB FK to violate). Log orphans. |
| R3 | A consumer needs an agent read not yet on `AgentService` | Medium | Enumerate per §6 consumer up front; add repository methods before repointing. |
| R4 | New-id format drift (uuid would break Mongo `Types.ObjectId` referrers) | High if ignored | **Locked:** keep generating ObjectId-format string ids. |
| R5 | Two write paths during transition create drift | Low | Hard cutover — no dual-write window; PG is truth immediately after backfill+repoint. |
| R6 | agent.service loses `agentType` populate | Low | Compose via already-imported `AgentTypeService`; denormalized slug covers external readers. |

---

## 10. Open items for the implementation plan

1. Exact `PostgresModule` provider/token shape and how `drizzle-kit` config + migration scripts are wired into the repo (`package.json` scripts, CI test DB).
2. Whether `AgentService` exposes one broad read port or several narrow methods to the §6 consumers.
3. Backfill script location, idempotency, and orphan-logging format.
4. Whether `guardrails`/`deployment_settings` need any promoted query columns now or stay pure jsonb until a reader demands otherwise.

---

*Design approved 2026-08-04. Next step: implementation plan (writing-plans).*
