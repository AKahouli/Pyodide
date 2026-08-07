# MongoDB → PostgreSQL Migration — Feasibility Study

**Date:** 2026-08-03
**Scope:** `back/` NestJS backend (`yellostorm-backend` v1.11.1)
**Decision requested:** Full replacement of MongoDB/Mongoose with PostgreSQL. This document assesses **feasibility**, **impact**, and **whether a data-model change is required**. It is a study only — no implementation plan or code changes are included.

---

## 1. Executive summary

| Question | Verdict |
|---|---|
| **Is it feasible?** | **Yes — no technical blockers.** Every MongoDB feature that typically makes migration impossible is absent from this codebase. |
| **What is the impact?** | **Large but mechanical, and highly concentrated.** The dominant cost is *volume* (149 schemas, ~215 files with direct ODM coupling) and re-normalizing a document-oriented model — not exotic features. |
| **Is a data-model change required?** | **Yes.** But the model splits cleanly: ~60–70% of collections are already relational-shaped and normalize mechanically; ~30–40% (execution engines + governance snapshots) are best kept as `jsonb` with promoted query columns. |

**Recommendation:** Proceed. Adopt a **hybrid relational + `jsonb`** target schema on PostgreSQL, managed with **Drizzle ORM**. The migration is a multi-month effort dominated by mechanical rewrites, not research risk. The single biggest structural cost is that there is **no datastore abstraction seam** today — every service is directly coupled to Mongoose (`@InjectModel`).

**Motivation validated:** The stated driver — cost/licensing plus wanting database indexing the MongoDB Community edition cannot provide — is sound. PostgreSQL delivers **GIN / `tsvector` full-text search and `pgvector`** for embeddings natively, with no paid tier. Note this is a *new forward capability*: there is no MongoDB-side full-text or vector search in the code today (text search is delegated to an external service), so nothing is lost in the swap and the indexing capability is gained.

---

## 2. Current-state map

### 2.1 Stack
- **NestJS 10**, Node ≥ 20, TypeScript 5.5.
- **Mongoose 8.21** via `@nestjs/mongoose`. **149 `*.schema.ts` files** across ~46 modules.
- **Two Mongoose connections**: the primary app DB (`modules/database/database.module.ts`, global) and a **separate isolated `logging` connection** (`modules/logger/logger.module.ts`, toggleable via `LOGGING_PERSISTENCE_ENABLED`). Both need PG equivalents.
- Config in `config/database.config.ts` (default `mongodb://localhost:27017/yellostorm`), validated in `config/config.schema.ts`.

### 2.2 PostgreSQL already present (but not app-owned)
Postgres is already a runtime dependency (`pg` ^8.22, `@electric-sql/client` ^1.5.23), used in exactly two feature-scoped places, both talking to **external databases the app does not own**:
- **`modules/memory-cards/memory-cards.service.ts`** — ad-hoc `pg.Pool` reading an external `thematic_memory` DB (`memory_cards_metadata` table). Disabled/503 when `MEMORY_PG_HOST` is unset.
- **`modules/worky/services/worky-electric-consumer.service.ts`** — consumes an *external* "Worky manager" Postgres via ElectricSQL HTTP shapes (`messages`, `plans`, `plan_steps`) and mirrors rows **into Mongo**.

**Implication:** the team already operates Postgres and writes raw parameterized SQL, but there is **no template for an app-owned PG schema**, **no shared `pg` provider**, **zero migration tooling**, and **zero `.sql` files**. Schema management must be chosen from scratch.

> Note: `connector.service.ts` / `connector-mcp-runtime.service.ts` use the MCP SDK `Client`, **not** `pg` — they are not Postgres consumers.

### 2.3 No abstraction seam
- **409 `@InjectModel` usages across 215 files.** Services use Mongoose models directly.
- The only `*Repository` classes (5, in `knowledge-intelligence`) are still Mongoose-backed and single-collection — not a portable datastore interface.
- A migration therefore touches essentially every feature service. Introducing a thin repository layer per module is part of the work, not a pre-existing convenience.

---

## 3. Feasibility analysis — feature by feature

The risk surface is **narrow and concentrated**. Counts exclude `*.spec.ts`.

### 3.1 Absent = zero migration risk ✅
| Feature | Status |
|---|---|
| Change streams (`.watch`) | **None.** No real-time change-stream consumers. |
| Geospatial (`2dsphere`, `$near`, `$geoWithin`) | **None.** |
| Mongo-side text / vector search (`$text`, `$search`, `$vectorSearch`, Atlas Search) | **None.** Delegated to external service. |
| GridFS / binary-in-Mongo | **None.** (WhatsApp Baileys auth state is an *encrypted string* → trivially a `text`/`bytea` column.) |
| Discriminators / `discriminatorKey` | **None.** Polymorphism is `type`-enum + `Mixed` payload. |

