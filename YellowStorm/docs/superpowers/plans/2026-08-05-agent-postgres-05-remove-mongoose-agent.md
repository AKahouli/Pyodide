# Agent → PostgreSQL — Plan 5: Remove the Mongoose Agent Schema (Cutover)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Delete the Mongoose `Agent` schema and its last `forFeature([Agent])` registrations so MongoDB no longer defines or manages an `agents` collection. Postgres becomes the sole datastore for agents in every sense. Replace the two remaining `AgentDocument` type usages with datastore-agnostic types.

**Prerequisites (satisfied):** Plans 1–4 merged — no service injects `@InjectModel(Agent.name)`; all reads/writes go through `AgentRepository`/`AgentService`. Only 5 files still reference `agent.schema.ts`: `agent.module.ts`, `agent.service.ts`, `agent-permission.guard.ts`, `telegram.module.ts`, `whatsapp.module.ts`. `SharedAgent` stays Mongoose (agent sharing remains in Mongo, by design).

## Global Constraints
- `SharedAgent` schema/model is untouched.
- `agentContext.agent` is only read for `.isDefault` (present on `AgentRecord`), so retyping it to `AgentRecord` is safe.
- telegram/whatsapp never `.populate()` an agent — dropping their Agent `forFeature` is safe (their schemas keep the harmless `ref: 'Agent'` string).

---

## Task 1: Replace `AgentDocument` type usages

- [ ] `agent.service.ts`: change `toResponse`/`toStreamAgent` param types `AgentDocument | Record<string, unknown>` → `Record<string, unknown>`; remove `import { AgentDocument } from './schemas/agent.schema'`.
- [ ] `agent-permission.guard.ts`: `AgentContext.agent: AgentDocument` → `AgentRecord`; the three `agent as unknown as AgentDocument` casts → `agent`; swap `import { AgentDocument } …/agent.schema` for `import { AgentRecord } from '../repositories/agent-record.mapper'`.

## Task 2: Remove the `forFeature([Agent])` registrations
- [ ] `agent.module.ts`: drop `{ name: Agent.name, schema: AgentSchema }` (keep `SharedAgent`); remove the `Agent, AgentSchema` import.
- [ ] `telegram.module.ts`: same removal.
- [ ] `whatsapp.module.ts`: same removal.

## Task 3: Delete the schema file
- [ ] `git rm back/src/modules/agent/schemas/agent.schema.ts`.

## Task 4: Verify
- [ ] `grep -rn "agent/schemas/agent.schema\|from './schemas/agent.schema'\|from '../schemas/agent.schema'" back/src` → no matches (only `shared-agent.schema` remains, which is a different file).
- [ ] `npm run build` → succeeds.
- [ ] `npx jest src/modules/agent` → passes.
- [ ] **Live smoke:** with the app on `agentstore` + Mongo, exercise create → read → update → delete of an agent end-to-end (or a standalone repository round-trip against `agentstore`), confirming the row + junctions land in Postgres and nothing touches a Mongo `agents` collection.

## Definition of Done
- `agent.schema.ts` deleted; no `forFeature([Agent])` anywhere; build + agent tests green. MongoDB has no `agents` model. The migration is complete.
