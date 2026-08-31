# Conversation v1 MongoDB to PostgreSQL Migration Plan

> **Status:** PostgreSQL-only development cutover implemented and verified on 2026-08-30.
>
> **Supersedes:** `C:\Users\zadmi\Downloads\yellowstorm_conversation_postgres_migration_plan.md`.
>
> **Execution:** This remains Tier 3 persistence work. The implementation uses a fresh PostgreSQL development database; existing Conversation development data is disposable.

## Scope Update (2026-08-30)

The current implementation direction supersedes the live-data migration and rollback steps below:

- PostgreSQL is the only runtime owner for Conversation v1 data.
- No Mongo-to-PostgreSQL backfill, dual-write, reconciliation, driver selector, reverse delta, or production rollback path is required.
- `ConversationPersistenceModule` binds Conversation, Message, Report, Share, Handoff, Analytics, and branch-state tokens directly to PostgreSQL adapters and registers no Conversation-owned Mongoose schemas.
- User remains Mongo-owned for profile and invitation lookups.
- The historical preflight and repair tooling remains documented for provenance, but it is not a prerequisite for the fresh-database cutover.
- External REST, SSE, gRPC, authorization, idempotency, branching, reliability, correction, sharing, reporting, analytics, and handoff contracts remain unchanged.

Any later production migration from a populated MongoDB source requires a new approved plan; do not infer production readiness from the historical backfill sections in this document.

## Goal

Move the complete Conversation v1 persistence domain from MongoDB/Mongoose to the existing app-owned PostgreSQL/Drizzle datastore while preserving REST responses, IDs, authorization, pagination, branching, streaming, reliability/correction workflows, reports, sharing, analytics, and Conversation-to-Playbook handoffs.

The final state has one authoritative Conversation v1 store, no Conversation-owned Mongoose models, and no direct Conversation schema registration in consuming modules.

## Executive Decisions

1. PostgreSQL is authoritative for Conversation v1 runtime persistence in development.
2. Use the existing `PostgresModule`, `DRIZZLE_DB`, Drizzle schema barrel, migration directory, and app-owned `POSTGRES_*` configuration.
3. Create a dedicated PostgreSQL schema named `conversation` with `pgSchema('conversation')`.
4. Migrate five owned Mongo collections:
   - `conversations`
   - `messages`
   - `reports`
   - `shared_conversations`
   - `conversation_playbook_handoffs`
5. Preserve Mongo `_id` values as lowercase 24-character hex strings. Generate new Conversation v1 entity IDs in the application as 24-character hex strings.
6. Preserve the handoff contract's separate UUID `handoffId`; store both the Mongo document `_id` and the public handoff UUID.
7. Do not migrate User, Workspace, Project, Skill, Governance, Telegram, WhatsApp, or Conversation v2 data.
8. Keep external-domain IDs as opaque 24-character references without cross-database foreign keys.
9. Remove the redundant `Conversation.messages[]` relation. `messages.conversation_id` is the relational ownership source.
10. Preserve `messageCount` and `lastMessageAt` as stored business aggregates. Do not silently recompute them from message rows during this migration.
11. Preserve current title and full-text search semantics during cutover. AI component search is a separately approved follow-up, not migration parity work.
12. Keep heterogeneous components, snapshots, governance data, replay data, telemetry, reliability data, correction data, interactions, and handoff context in `jsonb`.
13. Do not route live token delivery through PostgreSQL. SSE, gRPC, and process-local stream buffers remain unchanged.
14. Do not implement dual-write, backfill, writer-freeze, reconciliation, or rollback machinery for the fresh development database.
15. Do not add a persistence-driver selector; runtime provider tokens bind directly to PostgreSQL adapters.
16. Do not add ElectricSQL, pgvector, embeddings, or `mcp-conversation` in this migration.

## Corrections to the Previous Draft

