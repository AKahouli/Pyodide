# Outbox, governance and asynchronous domain workers

Read only the sections needed for the changed behavior. Paths such as `src/`, `drizzle/` and `package.json` are relative to `YellowStorm/back/`; `front/` means `YellowStorm/front/`. Verify descriptive inventories and known debt against current source before relying on them.

## 24. Advanced Architectural Patterns

These are cross-module patterns that have their own conventions beyond the per-section rules above. Add to them only after reading the existing implementation; they encode load-bearing invariants.

### 24.1 Integration Events (Transactional Outbox)

`integration-events` implements a MongoDB transactional-outbox for cross-module domain events.

- **Envelope:** immutable event documents carry `eventId`, `aggregateType`/`aggregateId`, `eventName`, `payload`, `correlationId`/`causationId`, a global `deliveryState`, per-handler `deliveryRecords[]` keyed by `handlerKey`, and `retryMetadata`. See `integration-events/schemas/integration-event.schema.ts`.
- **Versioned contracts:** producers record events against named, versioned contracts (e.g. `workspace.document.created.v1`, `workspace.document.updated.v1`) under `integration-events/contracts/`. The `v1` suffix is a wire contract — bumping it requires a new contract file and parallel consumer registration; never edit a published contract in a breaking way.
- **Emission is feature-gated:** producers must check the relevant `dataRoom.*` flag before recording (e.g. `workspace.document.*.v1` is gated on `dataRoom.workspaceEventsEnabled`). Outbox dispatch itself is gated on `dataRoom.outboxDispatchEnabled`.
- **Dispatch:** a single `@Interval()` dispatcher (every 5s, only when enabled) acquires a distributed lock, selects due events, and fans them out to registered handlers. Stale locks are recovered after 120s.
- **Handler registration:** consumers implement the handler interface and register a `handlerKey` (e.g. `governance.workspace-events.v1`) via `OnModuleInit`. The handler-key string is the routing contract — keep it stable.
- **Delivery semantics:** at-least-once, idempotency-oriented. Handlers must be idempotent on `(eventId, handlerKey)`. Failed deliveries use exponential backoff and eventually move to a dead-letter status.

When adding a new producer: add the versioned contract, gate emission on a `dataRoom` flag, and update `config.schema.ts` if a new flag is introduced. When adding a new consumer: register a stable `handlerKey`, document idempotency key, and verify ordering expectations against the producer.

### 24.2 Governance Framework

`governance` is a large Mongo-backed domain spanning programs, hierarchical scopes/audiences, source/version lifecycle, memberships, deployments/revisions, dry-runs, metrics, workspace bindings/reconciliation, and governed conversations. It depends on `authorization`, `conversation`, `widget-chat`, `whatsapp`, `telegram`, `user-group`, `connector`, `indexing`, `integration-events`, and `knowledge-intelligence`.

- **Consumes integration events** through the handler in `governance/integration/workspace-governance-event.handler.ts`. It applies ordering and idempotency checks before materialising workspace documents into governed sources/versions, and conditionally queues knowledge-extraction work.
- **Temporal intelligence worker** is feature-gated, polls every 5s, validates workspace content/indexing identity before and after evidence search, and writes temporal-candidate records.
- **Persistence uses domain-specific uniqueness/idempotency indexes:** source-event deduplication, one binding per `(program, workspace)`, and version/revision uniqueness. When adding a new governance collection, declare the uniqueness invariant as a compound index next to the schema, not in the service.
- **Governance reconciliation** is exposed to the frontend via polling (currently 1s) on the reconciliation Query — there is no governance SSE today. If you add one, follow [related guidance](realtime.md).
- **Workspace binding detach:** `DELETE /governance/programs/:programId/workspace-bindings/:bindingId` removes the whole binding; with the optional `?scopeId=` query param it detaches only that scope — remaining single scopes downgrade `multi_scope` to `scope_specific`, and detaching the last scope deletes the binding. Program-shared bindings reject single-scope detach.
- **Governed conversations** are a rollout-gated integration between governance and the conversation module; their enablement flows through the `governedConversations` config namespace and the frontend `governedConversationFeatures` shared flag.

### 24.3 Workspace Artifacts and Async Generation

`workspace-artifact` is a Mongo collection (`workspace_artifacts`) holding workspace-nested artifacts with source references, JSON payload, `revision`-based optimistic concurrency (see [related guidance](persistence.md)), and an embedded generation lease/retry state machine.

- **REST contract:** queue/create, configuration, retry, clone, update (requires `expectedRevision`), delete — under `/api/v1/workspaces/:workspaceId/artifacts`.
- **Decision-flow generation worker** is an asynchronous, cron-polled worker. It downloads PDF source bytes from existing object storage via the document module, extracts selected-page text with `pdf-parse`, submits an LLM task through `AgentTaskExecutionService`, validates JSON output, and commits results only if the lease token still matches. Do not run this kind of worker without the lease check.
- **Source bytes are read from object storage through the document module** — do not duplicate upload/storage ownership in the artifact module.

### 24.4 Knowledge Intelligence

`knowledge-intelligence` provides reusable Mongo repositories plus a durable, Mongo-embedded extraction-job queue (see [related guidance](persistence.md)'s lease pattern). Identity is `(sourceVersionId, jobType, inputHash, engineVersion)` — changing any of these fields creates a new job; do not mutate identity on an existing job. Engine version bumps intentionally re-run extraction; gate behind a feature flag if cost is a concern.
