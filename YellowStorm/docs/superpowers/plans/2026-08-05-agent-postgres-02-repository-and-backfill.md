# Agent → PostgreSQL — Plan 2: AgentRepository + Backfill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Drizzle-backed `AgentRepository` that returns records shaped exactly like the current Mongoose lean agent doc (so `AgentService`'s existing mappers work unchanged in Plan 3), plus a one-time Mongo→PG backfill script. Nothing in `AgentService` is repointed yet — that is Plan 3.

**Architecture:** A pure `rowToRecord` mapper reconstructs a lean-doc-shaped `AgentRecord` from an `agents` row + its junction rows. `AgentRepository` wraps the injected Drizzle db (`DRIZZLE_DB` from Plan 1's global `PostgresModule`) and exposes read/write/junction operations mapped 1:1 from `AgentService`'s current `agentModel` calls and the external consumers'. A standalone `ts-node` backfill script copies every Mongo `agents` doc into Postgres, preserving `_id`.

**Tech Stack:** NestJS 10, Drizzle ORM 0.45 (node-postgres), `pg` 8.22, Mongoose 8 (read side of backfill), Jest + ts-jest. Integration tests run against a **real Postgres** (`agentstore`).

## Global Constraints

- **IDs preserved:** every id is a Mongo ObjectId 24-hex string. `create()` requires the caller to supply `id` (Plan 3 generates a fresh `new Types.ObjectId().toString()`; backfill passes the existing `_id`). Never auto-generate uuids.
- **Record shape = Mongo lean doc.** `AgentRecord` uses the *Mongo* field names, notably `agentType` (id string), `llmModel`, and the snake_case `enable_temporary_child_agents` / `max_temporary_child_agents`, plus `connectorActionSelections: [{ connector: string, actionKeys: string[] }]`. This is what `AgentService.toResponse`/`toStreamAgent` read via `d.<field>`.
- **`agentType` is NOT resolved here.** The record carries `agentType` as the raw id string; Plan 3 hydrates name/slug/skills from Mongo. The repository does write the denormalized `agentTypeSlug` column from `create`/`update` input.
- **Credentials only via env.** Integration tests and the backfill read `POSTGRES_*` / `MONGODB_URI` from `back/.env` (gitignored) or the environment. No credentials in any committed file. Integration suites **skip** (not fail) when `POSTGRES_HOST` is unset.
- **Test isolation:** integration tests create rows with unique ids and delete exactly those ids in `afterEach` (agent-id FK cascade cleans junctions). No `TRUNCATE` of shared tables.
- **Transactions:** multi-table writes (`create`, `updateById`) run inside `db.transaction(...)`.
- **Path aliases:** `@modules/*`, `@common/*`, `@config/*` as configured in `package.json` jest `moduleNameMapper`.

## Prerequisites (already satisfied in this branch)

- Plan 1 merged: `PostgresModule`, `DRIZZLE_DB` token, Drizzle schema (`agents` + 6 junction tables), migration applied to `agentstore`.
- `back/.env` contains `POSTGRES_HOST/PORT/USER/PASSWORD/DB` pointing at `agentstore`, and `MONGODB_URI`.

---

## File Structure (this plan)

- `back/src/modules/agent/repositories/agent-record.mapper.ts` — **Create.** `AgentRecord` type + pure `rowToRecord` / input-builder helpers.
- `back/src/modules/agent/repositories/agent-record.mapper.spec.ts` — **Create.** Pure unit tests.
- `back/src/modules/agent/repositories/agent.repository.ts` — **Create.** The Drizzle-backed repository.
- `back/src/modules/agent/repositories/agent.repository.spec.ts` — **Create.** Integration tests (real PG, env-gated).
- `back/test/pg-integration.ts` — **Create.** Shared harness: load `.env`, build a Drizzle db from `POSTGRES_*`, `describeIntegration` gate, row-cleanup helper. (Placed under `back/test/` so it is not itself test-collected; imported by specs. Jest `rootDir` is `src`, so also acceptable to place at `src/modules/postgres/testing/pg-integration.ts` — use that path to stay within rootDir. **This plan uses `src/modules/postgres/testing/pg-integration.ts`.**)
- `back/src/modules/agent/agent.module.ts` — **Modify.** Provide + export `AgentRepository`.
- `back/scripts/backfill-agents-to-postgres.ts` — **Create.** One-time Mongo→PG backfill.
- `back/package.json` — **Modify.** Add `backfill:agents` script.

---

## Task 1: Postgres integration-test harness

**Files:**
- Create: `back/src/modules/postgres/testing/pg-integration.ts`

**Interfaces:**
- Produces:
  - `pgAvailable(): boolean` — true when `POSTGRES_HOST` is set (after loading `.env`).
  - `describeIntegration` — `describe` when available, else `describe.skip`.
  - `makeTestDb(): { db: NodePgDatabase<typeof schema>; pool: Pool; close(): Promise<void> }`.
  - `deleteAgents(db, ids: string[]): Promise<void>` — deletes agent rows by id (cascades junctions).

- [ ] **Step 1: Create the harness**

```typescript
import * as path from 'path';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../schema';

// Load back/.env (cwd is back/ when jest runs) so POSTGRES_* are visible.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export function pgAvailable(): boolean {
  return Boolean(process.env.POSTGRES_HOST);
}

export const describeIntegration: jest.Describe = pgAvailable() ? describe : describe.skip;

export function makeTestDb(): { db: NodePgDatabase<typeof schema>; pool: Pool; close: () => Promise<void> } {
  const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 3,
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

export async function deleteAgents(db: NodePgDatabase<typeof schema>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(schema.agents).where(inArray(schema.agents.id, ids));
}
```

- [ ] **Step 2: Sanity-check the harness compiles and gating works**

Add a temporary probe spec is unnecessary; the harness is exercised by Task 3. Instead verify it type-checks: `npx tsc --noEmit -p tsconfig.json` (or rely on the Task 3 run). Expected: no TS errors from this file.

- [ ] **Step 3: Commit**

```bash
git add back/src/modules/postgres/testing/pg-integration.ts
git commit -m "test(postgres): add env-gated integration-test harness"
```

---

## Task 2: AgentRecord type + pure mapper

**Files:**
- Create: `back/src/modules/agent/repositories/agent-record.mapper.ts`
- Test: `back/src/modules/agent/repositories/agent-record.mapper.spec.ts`

**Interfaces:**
- Produces:
  - `interface AgentRecord` — the lean-doc shape (see below).
  - `interface AgentJunctions { tools: string[]; skills: string[]; disabledSkills: string[]; connectors: string[]; knowledgeBases: string[]; connectorActions: Array<{ connectorId: string; actionKeys: string[] }> }`.
  - `type AgentRow = typeof agents.$inferSelect`.
  - `rowToRecord(row: AgentRow, junctions: AgentJunctions): AgentRecord` — pure.
  - `trim24(v: string): string` — trims `char(24)` padding (Postgres `char` right-pads; guard against it).

- [ ] **Step 1: Write the failing test**

```typescript
import { rowToRecord, AgentJunctions } from './agent-record.mapper';
import type { agents } from '../../postgres/schema';

type Row = typeof agents.$inferSelect;

function baseRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 'a'.repeat(24),
    name: 'Sales Bot',
    slug: 'sales-bot',
    role: 'Sell things',
    description: 'desc',
    temperature: 0.5,
    llmModel: 'gpt-x',
    email: 'a@b.co',
    instruction: 'do it',
    ignorePrePrompt: false,
    agentTypeId: 'b'.repeat(24),
    agentTypeSlug: 'mono-agent',
    enableTemporaryChildAgents: true,
    maxTemporaryChildAgents: 3,
    isDefault: false,
    isActive: true,
    isDefaultForType: false,
    createdBy: 'c'.repeat(24),
    guardrails: { promptInjection: { inputGuardrailEnabled: true } },
    deploymentSettings: { embedEnabled: true, restEnabled: false, widget: null },
    a2aPublished: false,
    a2aAgentId: null,
    a2aAgentCardUrl: null,
    a2aApiKeyHeader: null,
    a2aPublishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  } as Row;
}

const emptyJunctions: AgentJunctions = {
  tools: [], skills: [], disabledSkills: [], connectors: [], knowledgeBases: [], connectorActions: [],
};

describe('rowToRecord', () => {
  it('maps db row + junctions to a Mongo-lean-doc-shaped record', () => {
    const rec = rowToRecord(baseRow(), {
      ...emptyJunctions,
      tools: ['t'.repeat(24)],
      skills: ['s'.repeat(24)],
      disabledSkills: ['d'.repeat(24)],
      connectors: ['x'.repeat(24)],
      knowledgeBases: ['w'.repeat(24)],
      connectorActions: [{ connectorId: 'x'.repeat(24), actionKeys: ['send'] }],
    });

    expect(rec._id).toBe('a'.repeat(24));
    expect(rec.agentType).toBe('b'.repeat(24)); // id string, NOT populated
    expect(rec.agentTypeSlug).toBe('mono-agent');
    expect(rec.llmModel).toBe('gpt-x');
    expect(rec.tools).toEqual(['t'.repeat(24)]);
    expect(rec.skills).toEqual(['s'.repeat(24)]);
    expect(rec.disabledSkills).toEqual(['d'.repeat(24)]);
    expect(rec.connectors).toEqual(['x'.repeat(24)]);
    expect(rec.knowledgeBases).toEqual(['w'.repeat(24)]);
    expect(rec.connectorActionSelections).toEqual([{ connector: 'x'.repeat(24), actionKeys: ['send'] }]);
    // Mongo-style field names preserved for the existing mappers:
    expect(rec.enable_temporary_child_agents).toBe(true);
    expect(rec.max_temporary_child_agents).toBe(3);
    expect(rec.createdAt).toEqual(new Date('2026-01-01T00:00:00Z'));
  });

  it('trims char(24) right-padding on ids', () => {
    const rec = rowToRecord(baseRow({ id: ('a'.repeat(24) + '      ') as any }), emptyJunctions);
    expect(rec._id).toBe('a'.repeat(24));
  });

  it('defaults optional/nullable fields safely', () => {
    const rec = rowToRecord(baseRow({ llmModel: null, email: null, guardrails: {}, deploymentSettings: {} }), emptyJunctions);
    expect(rec.llmModel).toBeUndefined();
    expect(rec.email).toBeUndefined();
    expect(rec.tools).toEqual([]);
    expect(rec.a2aPublished).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/agent/repositories/agent-record.mapper.spec.ts`
Expected: FAIL — cannot find module `./agent-record.mapper`.

- [ ] **Step 3: Create the mapper**

```typescript
import type { agents } from '../../postgres/schema';

export type AgentRow = typeof agents.$inferSelect;

export interface AgentJunctions {
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  knowledgeBases: string[];
  connectorActions: Array<{ connectorId: string; actionKeys: string[] }>;
}

export interface AgentRecord {
  _id: string;
  name: string;
  slug: string;
  agentType: string;
  agentTypeSlug: string;
  role: string;
  description: string;
  temperature: number;
  llmModel?: string;
  email?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  connectorActionSelections: Array<{ connector: string; actionKeys: string[] }>;
  guardrails: Record<string, unknown>;
  deploymentSettings: Record<string, unknown>;
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
  isDefault: boolean;
  isActive: boolean;
  isDefaultForType: boolean;
  createdBy: string;
  a2aPublished: boolean;
  a2aAgentId?: string;
  a2aAgentCardUrl?: string;
  a2aApiKeyHeader?: string;
  a2aPublishedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** Postgres `char(n)` right-pads with spaces; trim so ids compare equal to Mongo hex. */
export function trim24(v: string): string {
  return typeof v === 'string' ? v.trim() : v;
}

export function rowToRecord(row: AgentRow, j: AgentJunctions): AgentRecord {
  return {
    _id: trim24(row.id),
    name: row.name,
    slug: row.slug,
    agentType: trim24(row.agentTypeId),
    agentTypeSlug: row.agentTypeSlug,
    role: row.role,
    description: row.description,
    temperature: row.temperature,
    llmModel: row.llmModel ?? undefined,
    email: row.email ?? undefined,
    instruction: row.instruction,
    ignorePrePrompt: row.ignorePrePrompt,
    knowledgeBases: j.knowledgeBases.map(trim24),
    tools: j.tools.map(trim24),
    skills: j.skills.map(trim24),
    disabledSkills: j.disabledSkills.map(trim24),
    connectors: j.connectors.map(trim24),
    connectorActionSelections: j.connectorActions.map((a) => ({
      connector: trim24(a.connectorId),
      actionKeys: a.actionKeys,
    })),
    guardrails: (row.guardrails as Record<string, unknown>) ?? {},
    deploymentSettings: (row.deploymentSettings as Record<string, unknown>) ?? {},
    enable_temporary_child_agents: row.enableTemporaryChildAgents,
    max_temporary_child_agents: row.maxTemporaryChildAgents,
    isDefault: row.isDefault,
    isActive: row.isActive,
    isDefaultForType: row.isDefaultForType,
    createdBy: trim24(row.createdBy),
    a2aPublished: row.a2aPublished,
    a2aAgentId: row.a2aAgentId ?? undefined,
    a2aAgentCardUrl: row.a2aAgentCardUrl ?? undefined,
    a2aApiKeyHeader: row.a2aApiKeyHeader ?? undefined,
    a2aPublishedAt: row.a2aPublishedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/agent/repositories/agent-record.mapper.spec.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent/repositories/agent-record.mapper.ts back/src/modules/agent/repositories/agent-record.mapper.spec.ts
git commit -m "feat(agent): add AgentRecord type and pure rowToRecord mapper"
```

---

## Task 3: Repository scaffold — `create` + `findById` + junction assembly + wiring

**Files:**
- Create: `back/src/modules/agent/repositories/agent.repository.ts`
- Create: `back/src/modules/agent/repositories/agent.repository.spec.ts`
- Modify: `back/src/modules/agent/agent.module.ts`

**Interfaces:**
- Consumes: `DRIZZLE_DB` (Plan 1), schema tables, `rowToRecord` (Task 2), the harness (Task 1).
- Produces on `AgentRepository`:
  - `create(input: CreateAgentInput): Promise<AgentRecord>`
  - `findById(id: string): Promise<AgentRecord | null>`
  - `CreateAgentInput` (exported) — see code.
  - private `loadJunctions(ids: string[]): Promise<Map<string, AgentJunctions>>` and `assemble(rows): Promise<AgentRecord[]>`.

- [ ] **Step 1: Write the failing integration test**

```typescript
import { Types } from 'mongoose';
import { AgentRepository, CreateAgentInput } from './agent.repository';
import { describeIntegration, makeTestDb, deleteAgents } from '../../postgres/testing/pg-integration';

const oid = () => new Types.ObjectId().toString();

function createInput(over: Partial<CreateAgentInput> = {}): CreateAgentInput {
  return {
    id: oid(),
    name: `Agent ${oid().slice(-6)}`,
    slug: `agent-${oid().slice(-6)}`,
    agentType: oid(),
    agentTypeSlug: 'mono-agent',
    role: 'role text',
    description: '',
    temperature: 0,
    instruction: '',
    ignorePrePrompt: false,
    knowledgeBases: [],
    tools: [],
    skills: [],
    disabledSkills: [],
    connectors: [],
    connectorActionSelections: [],
    guardrails: {},
    deploymentSettings: {},
    enable_temporary_child_agents: false,
    max_temporary_child_agents: 4,
    isDefault: false,
    isActive: true,
    isDefaultForType: false,
    createdBy: oid(),
    ...over,
  };
}

describeIntegration('AgentRepository create/findById (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as any);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('creates an agent with junctions and reads it back in lean-doc shape', async () => {
    const toolId = oid(); const skillId = oid(); const connectorId = oid(); const wsId = oid();
    const input = createInput({
      tools: [toolId], skills: [skillId], connectors: [connectorId], knowledgeBases: [wsId],
      connectorActionSelections: [{ connectorId, actionKeys: ['send', 'list'] }],
      guardrails: { promptInjection: { inputGuardrailEnabled: true } },
    });
    created.push(input.id);

    const rec = await repo.create(input);
    expect(rec._id).toBe(input.id);
    expect(rec.tools).toEqual([toolId]);
    expect(rec.connectorActionSelections).toEqual([{ connector: connectorId, actionKeys: ['send', 'list'] }]);

    const fetched = await repo.findById(input.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.agentType).toBe(input.agentType);
    expect(fetched!.skills).toEqual([skillId]);
    expect(fetched!.knowledgeBases).toEqual([wsId]);
    expect(fetched!.guardrails).toEqual({ promptInjection: { inputGuardrailEnabled: true } });
  });

  it('findById returns null for a missing id', async () => {
    expect(await repo.findById(oid())).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts`
Expected: FAIL — cannot find module `./agent.repository`. (If `POSTGRES_HOST` were unset the suite would skip; here `.env` provides it.)

- [ ] **Step 3: Create the repository (scaffold + create + findById)**

```typescript
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '../../postgres';
import * as schema from '../../postgres/schema';
import { AgentRecord, AgentJunctions, rowToRecord, trim24 } from './agent-record.mapper';

const {
  agents, agentTools, agentSkills, agentDisabledSkills,
  agentConnectors, agentKnowledgeBases, agentConnectorActions,
} = schema;

export interface CreateAgentInput {
  id: string;
  name: string;
  slug: string;
  agentType: string;
  agentTypeSlug: string;
  role: string;
  description: string;
  temperature: number;
  llmModel?: string;
  email?: string;
  instruction: string;
  ignorePrePrompt: boolean;
  knowledgeBases: string[];
  tools: string[];
  skills: string[];
  disabledSkills: string[];
  connectors: string[];
  connectorActionSelections: Array<{ connectorId: string; actionKeys: string[] }>;
  guardrails: Record<string, unknown>;
  deploymentSettings: Record<string, unknown>;
  enable_temporary_child_agents: boolean;
  max_temporary_child_agents: number;
  isDefault: boolean;
  isActive: boolean;
  isDefaultForType: boolean;
  createdBy: string;
  a2aPublished?: boolean;
  a2aAgentId?: string | null;
  a2aAgentCardUrl?: string | null;
  a2aApiKeyHeader?: string | null;
  a2aPublishedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

@Injectable()
export class AgentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async create(input: CreateAgentInput): Promise<AgentRecord> {
    await this.db.transaction(async (tx) => {
      await tx.insert(agents).values({
        id: input.id,
        name: input.name,
        slug: input.slug,
        role: input.role,
        description: input.description,
        temperature: input.temperature,
        llmModel: input.llmModel ?? null,
        email: input.email ?? null,
        instruction: input.instruction,
        ignorePrePrompt: input.ignorePrePrompt,
        agentTypeId: input.agentType,
        agentTypeSlug: input.agentTypeSlug,
        enableTemporaryChildAgents: input.enable_temporary_child_agents,
        maxTemporaryChildAgents: input.max_temporary_child_agents,
        isDefault: input.isDefault,
        isActive: input.isActive,
        isDefaultForType: input.isDefaultForType,
        createdBy: input.createdBy,
        guardrails: input.guardrails,
        deploymentSettings: input.deploymentSettings,
        a2aPublished: input.a2aPublished ?? false,
        a2aAgentId: input.a2aAgentId ?? null,
        a2aAgentCardUrl: input.a2aAgentCardUrl ?? null,
        a2aApiKeyHeader: input.a2aApiKeyHeader ?? null,
        a2aPublishedAt: input.a2aPublishedAt ?? null,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
      });
      await this.insertJunctions(tx, input.id, input);
    });
    const rec = await this.findById(input.id);
    if (!rec) throw new Error(`AgentRepository.create: row ${input.id} not found after insert`);
    return rec;
  }

  async findById(id: string): Promise<AgentRecord | null> {
    const rows = await this.db.select().from(agents).where(eq(agents.id, id)).limit(1);
    if (rows.length === 0) return null;
    const [rec] = await this.assemble(rows);
    return rec;
  }

  // ---- internals ----

  private async insertJunctions(
    tx: NodePgDatabase<typeof schema>,
    agentId: string,
    j: Pick<CreateAgentInput, 'tools' | 'skills' | 'disabledSkills' | 'connectors' | 'knowledgeBases' | 'connectorActionSelections'>,
  ): Promise<void> {
    if (j.tools.length) await tx.insert(agentTools).values(dedupe(j.tools).map((toolId) => ({ agentId, toolId })));
    if (j.skills.length) await tx.insert(agentSkills).values(dedupe(j.skills).map((skillId) => ({ agentId, skillId })));
    if (j.disabledSkills.length) await tx.insert(agentDisabledSkills).values(dedupe(j.disabledSkills).map((skillId) => ({ agentId, skillId })));
    if (j.connectors.length) await tx.insert(agentConnectors).values(dedupe(j.connectors).map((connectorId) => ({ agentId, connectorId })));
    if (j.knowledgeBases.length) await tx.insert(agentKnowledgeBases).values(dedupe(j.knowledgeBases).map((workspaceId) => ({ agentId, workspaceId })));
    const actions = (j.connectorActionSelections || []).filter((a) => a.connectorId && a.actionKeys?.length);
    if (actions.length) {
      await tx.insert(agentConnectorActions).values(actions.map((a) => ({ agentId, connectorId: a.connectorId, actionKeys: a.actionKeys })));
    }
  }

  private async assemble(rows: (typeof agents.$inferSelect)[]): Promise<AgentRecord[]> {
    const ids = rows.map((r) => trim24(r.id));
    const junctions = await this.loadJunctions(ids);
    return rows.map((r) => rowToRecord(r, junctions.get(trim24(r.id)) ?? emptyJunctions()));
  }

  private async loadJunctions(ids: string[]): Promise<Map<string, AgentJunctions>> {
    const map = new Map<string, AgentJunctions>();
    ids.forEach((id) => map.set(id, emptyJunctions()));
    if (ids.length === 0) return map;

    const [tools, skills, disabled, connectors, kbs, actions] = await Promise.all([
      this.db.select().from(agentTools).where(inArray(agentTools.agentId, ids)),
      this.db.select().from(agentSkills).where(inArray(agentSkills.agentId, ids)),
      this.db.select().from(agentDisabledSkills).where(inArray(agentDisabledSkills.agentId, ids)),
      this.db.select().from(agentConnectors).where(inArray(agentConnectors.agentId, ids)),
      this.db.select().from(agentKnowledgeBases).where(inArray(agentKnowledgeBases.agentId, ids)),
      this.db.select().from(agentConnectorActions).where(inArray(agentConnectorActions.agentId, ids)),
    ]);
    for (const t of tools) map.get(trim24(t.agentId))!.tools.push(trim24(t.toolId));
    for (const s of skills) map.get(trim24(s.agentId))!.skills.push(trim24(s.skillId));
    for (const d of disabled) map.get(trim24(d.agentId))!.disabledSkills.push(trim24(d.skillId));
    for (const c of connectors) map.get(trim24(c.agentId))!.connectors.push(trim24(c.connectorId));
    for (const w of kbs) map.get(trim24(w.agentId))!.knowledgeBases.push(trim24(w.workspaceId));
    for (const a of actions) map.get(trim24(a.agentId))!.connectorActions.push({ connectorId: trim24(a.connectorId), actionKeys: a.actionKeys });
    return map;
  }
}

function emptyJunctions(): AgentJunctions {
  return { tools: [], skills: [], disabledSkills: [], connectors: [], knowledgeBases: [], connectorActions: [] };
}
function dedupe(v: string[]): string[] {
  return [...new Set(v)];
}
```

> Drizzle typing note: `db.transaction`'s `tx` is a `PgTransaction`, structurally compatible with the `NodePgDatabase` methods used here. If TS complains, type the `tx` param as `any` in `insertJunctions` — the runtime behavior is identical.

- [ ] **Step 4: Run the integration test**

Run (env comes from `back/.env`): `npx jest src/modules/agent/repositories/agent.repository.spec.ts`
Expected: PASS (create roundtrip + null case). If it SKIPS, `POSTGRES_HOST` is not being loaded — confirm `back/.env` has it and you run jest from `back/`.

- [ ] **Step 5: Wire the repository into AgentModule**

In `back/src/modules/agent/agent.module.ts`, add `AgentRepository` to `providers` and `exports` (import from `./repositories/agent.repository`). It resolves `DRIZZLE_DB` from the global `PostgresModule` — no import change needed. This does not yet change any `AgentService` behavior.

- [ ] **Step 6: Verify build + module still constructs**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/agent/repositories/agent.repository.ts back/src/modules/agent/repositories/agent.repository.spec.ts back/src/modules/agent/agent.module.ts
git commit -m "feat(agent): add AgentRepository with create/findById and wire into AgentModule"
```

---

## Task 4: Read & query methods

**Files:**
- Modify: `back/src/modules/agent/repositories/agent.repository.ts`
- Modify: `back/src/modules/agent/repositories/agent.repository.spec.ts`

**Interfaces (add to `AgentRepository`):**
- `listUserAgents(p: { userId: string; search?: string; agentType?: string; isActive?: boolean; page: number; limit: number }): Promise<{ items: AgentRecord[]; total: number }>` — filter `createdBy = userId AND isDefault = false`, `name ILIKE %search%`, optional `agentType`, `isActive`; sort `createdAt desc`; paginate.
- `listDefaultAgents(p: { search?; agentType?; isActive?; page; limit }): Promise<{ items; total }>` — `isDefault = true` + same optional filters.
- `listHumainPublic(p: { agentTypeId: string; name?; role?; description?; page; limit }): Promise<{ items; total }>` — `agentType = agentTypeId` + ILIKE filters on name/role/description.
- `findForUser(userId: string): Promise<AgentRecord[]>` — `isActive = true AND ((createdBy = userId AND isDefault=false) OR isDefault=true)`, sort `isDefault desc, createdAt desc`.
- `findByIdsForUser(ids: string[], userId: string): Promise<AgentRecord[]>` — the same owner-or-default predicate, restricted to `id IN ids`, `isActive=true`.
- `findByIds(ids: string[], opts?: { activeOnly?: boolean }): Promise<AgentRecord[]>`.
- `findByIdDefault(id: string): Promise<AgentRecord | null>` — `id = id AND isDefault=true`.
- `findDefaultByType(agentTypeId: string): Promise<AgentRecord | null>` — `agentType=… AND isDefault=true AND isActive=true`.
- `findDefaultByNameActive(name: string): Promise<AgentRecord | null>` — `LOWER(name)=LOWER(name) AND isDefault=true AND isActive=true`.
- `findActiveDefaults(): Promise<AgentRecord[]>` — `isDefault=true AND isActive=true`, sort `name asc`.
- `existsActiveDefault(id: string): Promise<boolean>`.
- `findActiveDefaultIdBySlug(slug: string): Promise<string | null>`.
- `countByAgentType(agentTypeId: string): Promise<number>`.
- `findByNameAndOwner(name: string, userId: string): Promise<AgentRecord | null>`.
- `findByNameDefault(name: string): Promise<AgentRecord | null>` — `name=name AND isDefault=true`.
- `findBySlug(p: { slug: string; isDefault: boolean; userId?: string; excludeId?: string }): Promise<AgentRecord | null>`.
- `findByOwnerAndType(userId: string, agentTypeId: string): Promise<AgentRecord | null>`.

- [ ] **Step 1: Write failing integration tests (representative filters)**

Append to `agent.repository.spec.ts` a new `describeIntegration` block covering the behaviors most likely to break (not every method):

```typescript
import { AgentRepository, CreateAgentInput } from './agent.repository';
import { describeIntegration, makeTestDb, deleteAgents } from '../../postgres/testing/pg-integration';
import { Types } from 'mongoose';
const oid = () => new Types.ObjectId().toString();
// reuse createInput from Task 3 (extract it to a shared helper at top of the spec file)

describeIntegration('AgentRepository reads (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as any);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('findForUser returns the user\'s non-default active agents plus active defaults', async () => {
    const userId = oid();
    const mine = createInput({ createdBy: userId, isDefault: false, isActive: true, name: `mine-${oid().slice(-6)}` });
    const def = createInput({ isDefault: true, isActive: true, name: `def-${oid().slice(-6)}` });
    const otherUser = createInput({ createdBy: oid(), isDefault: false, isActive: true, name: `other-${oid().slice(-6)}` });
    const inactiveMine = createInput({ createdBy: userId, isDefault: false, isActive: false, name: `inact-${oid().slice(-6)}` });
    for (const i of [mine, def, otherUser, inactiveMine]) { created.push(i.id); await repo.create(i); }

    const result = await repo.findForUser(userId);
    const ids = result.map((r) => r._id);
    expect(ids).toContain(mine.id);
    expect(ids).toContain(def.id);
    expect(ids).not.toContain(otherUser.id);
    expect(ids).not.toContain(inactiveMine.id);
  });

  it('listUserAgents paginates and filters by case-insensitive name search', async () => {
    const userId = oid();
    const a = createInput({ createdBy: userId, name: `Zeta-${oid().slice(-6)}` });
    const b = createInput({ createdBy: userId, name: `Alpha-${oid().slice(-6)}` });
    for (const i of [a, b]) { created.push(i.id); await repo.create(i); }
    const page = await repo.listUserAgents({ userId, search: 'alpha', page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]._id).toBe(b.id);
  });

  it('findByNameAndOwner and findBySlug honor owner scoping and excludeId', async () => {
    const userId = oid();
    const slug = `slug-${oid().slice(-6)}`;
    const a = createInput({ createdBy: userId, slug, isDefault: false });
    created.push(a.id); await repo.create(a);
    expect((await repo.findByNameAndOwner(a.name, userId))!._id).toBe(a.id);
    expect(await repo.findByNameAndOwner(a.name, oid())).toBeNull();
    expect((await repo.findBySlug({ slug, isDefault: false, userId }))!._id).toBe(a.id);
    expect(await repo.findBySlug({ slug, isDefault: false, userId, excludeId: a.id })).toBeNull();
  });

  it('countByAgentType counts all agents of a type', async () => {
    const typeId = oid();
    const a = createInput({ agentType: typeId }); const b = createInput({ agentType: typeId });
    for (const i of [a, b]) { created.push(i.id); await repo.create(i); }
    expect(await repo.countByAgentType(typeId)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts -t reads`
Expected: FAIL — `repo.findForUser is not a function` (methods not yet added).

- [ ] **Step 3: Implement the read methods**

Add these imports at the top of `agent.repository.ts`: `import { and, eq, inArray, or, desc, asc, ilike, sql, count } from 'drizzle-orm';` (extend the existing import). Then add the methods to the class:

```typescript
  async listUserAgents(p: { userId: string; search?: string; agentType?: string; isActive?: boolean; page: number; limit: number }) {
    const conds = [eq(agents.createdBy, p.userId), eq(agents.isDefault, false)];
    if (p.search) conds.push(ilike(agents.name, `%${p.search}%`));
    if (p.agentType) conds.push(eq(agents.agentTypeId, p.agentType));
    if (p.isActive !== undefined) conds.push(eq(agents.isActive, p.isActive));
    return this.paginate(and(...conds), p.page, p.limit);
  }

  async listDefaultAgents(p: { search?: string; agentType?: string; isActive?: boolean; page: number; limit: number }) {
    const conds = [eq(agents.isDefault, true)];
    if (p.search) conds.push(ilike(agents.name, `%${p.search}%`));
    if (p.agentType) conds.push(eq(agents.agentTypeId, p.agentType));
    if (p.isActive !== undefined) conds.push(eq(agents.isActive, p.isActive));
    return this.paginate(and(...conds), p.page, p.limit);
  }

  async listHumainPublic(p: { agentTypeId: string; name?: string; role?: string; description?: string; page: number; limit: number }) {
    const conds = [eq(agents.agentTypeId, p.agentTypeId)];
    if (p.name) conds.push(ilike(agents.name, `%${p.name}%`));
    if (p.role) conds.push(ilike(agents.role, `%${p.role}%`));
    if (p.description) conds.push(ilike(agents.description, `%${p.description}%`));
    return this.paginate(and(...conds), p.page, p.limit);
  }

  async findForUser(userId: string): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.isActive, true), or(and(eq(agents.createdBy, userId), eq(agents.isDefault, false)), eq(agents.isDefault, true))))
      .orderBy(desc(agents.isDefault), desc(agents.createdAt));
    return this.assemble(rows);
  }

  async findByIdsForUser(ids: string[], userId: string): Promise<AgentRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(agents)
      .where(and(inArray(agents.id, ids), eq(agents.isActive, true),
        or(and(eq(agents.createdBy, userId), eq(agents.isDefault, false)), eq(agents.isDefault, true))));
    return this.assemble(rows);
  }

  async findByIds(ids: string[], opts?: { activeOnly?: boolean }): Promise<AgentRecord[]> {
    if (ids.length === 0) return [];
    const conds = [inArray(agents.id, ids)];
    if (opts?.activeOnly) conds.push(eq(agents.isActive, true));
    const rows = await this.db.select().from(agents).where(and(...conds));
    return this.assemble(rows);
  }

  async findByIdDefault(id: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.id, id), eq(agents.isDefault, true)));
  }

  async findDefaultByType(agentTypeId: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.agentTypeId, agentTypeId), eq(agents.isDefault, true), eq(agents.isActive, true)));
  }

  async findDefaultByNameActive(name: string): Promise<AgentRecord | null> {
    return this.one(and(sql`lower(${agents.name}) = lower(${name})`, eq(agents.isDefault, true), eq(agents.isActive, true)));
  }

  async findActiveDefaults(): Promise<AgentRecord[]> {
    const rows = await this.db.select().from(agents)
      .where(and(eq(agents.isDefault, true), eq(agents.isActive, true))).orderBy(asc(agents.name));
    return this.assemble(rows);
  }

  async existsActiveDefault(id: string): Promise<boolean> {
    const rows = await this.db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.id, id), eq(agents.isDefault, true), eq(agents.isActive, true))).limit(1);
    return rows.length > 0;
  }

  async findActiveDefaultIdBySlug(slug: string): Promise<string | null> {
    const rows = await this.db.select({ id: agents.id }).from(agents)
      .where(and(eq(agents.slug, slug), eq(agents.isDefault, true), eq(agents.isActive, true))).limit(1);
    return rows.length ? trim24(rows[0].id) : null;
  }

  async countByAgentType(agentTypeId: string): Promise<number> {
    const rows = await this.db.select({ c: count() }).from(agents).where(eq(agents.agentTypeId, agentTypeId));
    return Number(rows[0].c);
  }

  async findByNameAndOwner(name: string, userId: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.name, name), eq(agents.createdBy, userId)));
  }

  async findByNameDefault(name: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.name, name), eq(agents.isDefault, true)));
  }

  async findBySlug(p: { slug: string; isDefault: boolean; userId?: string; excludeId?: string }): Promise<AgentRecord | null> {
    const conds = [eq(agents.slug, p.slug), eq(agents.isDefault, p.isDefault)];
    if (!p.isDefault && p.userId) conds.push(eq(agents.createdBy, p.userId));
    if (p.excludeId) conds.push(sql`${agents.id} <> ${p.excludeId}`);
    return this.one(and(...conds));
  }

  async findByOwnerAndType(userId: string, agentTypeId: string): Promise<AgentRecord | null> {
    return this.one(and(eq(agents.createdBy, userId), eq(agents.agentTypeId, agentTypeId)));
  }

  // ---- read helpers ----
  private async one(where: ReturnType<typeof and>): Promise<AgentRecord | null> {
    const rows = await this.db.select().from(agents).where(where).limit(1);
    if (rows.length === 0) return null;
    const [rec] = await this.assemble(rows);
    return rec;
  }

  private async paginate(where: ReturnType<typeof and>, page: number, limit: number): Promise<{ items: AgentRecord[]; total: number }> {
    const offset = (page - 1) * limit;
    const [rows, totalRows] = await Promise.all([
      this.db.select().from(agents).where(where).orderBy(desc(agents.createdAt)).limit(limit).offset(offset),
      this.db.select({ c: count() }).from(agents).where(where),
    ]);
    return { items: await this.assemble(rows), total: Number(totalRows[0].c) };
  }
