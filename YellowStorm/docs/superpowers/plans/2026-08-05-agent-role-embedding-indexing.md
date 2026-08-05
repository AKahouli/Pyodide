# Humain Agent Role Embeddings (pgvector) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Index the `role` of every **humain** agent with a pgvector embedding, recomputed on create and on any update that changes `name`/`role`. Write-side (indexing) only — no search endpoint yet.

**Architecture:** New `role_embedding halfvec(3072)` column + HNSW cosine index on `agents`. A reusable `EmbeddingService` (models module) calls the shared LiteLLM proxy `/v1/embeddings`. An `AgentRoleEmbeddingService` (global module) orchestrates: gated on `agentTypeSlug === 'humain'`, embeds `` `${name}. ${role}` ``, stores via `AgentRepository.setRoleEmbedding`. All triggers are **fire-and-forget and never throw** — a login/profile write never fails because embeddings are down.

**Decisions (locked):** indexing only · never block the write (best-effort) · trigger from both `HumainAgentService` and generic `AgentService.updatePersonal/createPersonal` (gated on humain slug) · embed `` `${name}. ${role}` `` · model `text-embedding-3-large`, dim `3072` (env) · one-time backfill of existing humain agents.

## Global Constraints
- `role_embedding` is nullable; only humain agents ever populate it.
- **halfvec, not vector** — 3072 dims exceeds the `vector` index ceiling (2000); `halfvec` allows up to 4000.
- Same embedding model on write as any future query side, or cosine similarity is meaningless.
- Embedding is kept OUT of the Drizzle ORM schema (raw SQL for the vector column) so `drizzle-kit generate` never drifts on the `halfvec`/extension/HNSW DDL it can't model.

---

## Task 1: DDL migration + apply + contract update

**Files:** Create `back/drizzle/0001_agent_role_embedding.sql`; modify `back/drizzle/meta/_journal.json`; modify `back/db/postgres/agent.schema.sql`.

- [ ] **Step 1:** Create `back/drizzle/0001_agent_role_embedding.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "role_embedding" halfvec(3072);
--> statement-breakpoint
CREATE INDEX "idx_agents_role_embedding" ON "agents" USING hnsw ("role_embedding" halfvec_cosine_ops);
```
- [ ] **Step 2:** Append to `_journal.json` `entries` array:
```json
{ "idx": 1, "version": "7", "when": 1785916711241, "tag": "0001_agent_role_embedding", "breakpoints": true }
```
- [ ] **Step 3:** Add the same column + index (and `CREATE EXTENSION vector`) to `back/db/postgres/agent.schema.sql`, with a comment: humain-only semantic index; `halfvec` for 3072-dim `text-embedding-3-large`.
- [ ] **Step 4: Apply to both databases** (pgvector must be available on the server):
  `POSTGRES_DB=agentstore npm run db:migrate` and `POSTGRES_DB=agentstore_test npm run db:migrate`.
  Expected: `0001` applies. If `CREATE EXTENSION vector` fails (extension not installed on the server), STOP and report — the DBA must install pgvector first.
- [ ] **Step 5: Verify** — `\d agents` shows `role_embedding halfvec(3072)` and `idx_agents_role_embedding` (hnsw). Commit.

---

## Task 2: Embedding config

**Files:** Modify `back/src/config/litellm.config.ts`, `back/src/config/config.schema.ts`, `back/.env` (gitignored).

- [ ] Add to `litellm.config.ts` the namespace fields: `embeddingsEndpoint: '/v1/embeddings'`, `embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-large'`, `embeddingDimension: Number.parseInt(process.env.EMBEDDING_DIMENSION || '3072', 10)`.
- [ ] Add Joi (config.schema.ts): `EMBEDDING_MODEL: Joi.string().default('text-embedding-3-large')`, `EMBEDDING_DIMENSION: Joi.number().default(3072)`.
- [ ] Append to `.env`: `EMBEDDING_MODEL=text-embedding-3-large` and `EMBEDDING_DIMENSION=3072`.
- [ ] Build → commit.

---

## Task 3: `EmbeddingService` (models module)

**Files:** Create `back/src/modules/models/embedding.service.ts`; modify `models.module.ts` (provide + export); test `embedding.service.spec.ts`.

**Interface:** `embed(text: string): Promise<number[] | null>` — POST `{ model, input: text, dimensions }` to the LiteLLM `/v1/embeddings` endpoint via `LiteLLMConnectionService.getHttpClient()`. Returns the float array, or `null` when the client is unconfigured or the call fails/returns no data (logs, never throws).

