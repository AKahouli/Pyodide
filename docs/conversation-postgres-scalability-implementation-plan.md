# YellowStorm Conversation PostgreSQL Scalability Implementation Plan

## 1. Purpose

Prepare the current PostgreSQL-only Conversation implementation for rapid growth and at least 50 simultaneous modeled users while preserving authorization, message workflow, group, branch, share, and public API behavior.

This plan optimizes the current implementation, not only the database schema. It addresses:

- Application-to-PostgreSQL round trips.
- Unbounded reads and cleanup jobs.
- OFFSET and exact-count work on hot scrolling paths.
- Frontend request fan-out.
- Indexes that match the real predicates and ordering.
- Idempotency and concurrency behavior under simultaneous requests.
- Connection pool pressure and protected operational telemetry.
- Repeatable target-scale verification before production traffic.

## 2. Starting State

The Conversation database is currently disposable and nearly empty. Apply the initial schema/index correction before production data becomes durable. After this rollout, treat all Conversation data as durable and use online operations for later index changes.

Verified implementation costs and risks:

| Operation | Current PostgreSQL behavior |
|---|---|
| Conversation list | Page query + exact count + 7 relation queries: 9 statements |
| Conversation detail | Base row + 7 relation queries: 8 statements |
| Guarded detail | 3 access statements + 8 detail statements: commonly 11 statements |
| Message page | OFFSET query + exact count: 2 statements |
| Initial message rendering | Message page plus one branch HTTP request/query per visible answered user message |
| Message broadcast | Reloads and fully hydrates the Conversation to obtain recipient IDs |
| Reliability cleanup | Unbounded candidate query followed by one UPDATE per candidate |
| Stale stream cleanup | One unbounded UPDATE |
| Branch/private fork | Loads and copies an unbounded message history |

Primary source locations:

- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-conversation-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-message-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-conversation-branch-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-share-store.ts`
- `YellowStorm/back/src/modules/postgres/schema/conversation.schema.ts`
- `YellowStorm/front/src/modules/conversation/store.ts`

## 3. Non-Negotiable Invariants

1. PostgreSQL remains the sole owner of Conversation data.
2. The global JWT guard, `ConversationOwnerGuard`, owner/member/invite access rules, and permission behavior do not weaken.
3. Branch cloning remains transactional.
4. Message stream, reliability, correction, branch seed, and request-id ownership remain compare-and-set operations.
5. Standard-to-group conversion continues to preserve owner membership, both participant input forms, participant jobs, invitations, and email dispatch.
6. Ordered child arrays preserve their `position` ordering.
7. Normalized invitation emails remain non-unique.
8. Mentions remain non-unique unless a separate product decision changes retry semantics.
9. Legacy page-based endpoints remain available for one rollback window.
10. Public health endpoints expose only generic component status.
11. SQL text, bind values, content, emails, tokens, and credentials are never returned by telemetry or written to performance logs.

## 4. Capacity Model

Fifty simultaneous users do not require fifty PostgreSQL connections. Long-lived AI streams mostly consume HTTP/SSE and ADK capacity, not a checked-out database connection. Pool size must be derived from measured query service time and the database-wide connection budget.

Use this deployment constraint:

```text
(backend replica count * pool max per replica)
  + worker/migration connections
  + database administration reserve
  <= 80% of the PostgreSQL max_connections allocation