```

- [ ] **Step 4: Run the read tests**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts`
Expected: PASS (Task 3 + the new reads block).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent/repositories/agent.repository.ts back/src/modules/agent/repositories/agent.repository.spec.ts
git commit -m "feat(agent): add AgentRepository read and query methods"
```

---

## Task 5: `updateById` (junction diffing) + `deleteById` + `clearDefaultForType`

**Files:**
- Modify: `back/src/modules/agent/repositories/agent.repository.ts`
- Modify: `back/src/modules/agent/repositories/agent.repository.spec.ts`

**Interfaces (add):**
- `updateById(id: string, patch: UpdateAgentInput): Promise<AgentRecord | null>` — updates provided scalar columns; for each array field **present** in `patch`, replaces that junction wholesale (delete-all-then-insert within a transaction); `updatedAt` bumped to `now()`. Returns the reassembled record, or null if the row is missing.
- `deleteById(id: string): Promise<void>` — deletes the agent row (junctions cascade).
- `clearDefaultForType(p: { agentTypeId: string; isPersonal: boolean; userId?: string; excludeId?: string }): Promise<void>` — sets `isDefaultForType=false` for matching rows (personal → `isDefault=false AND createdBy=userId`; admin → `isDefault=true`), excluding `excludeId`.
- `UpdateAgentInput` (exported): all `CreateAgentInput` scalar fields optional, plus optional `tools/skills/disabledSkills/connectors/knowledgeBases/connectorActionSelections` and `agentType`/`agentTypeSlug`.

- [ ] **Step 1: Write failing integration tests**

```typescript
describeIntegration('AgentRepository update/delete (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as any);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('updateById replaces provided junctions and updates scalars', async () => {
    const t1 = oid(), t2 = oid();
    const input = createInput({ tools: [t1], description: 'old' });
    created.push(input.id); await repo.create(input);

    const updated = await repo.updateById(input.id, { description: 'new', tools: [t2] });
    expect(updated!.description).toBe('new');
    expect(updated!.tools).toEqual([t2]); // replaced, not merged
  });

  it('updateById leaves junctions untouched when the array is omitted', async () => {
    const t1 = oid();
    const input = createInput({ tools: [t1] });
    created.push(input.id); await repo.create(input);
    const updated = await repo.updateById(input.id, { description: 'x' });
    expect(updated!.tools).toEqual([t1]);
  });

  it('deleteById removes the agent and cascades junctions', async () => {
    const input = createInput({ tools: [oid()] });
    created.push(input.id); await repo.create(input);
    await repo.deleteById(input.id);
    expect(await repo.findById(input.id)).toBeNull();
  });

  it('clearDefaultForType unsets the flag for the matching personal scope', async () => {
    const userId = oid(); const typeId = oid();
    const a = createInput({ createdBy: userId, agentType: typeId, isDefault: false, isDefaultForType: true });
    created.push(a.id); await repo.create(a);
    await repo.clearDefaultForType({ agentTypeId: typeId, isPersonal: true, userId });
    expect((await repo.findById(a.id))!.isDefaultForType).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts -t update`
Expected: FAIL — `repo.updateById is not a function`.

- [ ] **Step 3: Implement update/delete/clear**

Add `UpdateAgentInput` next to `CreateAgentInput`:

```typescript
export interface UpdateAgentInput {
  name?: string; slug?: string; agentType?: string; agentTypeSlug?: string; role?: string;
  description?: string; temperature?: number; llmModel?: string | null; email?: string | null;
  instruction?: string; ignorePrePrompt?: boolean;
  enable_temporary_child_agents?: boolean; max_temporary_child_agents?: number;
  isDefault?: boolean; isActive?: boolean; isDefaultForType?: boolean;
  a2aPublished?: boolean; a2aAgentId?: string | null; a2aAgentCardUrl?: string | null;
  a2aApiKeyHeader?: string | null; a2aPublishedAt?: Date | null;
  tools?: string[]; skills?: string[]; disabledSkills?: string[]; connectors?: string[];
  knowledgeBases?: string[]; connectorActionSelections?: Array<{ connectorId: string; actionKeys: string[] }>;
}
```

Add the methods:

```typescript
  async updateById(id: string, patch: UpdateAgentInput): Promise<AgentRecord | null> {
    const exists = await this.db.select({ id: agents.id }).from(agents).where(eq(agents.id, id)).limit(1);
    if (exists.length === 0) return null;

    await this.db.transaction(async (tx) => {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      const scalarMap: Array<[keyof UpdateAgentInput, string]> = [
        ['name', 'name'], ['slug', 'slug'], ['agentType', 'agentTypeId'], ['agentTypeSlug', 'agentTypeSlug'],
        ['role', 'role'], ['description', 'description'], ['temperature', 'temperature'], ['llmModel', 'llmModel'],
        ['email', 'email'], ['instruction', 'instruction'], ['ignorePrePrompt', 'ignorePrePrompt'],
        ['enable_temporary_child_agents', 'enableTemporaryChildAgents'], ['max_temporary_child_agents', 'maxTemporaryChildAgents'],
        ['isDefault', 'isDefault'], ['isActive', 'isActive'], ['isDefaultForType', 'isDefaultForType'],
        ['a2aPublished', 'a2aPublished'], ['a2aAgentId', 'a2aAgentId'], ['a2aAgentCardUrl', 'a2aAgentCardUrl'],
        ['a2aApiKeyHeader', 'a2aApiKeyHeader'], ['a2aPublishedAt', 'a2aPublishedAt'],
      ];
      for (const [inKey, col] of scalarMap) {
        if (patch[inKey] !== undefined) set[col] = patch[inKey];
      }
      await tx.update(agents).set(set).where(eq(agents.id, id));

      await this.replaceJunction(tx, id, patch);
    });
    return this.findById(id);
  }

  async deleteById(id: string): Promise<void> {
    await this.db.delete(agents).where(eq(agents.id, id));
  }

  async clearDefaultForType(p: { agentTypeId: string; isPersonal: boolean; userId?: string; excludeId?: string }): Promise<void> {
    const conds = [eq(agents.agentTypeId, p.agentTypeId), eq(agents.isDefaultForType, true)];
    if (p.isPersonal) { conds.push(eq(agents.isDefault, false)); if (p.userId) conds.push(eq(agents.createdBy, p.userId)); }
    else { conds.push(eq(agents.isDefault, true)); }
    if (p.excludeId) conds.push(sql`${agents.id} <> ${p.excludeId}`);
    await this.db.update(agents).set({ isDefaultForType: false }).where(and(...conds));
  }

  private async replaceJunction(tx: NodePgDatabase<typeof schema>, agentId: string, patch: UpdateAgentInput): Promise<void> {
    if (patch.tools !== undefined) {
      await tx.delete(agentTools).where(eq(agentTools.agentId, agentId));
      if (patch.tools.length) await tx.insert(agentTools).values(dedupe(patch.tools).map((toolId) => ({ agentId, toolId })));
    }
    if (patch.skills !== undefined) {
      await tx.delete(agentSkills).where(eq(agentSkills.agentId, agentId));
      if (patch.skills.length) await tx.insert(agentSkills).values(dedupe(patch.skills).map((skillId) => ({ agentId, skillId })));
    }
    if (patch.disabledSkills !== undefined) {
      await tx.delete(agentDisabledSkills).where(eq(agentDisabledSkills.agentId, agentId));
      if (patch.disabledSkills.length) await tx.insert(agentDisabledSkills).values(dedupe(patch.disabledSkills).map((skillId) => ({ agentId, skillId })));
    }
    if (patch.connectors !== undefined) {
      await tx.delete(agentConnectors).where(eq(agentConnectors.agentId, agentId));
      if (patch.connectors.length) await tx.insert(agentConnectors).values(dedupe(patch.connectors).map((connectorId) => ({ agentId, connectorId })));
    }
    if (patch.knowledgeBases !== undefined) {
      await tx.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.agentId, agentId));
      if (patch.knowledgeBases.length) await tx.insert(agentKnowledgeBases).values(dedupe(patch.knowledgeBases).map((workspaceId) => ({ agentId, workspaceId })));
    }
    if (patch.connectorActionSelections !== undefined) {
      await tx.delete(agentConnectorActions).where(eq(agentConnectorActions.agentId, agentId));
      const actions = patch.connectorActionSelections.filter((a) => a.connectorId && a.actionKeys?.length);
      if (actions.length) await tx.insert(agentConnectorActions).values(actions.map((a) => ({ agentId, connectorId: a.connectorId, actionKeys: a.actionKeys })));
    }
  }