| Draft claim | Assessment | Updated decision |
|---|---|---|
| Four owned collections | Incorrect | Include `conversation_playbook_handoffs`, its state machine, unique keys, and TTL behavior. |
| Conversation module is the only consumer | Incorrect | Migrate direct consumers in Analytics, Project, Workspace, and the Governance document type boundary. |
| `messageCount` equals all Message rows | Incorrect in current runtime | Backfill and preserve the stored value. Report drift separately. Current user-message creation increments it; AI placeholder creation does not, while branch/share clones set it differently. |
| `lastMessageAt` equals max Message creation time | Incorrect in current runtime | Preserve the stored value. It is touched when a user message is created and when an AI message completes. |
| Full-text search should include AI components | Intentional behavior change, not parity | First preserve current literal case-insensitive substring matching over title or `Message.content`. Add AI component search later behind separate acceptance criteria. |
| Normalize group invites with unique `(conversation,email)` | Not proven by current schema | Preserve source rows and order. Add uniqueness only if preflight proves duplicates cannot exist and product ownership accepts it. |
| One transaction creates user and AI messages | Incompatible with current controller sequencing without orchestration work | Use separate local transactions for user-message persistence, AI-placeholder/link persistence, and AI completion. Preserve retry recovery for a user message with no placeholder. |
| HTTP maintenance mode is a complete write freeze | Incorrect | Freeze or drain HTTP, active streams, cron cleanup, Telegram, WhatsApp, reliability/correction workers, branch seeding, and playbook-handoff consumers across every backend replica. |
| Existing agent backfill is a direct template | Incomplete | Conversation data is mutable. Use update-aware upserts and a frozen delete reconciliation; do not skip existing target rows. |
| Cleanup affects only the Conversation module | Incorrect | Remove direct Conversation schema registrations and Mongo pipelines from Analytics, Project, and Workspace before deleting schemas. |

## Source-Backed Current State

### Owned schemas

- `conversation.schema.ts` owns Conversation scalar state, workspace/skill/agent arrays, branch state, group membership/invites/mentions, and aggregate fields.
- `message.schema.ts` owns user/AI turns, message links, stream leases, telemetry, replay state, reliability state, and correction state.
- `report.schema.ts` owns user and system-correction reports.
- `shared-conversation.schema.ts` owns public snapshots, private share metadata, access tokens, expiry, revocation, and view count.
- `conversation-playbook-handoff.schema.ts` owns prepared/bound/consumed handoffs and a 24-hour TTL.
- `conversation.module.ts:72-79` registers those five schemas plus the externally owned User schema.

### Direct Mongoose consumers in Conversation v1

- `services/conversation.service.ts`: Conversation, Message, SharedConversation, User.
- `services/message.service.ts`: Message.
- `services/conversation-branch.service.ts`: Conversation and Message.
- `services/share.service.ts`: SharedConversation, Conversation, and Message.
- `services/report.service.ts`: Report, Message, and User.
- `services/conversation-playbook-handoff.service.ts`: ConversationPlaybookHandoff.
- `services/choice-interaction.service.ts`: Message.
- `services/response-reliability-evidence.builder.ts`: `MessageDocument` type dependency that must become a neutral Message record.
- `guards/conversation-owner.guard.ts`: Conversation.

### Cross-module direct consumers

- `analytics/analytics.module.ts` re-registers Conversation, Message, and Report.
- `analytics/services/conversation-analytics.service.ts` uses Mongo aggregation pipelines over all three collections.
- `project/project.module.ts` re-registers Conversation.
- `project/project.service.ts` counts conversations by project and detaches conversations when a project is deleted.
- `workspace/workspace.module.ts` re-registers Conversation.
- `workspace/workspace.service.ts:550-554` removes a deleted workspace from all conversations.
- `governance/services/governed-conversation-runtime.service.ts` imports `ConversationDocument` as an internal type.
- `governance/services/governed-conversation.service.ts` creates governed Conversation records through `ConversationService`.
- `governance/services/governance-dry-run.service.ts` consumes both `ConversationService` and `MessageService`; governance dry-run documents persist Conversation IDs in their own Mongo collection.
- `playbook-flow/assistant/playbook-assistant.service.ts` consumes `ConversationPlaybookHandoffService`; its contract must remain stable.
- Telegram and WhatsApp persist Conversation IDs in their own Mongo records and call Conversation services. Their collections remain Mongo-owned.

### Important runtime invariants

- Message send retry identity is `(conversationId, senderId, conversationType, requestId)` when request and sender exist.
- Platform-copilot, governed-conversation, and branch creation use separate unique request identities.
- User message creation and AI placeholder creation are currently separate, recoverable steps.
- Stream, reliability, correction, branch-seed, and handoff ownership use conditional atomic updates.
- Branch seeding has an external ADK side effect and a compensating state machine. Do not hold a database transaction over that call.
- Group access includes owner, member, and restricted invited-user behavior in `ConversationOwnerGuard`.
- Public share reads enforce expiry even before Mongo TTL deletion.
- Handoff prepare/replay and bind enforce expiry; consume currently relies on record existence after binding.
- Message page 1 is the newest window queried descending and returned oldest-to-newest within that page.
- Current `searchScope=fulltext` is literal case-insensitive substring matching over Conversation title or `Message.content`; it does not inspect AI components.

## Scope

### In scope

- PostgreSQL schema, migrations, repositories, records, and row mappers.
- Temporary Mongo and PostgreSQL persistence adapters.
- Conversation, Message, Branch, Choice Interaction, Share, Report, and Handoff persistence refactors.
- Stream/recovery, reliability, correction, cron, and access queries that mutate or inspect owned persistence.
- Analytics SQL replacement.
- Project count/detach and Workspace detach operations through Conversation-owned APIs.
- User lookups through the User module rather than User schema re-registration.
- Backfill, exact verification, cutover, rollback runbook, and cleanup.
- Unit, adapter-contract, real-PostgreSQL integration, service regression, and focused end-to-end tests.

