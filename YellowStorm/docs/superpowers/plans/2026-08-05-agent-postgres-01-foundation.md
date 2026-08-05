# Agent → PostgreSQL — Plan 1: Postgres Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an app-owned PostgreSQL datastore (Drizzle ORM + `pg` pool) with the agent relational schema migrated in, a shared connection provider, config, and migration tooling — running alongside the existing MongoDB stack, touching **no** agent behavior yet.

**Architecture:** A new `@Global()` `PostgresModule` mirrors the existing Mongoose `DatabaseModule`: it loads a `postgres` config namespace, opens a `pg.Pool`, wraps it in a Drizzle instance exposed via DI tokens, and offers a connection/health service. The agent tables are declared as Drizzle schema and materialized through `drizzle-kit` versioned migrations. Nothing consumes these tables in this plan — it is pure foundation.

**Tech Stack:** NestJS 10, TypeScript 5.5, `drizzle-orm` (node-postgres driver), `drizzle-kit`, `pg` ^8.22 (already a dependency), Jest + ts-jest.

## Global Constraints

- **Runtime:** Node ≥ 20, NestJS `^10.4.0`. Do not upgrade major versions.
- **Datastores coexist:** MongoDB/Mongoose stays fully operational. This plan adds Postgres; it removes nothing.
- **ID format:** agent ids and all `*_id` reference columns are MongoDB ObjectId hex — `char(24)` — NOT uuid. New agents keep ObjectId-format ids. (Referenced ids point at Mongo-owned docs → no cross-DB FKs.)
- **Contract source of truth:** `back/db/postgres/agent.schema.sql` is the agreed schema shared with other services. The Drizzle schema in this plan must generate DDL that matches it; any divergence is reconciled in Task 6.
- **Path aliases:** use existing Jest/TS aliases — `@config/*` → `src/config/*`, `@modules/*` → `src/modules/*`, `@common/*` → `src/common/*`.
- **Config style:** namespaced `registerAs(...)` factory + Joi validation entries in `src/config/config.schema.ts`, exactly like `database.config.ts` / the `MEMORY_PG_*` block.
- **No secrets in code or committed `.env`.** Defaults target a local dev Postgres.

## Roadmap (context — later plans, written when we reach them)

This is Plan 1 of a sequence. Each plan produces working, testable software on its own:

1. **Foundation (this plan)** — Postgres module, config, Drizzle schema, migrations, health.
2. **Agent repository + backfill** — `AgentRepository` (Drizzle) returning Mongo-lean-doc-shaped records; one-time backfill script Mongo→PG.
3. **AgentService on Postgres** — repoint `AgentService`'s ~28 methods to `AgentRepository`; add agent-type hydration at the service layer; write `agent_type_slug` on save.
4. **Consumer decoupling** — repoint the 10 external `@InjectModel(Agent.name)` consumers to `AgentService`; rewrite `conversation.service.ts:673` `populate('groupMeta.taggedAgents')`.
5. **Cutover** — remove the Agent Mongoose schema + all `forFeature([Agent])` registrations; final verification.

---

## File Structure (this plan)

- `back/src/config/postgres.config.ts` — **Create.** `registerAs('postgres', …)` factory reading `POSTGRES_*` env.
- `back/src/config/config.schema.ts` — **Modify.** Add the `POSTGRES_*` Joi block.
- `back/src/modules/postgres/postgres.constants.ts` — **Create.** DI tokens `PG_POOL`, `DRIZZLE_DB`.
- `back/src/modules/postgres/schema/agents.schema.ts` — **Create.** Drizzle `pgTable` defs: `agents` + 6 junction tables + indexes.
- `back/src/modules/postgres/schema/index.ts` — **Create.** Barrel re-export of all schema tables (the object Drizzle + drizzle-kit consume).
- `back/src/modules/postgres/postgres-connection.service.ts` — **Create.** Pool lifecycle + `isConnected()`/`ping()` health.
- `back/src/modules/postgres/postgres.module.ts` — **Create.** `@Global()` module wiring pool + Drizzle + connection service.
- `back/src/modules/postgres/index.ts` — **Create.** Barrel export (module, service, tokens, schema).
- `back/drizzle.config.ts` — **Create.** drizzle-kit config (schema glob, out dir, dialect, credentials).
- `back/package.json` — **Modify.** Add `drizzle-orm` + `drizzle-kit` deps and `db:generate` / `db:migrate` / `db:studio` scripts.
- `back/src/app.module.ts` — **Modify.** Register `PostgresModule` in the root `imports` (next to `DatabaseModule`).
- Test files colocated as `*.spec.ts` (Jest `testRegex: .*\.spec\.ts$`, `rootDir: src`). `drizzle.config.ts` is outside `src`, so it is not test-collected — that's fine.

