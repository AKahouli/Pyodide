---
project: YellowStorm
type: feature
slug: connector-playbook-binding-sync
status: active
updated: 2026-07-10 12:00 UTC
source_paths:
  - YellowStorm/back/src/modules/connector/services/connector-playbook-binding-sync.service.ts
  - YellowStorm/back/src/modules/connector/connector.service.ts
  - YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts
  - YellowStorm/back/scripts/migrations/2026-07-09-create-flow-toolbindings-connectorid-index.ts
tags:
  - yellowstorm
  - feature/connector-playbook-binding-sync
  - backend
  - connector
  - playbook-flow
---

# Connector Playbook Binding Sync

## Agent Quick Context
- Entry points: `connector-playbook-binding-sync.service.ts` (sync logic), `connector.service.ts` (wired into `update()`)
- Runtime flow: Admin updates connector actions (enabled/disabled) → `ConnectorService.update()` saves connector → if `actions` changed, calls `ConnectorPlaybookBindingSyncService.syncConnectorActions()` → `updateMany` on flows collection matching `nodes.metadata.toolBindings.connectorId` → replaces matching bindings' actions with the connector's current enabled action keys
- Contracts: `syncConnectorActions(connectorId, previousEnabledKeys, nextEnabledKeys): Promise<void>` — idempotent, no-op if keys unchanged
- Invariants: Sync is best-effort after connector save — failures are logged (WARN) and never propagated to the caller. Only enabled actions (where `isEnabled !== false`) are synced. Atomic `updateMany` uses positional all `$[]` and `$[binding]` array filters to scope updates to matching nodes and bindings only.
- Pitfalls: Relies on index `nodes.metadata.toolBindings.connectorId` on flows collection — migration must have been run for acceptable query performance in production. Sync only runs when `actions` is present in the update DTO — disabling actions via a separate field does NOT trigger sync. Large playbook sets may have slow `updateMany` — no batching/pagination implemented (deferred).

## Purpose
Keep playbook flow node `toolBindings.actions` synchronized with the connector's currently enabled action keys. When an admin enables, disables, or adds actions to a connector, every persisted flow whose nodes reference that connector via `toolBindings.connectorId` gets its matching binding's actions replaced atomically.

## Current Implementation

### Sync Service (`connector-playbook-binding-sync.service.ts`)
Uses `Connection.collection('flows').updateMany()` (native MongoDB driver, bypassing Mongoose) with:
- **Filter:** `{ 'nodes.metadata.toolBindings.connectorId': connectorId }`
- **Update:** `$set` on `nodes.$[].metadata.toolBindings.$[binding].actions` to the mapped `[{ actionKey, isEnabled: true }]` array
- **Array filters:** `[{ 'binding.connectorId': connectorId }]` — only updates bindings matching the connector, leaving other bindings on the same node untouched

Pre-checks `sameKeys()` on the previous vs next enabled action key sets — skips the write entirely when keys are identical (avoids unnecessary index writes and oplog entries).

### Integration with ConnectorService.update()
After `findByIdAndUpdate` succeeds, if the DTO contained `actions`:
1. `getEnabledActionKeys()` extracts sorted enabled action keys from both old (pre-save `existing`) and new (`normalizedActions`)
2. Calls `syncConnectorActions(id, previousKeys, nextKeys)`
3. Errors are caught and logged at WARN level — the connector save is already committed, so a sync failure does not roll back the connector update

### Database Index
```typescript
FlowSchema.index({ 'nodes.metadata.toolBindings.connectorId': 1 });
```
Added in `playbook-flow.schema.ts` line 255. Production environments with Mongoose auto-indexing disabled require the migration script.

### Migration
`2026-07-09-create-flow-toolbindings-connectorid-index.ts` — one-shot script using native `MongoClient.createIndex()` on `flows` collection. Safe to re-run.