```

Start with the existing pool maximum of 10 per backend replica. Increase it only when the 50-user test shows sustained acquisition wait while PostgreSQL still has CPU, I/O, lock, and connection headroom. Do not size the pool from HTTP concurrency alone.

## 5. Target Contracts

### 5.1 Additive Conversation cursor mode

Keep the current page response as the default legacy contract. Add:

```http
GET /conversations?mode=cursor&limit=50
GET /conversations?mode=cursor&limit=50&cursor=<opaque>
```

Cursor mode returns a dedicated summary rather than a partially populated `ConversationResponse`:

```ts
interface ConversationSummaryResponse {
  id: string;
  title: string;
  createdBy: string;
  ownerName?: string;
  messageCount: number;
  lastMessageAt?: string;
  isArchived: boolean;
  isShared: boolean;
  isGroup: boolean;
  unseenMentionCount: number;
  projectId?: string | null;
  runtimeMode: 'standard' | 'governed';
  runtimePurpose: 'chat' | 'platform_copilot';
  pinnedAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

```json
{
  "conversations": [],
  "pagination": {
    "mode": "cursor",
    "limit": 50,
    "hasMore": true,
    "nextCursor": "opaque-or-null"
  }
}
```

The cursor is a base64url-encoded, versioned, strictly validated payload containing:

- Sort field and direction.
- Last sort value and Conversation ID.
- Null rank for `lastMessageAt`.
- A hash of filters that affect the result set.

Reject a cursor reused with different filters. No nested query object is used. Cursor data is positional, not an authorization credential; every request still applies the complete access predicate.

Conversation cursor mode is intentionally weakly consistent because `lastMessageAt`, archive state, project, and title are mutable. It guarantees deterministic traversal of the ordering visible to each request and frontend ID deduplication, but it does not promise snapshot isolation across requests. A Conversation that moves ahead of an already-consumed cursor can be absent until the first page is refreshed. The frontend must reset/refetch the first page on focus, reconnect, successful send/completion events, and local archive/project/title mutations.

Implement and test every ordering explicitly. Use native PostgreSQL null ordering so the btree pathkeys match; keep null rank only in the cursor payload and keyset predicate, not as an `ORDER BY CASE` expression:

- `lastMessageAt DESC NULLS LAST`: use native `ORDER BY last_message_at DESC NULLS LAST, id DESC`. After a non-null cursor, select older tuples plus all null rows; after a null cursor, select null rows with a lower ID.
- `lastMessageAt ASC NULLS FIRST`: use native `ORDER BY last_message_at ASC NULLS FIRST, id ASC`, which can reverse-scan the corresponding descending btree after the equality prefix. After a null cursor, select later null IDs plus all non-null rows; after a non-null cursor, select greater timestamp/ID tuples.
- `createdAt` and `title`: both are non-null; use the requested comparison direction and the same direction for the ID tie-breaker.

Target-scale `EXPLAIN` assertions must show that these hot orderings use the expected index pathkeys without an avoidable explicit sort.

Do not describe Conversation cursor mode as gap-free under concurrent recency or metadata updates. The legacy exact-page endpoint remains available for consumers requiring its current behavior.

The frontend stores `ConversationSummaryResponse[]` separately from `currentConversation`. Selecting a summary may render its title immediately, but it must fetch detail before initializing workspaces, skills, group members, invitations, or composer state. Keep the composer disabled while detail is loading.

### 5.2 Additive Message cursor mode

Keep the existing page mode as the default legacy contract. Add:

```http
GET /conversations/:id/messages?mode=cursor&limit=50
GET /conversations/:id/messages?mode=cursor&limit=50&cursor=<opaque>
```

```json
{
  "messages": [],
  "branchesByQuestion": {},
  "pagination": {
    "mode": "cursor",
    "limit": 50,
    "hasMore": true,
    "nextCursor": "opaque-or-null"
  }
}
```

Rules:

- The immutable key is `(created_at, id)`.
- SQL reads descending with `LIMIT limit + 1`; the API reverses the selected window to chronological display order.
- The next cursor represents the oldest returned row.
- The cursor includes the optional `conversationType` filter hash.
- An absent cursor requests the first window.
- `mode=cursor` permits an absent cursor but rejects an explicitly supplied `page`.
- Legacy mode rejects `cursor` and applies `page = 1` only after mode-specific validation.
- Remove the current DTO `page` property initializer; service/controller normalization supplies the legacy default so transformation cannot create a false page/cursor conflict.
- `nextCursor` is `null` exactly when `hasMore` is false.
- Invalid version, timestamp, ID, filter hash, or payload shape returns the established validation error.
- `branchesByQuestion` is fetched in one batched statement for all user-message IDs in the window.
- Cursor mode performs no OFFSET and no exact count.

The frontend migrates initial and older-message loading to cursor mode and stops issuing one branch request per visible message. Keep the individual branch endpoint for compatibility and targeted refreshes.

Apply the same mode-discriminated DTO/default rules to Conversation cursor mode: an absent cursor means the first window, an explicitly supplied page is invalid in cursor mode, and the legacy page default is assigned only after mode validation.

## 6. Query Architecture

### 6.1 Conversation summary query

Implement one set-oriented statement:

1. Build accessible Conversation IDs from an owner branch and a member branch joined through `(user_id, conversation_id)`.
2. Deduplicate IDs with `UNION`, not application code.
3. Apply the exact visible-state predicate `initialization_status = 'ready'`, followed by runtime, archive, project, and search filters.
4. Apply deterministic sort plus `id` tie-breaker.
5. Apply keyset predicate and `LIMIT limit + 1`.
6. Join only the current user's unseen mention aggregate.

Do not hydrate workspaces, skills, tagged agents, all members, all invitations, or all mentions for list mode.

Rewrite every visible Conversation access/list query intended to use a `... WHERE initialization_status = 'ready'` partial index to use that exact equality. Do not retain `NOT IN ('pending', 'seeding', 'cleanup_pending')` on those paths and assume PostgreSQL will prove the partial-index implication. The allowed status constraint makes `ready` the only visible state, so this is behavior-preserving. Target-scale plan tests must prove index selection before an old broad index is dropped.

Optimize the legacy list separately so it preserves its full response and exact total. Use one page/count statement plus one set-oriented relation hydration statement, not seven relation queries. Legacy mode is not the frontend hot path after migration.

### 6.2 Conversation detail query

Replace `hydrateMany()` fan-out with one statement built from:

- One Conversation row.
- Independent child aggregates joined by `conversation_id`.
- A mention aggregate grouped by `(conversation_id, user_id)` before it is attached to members.

Never join all child tables into one unaggregated row set; that multiplies workspaces, skills, agents, members, invitations, and mentions.

Preserve array ordering with `array_agg/jsonb_agg(... ORDER BY position)`. Preserve current empty-array, optional, date, and branch-provenance response semantics.

### 6.3 Projection-specific store methods

Stop using a full `ConversationRecord` for operations that need two or three fields. Add explicit internal records and methods:

| Projection | Required fields | Consumers |
|---|---|---|
| Access | id, createdBy, memberIds, invitedEmails | `ConversationOwnerGuard` |
| Runtime | routing/runtime/workspace/skill fields used for a turn | send-message controller and stream startup |
| Ownership resources | id, createdBy, isGroup, systemWorkspaceId | update/delete/member ownership checks |
| Workspace | workspace IDs and system workspace ID | document and upload paths |
| Broadcast recipients | createdBy and active member IDs | message/reliability/correction broadcasts |
| Orphan cleanup | id, createdBy, systemWorkspaceId | orphan cleanup |

Each projection is one statement. Do not call `findById()` from projection methods.

### 6.4 Mutation paths

- `create`: use returned base columns and the validated input arrays to construct the response. Do not perform an eight-statement post-create hydration.
- `updateOwned`: issue `UPDATE ... WHERE id = ? AND created_by = ? RETURNING id`; update only relation sets present in the patch; hydrate detail once after commit for the response.
- `deleteOwned`: return a boolean or minimal deleted-row projection. The service already retrieves ownership resources before external workspace cleanup.
- `getWorkspaceIds`, `getGroupMembers`, and `getTaggedAgents`: use dedicated projections.
- `findOrphaned`: return only the cleanup projection.
- `findTurnByRequestId`: retrieve the user turn and optional AI ID with one self/lateral join.
- `canonicalizeMany`: load all referenced choice messages in one query instead of sequential per-choice reads.
- `addMentions`: lock/select all target members once, calculate per-user positions once, and bulk insert in one transaction. Preserve duplicate mention semantics.
- Broadcast paths: query recipient IDs only. Batch recipient lookup by distinct Conversation IDs during cleanup broadcasts.

### 6.5 PostgreSQL idempotency correction

The send-message race handler currently recognizes Mongo duplicate code `11000`. PostgreSQL reports unique violations as SQLSTATE `23505`.

Add a shared PostgreSQL error predicate that checks:

- SQLSTATE `23505`.
- Constraint `uq_messages_request_identity`.

On this exact conflict, re-read the turn and apply the existing fingerprint comparison. Do not convert unrelated unique violations into idempotent success.

Add a real-PostgreSQL concurrency test proving that simultaneous identical request IDs produce one user message and one recoverable response, while a different fingerprint returns the current conflict error.

## 7. Day-One Index Inventory

Apply these indexes now, while Conversation data is disposable. Use a normal Drizzle migration because no production traffic depends on the current tables.

### 7.1 Conversations

```sql
CREATE INDEX idx_conv_owner_ready_last_v2
ON conversation.conversations
  (created_by, last_message_at DESC NULLS LAST, id DESC)
WHERE initialization_status = 'ready'
  AND runtime_purpose <> 'platform_copilot';

CREATE INDEX idx_conv_owner_ready_created_v2
ON conversation.conversations (created_by, created_at DESC, id DESC)
WHERE initialization_status = 'ready'
  AND runtime_purpose <> 'platform_copilot';

CREATE INDEX idx_conv_owner_ready_title_v2
ON conversation.conversations (created_by, title, id)
WHERE initialization_status = 'ready'
  AND runtime_purpose <> 'platform_copilot';

CREATE INDEX idx_conv_owner_project_last_v2
ON conversation.conversations
  (created_by, project_id, last_message_at DESC NULLS LAST, id DESC);

CREATE INDEX idx_conv_platform_owner_last_v2
ON conversation.conversations
  (created_by, last_message_at DESC NULLS LAST, created_at DESC, id DESC)
WHERE runtime_purpose = 'platform_copilot';

CREATE INDEX idx_conv_platform_agent_last_v2
ON conversation.conversations
  (created_by, pinned_agent_id, last_message_at DESC NULLS LAST, created_at DESC, id DESC)
WHERE runtime_purpose = 'platform_copilot';

CREATE INDEX idx_conv_initializing_updated_v2
ON conversation.conversations (updated_at, id)
WHERE initialization_status IN ('pending', 'seeding', 'cleanup_pending');

CREATE INDEX idx_conv_orphan_created_v2
ON conversation.conversations (created_at, id)
WHERE message_count = 0 AND is_first_message = true AND is_shared = false;
```

Retain the existing partial unique request indexes and title trigram GIN index.

### 7.2 Group access and mentions

```sql
CREATE INDEX idx_group_members_user_conversation
ON conversation.conversation_group_members (user_id, conversation_id);

CREATE INDEX idx_group_invites_conversation_email
ON conversation.conversation_group_invites (conversation_id, normalized_email);

CREATE INDEX idx_mentions_user_unseen_conversation
ON conversation.conversation_member_mentions (user_id, conversation_id)
WHERE seen_at IS NULL;
```

`idx_group_invites_conversation_email` is deliberately non-unique. Retain the mention message index for message-delete foreign-key work.

### 7.3 Messages

```sql
CREATE INDEX idx_messages_conv_created_v2
ON conversation.messages (conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_messages_conv_type_created_v2
ON conversation.messages
  (conversation_id, conversation_type, created_at DESC, id DESC);

CREATE INDEX idx_messages_ai_question_created_v2
ON conversation.messages (question_message_id, created_at, id)
WHERE conversation_type = 'ai';

CREATE INDEX idx_messages_streaming_updated_v2
ON conversation.messages (updated_at, id)
WHERE is_streaming = true;

CREATE INDEX idx_messages_pending_reliability_v2
ON conversation.messages (reliability_evaluation_heartbeat_at, id)
WHERE reliability_evaluation->>'status' = 'pending';
```

Retain:

- Message primary key.
- `uq_messages_request_identity`.
- `idx_messages_content_trgm` for the existing content substring-search contract.

Every writer that sets reliability status to `pending` must also set `reliability_evaluation_heartbeat_at`. The cleanup path handles historical null heartbeats as a separately bounded recovery query; it must not make the indexed hot query depend on a JSON timestamp cast.

### 7.4 Shares, handoffs, and reports

```sql
CREATE INDEX idx_shared_original_created_v2
ON conversation.shared_conversations
  (original_conversation_id, created_at DESC, id DESC);

CREATE INDEX idx_shared_expires_v2
ON conversation.shared_conversations (expires_at, id)
WHERE expires_at IS NOT NULL;

CREATE INDEX idx_handoffs_expires_v2
ON conversation.conversation_playbook_handoffs (expires_at, id);

CREATE INDEX idx_reports_created_v2
ON conversation.reports (created_at DESC, id DESC);

CREATE INDEX idx_reports_status_created_v2
ON conversation.reports (status, created_at DESC, id DESC);

CREATE INDEX idx_reports_reason_created_v2
ON conversation.reports (reason, created_at DESC, id DESC);
```

Keep unique share/report/handoff constraints and their other predicate-specific indexes.

### 7.5 Superseded indexes

After target-scale `EXPLAIN` comparison, remove only indexes fully replaced by the v2 definitions. The migration test asserts the final exact inventory so an old broad index is not accidentally retained forever.

Likely replacements include:

- `idx_conversations_owner_last_message`
- `idx_conversations_owner_created`
- `idx_conversations_owner_project_last_message`
- `idx_conversations_runtime_purpose`
- `idx_conversations_initialization_status`
- `idx_messages_conversation_created`
- `idx_messages_conversation_type`
- `idx_messages_question_type_created`
- `idx_messages_streaming_updated`
- `idx_messages_reliability_heartbeat`
- Old share/handoff/report ordering indexes replaced above

Do not drop `idx_conversations_owner_archived_last_message` until the archive-filter plan is measured. It may remain useful even though it cannot satisfy the unfiltered default ordering.

## 8. Benchmark-Gated Schema Changes

Do not add these on assumption alone:

- Additional archive-specific partial indexes.
- Covering indexes with `INCLUDE` payload columns.
- Denormalized member Conversation recency.
- BRIN indexes.
- JSONB GIN indexes.
- Message table partitioning.
- Read replicas.
- Cached or estimated Conversation totals.
- A derived `search_text` column.
- `pg_stat_statements` as a runtime dependency.

Promote one only when a representative query plan or load result identifies the matching bottleneck and the measured read benefit exceeds write/storage cost.

## 9. Search Scope

The current `fulltext` mode is substring search over Conversation title and `messages.content`. It is not a search of all visible AI component content. Keep that behavior for this scalability rollout.

Actions:

1. Retain the existing title/content trigram GIN indexes.
2. Require a trimmed search term of at least three characters in the new cursor mode.
3. Debounce frontend search and cancel superseded requests.
4. Rewrite the search CTE so message matches are deduplicated to Conversation IDs before paging.
5. Test selective and common terms at target scale.

If product requirements later include AI components, corrections, citations, sources, and artifacts, design a separate canonical search document. That design must cover every direct insert/copy/update path, including branch clone, private fork, and correction publication. Do not introduce a partially maintained `search_text` column in this rollout.

## 10. Bounded Heavy Operations

### 10.1 Cleanup

Use ordered candidate CTEs with `LIMIT 1000 FOR UPDATE SKIP LOCKED` for:

- Stale branch state.
- Stale streaming messages.
- Stale pending reliability.
- Expired shares.
- Expired handoffs.

Reliability and stream cleanup use one set-based UPDATE per batch and return only fields needed for notification. Do not return complete Message JSONB when broadcasting a status change.

The orphan cleanup runs under a PostgreSQL session advisory lock so only one backend replica performs external workspace cleanup. Check out one dedicated `PoolClient`, acquire `pg_try_advisory_lock` on that client, hold that same client for the complete external-cleanup loop, release the advisory lock on that client in `finally`, and then release the client. Never acquire/release a session lock through independent pool queries. Keep the current orphan batch of 50. Add cross-replica, thrown-exception, and shutdown-path tests proving single ownership and lock release. Do not reuse `initialization_status='cleanup_pending'` as an orphan claim because branch cleanup assumes that status has branch provenance.

### 10.2 Branch and share cloning

Replace unbounded history APIs with bounded reads using `limit + 1`.

Add configuration:

```text
CONVERSATION_MAX_CLONE_MESSAGES=2000
CONVERSATION_MAX_PRIVATE_SHARE_RECIPIENTS=20
CONVERSATION_CLONE_INSERT_BATCH_SIZE=250
```

- Reject a synchronous branch/public snapshot/private fork above the configured message limit with a stable domain error before loading the complete payload.
- Add `@ArrayMaxSize(20)` and normalized-email deduplication to private-share recipients.
- Keep recipient forks sequential or tightly bounded; never start one full transaction per recipient concurrently.
- Insert cloned messages in bounded batches inside the existing transaction to avoid PostgreSQL parameter limits.
- Preserve every ID remapping and reset rule with column-by-column contract tests.
- If real use requires larger histories, move clone work to a durable job workflow rather than raising the synchronous limit without a load test.

## 11. Query Budgets

Budgets count SQL statements and exclude transaction `BEGIN/COMMIT`, global JWT work, Mongo User/file enrichment, and external ADK calls.

| Operation | Required budget |
|---|---:|
| Cursor Conversation list | 1 PostgreSQL statement |
| Legacy Conversation list | At most 2 PostgreSQL statements |
| Access guard | 1 PostgreSQL statement |
| Guarded Conversation detail | 2 total: guard + detail |
| Cursor Message window with branches | At most 2 PostgreSQL statements |
| Legacy Message page | 2 PostgreSQL statements |
| Broadcast recipient lookup | 1 projection statement |
| Idempotency turn lookup | 1 PostgreSQL statement |
| Stale cleanup batch | 1 claim/update statement per cleanup type |
| Orphan candidate lookup | 1 bounded projection statement |

Mutation budgets are based on changed relation sets:

- User message creation: one INSERT and one Conversation counter update in one transaction.
- AI placeholder: one INSERT and one conditional question-link update.
- AI completion: one CAS UPDATE and one Conversation counter update in one transaction.
- `updateOwned`: one ownership-scoped base UPDATE, only the relation delete/insert pairs named in the patch, then one detail response read.

Add integration assertions that count statements by stable operation name. Do not optimize statement count by combining unrelated work into a row-multiplying or lock-heavy query.

## 12. Pool and Query Safety

Extend PostgreSQL configuration with validated values for:

- Pool maximum, idle timeout, and acquisition timeout.
- Application statement timeout.
- Idle-in-transaction timeout.
- TCP keepalive.
- Application name including service and replica identity.

Recommended initial application statement timeout is 30 seconds; clone/load administration uses an explicit separate timeout. Validate the value in staging rather than silently accepting malformed environment variables.

Record:

- `totalCount` as allocated connections.
- `idleCount`.
- `checkedOutCount = totalCount - idleCount`.
- `waitingCount`.
- Acquisition latency histogram.

Do not call `totalCount / max` saturation. Pool pressure is sustained checked-out percentage plus wait count and acquisition latency.

## 13. Telemetry and Health

### 13.1 Low-overhead operation telemetry

Create an in-memory bounded aggregator keyed by an allowlisted operation name. Record count, error count, total duration, max duration, statement count, and pool acquisition duration.

Flush one aggregate record per active operation every 60 seconds. The aggregate may use the existing logger because it produces tens of records per minute, not one Mongo document per SQL operation. Per-request timing logs must use `save: false` or remain in memory.

Example operation names:

- `conversation.list.cursor`
- `conversation.list.legacy`
- `conversation.detail`
- `conversation.access`
- `message.window.cursor`
- `message.page.legacy`
- `message.turn.lookup`
- `message.cleanup.stream`
- `message.cleanup.reliability`
- `branch.clone`
- `share.fork`

### 13.2 Public health

- Add a bounded PostgreSQL `SELECT 1` check to full health and readiness.
- Keep liveness independent of PostgreSQL.
- Split the current class-level `@Public()` controller. Public routes are limited to `/health`, `/health/live`, and `/health/ready` and return dedicated generic DTOs containing overall status, timestamp, and boolean/component status only.
- Do not expose version, uptime, response times, database names/states, reconnect attempts, raw component messages, history, statistics, pool data, or topology on a public route.
- Apply a short timeout so health checks cannot queue indefinitely behind application work.

Move the existing detailed full-health payload, health history, and health statistics to an authenticated admin controller under `/admin/health`. Require `PermissionsGuard` and `system.maintenance` for every detailed route. The frontend Settings navigation and `HealthSection` must use `usePermissions()` to hide the section and must not fetch detailed health/history/statistics for an unauthorized user. Add public DTO snapshot tests and admin 401/403/allowed contract tests.

### 13.3 Protected PostgreSQL diagnostics

Create a separate controller, not a route under the class-level `@Public()` Health controller:

```http
GET /admin/health/postgres
```

Requirements:

- Global JWT authentication remains active.
- `PermissionsGuard` and `system.maintenance` are required.
- The module imports authorization support.
- Results are single-flight cached for 15 seconds per backend replica.
- Each diagnostic query has a 1.5-second statement timeout.
- Arrays are top-N bounded.
- No raw or sanitized SQL preview is returned. Use `queryid` and numeric aggregates only when `pg_stat_statements` is available.
- Extension absence, statistics reset, or restricted catalog privileges return an `unavailable` subsection, not endpoint failure.

Counter semantics:

- Return `statsResetAt` with cumulative database/index counters.
- Health warnings use interval deltas from the cached previous sample, not lifetime values.
- A historical deadlock does not keep health degraded forever.
- Index usage is informational until the database has representative data and a complete observation window.

Frontend diagnostics are fetched only when an authorized user opens the health section and polling stops while the page is hidden.

## 14. Migration Strategy

### 14.1 Initial rollout before traffic

1. Update Drizzle schema declarations.
2. Generate and inspect `0006_conversation_scalability.sql`.
3. Use normal index creation because the current Conversation data is disposable.
4. Run the migration from a clean database twice.
5. Assert all indexes are ready/valid and no unexpected duplicates remain.
6. Apply this migration before opening production traffic.

### 14.2 Later populated databases

Never put `CREATE INDEX CONCURRENTLY` in the current Drizzle migrator because it wraps migrations in a transaction.

Add an allowlisted operational index runner with:

- One autocommit `pg` connection.
- Database identity and expected-schema preflight.
- A PostgreSQL advisory lock.
- A checked-in manifest ID, SQL checksum, exact up/down DDL, and expected index definition.
- One concurrent create/drop at a time.
- `pg_index.indisready` and `indisvalid` verification.
- Explicit recovery for an invalid same-name index using `DROP INDEX CONCURRENTLY` before retry.
- A dedicated online-schema ledger recording manifest ID, checksum, status, and timestamps.
- Operator confirmation for production and rollback.

Identifiers come only from the checked-in manifest; never interpolate CLI-provided SQL or index names.

## 15. Implementation Phases

### Phase 0: Baseline and contracts

- Add small/target/stress deterministic seed profiles.
- Capture current statement counts and target-scale plans.
- Freeze legacy response fixtures and authorization outcomes.
- Add PostgreSQL duplicate-error concurrency tests.

Exit criteria:

- Current 9-statement list and 11-statement guarded detail are reproduced by tests.
- A target environment fingerprint and initial latency/error baseline are recorded.
- Existing response fixtures cover standard, governed, platform, group, invited, archived, project, and empty cases.

### Phase 1: Empty-database schema correction

- Add the day-one indexes.
- Remove only proven superseded indexes.
- Update migration/schema gates.
- Add pool safety configuration and generic PostgreSQL health.

Exit criteria:

- Fresh and repeat migration gates pass.
- All expected indexes are valid.
- PostgreSQL health failure changes readiness but not liveness.
- Public health snapshots contain no version, timing, database, topology, history, or diagnostic detail; protected health routes enforce `system.maintenance`.

### Phase 2: Projection and mutation optimization

- Add projection-specific store contracts.
- Collapse access/detail hydration.
- Optimize create/update/delete/orphan/workspace/group/broadcast paths.
- Batch choice and mention operations.
- Correct PostgreSQL idempotency conflict handling.

Exit criteria:

- Query-budget integration tests pass.
- Legacy API fixtures remain byte-shape compatible.
- Concurrent request-id, group join, mention position, stream lease, reliability, and correction ownership tests pass.

### Phase 3: Cursor reads and frontend fan-out removal

- Add Conversation and Message cursor DTOs/utilities.
- Add summary and cursor response types.
- Batch branches for each Message window.
- Migrate frontend stores and API wrappers.
- Disable composer state until detail hydration finishes.

Exit criteria:

- Message equal-timestamp cursor tests show no duplicates or gaps.
- Concurrent inserts do not disturb Message pagination.
- Conversation cursor tests cover ASC/DESC null ranks, terminal cursors, malformed/version/filter mismatches, `page`/`cursor` exclusivity, and weak-consistency behavior when recency, title, archive, or project changes between pages.
- Frontend refresh/reset tests prove a moved Conversation is recovered on focus, reconnect, message activity, and local metadata mutations.
- Cursor authorization tests cover owner, active member, invited-only user, outsider, cross-user cursor reuse, and malformed cursors for both endpoints. A cursor never bypasses `ConversationOwnerGuard` or widens the list access predicate; invited-only Message access remains exactly as allowed by the current guard contract.
- Frontend performs one Message-window request instead of N branch requests.
- Legacy mode remains usable for rollback.

### Phase 4: Bounded cleanup and cloning

- Convert stale reliability and stream cleanup to bounded set operations.
- Bound stale branch claims.
- Add cross-replica orphan cleanup locking.
- Add clone limits, recipient limits, and chunked transactional inserts.

Exit criteria:

- Two concurrent workers do not double-own cleanup rows.
- Every cleanup run respects its batch limit.
- Injected branch/fork failures roll back all PostgreSQL rows.
- Oversized clone requests fail before full payload hydration.

### Phase 5: Protected telemetry

- Add aggregate operation metrics.
- Add the protected admin diagnostics endpoint and UI.
- Add reset/delta semantics and cache stampede protection.

Exit criteria:

- Unauthorized requests return 401/403 as appropriate.
- No response/log includes SQL, bind data, content, IDs, emails, tokens, or credentials.
- Missing extensions/restricted statistics degrade one subsection only.

### Phase 6: Target-scale load gate

- Run plan checks on the target seed.
- Run concurrency correctness tests before throughput tests.
- Run stepped load at 1, 10, 25, 50, 75, and 100 modeled users.
- Ratify environment-specific p50/p95/p99 SLOs from the first representative run.

Exit criteria at 50 users:

- No application/database errors, deadlocks, connection acquisition timeouts, or duplicate CAS winners.
- Pool wait is not continuously non-zero for a full 10-second observation bucket.
- Throughput has not plateaued while p95 worsens across two consecutive load steps.
- Query budgets remain unchanged under concurrency.
- Intended indexes are selected for target-scale hot queries.
- Backend/frontend tests, builds, reviewer gate, and browser QA pass.

Phase 6 is a pre-production gate. Run it in the representative staging environment after each relevant phase is integrated and before enabling that path in production. Production smoke tests verify deployment; they do not establish initial capacity.

## 16. Load Profiles

### CI profile

- 20 owners.
- 20 Conversations per owner.
- 20 Messages per Conversation.
- Enough group, project, archive, platform, branch, share, and cleanup rows for contracts.

### Target profile

- 100 owners.
- 200 Conversations per owner.
- 100 Messages per Conversation on average: about 2 million Messages.
- 10% group Conversations with memberships, invitations, and mentions.
- 15% archived.
- 40% assigned to projects.
- Platform and governed Conversations.
- JSON-heavy completed AI messages.
- Selective/common title and message-content search terms.
- Stale stream, reliability, branch, share, handoff, and orphan candidates.

### Stress profile

- At least 5 million Messages.
- Skewed users with thousands of Conversations and long histories.
- Run only in a dedicated performance database.

Seed tooling must require an explicit dedicated-database confirmation, use deterministic IDs/data, support cleanup, and never log credentials.

The HTTP workload should include list/load-more, detail open, Message initial/load-more, search, send/idempotent retry, group activity, controlled branch/share, and cleanup contention. Run a database-focused profile with ADK mocked or controlled, then a separate end-to-end stream profile.

## 17. Required Verification

Backend:

```bash
npm run test:migration:conversations
npm run test:store:conversations
npm test -- --runInBand src/modules/conversation src/modules/postgres src/modules/health
npm run build
```

Frontend:

```bash
npm test -- --run src/modules/conversation/api.test.ts src/modules/conversation/store.test.ts
npm run build
```

Performance:

```bash
npm run seed:conversation-load -- --profile target
npm run test:conversation-plans
npm run load:conversation -- --steps 1,10,25,50,75,100
```

Plan assertions use `EXPLAIN (ANALYZE, BUFFERS, WAL)` on the dedicated performance database. Wrap any mutating `EXPLAIN ANALYZE` in `BEGIN/ROLLBACK` or use a disposable fixture. Never execute a mutating plan against production data.

Browser QA covers desktop/mobile Conversation list, search, opening summaries, disabled composer during detail load, repeated older-message loading, branch navigation, group mentions, refresh, SSE completion, console, and network request counts.

## 18. Rollout and Rollback

Rollout order:

1. Complete Phases 0-6 in a representative staging environment, including correctness, migration, plan, 50-user load, reviewer, and frontend QA gates.
2. Apply Phase 1 to the empty production database before opening Conversation traffic.
3. Deploy backend projections behind feature flags while responses remain legacy-compatible; run production smoke and telemetry checks.
4. Enable additive cursor endpoints for canary traffic and verify query budgets/errors.
5. Deploy frontend cursor consumers behind a rollback flag, then increase exposure.
6. Enable bounded cleanup/cloning and verify batch/lock telemetry.
7. Enable protected diagnostics routes and UI only for authorized users.
8. Compare production smoke telemetry with the ratified staging baseline; do not redefine capacity from production traffic.

Rollback:

1. Revert frontend to legacy pagination first.
2. Disable cursor mode with a feature flag if needed.
3. Revert backend query code while leaving compatible indexes in place.
4. Do not remove useful indexes during an incident.
5. If an index must be removed after data growth, use the online index runner.
6. Cursor state is client-memory-only and needs no data rollback.

## 19. Files Expected to Change

Backend core:

- `YellowStorm/back/src/modules/postgres/schema/conversation.schema.ts`
- `YellowStorm/back/src/modules/postgres/schema/conversation.schema.spec.ts`
- `YellowStorm/back/drizzle/0006_conversation_scalability.sql`
- `YellowStorm/back/drizzle/meta/*`
- `YellowStorm/back/src/modules/conversation/persistence/conversation-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/message-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-conversation-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-message-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-conversation-branch-store.ts`
- `YellowStorm/back/src/modules/conversation/persistence/postgres/postgres-share-store.ts`
- `YellowStorm/back/src/modules/conversation/services/conversation.service.ts`
- `YellowStorm/back/src/modules/conversation/services/message.service.ts`
- `YellowStorm/back/src/modules/conversation/services/choice-interaction.service.ts`
- `YellowStorm/back/src/modules/conversation/controllers/message.controller.ts`
- `YellowStorm/back/src/modules/conversation/dto/conversation-query.dto.ts`
- `YellowStorm/back/src/modules/conversation/dto/message-query.dto.ts`
- `YellowStorm/back/src/modules/conversation/dto/create-share.dto.ts`
- `YellowStorm/back/src/modules/conversation/utils/conversation-cursor.ts`
- `YellowStorm/back/src/modules/conversation/utils/message-cursor.ts`

PostgreSQL/health:

- `YellowStorm/back/src/config/postgres.config.ts`
- `YellowStorm/back/src/modules/postgres/postgres.module.ts`
- `YellowStorm/back/src/modules/postgres/postgres-connection.service.ts`
- `YellowStorm/back/src/modules/postgres/postgres-operation-telemetry.service.ts`
- `YellowStorm/back/src/modules/health/health.service.ts`
- `YellowStorm/back/src/modules/health/health.module.ts`
- `YellowStorm/back/src/modules/health/public-health.controller.ts`
- `YellowStorm/back/src/modules/health/admin-health.controller.ts`
- `YellowStorm/back/src/modules/health/admin-postgres-health.controller.ts`
- `YellowStorm/back/src/modules/health/postgres-health.service.ts`

Frontend:

- `YellowStorm/front/src/modules/conversation/types.ts`
- `YellowStorm/front/src/modules/conversation/api.ts`
- `YellowStorm/front/src/modules/conversation/store.ts`
- `YellowStorm/front/src/modules/sidebar/components/AppSidebar.tsx`
- `YellowStorm/front/src/modules/profile/components/SettingsSidebar.tsx`
- `YellowStorm/front/src/modules/profile/components/HealthSection.tsx`
- Conversation API/store/sidebar/health tests and locale files

Tooling:

- `YellowStorm/back/scripts/test-conversation-postgres-migration.ts`
- `YellowStorm/back/scripts/test-conversation-postgres-store.ts`
- `YellowStorm/back/scripts/deploy-conversation-indexes.ts`
- `YellowStorm/back/scripts/seed-conversation-postgres-load.ts`
- `YellowStorm/back/scripts/test-conversation-postgres-plans.ts`
- `YellowStorm/back/scripts/conversation-postgres-load-gate.mjs`
- `YellowStorm/back/package.json`

## 20. Completion Definition

The work is complete only when:

- The day-one schema is applied before production data becomes durable.
- Hot frontend paths use summary/cursor contracts.
- Query-budget tests prove the reduction in PostgreSQL round trips.
- No hot endpoint performs per-row relation or branch queries.
- Cleanup and cloning are bounded and concurrency-tested.
- PostgreSQL unique conflicts are handled correctly.
- Pool metrics describe actual pressure, not allocated connections.
- Public and protected health boundaries are verified.
- The target-scale 50-user gate passes in a representative environment.
- Reviewer and frontend QA gates pass.
- The ratified environment baseline and operational index procedure are documented.