---

## Task 1: Add Drizzle dependencies and DB scripts

**Files:**
- Modify: `back/package.json`

- [ ] **Step 1: Add dependencies**

Run (from `back/`):

```bash
npm install drizzle-orm
npm install -D drizzle-kit
```

Expected: `drizzle-orm` under `dependencies`, `drizzle-kit` under `devDependencies`. (`pg` ^8.22 and `@types/pg` are already present — do not re-add.)

- [ ] **Step 2: Add db scripts**

In `back/package.json`, add to the `"scripts"` block:

```json
"db:generate": "drizzle-kit generate",
"db:migrate": "drizzle-kit migrate",
"db:studio": "drizzle-kit studio"
```

- [ ] **Step 3: Verify install**

Run: `npx drizzle-kit --version`
Expected: prints a drizzle-kit version without error.

- [ ] **Step 4: Commit**

```bash
git add back/package.json back/package-lock.json
git commit -m "chore(postgres): add drizzle-orm and drizzle-kit with db scripts"
```

---

## Task 2: Postgres config namespace + validation

**Files:**
- Create: `back/src/config/postgres.config.ts`
- Modify: `back/src/config/config.schema.ts`
- Test: `back/src/config/postgres.config.spec.ts`

**Interfaces:**
- Produces: `registerAs('postgres', () => PostgresConfig)` where
  `PostgresConfig = { host: string; port: number; user: string; password: string; database: string; ssl: boolean; maxPoolSize: number; idleTimeoutMs: number; connectionTimeoutMs: number }`.

- [ ] **Step 1: Write the failing test**

Create `back/src/config/postgres.config.spec.ts`:

```typescript
import postgresConfig from './postgres.config';

describe('postgresConfig', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('falls back to local dev defaults when env is unset', () => {
    delete process.env.POSTGRES_HOST;
    delete process.env.POSTGRES_PORT;
    delete process.env.POSTGRES_DB;
    const cfg = postgresConfig();
    expect(cfg.host).toBe('localhost');
    expect(cfg.port).toBe(5432);
    expect(cfg.database).toBe('yellostorm');
    expect(cfg.ssl).toBe(false);
    expect(cfg.maxPoolSize).toBe(10);
  });

  it('reads values from environment', () => {
    process.env.POSTGRES_HOST = 'db.internal';
    process.env.POSTGRES_PORT = '6543';
    process.env.POSTGRES_DB = 'agents';
    process.env.POSTGRES_SSL = 'true';
    process.env.POSTGRES_MAX_POOL_SIZE = '25';
    const cfg = postgresConfig();
    expect(cfg.host).toBe('db.internal');
    expect(cfg.port).toBe(6543);
    expect(cfg.database).toBe('agents');
    expect(cfg.ssl).toBe(true);
    expect(cfg.maxPoolSize).toBe(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/config/postgres.config.spec.ts`
Expected: FAIL — cannot find module `./postgres.config`.

- [ ] **Step 3: Create the config factory**

Create `back/src/config/postgres.config.ts`:

```typescript
import { registerAs } from '@nestjs/config';

export interface PostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  maxPoolSize: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
}

export default registerAs('postgres', (): PostgresConfig => ({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number.parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'yellostorm',
  ssl: process.env.POSTGRES_SSL === 'true',
  maxPoolSize: Number.parseInt(process.env.POSTGRES_MAX_POOL_SIZE || '10', 10),
  idleTimeoutMs: Number.parseInt(process.env.POSTGRES_IDLE_TIMEOUT || '30000', 10),
  connectionTimeoutMs: Number.parseInt(process.env.POSTGRES_CONNECT_TIMEOUT || '10000', 10),
}));
```

- [ ] **Step 4: Add Joi validation entries**

In `back/src/config/config.schema.ts`, add this block immediately after the `MEMORY_PG_*` block (around line 36):