## Key Files
- `YellowStorm/back/src/modules/connector/services/connector-playbook-binding-sync.service.ts` — Sync service (49 lines)
- `YellowStorm/back/src/modules/connector/services/connector-playbook-binding-sync.service.spec.ts` — Unit tests (65 lines, 3 test cases)
- `YellowStorm/back/src/modules/connector/connector.service.ts` — `update()` wires the sync call after connector save
- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts` — Index declaration (line 255)
- `YellowStorm/back/scripts/migrations/2026-07-09-create-flow-toolbindings-connectorid-index.ts` — Index creation migration

## API / Interfaces
- `ConnectorPlaybookBindingSyncService.syncConnectorActions(connectorId: string, previousEnabledActionKeys: string[], nextEnabledActionKeys: string[]): Promise<void>` — Replaces matching flow node bindings' actions with the next enabled action keys. No-op if keys unchanged. Best-effort (errors logged, not thrown).

## Design Decisions
| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| Best-effort sync after connector save | Connector save is the primary operation; sync failures should not block connector updates. Sync can be retried manually or via background job if needed. | Pre-save sync with rollback on failure (couples connector update to sync success); deferred background job (stale bindings until job runs) |
| `updateMany` with `$[]` and `$[binding]` array filters | Single atomic write updates all matching binding entries across all flow documents, regardless of array position | Iterate flows per-document (N+1 queries, race conditions); pull+push entire binding array (loses other bindings on same node) |
| Skip write on identical keys (`sameKeys` guard) | Avoids unnecessary index updates and MongoDB oplog entries when actions haven't changed | Always write (wasteful); compare deep equality on full action objects (more expensive) |
| Native MongoDB `Connection.collection()` instead of Mongoose model | Bypasses Mongoose schema validation and hooks for a simple atomic `updateMany` — the operation is a targeted data sync not a document operation | Mongoose `updateMany` with the same filter (unnecessary overhead — no schema casting needed for positional operators) |
| Index on `nodes.metadata.toolBindings.connectorId` | Required for the `updateMany` filter to avoid collection scan on every connector action update. Production disables Mongoose auto-indexing, so the migration creates it explicitly. | No index (acceptable for small collections, degrades with scale); `$lookup`-based sync (over-engineered) |

## Known Pitfalls
- **Sync only triggers on `actions` field update**: If an admin changes connector behavior through a field other than `actions` (e.g., `isActive`, `mcpServerUrl`), the binding sync does NOT run. Only the `actions` DTO field triggers `syncConnectorActions()`.
- **Migration must run in production**: The index is declared in the Mongoose schema but not auto-created in production environments (auto-indexing is `false`). Run the migration script once during deployment, otherwise the `updateMany` query does a full collection scan.
- **No batching/pagination**: `updateMany` is unbatched — fine for typical playbook counts but could be slow on very large collections with many matching flows.
- **Sync is best-effort**: A sync failure (e.g., transient MongoDB error) is logged at WARN and swallowed. The connector is already saved — if the sync fails, playbook flows have stale action bindings until the next connector update. No retry mechanism.
- **`sameKeys` uses Set comparison**: Order of keys in the arrays doesn't matter (Set-based equality). If the order of actions changes without the keys changing (e.g., reordering), the sync correctly skips.
- **Disabling all actions**: If all connector actions are disabled, `getEnabledActionKeys()` returns an empty array, and the sync replaces the binding's actions with `[]`. The ADK runtime currently skips connectors with no enabled actions (`findByIdsForGrpc` line ~162) — flows with empty bindings will fail or be skipped at execution time. Confirm runtime behavior.

## Recent Changes
### 2026-07-10 12:00 UTC
- **Changed:** Added `ConnectorPlaybookBindingSyncService` — on connector action updates, atomically synchronizes persisted playbook flow node `metadata.toolBindings.actions` for all flows referencing the connector. Wired into `ConnectorService.update()` as a best-effort post-save step. Added `FlowSchema` index on `nodes.metadata.toolBindings.connectorId`. Created migration script `2026-07-09-create-flow-toolbindings-connectorid-index.ts`.
- **Why:** Connector action changes (enabling/disabling/adding actions) were not reflected in already-persisted playbook flows. Flow nodes with stale action bindings would either reference non-existent actions at execution time or miss newly available actions until the flow was re-saved.
- **Impact:** `connector-playbook-binding-sync.service.ts` (new, 49 lines), `connector-playbook-binding-sync.service.spec.ts` (new, 65 lines, 3 tests), `connector.service.ts` (wired sync into `update()`), `playbook-flow.schema.ts` (index line 255), `YellowStorm/back/scripts/migrations/2026-07-09-create-flow-toolbindings-connectorid-index.ts` (new migration). `npm test -- connector.service.spec.ts connector-playbook-binding-sync.service.spec.ts` passed.

## Related Notes
- [[flow-engine-tools]] — Python ADK tool factory consumes the connector bindings synced by this service
- [[playbook-flow-execution]] — Playbook execution service reads `toolBindings` from node metadata at runtime
- [[webchat-widget]] — Peer backend feature (widget CRUD + migration pattern reference)