```

- [ ] **Step 4: Run the update/delete tests**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent/repositories/agent.repository.ts back/src/modules/agent/repositories/agent.repository.spec.ts
git commit -m "feat(agent): add AgentRepository update, delete, and clearDefaultForType"
```

---

## Task 6: Junction `pull` operations (for the external consumers)

**Files:**
- Modify: `back/src/modules/agent/repositories/agent.repository.ts`
- Modify: `back/src/modules/agent/repositories/agent.repository.spec.ts`

**Interfaces (add):** each returns `Promise<void>` and removes a referenced id from ALL agents (replaces the Mongo `updateMany($pull)` in tool/skill/workspace services):
- `pullToolFromAll(toolId: string)` → `DELETE FROM agent_tools WHERE tool_id = $1`
- `pullSkillFromAll(skillId: string)` → `DELETE FROM agent_skills WHERE skill_id = $1`
- `pullDisabledSkillFromAll(skillId: string)` → `DELETE FROM agent_disabled_skills WHERE skill_id = $1`
- `pullKnowledgeBaseFromAll(workspaceId: string)` → `DELETE FROM agent_knowledge_bases WHERE workspace_id = $1`
- `pullConnectorFromAll(connectorId: string)` → deletes from `agent_connectors` AND `agent_connector_actions`