### 3.2 Present but low-risk (PG makes them easier) 🟢
- **Multi-document transactions — 5 `withTransaction` flows, all in `governance`** (`governance-source.service.ts:182` delete cascade, `governance-source-transition.service.ts:25`, `governance-source-review-scheduler.service.ts:51`, `governance-knowledge-assessment.service.ts:164`, `governance-temporal-candidate.service.ts:41`). `knowledge-intelligence` repositories thread an optional `ClientSession` across collections. On PostgreSQL, ACID transactions are always available, so the existing `isTransactionUnavailable()` / `transitionWithoutTransaction()` fallback paths (`governance-source-review-scheduler.service.ts:58-99`) become **dead code that can be deleted** — a net simplification.
- **~9 analytics aggregation pipelines** (`analytics/*`, `usage`, `worky-budget`, `worky-report`, `log-buffer`) — `$match`/`$group`/`$dateToString`/`$unwind`. Map directly to SQL `GROUP BY` / `date_trunc` / `LATERAL unnest`.

### 3.3 Present and genuinely hard 🔴
These four are where design attention is required:
1. **`governance-source-review-scheduler.service.ts:35` & `:69`** — two near-identical 8-stage pipelines, each with **two correlated `$lookup` sub-pipelines** (`let` + `$expr`) plus a computed dedup key (`$concat`/`$toString`/`$dateToString`) and a `{'reviewDueEvent.0':{$exists:false}}` anti-join. → SQL: multi-CTE query with two `LEFT JOIN … WHERE … IS NULL` anti-joins. Doable; the duplication means two copies stay in sync.
2. **`connector-playbook-binding-sync.service.ts:54`** — an `updateMany` **with an aggregation pipeline** (`$map` + nested `$mergeObjects` + `$cond` + `$filter`) rewriting `toolBindings` arrays nested inside `nodes[]` inside `flows`. Pure artifact of the embedded-array model. → Once normalized, becomes a one-line `UPDATE … WHERE connector_id = $1`.
3. **`playbook.service.ts:206`** — paginated list with correlated `$lookup` + `$facet` (count + page in one round trip). → Windowed SQL query or two queries.
4. (Watch item) The `$facet`/`$lookup` combination also underpins several list endpoints; each needs a deliberate SQL rewrite rather than a mechanical translation.

### 3.4 Present, mechanical, high-volume 🟡
- **Atomic array/nested operators** (`$push`/`$pull`/`$addToSet`/`$inc`/positional/dotted-path) — **379 hits / 106 files.** These operate on embedded arrays (`members[]`, `skills[]`, `toolBindings[]`, etc.) that become **join tables**; each becomes an `INSERT`/`DELETE`/`UPDATE` on a child table.
- **Dynamic query construction** (`$or`/`$and`/`$in`/`$regex`/`$elemMatch`/`$exists`/`$ne`) — **498 hits / 136 files.** `$regex`→`ILIKE`/`~`; `$in`→`= ANY`; `$elemMatch`/`$exists` on embedded arrays are the ones that require rethinking once normalized. A shared query-builder helper reduces the per-file cost.
- **Upserts / `findOneAndUpdate`** — 282 hits / 92 files. Most → `INSERT … ON CONFLICT DO UPDATE`. The ones combining `$setOnInsert` + `$inc`/`$push` need care.
- **`bulkWrite`** — 3 files → batched upserts.

---

## 4. Impact analysis

### 4.1 Structural coupling (the biggest cost)
No datastore seam exists. 409 `@InjectModel` across 215 files means the migration is inherently repository-by-repository across the whole codebase. Recommended shape: introduce a per-module Drizzle-backed repository/service, migrate one module at a time behind that boundary.

### 4.2 Schema & index translation
- **~339 `index(...)` declarations across 141 schemas** → mechanical DDL translation.
- **~15 partial/unique compound indexes** → PG partial unique indexes (`CREATE UNIQUE INDEX … WHERE …`). Ports well but one-by-one. Notable: `governance-source-event.schema.ts:36` (dedup key that backs §3.3.1), `governance-membership.schema.ts:52-53`, `agent.schema.ts:188-189`, `conversation.schema.ts:164,167`.
- **~14 TTL indexes (`expireAfterSeconds`)** → ⚠️ **PostgreSQL has no native TTL.** Each needs a scheduled cleanup job (`pg_cron` or NestJS `@nestjs/schedule` cron). Affected: `auth/session`, multiple `*-oauth-state`, `shared-conversation`, `upload-session`, `telegram-link-code`, several `playbook-flow` lease/idempotency schemas, `notification` (`metadata.expiresAt`), and retention TTLs on `audit-log` (730d), `usage-log` (30d), `log` (30d). This is a discrete, well-bounded workstream.

