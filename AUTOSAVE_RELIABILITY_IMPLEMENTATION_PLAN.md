# Autosave Reliability Implementation Plan

## Goal

Make playbook autosave reliable under local editing bursts, concurrent browser tabs, slow network saves, backend retries, and server-side updates. The target outcome is no silent lost updates, clear conflict behavior, and automatic recovery for safe autosave conflicts.

## Current Problem Summary

- Delta autosave uses `expectedUpdatedAt` as an optimistic concurrency token.
- Backend checks `updatedAt` before saving, but the check and write are not atomic.
- Frontend treats `409 ERR_1005` as a failure signal, but does not fetch, rebase, and retry.
- Full save paths can run without an expected version and can overwrite newer state.
- Delta responses return only `updatedAt`, so the client must infer the saved baseline.
- `basePayloadHash` is sent by the frontend but not enforced by the backend.
- The XState autosave machine tracks lifecycle state but does not own save orchestration.

## Success Criteria

- Only one editor write based on a given server revision can succeed.
- Autosave retries the latest local draft after an in-flight save finishes.
- A safe `409` conflict automatically rebases local unsaved changes on the latest server base and retries once.
- Unsafe conflicts are visible to the user and do not overwrite either side silently.
- Full saves and delta saves use the same concurrency contract.
- Tests cover in-flight saves, conflict rebase, duplicate retries, and backend atomicity.

## Phase 0: Instrumentation And Baseline Tests

### Objective

Prove the current failure modes before changing behavior.

### Backend Work

- Add focused tests around `PlaybookFlowService.applyDeltaPatch()` for stale `expectedUpdatedAt` returning `ERR_1005`.
- Add a concurrency test that simulates two saves using the same starting timestamp.
- Add a test proving full update with stale `expectedUpdatedAt` returns conflict.

### Frontend Work

- Add store-level tests for `saveCurrentPlaybook()` when `patchFlowDelta()` returns `ERR_1005`.
- Add a test proving queued autosave after an in-flight save uses the latest local draft.
- Add a test proving failed autosave keeps `isDirty=true`.

### Observability

- Log autosave conflict events with playbook id, request id, client mutation id, expected revision, current revision, save mode, and reason.
- Do not log full node payloads or user prompt contents.

### Exit Criteria

- Existing bug can be reproduced in tests or by a clear manual repro script.
- Current telemetry identifies whether conflicts come from duplicate client saves, other browser tabs, or backend-side writes.

## Phase 1: Backend Atomic Concurrency

### Objective

Prevent silent last-write-wins when two requests race with the same base version.

### Design

Replace check-then-save with compare-and-swap persistence for editor writes.

### Backend Implementation

- Keep loading the document for validation and patch construction.
- After building the patched document, persist with a conditional update filter.
- The filter should include owner id, playbook id, and the expected version token.
- If the conditional update matches zero documents, return `409 ERR_1005`.

### Suggested Backend Shape

```ts
const updated = await this.flowModel.findOneAndUpdate(
  {
    _id: flowId,
    ownerId,
    updatedAt: new Date(dto.expectedUpdatedAt),
  },
  {
    $set: patchFields,
  },
  {
    new: true,
    runValidators: true,
  },
);

if (!updated) {
  throw new ConflictException(ErrorCode.CONFLICT, 'Playbook changed since this autosave started.');
}
```

### Notes

- This is the smallest immediate backend correctness fix.
- Keep validation before persistence.
- Ensure Mongoose timestamps still advance on the conditional update.

### Tests

- Two concurrent delta saves using the same `expectedUpdatedAt`: one succeeds, one returns `409`.
- Delta save with current `expectedUpdatedAt` persists nodes, edges, bindings, and scalar fields.
- Stale delta save does not mutate the document.

### Exit Criteria

- No stale editor write can pass after another writer already advanced the document.

## Phase 2: Introduce Editor Revision Token

### Objective

Stop using generic `updatedAt` as the only autosave version token.

### Design

Add a persisted `definitionRevision` or `graphRevision` field to the playbook flow document. Increment it only when editor-owned definition fields change.

### Editor-Owned Fields

- `name`
- `description`
- `designSettings`
- `settings`
- `workspaces`
- `nodes`
- `controlEdges`
- `dataBindings`
- `reflectionEnabled`
- `advisorScoringMode`
- `advisorAutopilotEnabled`
- `advisorAutopilotTargetScore`
- `advisorAutopilotMaxTurns`

### Backend Work

- Add `definitionRevision` to `Flow` schema with default `1`.
- Return `definitionRevision` in base and enriched playbook responses.
- Change delta DTO to accept `expectedDefinitionRevision`.
- Keep accepting `expectedUpdatedAt` temporarily only if needed for migration, but prefer the revision token in new frontend requests.
- Increment `definitionRevision` atomically in editor save updates.