- [ ] **Step 1: Write failing integration test**

```typescript
describeIntegration('AgentRepository pull ops (integration)', () => {
  const { db, close } = makeTestDb();
  const repo = new AgentRepository(db as any);
  const created: string[] = [];
  afterEach(async () => { await deleteAgents(db, created.splice(0)); });
  afterAll(async () => { await close(); });

  it('pullToolFromAll removes the tool from every agent', async () => {
    const toolId = oid();
    const a = createInput({ tools: [toolId, oid()] });
    const b = createInput({ tools: [toolId] });
    for (const i of [a, b]) { created.push(i.id); await repo.create(i); }
    await repo.pullToolFromAll(toolId);
    expect((await repo.findById(a.id))!.tools).not.toContain(toolId);
    expect((await repo.findById(b.id))!.tools).toEqual([]);
  });

  it('pullSkillFromAll and pullDisabledSkillFromAll remove from both tables', async () => {
    const skillId = oid();
    const a = createInput({ skills: [skillId], disabledSkills: [skillId] });
    created.push(a.id); await repo.create(a);
    await repo.pullSkillFromAll(skillId);
    await repo.pullDisabledSkillFromAll(skillId);
    const rec = await repo.findById(a.id);
    expect(rec!.skills).toEqual([]);
    expect(rec!.disabledSkills).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts -t "pull ops"`