```typescript
  // App-owned Postgres (agents datastore — Drizzle)
  POSTGRES_HOST: Joi.string().default('localhost'),
  POSTGRES_PORT: Joi.number().default(5432),
  POSTGRES_USER: Joi.string().default('postgres'),
  POSTGRES_PASSWORD: Joi.string().allow('').default('postgres'),
  POSTGRES_DB: Joi.string().default('yellostorm'),
  POSTGRES_SSL: Joi.boolean().default(false),
  POSTGRES_MAX_POOL_SIZE: Joi.number().min(1).max(100).default(10),
  POSTGRES_IDLE_TIMEOUT: Joi.number().min(0).default(30000),
  POSTGRES_CONNECT_TIMEOUT: Joi.number().min(1000).default(10000),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/config/postgres.config.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add back/src/config/postgres.config.ts back/src/config/postgres.config.spec.ts back/src/config/config.schema.ts
git commit -m "feat(postgres): add postgres config namespace and validation"
```

---

## Task 3: Drizzle schema for agents + junction tables

**Files:**
- Create: `back/src/modules/postgres/schema/agents.schema.ts`
- Create: `back/src/modules/postgres/schema/index.ts`
- Test: `back/src/modules/postgres/schema/agents.schema.spec.ts`

**Interfaces:**
- Produces the Drizzle tables (exported names later plans import):
  `agents`, `agentTools`, `agentSkills`, `agentDisabledSkills`, `agentConnectors`, `agentKnowledgeBases`, `agentConnectorActions`.
- Column mapping mirrors `back/db/postgres/agent.schema.sql`. `agents` row columns use camelCase TS names → snake_case DB names (e.g. `agentTypeId` → `agent_type_id`).

- [ ] **Step 1: Write the failing test**

The schema is declarative, so the test asserts the table objects expose the expected columns/names (a cheap guard against typos and accidental drops). Create `back/src/modules/postgres/schema/agents.schema.spec.ts`:

```typescript
import { getTableName, getTableColumns } from 'drizzle-orm';
import {
  agents,
  agentTools,
  agentSkills,
  agentDisabledSkills,
  agentConnectors,
  agentKnowledgeBases,
  agentConnectorActions,
} from './agents.schema';

describe('agents drizzle schema', () => {
  it('maps the agents table to snake_case db columns', () => {
    expect(getTableName(agents)).toBe('agents');
    const cols = getTableColumns(agents);
    // key scalar + denormalized + jsonb columns exist
    for (const name of [
      'id', 'name', 'slug', 'role', 'description', 'temperature', 'llmModel',
      'email', 'instruction', 'ignorePrePrompt', 'agentTypeId', 'agentTypeSlug',
      'guardrails', 'deploymentSettings', 'createdBy', 'createdAt', 'updatedAt',
    ]) {
      expect(cols[name]).toBeDefined();
    }
    expect(cols.agentTypeId.name).toBe('agent_type_id');
    expect(cols.agentTypeSlug.name).toBe('agent_type_slug');
    expect(cols.llmModel.name).toBe('llm_model');
  });

  it('defines the six junction tables', () => {
    expect(getTableName(agentTools)).toBe('agent_tools');
    expect(getTableName(agentSkills)).toBe('agent_skills');
    expect(getTableName(agentDisabledSkills)).toBe('agent_disabled_skills');
    expect(getTableName(agentConnectors)).toBe('agent_connectors');
    expect(getTableName(agentKnowledgeBases)).toBe('agent_knowledge_bases');
    expect(getTableName(agentConnectorActions)).toBe('agent_connector_actions');
    expect(getTableColumns(agentConnectorActions).actionKeys.name).toBe('action_keys');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/postgres/schema/agents.schema.spec.ts`
Expected: FAIL — cannot find module `./agents.schema`.

- [ ] **Step 3: Create the Drizzle schema**

Create `back/src/modules/postgres/schema/agents.schema.ts`:

```typescript
import { sql } from 'drizzle-orm';
import {
  pgTable,
  char,
  varchar,
  text,
  boolean,
  real,
  smallint,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';

/**
 * Agent relational schema. Mirrors back/db/postgres/agent.schema.sql (the
 * contract shared with other services). ids are Mongo ObjectId hex → char(24).
 * Ref-side ids point at Mongo docs → no cross-DB FK; only agent_id has a real FK.
 */
export const agents = pgTable(
  'agents',
  {
    id: char('id', { length: 24 }).primaryKey(),

    name: varchar('name', { length: 50 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull().default(''),
    role: text('role').notNull(),
    description: varchar('description', { length: 1000 }).notNull().default(''),
    temperature: real('temperature').notNull().default(0),
    llmModel: varchar('llm_model', { length: 100 }),
    email: varchar('email', { length: 320 }),
    instruction: text('instruction').notNull().default(''),
    ignorePrePrompt: boolean('ignore_pre_prompt').notNull().default(false),

    agentTypeId: char('agent_type_id', { length: 24 }).notNull(),
    agentTypeSlug: varchar('agent_type_slug', { length: 100 }).notNull().default(''),

    enableTemporaryChildAgents: boolean('enable_temporary_child_agents').notNull().default(false),
    maxTemporaryChildAgents: smallint('max_temporary_child_agents').notNull().default(4),

    isDefault: boolean('is_default').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    isDefaultForType: boolean('is_default_for_type').notNull().default(false),

    createdBy: char('created_by', { length: 24 }).notNull(),

    guardrails: jsonb('guardrails').notNull().default(sql`'{}'::jsonb`),
    deploymentSettings: jsonb('deployment_settings').notNull().default(sql`'{}'::jsonb`),

    a2aPublished: boolean('a2a_published').notNull().default(false),
    a2aAgentId: text('a2a_agent_id'),
    a2aAgentCardUrl: text('a2a_agent_card_url'),
    a2aApiKeyHeader: text('a2a_api_key_header'),
    a2aPublishedAt: timestamp('a2a_published_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('agents_temperature_range', sql`${t.temperature} >= 0 AND ${t.temperature} <= 1`),
    check('agents_max_children_range', sql`${t.maxTemporaryChildAgents} BETWEEN 1 AND 8`),
    index('idx_agents_created_by_is_active').on(t.createdBy, t.isActive),
    index('idx_agents_is_default_is_active').on(t.isDefault, t.isActive),
    uniqueIndex('uq_agents_name_created_by').on(t.name, t.createdBy),
    uniqueIndex('uq_agents_created_by_slug_non_default')
      .on(t.createdBy, t.slug)
      .where(sql`${t.isDefault} = false AND ${t.slug} <> ''`),
    uniqueIndex('uq_agents_slug_default')
      .on(t.slug, t.isDefault)
      .where(sql`${t.isDefault} = true AND ${t.slug} <> ''`),
    index('idx_agents_type_created_by_default_for_type').on(t.agentTypeId, t.createdBy, t.isDefaultForType),
    index('idx_agents_type_is_default_default_for_type').on(t.agentTypeId, t.isDefault, t.isDefaultForType),
    index('idx_agents_agent_type_slug').on(t.agentTypeSlug),
    index('idx_agents_is_active').on(t.isActive),
  ],
);

const junctionRef = (dbName: string) => char(dbName, { length: 24 }).notNull();

export const agentTools = pgTable(
  'agent_tools',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    toolId: junctionRef('tool_id'),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.toolId] }),
    index('idx_agent_tools_tool_id').on(t.toolId),
  ],
);

export const agentSkills = pgTable(
  'agent_skills',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    skillId: junctionRef('skill_id'),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('idx_agent_skills_skill_id').on(t.skillId),
  ],
);

export const agentDisabledSkills = pgTable(
  'agent_disabled_skills',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    skillId: junctionRef('skill_id'),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.skillId] }),
    index('idx_agent_disabled_skills_skill_id').on(t.skillId),
  ],
);

export const agentConnectors = pgTable(
  'agent_connectors',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    connectorId: junctionRef('connector_id'),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.connectorId] }),
    index('idx_agent_connectors_connector_id').on(t.connectorId),
  ],
);

export const agentKnowledgeBases = pgTable(
  'agent_knowledge_bases',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    workspaceId: junctionRef('workspace_id'),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.workspaceId] }),
    index('idx_agent_knowledge_bases_workspace_id').on(t.workspaceId),
  ],
);

export const agentConnectorActions = pgTable(
  'agent_connector_actions',
  {
    agentId: char('agent_id', { length: 24 }).notNull().references(() => agents.id, { onDelete: 'cascade' }),
    connectorId: char('connector_id', { length: 24 }).notNull(),
    actionKeys: text('action_keys').array().notNull().default(sql`'{}'`),
  },
  (t) => [
    primaryKey({ columns: [t.agentId, t.connectorId] }),
    index('idx_agent_connector_actions_connector_id').on(t.connectorId),
  ],
);
```

