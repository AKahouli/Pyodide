# Mongo and PostgreSQL persistence

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 9. Mongoose & Schemas

**Not everything is Mongo:** the conversation domain (conversations, messages, citations, branches, reports, shares) is persisted in PostgreSQL via Drizzle — see [domain pattern 24.5](persistence.md). Do not look for conversation data in Mongo collections; `messages`/`conversations` there are legacy and stale.

- Always `@Schema({ timestamps: true })`. Export `HydratedDocument<T>` as `<Name>Document`.
- Declare indexes next to the schema, not in services.
- Apply `toJSON` transform: `_id` → `id`, strip `__v`. The frontend expects `id`.
- Use strict typing (`!` on required, `?` on optional).

**Queries:** Prefer `.select()` projection over full documents. Use `.lean()` on read-heavy endpoints. Compound indexes for paginated queries. **Never** leak internal Mongo fields through the API.

**Persisted editable fields:** when adding a field users can edit, update every persistence/contract layer in one change: Mongoose schema defaults, create/update DTO validation, service mapping/serialization, public interfaces, frontend types, and any autosaved editor payload. Missing any layer causes silent data loss in autosaved UIs.

**Revision-based optimistic concurrency:** documents that multiple workers or users may mutate concurrently (e.g. `workspace-artifact`, `governance-deployment-revision`) carry a monotonic `revision` (or equivalent) counter. Update payloads must include `expectedRevision`; the service atomically increments it and rejects mismatches. Pair this with a unique compound index on the logical identity (e.g. `(programId, workspaceId)` for governance bindings, `(workspaceId, artifactType)` for artifacts). Do not use bare `findOneAndUpdate` for documents that have a revision field — always filter on the expected revision.

**Embedded lease state machine:** long-running generation/extraction jobs embed the lease sub-document directly on the job document (`leaseToken`, `expiresAt`, `attempt`, `retryCount`, `engineVersion`). Workers claim by atomic filter on `leaseToken == null OR expiresAt < $now`, then write results back only if their `leaseToken` still matches; long runs must extend `expiresAt` via heartbeat. Unique job identity is a compound key (e.g. `(sourceVersionId, jobType, inputHash, engineVersion)` for knowledge-extraction jobs). Do not introduce an external queue for these workers without documenting why Mongo-embedded leases are insufficient.

## Conversation Domain Persistence (PostgreSQL + Drizzle)

The conversation domain — conversations, messages (including the `components` payload with text parts, citations, and artifacts), branches, reports, shares, analytics, playbook handoffs, and group members/invites — is persisted in **PostgreSQL**, not Mongo. Connection details come from the Joi-validated `postgres` config namespace (`POSTGRES_HOST/PORT/USER/PASSWORD/DB/...`); the poc environment's database is named `agentstore`.

- **Access layer:** the global `PostgresModule` (`src/modules/postgres/`) owns the `pg` `Pool` (`PG_POOL`) and the Drizzle handle (`DRIZZLE_DB`, `drizzle-orm/node-postgres`), wrapped by `PostgresConnectionService`. Services must never create their own pool or read `POSTGRES_*` env directly ([related guidance](api-contracts.md)/[related guidance](verification.md) rules apply to Postgres too).
- **Store tokens, not DB handles:** consuming services inject symbol tokens (`CONVERSATION_STORE`, `MESSAGE_STORE`, `CONVERSATION_BRANCH_STORE`, `REPORT_STORE`, `SHARE_STORE`, `CONVERSATION_ANALYTICS_STORE`, `CONVERSATION_PLAYBOOK_HANDOFF_STORE`) defined in `src/modules/conversation/persistence/` and bound to `persistence/postgres/*` implementations in `ConversationPersistenceModule`. Add new persistence behind a token the same way; keep services storage-agnostic so the store can be faked in unit tests.
- **Schema & migrations:** tables are declared with Drizzle `pg-core` in `src/modules/postgres/schema/` (the conversation tables live under `pgSchema('conversation')` in `conversation.schema.ts`). Migrations are generated with `drizzle-kit` into `./drizzle/` (numbered SQL files, e.g. `0005_conversation.sql`); `drizzle.config.ts` reads the same `POSTGRES_*` env. A schema change is not done until the migration exists and both sides of any reader/writer are updated.
- **ID and column conventions:** Mongo-style 24-hex ids are preserved — primary/foreign keys are `char(24)` with a `^[0-9a-f]{24}$` check constraint, so existing id handling and API contracts stay unchanged. Timestamps are `timestamp with time zone`.
- **Ordered references:** use the `orderedIdTable()` helper (e.g. `conversation_workspaces`, `conversation_tagged_agents`, `conversation_selected_skills`) for ordered many-to-many references — `(id, position)` primary key plus FK to the owner — instead of JSON arrays when ordering and referential integrity matter.
- **Message payloads are one jsonb column:** text parts, citations, artifacts, and tool components live in `conversation.messages.components` (jsonb). There is no per-component collection or table; when the payload shape changes, update the mapper (`persistence/postgres/postgres-message-record.mapper.ts`) and every consumer in the same change.
- **Cross-store boundary:** workspace documents (the files citations and artifacts point at) remain in Mongo (`workspace_documents`) and blob storage. Resolution paths (e.g. `ConversationArtifactService`) read Postgres for the citation identity, then Mongo for the document — verify both sides when changing either, and remember the two stores can disagree on naming (citation `fileName` may be the storage `filename` while Mongo keeps a different `originalName`). Mongo `messages`/`conversations` collections are legacy: do not read them as current data and do not write new code to them.
- **Testing:** unit specs mock the store tokens. For real-SQL integration tests, opt in via `src/modules/postgres/testing/pg-integration.ts` — `describeIntegration` skips unless `POSTGRES_HOST` is set, and `makeTestDb()` targets `POSTGRES_TEST_DB` so the real `agentstore` is never polluted. Use that helper instead of ad-hoc pools.