Expected: FAIL — `repo.pullToolFromAll is not a function`.

- [ ] **Step 3: Implement the pull methods**

```typescript
  async pullToolFromAll(toolId: string): Promise<void> {
    await this.db.delete(agentTools).where(eq(agentTools.toolId, toolId));
  }
  async pullSkillFromAll(skillId: string): Promise<void> {
    await this.db.delete(agentSkills).where(eq(agentSkills.skillId, skillId));
  }
  async pullDisabledSkillFromAll(skillId: string): Promise<void> {
    await this.db.delete(agentDisabledSkills).where(eq(agentDisabledSkills.skillId, skillId));
  }
  async pullKnowledgeBaseFromAll(workspaceId: string): Promise<void> {
    await this.db.delete(agentKnowledgeBases).where(eq(agentKnowledgeBases.workspaceId, workspaceId));
  }
  async pullConnectorFromAll(connectorId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(agentConnectors).where(eq(agentConnectors.connectorId, connectorId));
      await tx.delete(agentConnectorActions).where(eq(agentConnectorActions.connectorId, connectorId));
    });
  }
```

- [ ] **Step 4: Run the pull tests**

Run: `npx jest src/modules/agent/repositories/agent.repository.spec.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add back/src/modules/agent/repositories/agent.repository.ts back/src/modules/agent/repositories/agent.repository.spec.ts
git commit -m "feat(agent): add AgentRepository junction pull operations"
```