### Out of scope

- Conversation v2.
- User, Workspace, Project, Governance, Skill, Telegram, or WhatsApp migration.
- Frontend contract changes.
- New REST, SSE, gRPC, or protobuf contracts.
- Private-sharing product redesign.
- Repairing `messageCount` semantics.
- AI-component search, `search_text`, tsvector, pgvector, or embeddings.
- Permanent CDC, dual-write, or generic multi-database infrastructure.

## Target PostgreSQL Model

### ID and timestamp rules

- Use `char(24)` for Mongo ObjectId identities to match the existing Agent migration convention.
- Every row mapper must trim PostgreSQL `char(24)` padding.
- Add checks for lowercase 24-character hexadecimal IDs on owned primary keys. Preflight external references before adding equivalent checks to all reference columns.
- Use `uuid` for `handoff_id` and keep a separate `char(24)` primary key for the migrated Mongo handoff `_id`.
- Use `timestamptz` for every timestamp.
- Preserve source `createdAt` and `updatedAt` exactly during backfill.
- PostgreSQL repositories must explicitly update `updated_at`; Drizzle does not reproduce Mongoose timestamps automatically.

### `conversation.conversations`

Columns:

```text
id                                    char(24) primary key
runtime_mode                          varchar not null
runtime_purpose                       varchar not null
pinned_agent_id                       char(24) null
platform_copilot_creation_request_id  varchar null
governed_creation_request_id          varchar null
title                                 varchar(200) not null
created_by                            char(24) not null
system_workspace_id                   char(24) null
project_id                            char(24) null
last_message_at                       timestamptz null
message_count                         integer not null
is_archived                           boolean not null
is_shared                             boolean not null
shared_from                           char(24) null
initialization_status                 varchar not null
branch_seed_attempt_id                varchar null
branch_request_id                     varchar null
branch_provenance                     jsonb null
governance_context                    jsonb null
is_group                              boolean not null
is_first_message                      boolean not null
created_at                            timestamptz not null
updated_at                            timestamptz not null
```

Constraints and indexes:

- Checks for runtime mode, runtime purpose, initialization status, and non-negative `message_count`.
- Existing owner/list/project/runtime indexes, with sort columns matching repository queries.
- Unique partial `(created_by, platform_copilot_creation_request_id)`.
- Unique partial `(created_by, governed_creation_request_id)`.
- Unique partial `(created_by, branch_request_id)`.
- Keep complete branch and governance values in JSONB. `branch_request_id` is the queryable projection of `branchProvenance.requestId`.

Do not create a `conversation_messages` junction and do not store a message-ID array on this row.

### Ordered Conversation child tables

Create:

- `conversation_workspaces`
- `conversation_selected_skills`
- `conversation_tagged_agents`
- `conversation_group_members`
- `conversation_group_invites`
- `conversation_group_tagged_agents`
- `conversation_member_mentions`

Rules:

- Every table has an owned `conversation_id` foreign key with `ON DELETE CASCADE`.
- Preserve externally visible/source array order with a `position` column where the source is ordered.
- Group members use `(conversation_id, user_id)` as their logical unique identity after a duplicate preflight.
- Group invitations use an internal identity and indexed normalized email. Do not add an email uniqueness constraint unless source preflight and product behavior support it.
- Member mentions preserve source order and use a Message foreign key with cascade deletion.
- Workspace, Skill, Agent, and User IDs do not receive cross-domain foreign keys.
- Replacement operations delete and insert the affected ordered set in one transaction.

### `conversation.messages`

Columns:

```text
id                                    char(24) primary key
conversation_id                       char(24) not null
sender_id                             char(24) null
parent_message_id                     char(24) null
conversation_type                     varchar not null
content                               text null
components                            jsonb null
attached_file_ids                     varchar(24)[] null
agent_ids                             varchar(24)[] null
member_ids                            varchar(24)[] null
model_id                              varchar(100) null
reasoning_effort                      varchar(50) null
web_search_enabled                    boolean not null
question_message_id                   char(24) null
answer_message_id                     char(24) null
feedback                              varchar null
feedback_at                           timestamptz null
is_edited                             boolean not null
edited_at                             timestamptz null
is_streaming                          boolean not null
is_complete                           boolean not null
stream_execution_lease_id             varchar null
stream_execution_lease_expires_at     timestamptz null
input_tokens                          integer null
output_tokens                         integer null
model_request_telemetry               jsonb null
duration_ms                           integer null
time_to_first_chunk                   integer null
time_to_first_token                   integer null
request_id                            varchar null
guardrail_decision                    jsonb null
interaction                           jsonb null
interactions                          jsonb null
replay_context                        jsonb null
reliability_evaluation                jsonb null
correction_workflow                   jsonb null
reliability_evaluation_heartbeat_at   timestamptz null
created_at                            timestamptz not null
updated_at                            timestamptz not null
```