- [ ] **Step 4: Create the schema barrel**

Create `back/src/modules/postgres/schema/index.ts`:

```typescript
export * from './agents.schema';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/modules/postgres/schema/agents.schema.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/postgres/schema/
git commit -m "feat(postgres): add drizzle schema for agents and junction tables"
```

---

## Task 4: Connection tokens + Postgres connection service

**Files:**
- Create: `back/src/modules/postgres/postgres.constants.ts`
- Create: `back/src/modules/postgres/postgres-connection.service.ts`
- Test: `back/src/modules/postgres/postgres-connection.service.spec.ts`

**Interfaces:**
- Produces tokens: `export const PG_POOL = 'PG_POOL'` (a `pg.Pool`), `export const DRIZZLE_DB = 'DRIZZLE_DB'` (a `NodePgDatabase<typeof schema>`).
- Produces `PostgresConnectionService` with:
  - `getDb(): NodePgDatabase<typeof schema>`
  - `getPool(): Pool`
  - `async ping(): Promise<boolean>` — runs `SELECT 1`, returns true on success, false on failure.

- [ ] **Step 1: Create the tokens**

Create `back/src/modules/postgres/postgres.constants.ts`:

```typescript
export const PG_POOL = 'PG_POOL';
export const DRIZZLE_DB = 'DRIZZLE_DB';
```

- [ ] **Step 2: Write the failing test**

Create `back/src/modules/postgres/postgres-connection.service.spec.ts`:

```typescript
import { PostgresConnectionService } from './postgres-connection.service';
import type { Pool } from 'pg';

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}

describe('PostgresConnectionService', () => {
  it('ping() returns true when SELECT 1 succeeds', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) } as unknown as Pool;
    const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
    await expect(svc.ping()).resolves.toBe(true);
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('ping() returns false when the query throws', async () => {
    const pool = { query: jest.fn().mockRejectedValue(new Error('down')) } as unknown as Pool;
    const svc = new PostgresConnectionService(pool, {} as any, loggerStub());
    await expect(svc.ping()).resolves.toBe(false);
  });

  it('getPool() and getDb() return the injected instances', () => {
    const pool = {} as Pool;
    const db = {} as any;
    const svc = new PostgresConnectionService(pool, db, loggerStub());
    expect(svc.getPool()).toBe(pool);
    expect(svc.getDb()).toBe(db);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx jest src/modules/postgres/postgres-connection.service.spec.ts`
Expected: FAIL — cannot find module `./postgres-connection.service`.

- [ ] **Step 4: Create the connection service**

Create `back/src/modules/postgres/postgres-connection.service.ts`:

```typescript
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { LoggerService } from '../logger';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import type * as schema from './schema';

@Injectable()
export class PostgresConnectionService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PostgresConnectionService.name);
  }

  getPool(): Pool {
    return this.pool;
  }

  getDb(): NodePgDatabase<typeof schema> {
    return this.db;
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      this.logger.error('Postgres ping failed', { error: (error as Error).message });
      return false;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest src/modules/postgres/postgres-connection.service.spec.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Commit**

```bash
git add back/src/modules/postgres/postgres.constants.ts back/src/modules/postgres/postgres-connection.service.ts back/src/modules/postgres/postgres-connection.service.spec.ts
git commit -m "feat(postgres): add connection tokens and health/connection service"
```

---

## Task 5: PostgresModule wiring + registration

**Files:**
- Create: `back/src/modules/postgres/postgres.module.ts`
- Create: `back/src/modules/postgres/index.ts`
- Modify: `back/src/app.module.ts`
- Test: `back/src/modules/postgres/postgres.module.spec.ts`

**Interfaces:**
- Consumes: `postgresConfig` (Task 2), tokens + service (Task 4), schema (Task 3).
- Produces: `PostgresModule` (`@Global`) exporting `PostgresConnectionService`, `PG_POOL`, `DRIZZLE_DB`.

- [ ] **Step 1: Create the module**

Create `back/src/modules/postgres/postgres.module.ts`:

```typescript
import { Global, Module, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import postgresConfig from '../../config/postgres.config';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import { PostgresConnectionService } from './postgres-connection.service';
import * as schema from './schema';

@Global()
@Module({
  imports: [ConfigModule.forFeature(postgresConfig)],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const cfg = configService.get('postgres')!;
        console.log('[PostgresModule] Creating Postgres pool...');
        const pool = new Pool({
          host: cfg.host,
          port: cfg.port,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          ssl: cfg.ssl ? { rejectUnauthorized: false } : undefined,
          max: cfg.maxPoolSize,
          idleTimeoutMillis: cfg.idleTimeoutMs,
          connectionTimeoutMillis: cfg.connectionTimeoutMs,
        });
        pool.on('error', (err) => {
          console.error('[PostgresModule] Idle client error:', err.message);
        });
        return pool;
      },
    },
    {
      provide: DRIZZLE_DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool) => drizzle(pool, { schema }),
    },
    PostgresConnectionService,
  ],
  exports: [PostgresConnectionService, PG_POOL, DRIZZLE_DB],
})
export class PostgresModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
```

- [ ] **Step 2: Create the barrel**

Create `back/src/modules/postgres/index.ts`:

```typescript
export * from './postgres.module';
export * from './postgres-connection.service';
export * from './postgres.constants';
export * as postgresSchema from './schema';
```

- [ ] **Step 3: Write the module test**

Create `back/src/modules/postgres/postgres.module.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PostgresModule } from './postgres.module';
import { PostgresConnectionService } from './postgres-connection.service';
import { PG_POOL, DRIZZLE_DB } from './postgres.constants';
import { LoggerService } from '../logger';

describe('PostgresModule', () => {
  it('provides the pool, drizzle db, and connection service', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true }), PostgresModule],
    })
      .overrideProvider(LoggerService)
      .useValue({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })
      .compile();

    expect(moduleRef.get(PG_POOL)).toBeDefined();
    expect(moduleRef.get(DRIZZLE_DB)).toBeDefined();
    expect(moduleRef.get(PostgresConnectionService)).toBeInstanceOf(PostgresConnectionService);

    // Close the pool opened by the factory so Jest exits cleanly.
    await moduleRef.close();
  });
});
```

> Note: creating a `pg.Pool` does not connect until first query, so this test needs no live database. `moduleRef.close()` triggers `onModuleDestroy` → `pool.end()`. If `LoggerService` is not directly injectable in isolation, import the module that provides it (mirror `database.module.spec.ts`).

- [ ] **Step 4: Run the module test**

Run: `npx jest src/modules/postgres/postgres.module.spec.ts`
Expected: PASS.

- [ ] **Step 5: Register in AppModule**

In `back/src/app.module.ts`, import and add `PostgresModule` to the root module's `imports` array, adjacent to `DatabaseModule`:

```typescript
import { PostgresModule } from './modules/postgres';
// ...
// in @Module({ imports: [ ... DatabaseModule, PostgresModule, ... ] })
```

- [ ] **Step 6: Verify the app compiles and boots**

Run: `npm run build`
Expected: build succeeds.

Run (with a local Postgres reachable via the `POSTGRES_*` defaults, or with `LOGGING`/other services as usual): `npm run start` and confirm the log line `[PostgresModule] Creating Postgres pool...` appears and the app starts without a Postgres connection error. Stop the app.

- [ ] **Step 7: Commit**

```bash
git add back/src/modules/postgres/postgres.module.ts back/src/modules/postgres/index.ts back/src/modules/postgres/postgres.module.spec.ts back/src/app.module.ts
git commit -m "feat(postgres): wire global PostgresModule and register in AppModule"
```

---

## Task 6: drizzle-kit config + generate & apply the initial migration

**Files:**
- Create: `back/drizzle.config.ts`
- Create (generated): `back/drizzle/` migration output
- No unit test — verification is applying the migration to a real local Postgres and inspecting the tables.

**Interfaces:**
- Consumes: the schema barrel `src/modules/postgres/schema/index.ts`.
- Produces: versioned SQL migration(s) under `back/drizzle/` that create `agents` + the 6 junction tables with all indexes.

- [ ] **Step 1: Create the drizzle-kit config**

Create `back/drizzle.config.ts` (assembles the URL from the same `POSTGRES_*` defaults as the Joi schema, so `npm run db:*` works out of the box against a local dev Postgres):

```typescript
import { defineConfig } from 'drizzle-kit';