### Frontend Work

- Add `definitionRevision` to `Playbook` / `Flow` types.
- Store baseline revision per playbook.
- Send `expectedDefinitionRevision` for delta and full editor saves.
- Use server-returned `definitionRevision` as the next base token.

### Tests

- Non-editor backend writes do not increment `definitionRevision`.
- Editor saves increment `definitionRevision` exactly once.
- Stale `expectedDefinitionRevision` returns `409`.

### Exit Criteria

- Autosave conflicts are caused by actual editor definition changes, not unrelated document timestamp updates.

## Phase 3: Canonical Delta Save Response

### Objective

Let the frontend update its saved baseline from the server copy, not from assumptions.

### Backend Work

- Change delta save response to include either the full normalized base flow or a canonical saved request body.
- Include `updatedAt`, `definitionRevision`, `payloadHash`, and `patchSummary`.

### Recommended Response

```ts
{
  id: string;
  updatedAt: string;
  definitionRevision: number;
  savedFlow: FlowResponse;
  payloadHash?: string;
  applied: true;
  patchSummary: PatchSummary;
}
```

### Frontend Work

- After delta success, rebuild `lastSavedRequestBodyByPlaybookId[id]` from `savedFlow`.
- Recompute `lastSavedPayloadHashByPlaybookId[id]` from `savedFlow`.
- Update current playbook server metadata from `savedFlow`.
- Preserve local draft fields if newer local edits happened during the save.

### Tests

- Delta success updates saved request body baseline from the returned server flow.
- Delta success with newer local edits keeps local draft but updates server base token.
- Next delta is built from returned canonical base, not stale pre-save base.

### Exit Criteria

- Client baseline and server persisted state stay aligned after every successful delta save.

## Phase 4: Frontend Save Queue

### Objective

Guarantee one write per playbook at a time and always save the latest draft after a pending change.

### Design

Create a per-playbook autosave queue inside the store or a dedicated autosave coordinator. Zustand may still own state, but save execution should be serialized by playbook id.

### Queue Rules

- If no save is in flight, start saving the current draft.
- If a save is in flight, mark `pendingAutosaveAfterCurrent=true` and return.
- When the in-flight save finishes, compare `dirtyVersion` to `savingDirtyVersion`.
- If dirty version advanced, immediately enqueue a save using the newest local draft and newest server revision.
- Never run two saves for the same playbook concurrently.
- Manual save may flush immediately, but must still enter the same queue.

### Frontend Work

- Move request id, dirty version, pending save, and retry decisions into one coordinator path.
- Keep `useAutosave()` responsible only for debounce timing and calling `saveCurrentPlaybook()`.
- Let `saveCurrentPlaybook()` always use the queue.

### Tests

- Three edits during one slow save produce two network writes at most: the first in-flight save and one trailing latest-draft save.
- Manual save during an autosave does not create a parallel request.
- Switching playbooks does not apply stale save results to the wrong playbook.

### Exit Criteria

- No duplicate in-flight editor writes for the same playbook.

## Phase 5: One-Shot Conflict Rebase

### Objective

Recover automatically from safe autosave conflicts.

### Design

On `409 ERR_1005`, fetch the latest base flow, rebuild the delta from latest server base to current local draft, and retry once.

### Algorithm

1. Capture the local draft request body at save start.
2. Attempt delta save.
3. If response is not `409`, handle normally.
4. If response is `409`, fetch latest base flow.
5. Build `serverRequestBody` from latest base flow.
6. Compare local changes against the old saved baseline and server changes against the old saved baseline.
7. If changed fields do not overlap, build a new delta from `serverRequestBody` to local draft.
8. Retry once with the latest server revision.
9. If fields overlap, keep local draft dirty and show a conflict message.

### Conflict Granularity

- Scalar fields conflict by field name.
- Nodes conflict by node id.
- Edges conflict by edge id or full edge list if ids are missing.
- Data bindings conflict by binding id or full binding list if ids are missing.

### Frontend Work

- Add helper to compute changed paths between two request bodies.
- Add helper to determine whether local changes and server changes overlap.
- Add `retryAfterConflict` logic inside the save coordinator.
- Use latest server response as new baseline after successful retry.

### UX

- Safe conflict: no toast, autosave recovers.
- Unsafe conflict: show a clear warning such as “This playbook changed elsewhere. Review latest changes before saving.”
- Keep local draft in memory; do not discard it automatically.

### Tests

- Server changes playbook name, local changes node description: auto-rebase succeeds.
- Server changes same node, local changes same node: conflict is shown and no overwrite occurs.
- Conflict retry only happens once.

### Exit Criteria