Constraints and indexes:

- `conversation_id` references `conversations(id)` with cascade deletion.
- Message self-references use `ON DELETE SET NULL` and are backfilled in a second pass.
- Checks for `conversation_type`, feedback, non-negative metrics, and content length at most 50,000 characters.
- Preserve current conversation/time, conversation/type, question/type/time, streaming/recovery, and reliability indexes.
- Add JSON expression indexes only for status paths proven by `EXPLAIN` to need them.
- Preserve the partial unique request identity `(conversation_id, sender_id, conversation_type, request_id)` when request and sender are non-null.
- Keep optional arrays nullable so absent and empty source values can remain distinguishable where response mapping depends on it.

### Search indexes

Preserve current behavior with:

- A trigram GIN index on `conversations.title`.
- A trigram GIN index on nullable `messages.content`.
- A parameterized `ILIKE` query using `EXISTS` for message matches.
- Explicit escaping of `\`, `%`, and `_` so SQL LIKE metacharacters remain literal, matching the current escaped Mongo regex behavior.

Create `pg_trgm` in the migration only if deployment permissions allow it. Otherwise document a DBA prerequisite and fail the migration clearly.

Do not add `search_text` in this migration. Adding searchable AI component projections is a future behavior change requiring data-classification and component allowlist review.

### `conversation.reports`

Preserve:

- Mongo `_id` as the primary key.
- Conversation and Message IDs as indexed weak references without foreign keys. Current Conversation deletion can leave reports behind, and changing that behavior requires separate approval.
- External `user_id` without a cross-domain foreign key.
- Reason, source, and status checks.
- Description and admin-notes maximum lengths.
- Unique `(user_id, message_id)`.
- One `system_correction` report per message through the equivalent partial unique index.
- Existing pagination order and report-detail pairing behavior.

Preflight the legacy conflict where a user report may already satisfy a system-correction request. Preserve `createSystemCorrectionReport()` reuse behavior.

### `conversation.shared_conversations`

Preserve:

- Mongo `_id`, original Conversation ID, sharer ID, type, title, snapshot JSONB, token, recipients, fork IDs, expiry, count, revocation, and timestamps.
- Ordered `recipient_emails` and `forked_conversation_ids` arrays.
- Unique partial non-null access token.
- Original Conversation foreign key with cascade deletion after orphan preflight.
- Atomic `view_count = view_count + 1`.
- Read-time revoked and expiry enforcement.
- A B-tree index on `expires_at` for bounded scheduled cleanup.

Use an idempotent scheduled bounded delete for expired rows. Keep read-time expiry as the access-control source of truth.

### `conversation.conversation_playbook_handoffs`

Columns include:

- `id char(24)` for the migrated Mongo `_id`.
- `handoff_id uuid` unique for the public opaque ID.
- Contract version, owner/source/target/platform/bound-message IDs.
- Creation request and all fingerprints.
- Ordered canonical selected answer IDs.
- Context, candidate bindings, and defaults in JSONB or typed arrays without changing their contract.
- Status and binding fields.
- Prepared, bound, consumed, expiry, created, and updated timestamps.

Preserve:

- Unique `(owner_id, creation_request_id)`.
- Indexed `(owner_id, platform_conversation_id, status)`.
- Atomic `prepared -> bound -> consumed` transitions.
- Current idempotency mismatch behavior.
- Current expiry behavior for prepare/replay and bind.
- Playbook Flow's existing `consume()` contract.
- Indexed weak source, target, platform-conversation, and bound-message references. Do not add cascading foreign keys: a bound handoff can currently be consumed without reloading its source Conversation or Message.
- A B-tree index on `expires_at` for bounded scheduled cleanup.

Use scheduled expiry cleanup. Any proposal to reject an already-bound handoff solely because its timestamp elapsed before cleanup is a separate behavior decision and must not be introduced accidentally.

## Persistence Boundaries

Create store-neutral records and narrow ports under `conversation/persistence/` or `conversation/repositories/`:

- Conversation aggregate read/write port.
- Message read/write and lease/CAS port.
- Report port.
- Shared Conversation port.
- Conversation Playbook Handoff port.
- Conversation analytics read port.
- Cross-module reference operations for Project and Workspace.

During migration, provide Mongo and PostgreSQL implementations behind explicit provider tokens. Do not inject Drizzle directly into orchestration services and do not expose generic `save(any)` methods.

Records use string IDs and plain objects. Remove service dependence on `HydratedDocument`, `Document`, `Model<T>`, `.populate()`, `.lean()`, `.save()`, `.markModified()`, `.toObject()`, and ObjectId methods.

Use a small datastore-neutral 24-hex ID utility for new owned IDs and validation. Do not require Mongoose merely to generate or validate an ID after cleanup.

## Required Cross-Module Refactors

### User composition

Replace direct User model access in Conversation and Report services with narrow User module operations for:

- User summaries by IDs.
- User lookup by email set.
- Reporter email lookup.

Batch user hydration for group responses to replace Mongoose populate behavior.

### Analytics

Replace Mongo pipelines with SQL behind a Conversation-owned analytics read port. Preserve:

- Consenting-user filtering.
- Date boundaries and day/week/month grouping.
- Message-count aggregate statistics based on stored `message_count`.
- Conversation duration calculation from stored `last_message_at`.
- Component type distribution using `jsonb_array_elements`.
- Feedback distribution/rate.
- Report reason distribution.
- Edited-message regeneration rate.
- Existing rounding and response shapes.

Analytics passes user IDs as strings across the new boundary.

### Project

Expose Conversation-owned operations to:

- Count owner conversations by project IDs.
- Count one owner/project pair.
- Detach all owner conversations from a deleted project.

Remove Conversation schema registration from `ProjectModule`.

### Workspace

Expose a Conversation-owned operation to detach a deleted workspace from all Conversation workspace rows. Remove Conversation schema registration from `WorkspaceModule`.

### Governance and Playbook Flow

Replace `ConversationDocument` type leakage with a store-neutral runtime record. Preserve `ConversationPlaybookHandoffService` as the Playbook Flow boundary so the current assistant contract remains unchanged.

Include `GovernedConversationService` and `GovernanceDryRunService` in PostgreSQL-driver regression tests and in the writer-freeze inventory. Their Mongo-owned governance records continue storing 24-character Conversation IDs.

### Raw migration scripts

Inventory and retire or rewrite scripts that directly mutate Conversation collections, including governed-conversation backfills and platform-copilot index scripts. No operational script may continue treating Mongo Conversation data as authoritative after cutover.

## Transaction and Concurrency Rules

### User turn

Preserve the current recoverable sequence:

1. Transaction A inserts the user Message and applies the corresponding Conversation aggregate/ordered-child changes.
2. Commit Transaction A.
3. Perform existing non-database side effects such as notifications outside the transaction.
4. Transaction B inserts the AI placeholder and conditionally sets the user's first `answer_message_id`. It does not change Conversation aggregates because the removed `Conversation.messages[]` reference is the only Conversation field currently changed at placeholder creation.
5. Commit Transaction B.
6. Start the stream after commit.
7. A later completion transaction conditionally completes the AI Message, increments `message_count`, and sets `last_message_at` exactly once for the winning completion owner.

Do not hold a transaction over model validation, workspace/blob calls, email, gRPC, SSE, or ADK work. Preserve retry recovery when Transaction A succeeded but Transaction B did not.

### Leases and conditional state

Implement stream lease claim/renew/release, completion ownership, reliability claims, correction ownership, stale cleanup, branch seed claims, and handoff transitions as single conditional SQL updates. Assert affected-row counts and preserve current conflict/not-found behavior.

### Branching

- Insert the pending branch Conversation and cloned Message rows in one PostgreSQL transaction.
- Generate all 24-hex IDs before insert.
- Preserve selected-path ordering and remap parent/question/answer links.
- Keep the external ADK seed after commit.
- Preserve pending/seeding/ready/cleanup_pending and compensating cleanup for ADK failure.
- Keep branch request uniqueness and concurrency tests.

### Sharing

- Make each private fork's Conversation and Message copy internally transactional.
- Preserve current partial-success private-share behavior unless product ownership separately approves an all-or-none change.
- Keep public snapshot sanitization at write and read time.
- Increment public view count atomically.

### Deletion

- Use PostgreSQL cascades for Messages, Shares, and normalized Conversation child rows where current deletion already removes those records.
- Keep Report and Handoff references weak for current behavior parity. A later retention/deletion policy may add cleanup and foreign keys only after explicit product approval and source-data repair.
- Keep external workspace/blob cleanup outside the PostgreSQL transaction.
- Define retry/compensation for external cleanup success followed by database failure.
- Do not add foreign keys to Mongo-owned entities.

## Configuration and Module Wiring

`ConversationPersistenceModule` imports `PostgresModule` and binds all Conversation-owned provider tokens directly to PostgreSQL adapters. There is no persistence selector or Mongo fallback. `ConversationModule` imports `UserModule` because User remains Mongo-owned.

## Backfill Tooling

> **Excluded from the approved development cutover.** Existing development Conversation data is disposable. No backfill, verifier, reconciliation, or related package command is implemented.

Create:

- `scripts/backfill-conversations-to-postgres.ts`
- `scripts/verify-conversations-postgres.ts`

Required import flags:

```text
--dry-run
--batch-size=N
--since=<ISO timestamp>
--resume-from=<cursor>
--checkpoint-file=<path>
--only=conversations|messages|reports|shares|handoffs|all
--verify
--strict
--reconcile-deletes
```

`--reconcile-deletes` is allowed only during the complete writer freeze.

### Import behavior

- Read Mongo without mutating it.
- Use deterministic `_id` ordering and bounded batches.
- Upsert mutable rows with `ON CONFLICT DO UPDATE`.
- Replace each mutable ordered child set in the same target transaction as its parent update.
- Use source `updatedAt` as the normal incremental signal with overlapping checkpoint boundaries.
- Use canonical field hashes where timestamps are absent or untrustworthy.
- Never skip a target row merely because its ID already exists.
- Never log Message content, components, snapshots, handoff context, or other sensitive payloads.
- Emit structured anomaly records containing IDs, collection, field name, and reason only.

### Import order

1. Conversation base rows without Message-dependent child rows.
2. Non-Message Conversation child rows.
3. Message base rows with self-links null.
4. Message self-link patch after all Message rows exist.
5. Member mentions.
6. Reports.
7. Shared Conversations.
8. Conversation Playbook Handoffs.

Migrate every source row still present in Mongo, including an expired TTL row that Mongo has not yet physically deleted. This single source predicate applies to counts, ID sets, hashes, and delete reconciliation. PostgreSQL cleanup begins only after PostgreSQL becomes authoritative.

## Verification

Frozen strict verification compares canonical source and target representations without printing payload values. Verification during online backfill is advisory because Mongo is still mutable; it reports a moving delta and import defects but is not the zero-mismatch cutover gate.

### Exact gates

- ID sets for all five owned collections.
- Every scalar, timestamp, nullable/default distinction, ordered array, ordered child row, and JSON payload.
- Message self-links and Conversation ownership.
- Conversation child sets and positions.
- Report and Share constraints.
- Handoff fingerprints, bindings, status, and expiry.
- Zero unexpected owned orphans.
- Zero duplicate source identities that violate target unique constraints.
- Zero malformed owned IDs.
- Zero unreviewed import errors.
- No target-only rows after frozen `--reconcile-deletes`.

### Informational anomaly reports

Report, but do not silently repair or automatically fail solely on:

- Stored `messageCount` versus actual Message row count.
- Stored `lastMessageAt` versus Message creation/completion timestamps.
- Historical duplicate arrays where no current source constraint exists.
- Expired TTL rows awaiting Mongo deletion, while still requiring those rows to exist in the target until final frozen reconciliation completes.

Any decision to repair these values requires a version-controlled exception/repair file and separate approval. The verifier must distinguish accepted source anomalies from migration mismatches.

### Canonical hashing

- Normalize ObjectId strings to lowercase.
- Normalize dates to UTC ISO-8601.
- Preserve order where the API/source preserves order.
- Sort only sets proven to be order-insensitive.
- Stable-sort object keys recursively.
- Hash canonical values and report only ID plus mismatched field path.

## Cutover Runbook

> **Excluded from the approved development cutover.** The staging, production, writer-freeze, and operational cutover steps below are retained only as historical planning context.

### Before production

- Apply the schema in an isolated database and inspect generated SQL.
- Rehearse against a representative Mongo snapshot.
- Measure full and incremental import duration.
- Test interruption and resume.
- Test exact delete reconciliation.
- Exercise REST, SSE, branch, group, share, report, reliability, correction, analytics, Telegram, WhatsApp, and Playbook handoff flows on the PostgreSQL driver.
- Confirm Mongo and PostgreSQL backups and restore procedures.
- Decide the post-write rollback policy and point of no return.

### Online phase

1. Deploy schema, both adapters, and `CONVERSATION_PERSISTENCE_DRIVER=mongo`.
2. Run the initial update-aware backfill.
3. Run advisory field verification and investigate stable mismatches while Mongo remains mutable.
4. Repeat overlapping incremental backfills until the delta is small and stable.
5. Observe import errors and resolve source anomalies before scheduling cutover.

### Complete writer freeze

1. Reject new Conversation HTTP mutations.
2. Stop Telegram and WhatsApp Conversation ingestion.
3. Drain or safely stop active streams.
4. Stop reliability/correction work and wait for ownership leases to settle.
5. Stop Governance conversation creation/dry runs, branch/handoff mutations, and Conversation cleanup cron execution.
6. Stop every NestJS backend replica and Conversation-capable worker; only the migration/verifier process remains active.
7. Confirm Mongo source counts and maximum `updatedAt` values remain stable across two observations.

### Final synchronization

1. Run the final overlapping upsert for all five collections.
2. Run `--reconcile-deletes` to remove target rows deleted from Mongo during the online window.
3. Run strict exact verification.
4. Block cutover on any unexplained ID, field, child-row, self-link, orphan, duplicate, or hash mismatch.
5. Run a standalone read-only repository smoke script for PostgreSQL reads, search, access projections, and analytics. Do not start NestJS during the freeze because module initialization starts scheduled/background writers.

### Runtime switch

1. Record the operational point-of-no-return approval. Starting a PostgreSQL-selected NestJS replica can run scheduled/background writes and immediately makes Mongo stale.
2. Deploy every backend replica with `CONVERSATION_PERSISTENCE_DRIVER=postgres`; PostgreSQL is now authoritative even while external ingress remains blocked.
3. Confirm homogeneous configuration and PostgreSQL schema readiness.
4. Run create/send/placeholder/stream/complete/list/branch/group/report/share/handoff smoke tests against PostgreSQL.
5. Reopen external ingress and channel writers.
6. Monitor database, API, stream, reliability, branch, handoff, and analytics failures.

## Rollback Boundary

> **Excluded from the approved development cutover.** No persistence rollback tooling or reverse-delta path is implemented.

Before any PostgreSQL-selected NestJS replica starts, rollback is switching the deployment back to the unchanged Mongo source.

Starting the first PostgreSQL-selected NestJS replica is the point of no return because scheduled/background work may write before external ingress opens. After that point, Mongo is stale and cannot be restored as authority without data loss. A catastrophic rollback requires:

1. Freeze every Conversation writer again.
2. Export and verify the PostgreSQL delta since cutover.
3. Apply a reviewed reverse migration or restore a combined Mongo state.
4. Verify exact parity before selecting Mongo.

If operations require immediate post-write rollback, a reverse-delta tool is a prerequisite. Do not solve that requirement by adding indefinite dual-write.

Document the production commands, owners, expected durations, backup identifiers, freeze confirmation, verification artifact, and rollback decision in `back/docs/migrations/conversation-postgres-runbook.md`.

## Implementation Phases

### Phase 0: Baseline and data preflight

**Status: historical and complete.** The development preflight and repair established the original schema constraints. The preflight/repair implementation and commands were removed after the fresh-database scope was approved.

### Phase 1: Store-neutral contracts and Mongo adapters

**Status: complete and superseded by direct PostgreSQL wiring.** Plain records, narrow ports, string IDs, User-module composition, and service decoupling remain. The temporary Mongo adapters and their tests were removed.

### Phase 2: PostgreSQL schema and migrations

**Status: complete.** Migration `0005_conversation.sql` creates the 12-table `conversation` schema, `pg_trgm`, constraints, foreign keys, partial indexes, and two trigram indexes. The destructive migration verification passes on a clean database and verifies idempotent rerun behavior.

### Phase 3: PostgreSQL adapters

**Status: complete.** PostgreSQL adapters cover Conversation, Message, Branch, Report, Share, Handoff, Analytics, and cross-module references. The real-PostgreSQL store contract verifies transactional, conditional-update, constraint, expiry, and analytics-boundary behavior.

### Phase 4: Service and consumer decoupling

**Status: complete.** Services, guards, Analytics, Project, Workspace, Governance, and Playbook Flow use neutral boundaries. Tests use port doubles, and the Nest module graph boots with PostgreSQL-only providers.

### Phase 5: Backfill and verifier

**Status: not applicable.** Explicitly excluded because existing development Conversation data is disposable.

### Phase 6: Staging rehearsal

**Status: not applicable.** Staging rehearsal and production migration operations are excluded.

### Phase 7: Production backfill and cutover

**Status: not applicable.** Production backfill, cutover, monitoring, and rollback are excluded.

### Phase 8: Stabilization

**Status: replaced by development verification.** Build, focused suites, real-PostgreSQL migration/store contracts, module-graph boot, full Jest, and blocking review are the approved gates.

### Phase 9: Cleanup

**Status: complete for the approved scope.** Mongo adapters, five owned Mongoose schemas, schema exports/tests, preflight/repair tooling, and raw Conversation Mongo scripts are removed. No selector was introduced. User remains Mongo-owned through `UserModule`. PostgreSQL migrations, adapters, and regression gates remain. Archiving or dropping Mongo collections is explicitly excluded.

## Implemented File Areas

```text
YellowStorm/back/src/modules/postgres/schema/conversation.schema.ts
YellowStorm/back/src/modules/postgres/schema/index.ts
YellowStorm/back/drizzle/0005_conversation.sql
YellowStorm/back/src/modules/conversation/persistence/**
YellowStorm/back/src/modules/conversation/conversation.module.ts
YellowStorm/back/src/modules/conversation/services/*.ts
YellowStorm/back/src/modules/conversation/guards/conversation-owner.guard.ts
YellowStorm/back/src/modules/conversation/interfaces/*.ts
YellowStorm/back/src/modules/analytics/analytics.module.ts
YellowStorm/back/src/modules/analytics/services/conversation-analytics.service.ts
YellowStorm/back/src/modules/project/project.module.ts
YellowStorm/back/src/modules/project/project.service.ts
YellowStorm/back/src/modules/workspace/workspace.module.ts
YellowStorm/back/src/modules/workspace/workspace.service.ts
YellowStorm/back/src/modules/governance/services/governed-conversation-runtime.service.ts
YellowStorm/back/src/modules/governance/services/governed-conversation.service.ts
YellowStorm/back/src/modules/governance/services/governance-dry-run.service.ts
YellowStorm/back/src/modules/user/user.service.ts
YellowStorm/back/scripts/test-conversation-postgres-migration.ts
YellowStorm/back/scripts/test-conversation-postgres-store.ts
YellowStorm/back/docs/migrations/conversation-postgres-phase-0.md
YellowStorm/back/docs/migrations/conversation-postgres-phase-1.md
YellowStorm/back/package.json
```

Removed after PostgreSQL-only verification:

```text
YellowStorm/back/src/modules/conversation/persistence/mongo/**
YellowStorm/back/src/modules/conversation/schemas/conversation.schema.ts
YellowStorm/back/src/modules/conversation/schemas/message.schema.ts
YellowStorm/back/src/modules/conversation/schemas/report.schema.ts
YellowStorm/back/src/modules/conversation/schemas/shared-conversation.schema.ts
YellowStorm/back/src/modules/conversation/schemas/conversation-playbook-handoff.schema.ts
YellowStorm/back/src/modules/conversation/migration/**
YellowStorm/back/scripts/preflight-conversations-postgres.ts
YellowStorm/back/scripts/repair-conversations-mongo.ts
YellowStorm/back/scripts/migrations/2026-08-16-create-platform-copilot-conversation-indexes.ts
```

## Verification Commands

Use the narrowest applicable command in each phase:

```bash
npm run db:generate
npm run db:migrate
npx jest src/modules/postgres src/modules/conversation --runInBand
npx jest src/modules/analytics src/modules/project src/modules/workspace --runInBand
npx jest src/modules/governance src/modules/playbook-flow --runInBand
npx jest src/modules/telegram src/modules/whatsapp --runInBand
npm run build
```

Run real PostgreSQL integration tests for partial indexes, intended cascades, weak report/handoff references, transactions, conditional updates, concurrent idempotency, search escaping, TTL indexes/cleanup, and pagination ties. Do not treat mocked Drizzle tests as proof of SQL behavior.

## Minimum Acceptance Criteria

- [x] Existing public IDs, REST shapes, error codes, pagination windows, and ordering are preserved.
- [x] Authorization, idempotency, retries, streaming, reliability, correction, branch, group, share, report, analytics, cross-module reference, and handoff behavior use PostgreSQL stores.
- [x] Current literal title/full-text search behavior is preserved with trigram indexes.
- [x] No runtime Conversation v1 read or write uses MongoDB.
- [x] No external module directly registers or queries a Conversation-owned schema.
- [x] Mongo adapters, owned Mongoose schemas, raw scripts, and migration-only tooling are removed.
- [x] User remains Mongo-owned through its owning module.
- [x] Focused tests, real-PostgreSQL migration/store contracts, build, module graph, and blocking review pass.
- [x] Full backend Jest passes: 370/370 suites and 3,310/3,310 tests.
- [x] Backfill, rollback, staging/production cutover, monitoring, and Mongo collection archival are explicitly excluded.

## Implementation Decisions

Confirmed through 2026-08-30:

1. Development uses the `conversation` PostgreSQL schema and `pg_trgm` extension.
2. Existing development Conversation data is disposable; no data migration or persistence rollback path is required.
3. AI-component search remains deferred.
4. Stored `messageCount` anomalies remain unchanged.
5. User remains Mongo-owned and is accessed through `UserModule`.
6. A future populated-database or production migration requires a new approved plan.

## Final Principle

This migration is complete only when PostgreSQL is the single authoritative Conversation v1 store, all direct consumers use store-neutral Conversation-owned boundaries, and the temporary Mongo/PostgreSQL coexistence code has been removed. Data cleanup, search enhancements, and unrelated product fixes must not be hidden inside persistence cutover work.