### 4.3 Referential integrity — new risk introduced
- **324 `ref:` declarations across 106 files, with no DB-level FK enforcement today.** MongoDB never enforced these, so **orphaned references almost certainly exist** and will violate foreign keys on import. A **data-cleaning / validation pass is mandatory** before or during backfill (this is a dev environment, so cleanup is low-stakes but still required for the load to succeed).
- **IDs embedded as strings inside `Mixed` blobs** (e.g. `conversation.schema.ts` `runtimeDefinition.{primaryAgentId, allowedAgentIds[], workspaceIds[]}`) are invisible to any schema-driven tooling and will not be caught automatically. These must be found by hand and either promoted to real FK columns or accepted as opaque `jsonb`.

### 4.4 Two connections
The isolated `logging` Mongoose connection needs its own PG target (or a decision to route logs elsewhere). `LOGGING_PERSISTENCE_ENABLED=false` is a viable interim.

---

## 5. Data-model change — required, and how

**A data-model change is unavoidable** (relational tables ≠ documents), but it is not uniform. The model splits cleanly by module.

### 5.1 Relational-shaped (~60–70%) — normalize mechanically
Identity/config/join/ledger collections: `User`, `Workspace`, `Project`, `Team`, `Agent`, `Connector`, `Skill`, `Tool`, `Role`, `Session`, all `*-share` / `*-link` / `*-oauth-state` / `*-idempotency` / `*-ledger`, and the thin `worky-*` event/trace rows.
- Clear FK edges (324 refs), **shallow single-hop joins** (52 `.populate()` calls, never recursive — deepest is 2 levels via path string).
- **M2M ObjectId arrays → junction tables** (`Agent.tools/skills/connectors/knowledgeBases`, `User.roles`, `Conversation.workspaces`, governance `allowedAgentIds`/`sourceIds`).
- Sharing is **already** modeled as explicit join collections → 1:1 to relational join tables.

### 5.2 Document-shaped (~30–40%) — keep as `jsonb`, promote query columns
The **playbook / playbook-flow execution engines** and **governance revision snapshots**:
- Worst offender: `playbook/schemas/playbook-execution.schema.ts` embeds `taskResults[] → {judgeHistory[], evaluationHistory[], stepExecutions[] → {toolTrace[], llmPromptTrace[], artifacts[], components[]}}` + `advisorTurnHistory[]` + a `Record<string, Array<…>>` map — **4–5 levels of nested arrays in one document.**
- `playbook-flow` (25 schemas) mirrors this; `governance-deployment-revision.schema.ts:36-58` has 7 immutable `Object` snapshot blobs.
- **Recommended target:** store the payload as a `jsonb` column and promote only the **query-driving fields** to real columns (`playbookId`, `status`, `executedBy`, `createdAt`). These are append-mostly audit/execution records queried by parent id + status, so full normalization (8–10 child tables each) is not worth the cost.

### 5.3 Flexible fields & polymorphism
- **136 `Mixed` / `type: Object` fields across 58 files → `jsonb`.** Includes JSON-Schema definitions in `connector.schema.ts`, message payloads (`components[].data`), governance snapshots. `@Schema({ strict: false })` subdocs in `playbook.schema.ts` are genuinely schemaless → `jsonb`.
- **Poor-man's polymorphism** (`type`/`kind` enum + `Mixed data`, e.g. `Message.components[].type` with 17 variants) → a table with a `type` column + `jsonb` payload (or per-type tables where queries demand it).

### 5.4 Primary keys
`_id` ObjectId is the PK everywhere; `toJSON` already remaps `_id → id`. Target: `uuid` PKs (or keep the 24-char hex as `text`/`bytea` if preserving existing IDs matters — in a dev env, regenerating as `uuid` is cleaner). Self-references (`Message.parentMessageId`, `WorkspaceDoc.parentId`, `Team.members.parentAgentId`) become self-FKs.

---

## 6. Recommended target architecture