---

## Task 7: One-time Mongo→PG backfill script

**Files:**
- Create: `back/scripts/backfill-agents-to-postgres.ts`
- Modify: `back/package.json` (add `backfill:agents` script)

**Interfaces:**
- CLI: `npx ts-node back/scripts/backfill-agents-to-postgres.ts [--dry-run] [--batch-size=N]`
- Reads Mongo `agents` collection raw; for each doc, resolves `agentTypeSlug` from the `agent_types` collection; inserts into Postgres via `AgentRepository.create`, preserving `_id`, timestamps, and all arrays. Idempotent: skips docs whose id already exists in `agents`.

- [ ] **Step 1: Write the backfill script**

```typescript
/**
 * One-time backfill: copy every Mongo `agents` document into Postgres.
 * Usage: npx ts-node back/scripts/backfill-agents-to-postgres.ts --dry-run
 */
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/modules/postgres/schema';
import { AgentRepository, CreateAgentInput } from '../src/modules/agent/repositories/agent.repository';

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) throw new Error('MONGODB_URI is required');
const dryRun = process.argv.includes('--dry-run');
const batchSize = Number(process.argv.find((v) => v.startsWith('--batch-size='))?.split('=')[1] ?? '200');

const idStr = (v: unknown): string => (v == null ? '' : String(v));
const idArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(idStr).filter(Boolean) : []);

async function main(): Promise<void> {
  await mongoose.connect(mongoUri!);
  const mdb = mongoose.connection.db!;
  const agentsCol = mdb.collection('agents');
  const typesCol = mdb.collection('agent_types');

  const pool = new Pool({
    host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT || '5432'),
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB, max: 4,
  });
  const db = drizzle(pool, { schema });
  const repo = new AgentRepository(db as any);

  // Cache agent-type slugs.
  const typeSlug = new Map<string, string>();
  for await (const t of typesCol.find({})) typeSlug.set(idStr(t._id), idStr(t.slug));

  let processed = 0, skipped = 0, inserted = 0, orphanTypes = 0;
  for await (const doc of agentsCol.find({}).batchSize(batchSize)) {
    processed += 1;
    const id = idStr(doc._id);
    const existing = await db.select({ id: schema.agents.id }).from(schema.agents).where(inArray(schema.agents.id, [id]));
    if (existing.length) { skipped += 1; continue; }

    const agentTypeId = idStr(doc.agentType);
    const slug = typeSlug.get(agentTypeId) ?? '';
    if (!slug) orphanTypes += 1;

    const input: CreateAgentInput = {
      id,
      name: idStr(doc.name),
      slug: idStr(doc.slug),
      agentType: agentTypeId,
      agentTypeSlug: slug,
      role: idStr(doc.role),
      description: idStr(doc.description ?? ''),
      temperature: Number(doc.temperature ?? 0),
      llmModel: doc.llmModel ? idStr(doc.llmModel) : undefined,
      email: doc.email ? idStr(doc.email) : undefined,
      instruction: idStr(doc.instruction ?? ''),
      ignorePrePrompt: Boolean(doc.ignorePrePrompt),
      knowledgeBases: idArr(doc.knowledgeBases),
      tools: idArr(doc.tools),
      skills: idArr(doc.skills),
      disabledSkills: idArr(doc.disabledSkills),
      connectors: idArr(doc.connectors),
      connectorActionSelections: Array.isArray(doc.connectorActionSelections)
        ? doc.connectorActionSelections.map((s: any) => ({ connectorId: idStr(s.connector), actionKeys: Array.isArray(s.actionKeys) ? s.actionKeys.map(String) : [] }))
        : [],
      guardrails: (doc.guardrails as Record<string, unknown>) ?? {},
      deploymentSettings: (doc.deploymentSettings as Record<string, unknown>) ?? {},
      enable_temporary_child_agents: Boolean(doc.enable_temporary_child_agents),
      max_temporary_child_agents: Number(doc.max_temporary_child_agents ?? 4),
      isDefault: Boolean(doc.isDefault),
      isActive: doc.isActive === undefined ? true : Boolean(doc.isActive),
      isDefaultForType: Boolean(doc.isDefaultForType),
      createdBy: idStr(doc.createdBy),
      a2aPublished: Boolean(doc.a2aPublished),
      a2aAgentId: doc.a2aAgentId ? idStr(doc.a2aAgentId) : null,
      a2aAgentCardUrl: doc.a2aAgentCardUrl ? idStr(doc.a2aAgentCardUrl) : null,
      a2aApiKeyHeader: doc.a2aApiKeyHeader ? idStr(doc.a2aApiKeyHeader) : null,
      a2aPublishedAt: doc.a2aPublishedAt ? new Date(doc.a2aPublishedAt) : null,
      createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
      updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
    };

    if (!dryRun) { await repo.create(input); inserted += 1; }
  }

  console.log(JSON.stringify({ dryRun, processed, skipped, inserted, orphanTypes }, null, 2));
  await pool.end();
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `back/package.json` scripts, add:

```json
"backfill:agents": "ts-node scripts/backfill-agents-to-postgres.ts"
```

- [ ] **Step 3: Dry-run against real data**

Run (from `back/`): `npm run backfill:agents -- --dry-run`
Expected: prints a JSON summary like `{ "dryRun": true, "processed": <N>, "skipped": 0, "inserted": 0, "orphanTypes": <n> }` with no error. `processed` should equal the Mongo `agents` count. Note `orphanTypes` (agents whose `agentType` id has no `agent_types` doc) — acceptable (slug falls back to `''`), but log-review it.

- [ ] **Step 4: Real backfill + verify counts match**

Run: `npm run backfill:agents`
Expected: `{ "dryRun": false, "processed": N, "skipped": 0, "inserted": N, ... }`.

Verify parity (from `back/`):
```bash
node -e "const {Client}=require('pg');(async()=>{const c=new Client({host:process.env.POSTGRES_HOST,port:+process.env.POSTGRES_PORT,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD,database:process.env.POSTGRES_DB});await c.connect();const r=await c.query('select count(*) from agents');console.log('PG agents:',r.rows[0].count);await c.end();})()"
```
Compare against the Mongo `agents` count (the dry-run `processed`). They must match.

- [ ] **Step 5: Re-run idempotency check**

Run: `npm run backfill:agents`
Expected: `{ "inserted": 0, "skipped": N }` — re-running inserts nothing.

- [ ] **Step 6: Commit**

```bash
git add back/scripts/backfill-agents-to-postgres.ts back/package.json
git commit -m "feat(agent): add one-time Mongo->PG agent backfill script"
```

---

## Definition of Done (Plan 2)

- `AgentRepository` provides create / read / query / update / delete / clearDefaultForType / junction-pull methods, all returning `AgentRecord` in Mongo-lean-doc shape.
- Pure mapper unit tests pass anywhere; repository integration tests pass against the real `agentstore` Postgres.
- `AgentRepository` is provided + exported by `AgentModule` (unused by `AgentService` until Plan 3).
- Backfill script copies all Mongo agents into Postgres (counts match) and is idempotent.
- `AgentService` and all consumers still run on Mongoose — no behavior change yet. Plan 3 flips `AgentService` onto `AgentRepository`.

## Self-Review notes

- **Coverage vs Plan 3 needs:** the method set is derived directly from `AgentService`'s current `agentModel` calls (create/find/update/delete/list/count/uniqueness/default-for-type/slug/mono-agent lookups) and the consumers' `$pull`/create/read calls mapped in the design. `findByIds`/`findByIdsForUser`/`findForUser` cover the stream/list paths; `pull*` cover tool/skill/workspace; `findByOwnerAndType` covers humain-agent.
- **Type consistency:** `CreateAgentInput`/`UpdateAgentInput` field names align with the mapper's `AgentRecord` (snake_case for the two temporary-child fields; `agentType` = id). `rowToRecord` is the single assembly point used by every read.
- **No placeholders:** every method has a literal body; every task has runnable commands.
- **Known follow-ups (Plan 3):** `AgentService` will map its DTO `connectorActionSelections` (`{connectorId,actionKeys}`) and `model`→`llmModel`, resolve `agentTypeSlug` before calling `create/update`, and hydrate `agentType` name/slug/skills from Mongo after reads.