const host = process.env.POSTGRES_HOST || 'localhost';
const port = process.env.POSTGRES_PORT || '5432';
const user = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD || 'postgres';
const database = process.env.POSTGRES_DB || 'yellostorm';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/postgres/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: `postgresql://${user}:${password}@${host}:${port}/${database}`,
  },
});
```

- [ ] **Step 2: Generate the initial migration**

Run (from `back/`): `npm run db:generate -- --name=agents_init`
Expected: a new folder/files under `back/drizzle/` (e.g. `0000_agents_init.sql` + `meta/`). Open the generated `.sql` and confirm it contains `CREATE TABLE "agents"`, the six `agent_*` junction tables, the two partial unique indexes with `WHERE` predicates, and the `agent_id` foreign keys.

- [ ] **Step 3: Reconcile with the shared contract**

Compare the generated `back/drizzle/0000_agents_init.sql` against `back/db/postgres/agent.schema.sql`. They should be equivalent modulo cosmetic differences. Expected known differences to accept or fix:
- The contract uses a reusable `object_id` DOMAIN with a hex `CHECK`; the Drizzle output uses plain `char(24)` columns (no hex domain). This is acceptable — the column widths and semantics match. If strict hex enforcement is wanted in Postgres, add it as a follow-up custom migration; do not block here.
- Column ordering/naming of constraints may differ. Confirm every table, column, index (names as written in Task 3), and FK from the contract is present in the generated SQL. If a column or index is missing, fix `agents.schema.ts` and re-generate.

- [ ] **Step 4: Apply the migration to local Postgres**

Ensure a local Postgres is running and the `yellostorm` database exists (create it if needed: `createdb yellostorm` or `CREATE DATABASE yellostorm;`).

Run: `npm run db:migrate`
Expected: migration applies without error.

- [ ] **Step 5: Verify tables exist**

Run: `psql "postgresql://postgres:postgres@localhost:5432/yellostorm" -c "\dt"`
Expected: lists `agents`, `agent_tools`, `agent_skills`, `agent_disabled_skills`, `agent_connectors`, `agent_knowledge_bases`, `agent_connector_actions`.

Run: `psql "postgresql://postgres:postgres@localhost:5432/yellostorm" -c "\d agents"`
Expected: shows all `agents` columns (incl. `email`, `agent_type_slug`, `guardrails jsonb`, `deployment_settings jsonb`) and the indexes from Task 3, including the two partial unique indexes.

- [ ] **Step 6: Commit**

```bash
git add back/drizzle.config.ts back/drizzle/
git commit -m "feat(postgres): add drizzle-kit config and initial agents migration"
```

---

## Definition of Done (Plan 1)

- `npm run build` succeeds; `npx jest src/config/postgres.config.spec.ts src/modules/postgres` passes.
- App boots with `PostgresModule` active alongside MongoDB; no agent behavior changed.
- `npm run db:generate` / `npm run db:migrate` create the agent tables in a local Postgres; `\dt` and `\d agents` confirm the schema matches `back/db/postgres/agent.schema.sql`.
- Nothing reads or writes the new tables yet — that begins in Plan 2 (`AgentRepository` + backfill).

---

## Self-Review notes

- **Spec coverage:** Plan 1 implements the design's §4.1 (PostgresModule parallel to DatabaseModule), §4.2 (full-relational agent schema + junctions + partial-unique indexes), and the ORM/migration-tooling decision. The `email` field added to the contract `.sql` is included in the Drizzle schema. Decoupling, repository, backfill, consumer repoints, and cutover are explicitly deferred to Plans 2–5.
- **Type consistency:** token names `PG_POOL`/`DRIZZLE_DB` and service methods `getPool()`/`getDb()`/`ping()` are used identically across Tasks 4–5. Exported table names (`agents`, `agentTools`, …) are consistent between Task 3 and the barrels.
- **No placeholders:** every step has runnable commands or literal code.