- [ ] **Step 1:** Unit test with a mocked `getHttpClient` (post resolves `{ data: { data: [{ embedding: [0.1,0.2] }] }}`) → `embed('x')` returns `[0.1,0.2]`; when `getHttpClient()` is null → returns `null`; when post rejects → returns `null` (no throw).
- [ ] **Step 2:** Implement:
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger';
import { LiteLLMConnectionService } from './litellm-connection.service';

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly connection: LiteLLMConnectionService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) { this.logger.setContext(EmbeddingService.name); }

  async embed(text: string): Promise<number[] | null> {
    const client = this.connection.getHttpClient();
    if (!client) { this.logger.warn('Embedding skipped: LiteLLM client not configured'); return null; }
    try {
      const endpoint = this.config.get<string>('litellm.embeddingsEndpoint', '/v1/embeddings');
      const model = this.config.get<string>('litellm.embeddingModel')!;
      const dimensions = this.config.get<number>('litellm.embeddingDimension')!;
      const res = await client.post(endpoint, { model, input: text, dimensions });
      const vec = res.data?.data?.[0]?.embedding;
      return Array.isArray(vec) ? (vec as number[]) : null;
    } catch (error) {
      this.logger.error('Embedding request failed', { error: (error as Error).message });
      return null;
    }
  }
}
```
- [ ] **Step 3:** `models.module.ts` — add `EmbeddingService` to `providers` and `exports`.
- [ ] **Step 4:** Test passes → build → commit.

---

## Task 4: `AgentRepository.setRoleEmbedding`

**Files:** Modify `agent.repository.ts`; modify `agent.repository.spec.ts`.

**Interface:** `setRoleEmbedding(id: string, embedding: number[]): Promise<void>` — `UPDATE agents SET role_embedding = $1::halfvec WHERE id = $2` (vector as a `[a,b,c]` literal bound param).

- [ ] **Step 1:** Implement:
```typescript
  async setRoleEmbedding(id: string, embedding: number[]): Promise<void> {
    const literal = `[${embedding.join(',')}]`;
    await this.db.execute(sql`UPDATE agents SET role_embedding = ${literal}::halfvec WHERE id = ${id}`);
  }
```
(add `import { sql } from 'drizzle-orm'` if not already imported — it is.)
- [ ] **Step 2:** Integration test (real `agentstore_test`): create an agent, `setRoleEmbedding(id, vec3072)`, then query `SELECT role_embedding IS NOT NULL AS has FROM agents WHERE id = …` via `db.execute` → true. Use a length-3072 array (e.g. `Array.from({length:3072},(_,i)=>(i%7)/10)`).
- [ ] **Step 3:** Run `npx jest …/agent.repository.spec.ts -t "role_embedding"` → PASS. Commit.

---

## Task 5: `AgentRoleEmbeddingService` + global module

**Files:** Create `back/src/modules/agent/services/agent-role-embedding.service.ts`; create `back/src/modules/agent/agent-embedding.module.ts`; modify `app.module.ts`; test `agent-role-embedding.service.spec.ts`.

**Interface:** `reindexHumainRole(agentId: string, agentTypeSlug: string, name: string, role: string): void` — no-op unless `agentTypeSlug === 'humain'`; otherwise fire-and-forget embed(`` `${name}. ${role}` ``) → `setRoleEmbedding`. Never throws.

- [ ] **Step 1:** Implement service:
```typescript
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../logger';
import { EmbeddingService } from '../../models/embedding.service';
import { AgentRepository } from '../repositories/agent.repository';

const HUMAIN_SLUG = 'humain';