- Common autosave races recover without user action.
- Real overlapping edits are not overwritten silently.

## Phase 6: Idempotency For Autosave Retries

### Objective

Make network retries and duplicate client submissions safe.

### Backend Work

- Store autosave mutation records by owner id, playbook id, client mutation id, and payload hash.
- If the same mutation is received again with the same payload hash, return the original result.
- If the same mutation id is reused with a different payload hash, return conflict.

### Frontend Work

- Generate stable `clientMutationId` for each save attempt.
- Reuse the same mutation id for retrying the exact same payload.
- Generate a new mutation id after local draft changes.

### Tests

- Duplicate identical delta request returns same result and does not double-increment revision.
- Same mutation id with different payload returns conflict.
- Browser retry after timeout does not duplicate writes.

### Exit Criteria

- Retried HTTP requests are safe and deterministic.

## Phase 7: Full Save Contract Cleanup

### Objective

Make full save a safe fallback, not an overwrite escape hatch.

### Backend Work

- Require expected revision for editor full save.
- Use the same atomic compare-and-swap persistence as delta save.
- Keep full save fallback only for cases where delta is disabled or unsupported, not for validation failures.

### Frontend Work

- Always pass expected revision on full editor saves.
- When delta is disabled, full save still uses concurrency token.
- Remove or isolate code paths that call update without version data from editor actions.

### Tests

- Full save with stale revision returns `409`.
- Full save with current revision succeeds.
- Delta-disabled fallback full save remains concurrency-safe.

### Exit Criteria

- No editor save path can overwrite a newer server version without detection.

## Phase 8: XState Ownership Decision

### Objective

Either make the autosave machine truly own orchestration or keep it explicitly observational.

### Option A: Machine Owns Orchestration

- Move debounce, save, backoff, conflict retry, and queue events into XState.
- Zustand stores draft and server baseline only.
- Machine invokes save services and receives success/failure events.

### Option B: Store Owns Orchestration

- Keep queue, retries, and rebase in Zustand/coordinator.
- Reduce XState machine to status display or remove if it duplicates state.

### Recommendation

Choose Option B first. It is smaller and preserves current architecture. Revisit Option A only after reliability is fixed.

### Exit Criteria

- There is one authoritative owner for autosave execution decisions.

## Phase 9: Rollout And Monitoring

### Feature Flags

- `PLAYBOOK_DEFINITION_REVISION_ENABLED`
- `PLAYBOOK_AUTOSAVE_REBASE_ENABLED`
- `PLAYBOOK_AUTOSAVE_IDEMPOTENCY_ENABLED`

### Metrics

- Autosave attempts by mode: delta, full, retry.
- Conflict count by reason.
- Auto-rebase success count.
- Unsafe conflict count.
- Save duration percentiles.
- Payload bytes by mode.
- Retry count.

### Rollout Order

1. Ship instrumentation and tests.
2. Ship backend atomic concurrency.
3. Ship canonical delta response.
4. Ship frontend queue.
5. Ship one-shot conflict rebase behind a frontend flag.
6. Ship definition revision token.
7. Ship idempotency.
8. Remove old `updatedAt` fallback after adoption.

### Exit Criteria

- Conflict rate is visible and explainable.
- Autosave no longer loses updates in concurrent edit tests.
- Manual QA verifies fast typing, dragging nodes, changing node description, tab duplication, and slow network saves.

## Manual QA Scenarios

- Edit one node description quickly for 30 seconds; confirm final description persists after reload.
- Edit while autosave request is artificially delayed; confirm a trailing save persists latest draft.
- Open the same playbook in two tabs; change different nodes; confirm safe rebase or visible conflict.
- Open the same playbook in two tabs; change the same node description; confirm no silent overwrite.
- Drag nodes repeatedly; confirm position saves are coalesced and final positions persist.
- Disable delta patch; confirm full save fallback still uses revision and does not overwrite stale server state.
- Simulate network timeout and retry; confirm duplicate requests do not double-apply.

## Main Risks

- Returning full saved flow from delta increases response size.
- Definition revision migration needs a default for existing documents.
- Conflict rebase can be wrong if changed-path detection is too coarse or too fine.
- Query cache invalidation after delta may briefly fetch stale data unless cache update is coordinated.
- Existing editor actions may call full update directly and bypass the autosave coordinator.

## Recommended First Implementation Slice

Implement these first:

1. Backend atomic compare-and-swap for delta saves.
2. Store-level frontend test for `409 ERR_1005` conflict behavior.
3. Frontend one-shot conflict rebase for non-overlapping changes.
4. Canonical delta response or immediate post-delta base refresh.

This slice directly addresses the observed “Playbook changed since this autosave started” failure while minimizing schema migration work.
