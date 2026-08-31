# Conversation PostgreSQL Migration: Phase 1

> Historical checkpoint: this document records the Mongo-backed seam phase. It was superseded by the PostgreSQL-only development cutover on 2026-08-30.

## PostgreSQL-Only Completion

- `ConversationPersistenceModule` now registers no Conversation-owned Mongoose schemas and binds all persistence tokens to PostgreSQL adapters.
- Conversation, Message, Report, Share, Handoff, Analytics, and branch initialization state use the `conversation` PostgreSQL schema.
- `ConversationService`, `MessageService`, and `ConversationBranchService` use neutral stores. Only User profile/invitation lookup remains Mongo-owned.
- Branch creation preserves request idempotency, transactional clone creation, and conditional `pending -> seeding -> ready/cleanup_pending` ownership.
- Message stream, reliability, and correction ownership use conditional PostgreSQL operations.
- Share and Handoff expiry cleanup runs hourly in bounded batches of 1,000 rows per table using `FOR UPDATE SKIP LOCKED`.
- Conversation list child rows and User summaries are batch-loaded per page.
- Internal branch request/fingerprint metadata is not exposed by the REST response.
- Existing development Conversation data is disposable. No backfill, dual-write, reconciliation, driver selector, or rollback implementation is part of this cutover.
- Temporary Mongo adapters, their contract tests, the five owned Mongoose schemas, schema tests/exports, preflight/repair tooling, and raw Conversation Mongo scripts have been removed.
- The remaining governed-conversation compatibility script now touches only Governance-owned Mongo collections.

Verification:

- PostgreSQL migration gate: 12 tables, `pg_trgm`, and 2 trigram indexes.
- PostgreSQL persistence contract: passed for Conversation, Message, branch CAS, Report, Share, Handoff, Analytics date boundaries, and expiry cleanup.
- `npm run build`: passed.
- Nest module graph: passed.
- Blocking reviewer: `PASS` after analytics, reliability scoping, batch hydration, and public branch-provenance corrections.
- Full Jest after final cleanup and group-conversion parity correction: 370/370 suites and 3,310/3,310 tests passed. The Platform Copilot historical-migration expectation and stale Widget component type assertion were corrected.

## First Read Seam

The first Phase 1 slice introduces store-neutral internal contracts while MongoDB remains the sole persistence implementation:

- `ConversationStore.findActiveAccessById()` returns plain creator, member, and invited-email access data.
- `MessageStore.findAiComponents()` returns a plain AI-message component projection scoped by Conversation and Message IDs.
- `MongoConversationStore` and `MongoMessageStore` contain the corresponding Mongoose queries and ObjectId conversion.
- `ConversationOwnerGuard` and `ChoiceInteractionService` depend on provider tokens rather than Mongoose models.
- `ResponseReliabilityEvidenceBuilder` consumes a plain `{ id, components }` record rather than `MessageDocument`.
- Owned ID validation and generation no longer depend on Mongoose.

This slice changes no REST, SSE, protobuf, frontend, Mongo schema, PostgreSQL schema, driver selector, or cutover behavior. Mongo remains authoritative and is registered behind the neutral provider tokens.

## Handoff Persistence Seam

The next Phase 1 slice moves Conversation-to-Playbook Handoff persistence behind `ConversationPlaybookHandoffStore` while retaining MongoDB as the only implementation:

- `ConversationPlaybookHandoffService` no longer imports Mongoose models, documents, ObjectIds, or query types.
- `MongoConversationPlaybookHandoffStore` owns ObjectId conversion, prepared-record creation, duplicate-key race recovery, and conditional selectors for bind, user-message attachment, and consumption.
- Prepare replay, request fingerprint checks, Platform Copilot creation, expiry, response assembly, and state-machine errors remain service behavior.
- The Mongo selectors preserve prepared-only unexpired binding, bound-only message attachment, exact owner/conversation/turn/message consumption, and consumed replay without an expiry check.

## Entity And Consumer Seams

- `ReportService` now uses neutral Report and Message stores plus `UserService.findSummaryById()`; Mongo owns uniqueness queries, status validation, ObjectId conversion, and report record mapping.
- `ShareService` now uses a neutral Share store; Mongo owns public/private persistence and the current cross-collection private-fork copy/link algorithm. Public snapshot sanitization, expiry errors, and partial-success orchestration remain service behavior.
- Conversation analytics pipelines moved unchanged into `MongoConversationAnalyticsStore`; Analytics no longer registers Conversation, Message, or Report schemas.
- Project and Workspace use Conversation-owned count, detach, and workspace-reference operations rather than registering the Conversation schema.
- Governance receives a plain string-ID runtime record instead of `ConversationDocument`.
- `ConversationPersistenceModule` is the single owner of the five Mongo schema registrations and exports the Mongo-backed neutral tokens without importing controllers or feature services.

## Preserved Behavior

- Pending, seeding, and cleanup-pending Conversations remain inaccessible.
- Creator, member, invited-user, join, and active-stream authorization semantics are unchanged.
- Choice interactions still require an AI Message matching both source Message ID and Conversation ID.
- Reliability evidence uses the same Message ID and components as before.
- Owned IDs are canonical lowercase 24-character hexadecimal strings.
- Handoff creation remains idempotent by owner and creation request, including duplicate-key race recovery.
- Consumed Handoffs replay their stored acceptance timestamp without another state transition.
- Report correction races still reuse existing review work, Share private forks retain partial-success behavior, and public view counts now increment atomically.
- Analytics filters, aggregation pipelines, rounding, and response shapes are unchanged.

## Verification

- Expanded Conversation, Analytics, Project, Workspace, Governance, and Playbook assistant run: 97 suites and 573 tests passed.
- Focused Handoff service and Mongo adapter contract run: 2 suites and 10 tests passed.
- `npm run build`: passed.
- Nest preview module-graph bootcheck: passed.
- Formatting and diff checks: passed.
- Reviewer gate and post-hardening recheck: PASS with no blocking findings.

## Deferred Phase 1 Work

- Broaden neutral ports to Conversation and Message writes and remaining read paths.
- Move Conversation Branch persistence and its conditional initialization/cleanup state machine behind the store boundary.
- Replace remaining `getConversationDocument()` and `getMessageDocument()` contracts with plain records.
- Add PostgreSQL adapters only after the neutral Mongo behavior is covered and reviewed.