@Injectable()
export class AgentRoleEmbeddingService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly agentRepository: AgentRepository,
    private readonly logger: LoggerService,
  ) { this.logger.setContext(AgentRoleEmbeddingService.name); }

  /** Fire-and-forget reindex of a humain agent's role embedding. Never throws. */
  reindexHumainRole(agentId: string, agentTypeSlug: string, name: string, role: string): void {
    if (agentTypeSlug !== HUMAIN_SLUG) return;
    void this.run(agentId, name, role).catch((error) =>
      this.logger.warn('Role embedding reindex failed', { agentId, error: (error as Error).message }),
    );
  }

  private async run(agentId: string, name: string, role: string): Promise<void> {
    const vec = await this.embeddingService.embed(`${name}. ${role}`);
    if (!vec) return; // embed already logged; nothing to store
    await this.agentRepository.setRoleEmbedding(agentId, vec);
    this.logger.log('Role embedding indexed', { agentId, dims: vec.length });
  }
}
```
- [ ] **Step 2:** Create `agent-embedding.module.ts` (`@Global`): `imports: [ModelsModule]`, `providers: [AgentRoleEmbeddingService]`, `exports: [AgentRoleEmbeddingService]`. (`AgentRepository` comes from the global `AgentRepositoryModule`; `EmbeddingService` from `ModelsModule`.)
- [ ] **Step 3:** Register `AgentEmbeddingModule` in `app.module.ts` imports (near `AgentRepositoryModule`).
- [ ] **Step 4:** Unit test: `reindexHumainRole('a','simple',…)` → does not call embed; `reindexHumainRole('a','humain','N','R')` → after a tick, `embed` called with `'N. R'` and `setRoleEmbedding` called with the returned vector; when `embed` resolves null → `setRoleEmbedding` NOT called; when `embed` throws → no unhandled rejection (spy the logger).
- [ ] **Step 5:** Build → commit.

---

## Task 6: Wire the triggers

**Files:** Modify `humain-agent.service.ts`, `humain-agent.service.spec.ts`, `agent.service.ts`, `agent.service.spec.ts`.

- [ ] **HumainAgentService:** inject `AgentRoleEmbeddingService`. After the **create** branch: `this.roleEmbedding.reindexHumainRole(id, agentTypeSlug, name, role);`. After the **syncFromProfile overwrite** update: `this.roleEmbedding.reindexHumainRole(existing._id, agentTypeSlug, name, role);`. (The login email-only branch does NOT reindex.) Update the spec: assert `reindexHumainRole` called on create + sync, not on the email-only path.
- [ ] **AgentService:** inject `AgentRoleEmbeddingService`.
  - `createPersonal`: after `create`, `this.agentRoleEmbedding.reindexHumainRole(agent._id, agent.agentTypeSlug, agent.name, agent.role);` (internal humain gate filters non-humain).
  - `updatePersonal`: after `updateById`, `if (dto.name !== undefined || dto.role !== undefined) this.agentRoleEmbedding.reindexHumainRole(updated._id, updated.agentTypeSlug, updated.name, updated.role);`.
  - Update `agent.service.spec.ts` `createService()` to provide an `agentRoleEmbedding` double `{ reindexHumainRole: jest.fn() }` in the constructor (matching the new position) so existing tests still construct.
- [ ] Build → run `npx jest src/modules/humain-agent src/modules/agent/agent.service.spec.ts` → PASS → commit.

---

## Task 7: One-time backfill of existing humain agents

**Files:** Create `back/scripts/backfill-humain-role-embeddings.ts`; add `package.json` script `backfill:humain-embeddings`.

- [ ] Standalone `ts-node` script (mirrors the agent backfill): connect to `agentstore` (drizzle) + build `EmbeddingService`-equivalent inline (or a minimal axios call to LiteLLM using `.env` `LITELLM_API_URL`/`LITELLM_API_KEY` + `EMBEDDING_MODEL`/`EMBEDDING_DIMENSION`). Select all agents whose `agent_type_slug = 'humain'` (and optionally only where `role_embedding IS NULL`), embed `` `${name}. ${role}` ``, `UPDATE … SET role_embedding = …::halfvec`. `--dry-run` prints counts. Log per-failure, continue.
- [ ] Dry-run → real run → verify `SELECT count(*) FROM agents WHERE agent_type_slug='humain' AND role_embedding IS NOT NULL`. Commit.

---

## Task 8: Verify (build + tests + live)

- [ ] `npm run build` → succeeds.
- [ ] `npx jest src/modules/models/embedding.service.spec.ts src/modules/agent/services/agent-role-embedding.service.spec.ts src/modules/agent/repositories/agent.repository.spec.ts src/modules/humain-agent src/modules/agent/agent.service.spec.ts` → all pass.
- [ ] **Live smoke** (needs LiteLLM reachable): run a standalone create/update of a humain agent through `AgentRoleEmbeddingService` against `agentstore_test`, then `SELECT role_embedding IS NOT NULL` → true; confirm re-embedding after a role change. If LiteLLM is not reachable from this env, note it and rely on the mocked tests + backfill dry-run.

## Definition of Done
- `agents.role_embedding halfvec(3072)` + HNSW cosine index exist in `agentstore`/`agentstore_test` and the contract `.sql`.
- Creating/updating a humain agent (via profile flow or generic agent edit) recomputes and stores the embedding of `` `${name}. ${role}` ``, best-effort and non-blocking.
- Existing humain agents backfilled. Build + all listed tests green.
- Search/query endpoint intentionally deferred.