- **ORM / migrations: Drizzle ORM.** Rationale: SQL-first (matches the raw parameterized SQL the team already writes in `memory-cards`), first-class `jsonb` typing, native `pgvector` support, lightweight, and its `drizzle-kit` migrations fill the current zero-tooling gap. Fits the hybrid relational+`jsonb` model better than a heavier ORM that hides SQL.
- **Schema strategy:** relational tables for §5.1, `jsonb`-with-promoted-columns for §5.2/§5.3.
- **Indexing (the motivation):** b-tree/compound as today; **GIN on `jsonb`** for document-shaped tables; **`tsvector` + GIN** for full-text; **`pgvector`** if/when vector search is brought in-house. All community-edition, no licensing.
- **TTL replacement:** `pg_cron` (if available on the target PG) or NestJS `@nestjs/schedule` cleanup jobs — one per current TTL index.
- **Access layer:** introduce a thin per-module repository boundary so services stop depending on Mongoose directly; migrate module-by-module behind it.
- **Connections:** primary app PG + a decision on the `logging` connection (separate schema/DB or disable persistence).

---

## 7. Risk register (prioritized)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | No abstraction seam — every service coupled to Mongoose (409 uses / 215 files) | **High** | Introduce per-module repositories; migrate incrementally |
| R2 | Orphaned refs violate FKs on import (no integrity enforced today) | **High** | Mandatory data-cleaning/validation pass before backfill |
| R3 | IDs hidden as strings inside `Mixed` blobs escape tooling | **Medium** | Manual audit of `Mixed` fields carrying IDs; promote or accept as opaque |
| R4 | 4 hard aggregation pipelines (correlated `$lookup`/`$facet`/update-pipeline) | **Medium** | Rewrite as CTEs/window queries with dedicated tests |
| R5 | No native TTL — 14 expiry behaviours must be rebuilt | **Medium** | `pg_cron` / scheduled cleanup jobs |
| R6 | Deeply nested execution/trace documents | **Medium** | `jsonb` + promoted columns, not full normalization |
| R7 | High-volume mechanical rewrite (379 atomic ops + 498 dynamic queries) | **Medium (volume)** | Shared query-builder + repository helpers; module-by-module |
| R8 | Second (`logging`) connection | **Low** | Separate PG schema or disable persistence |

---

## 8. Rough effort sizing & phasing

> High-level T-shirt estimates for scoping only — **not** commitments. Assumes 1–2 engineers familiar with the codebase, dev environment (no zero-downtime cutover constraints).

| Phase | Work | Size |
|---|---|---|
| **P0 — Foundations** | Stand up app-owned PG; add Drizzle + `drizzle-kit`; shared connection provider; CI test DB; TTL-cleanup job scaffold | **S–M** |
| **P1 — Relational core** | Schema §5.1 (users, workspaces, projects, teams, agents, connectors, skills, tools, roles, sessions, shares, ledgers); junction tables; repositories; port CRUD + dynamic queries | **L** |
| **P2 — Document/jsonb domains** | playbook, playbook-flow, governance snapshots as `jsonb` + promoted columns; rewrite the 4 hard pipelines; governance transactions | **L** |
| **P3 — Supporting modules** | conversation(+v2), worky, knowledge-intelligence, analytics, usage, notifications, auth-provider, whatsapp/telegram, logger | **L** |
| **P4 — Indexes, integrity, cutover** | All indexes incl. partial/unique + GIN; FK constraints; data-cleaning + backfill scripts; remove Mongoose; delete transaction-fallback dead code | **M–L** |
| **P5 — Hardening** | Full test pass, query performance/index tuning, jsonb GIN validation | **M** |

**Overall order of magnitude:** a **multi-month** effort (roughly on the order of **3–6 engineer-months** given 149 schemas / 215 coupled files), front-loaded on P1–P3. The risk is schedule (volume), not feasibility.

**Suggested first PoC target (if/when moving beyond this study):** a self-contained relational module such as `project` or `team` — small, flat, clear FKs — to validate the Drizzle repository pattern and the migration harness before tackling the execution engines.

---

## 9. Open decisions (for the implementation-planning phase)

1. **ID strategy:** regenerate as `uuid` (clean, recommended for dev) vs. preserve existing 24-char ObjectId hex as `text`.
2. **`logging` connection:** dedicated PG schema/DB vs. disable persistence vs. ship logs to an external sink.
3. **PG TTL mechanism:** `pg_cron` availability on the target host vs. app-level `@nestjs/schedule`.
4. **Execution-engine fidelity:** confirm the `jsonb`-with-promoted-columns approach is acceptable for playbook/playbook-flow vs. any reporting need that would force fuller normalization.
5. **ElectricSQL / Worky:** whether the app-owned PG changes the current external-PG→Mongo mirror for Worky (may be invertible or removable once the app is on PG).
6. **Full-text/vector scope:** whether to bring the externally-delegated search in-house onto `tsvector`/`pgvector` as part of this migration or defer it.

---

*Feasibility study — analysis only. No implementation performed.*
