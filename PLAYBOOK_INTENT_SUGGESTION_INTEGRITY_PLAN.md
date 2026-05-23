# Playbook Intent Suggestion Integrity Implementation Plan

## Goal

Harden the playbook intent suggestion pipeline so generated suggestions cannot silently create incoherent workflows, including duplicate-purpose nodes, duplicate `nodeRef` mappings, orphan nodes, invalid references, stale edges, or unbound required inputs.

Scope covers both sides of the contract:

- Backend intent analysis and normalization in `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`
- Built-in prompt guidance in `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts`
- Frontend suggestion application in `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- Frontend/backend shared shape mirror in `YellowStorm/front/src/modules/playbook/types.ts`

## Current Pipeline

1. Frontend sends `intent` and optional `selectedTaskId` to the backend.
2. Backend builds a workflow summary and renders `intent.analyze`.
3. LLM returns `{ suggestions: [...] }`.
4. Backend normalizes suggestions into `single_change` or `workflow_plan` objects.
5. Frontend applies the top suggestion or user-selected suggestion to the canvas.
6. Frontend saves the mutated playbook graph.

## Main Risks Identified

| ID | Severity | Risk | Primary Surface |
|---|---|---|---|
| INT-1 | High | Duplicate `nodeRef` values in one workflow plan create orphan nodes or wrong edge targets | Backend normalizer |
| INT-2 | High | Invalid existing task IDs silently no-op while impact counts remain misleading | Backend normalizer |
| INT-3 | High | New nodes can duplicate existing workflow tasks semantically | Backend normalizer |
| INT-4 | Medium | Invalid source/target ports silently drop data bindings | Backend normalizer + frontend applier |
| INT-5 | Medium | `delete_data_binding` deletes all bindings to a target port | Backend contract + frontend applier |
| INT-6 | Medium | `nodeRef` is incorrectly promoted to `targetTaskId` for update/delete | Backend normalizer |
| INT-7 | Medium | `single_change` cannot create bindings for required input ports | Backend normalizer + frontend applier |
| INT-8 | Medium | Invalid anchors can create disconnected nodes silently | Frontend applier |
| INT-9 | Low | Workflow summary exposes port `type` while prompt expects `artifactKind` | Backend prompt context |
| INT-10 | Low | Plans can create edges to nodes that are later deleted in the same plan | Backend normalizer |

## Implementation Strategy

Use a staged approach. Start with backend contract validation because it prevents bad suggestions from reaching the canvas. Then tighten frontend application so anything still invalid is rejected loudly instead of silently creating partial graph mutations.

Do not add broad new abstractions. Keep the first implementation local to the intent service and canvas applier. Extract only if validation logic becomes reused in tests or additional services.

## Phase 1: Backend Intent Validation Context

### Objective

Give the backend normalizer enough workflow context to validate existing IDs, ports, data bindings, and duplicate node refs.

### Changes

Update `PlaybookFlowIntentService.analyze()` to build a validation context from the loaded flow before calling `normalizeSuggestions()`.

Suggested local type:

```ts
interface IntentWorkflowValidationContext {
  existingTaskIds: Set<string>;
  existingTaskTitles: Map<string, string>;
  existingTaskAgents: Map<string, string | null>;
  inputPortsByTaskId: Map<string, Map<string, string>>;
  outputPortsByTaskId: Map<string, Map<string, string>>;
  existingBindingTargets: Set<string>;
}
```

Notes:

- Port maps should use `portId -> artifactKind`.
- Binding target key can be `${targetNode}:${targetPort}`.
- Keep this local to `playbook-flow-intent.service.ts` unless it grows too large.

### Acceptance Criteria

- `normalizeSuggestions()` receives the validation context.
- Existing task IDs and port artifact kinds can be checked during normalization.
- No frontend contract change in this phase.

## Phase 2: Reject Duplicate and Invalid Workflow Plan Changes

### Objective

Prevent suggestions with duplicate `nodeRef`s, invalid references, invalid ports, and create-edge-to-deleted-node patterns from passing normalization.

### Changes

In `normalizeWorkflowPlanSuggestion()`:

1. Track created refs:

```ts
const createdNodeRefs = new Set<string>();
```

2. Drop `create_node` changes whose `nodeRef` already exists in the same plan.

3. Validate `update_node` and `delete_node` target IDs against `existingTaskIds`.

4. Validate `create_edge` / `delete_edge` references:

- `targetTaskId` and `sourceTaskId` must exist if provided.
- `sourceNodeRef` and `targetNodeRef` must reference a previously created node ref.
- Do not allow edges where source or target is a task scheduled for deletion.

5. Validate `create_data_binding` references:

- Existing task IDs must exist.
- Node refs must reference previously created node refs.
- Existing source ports must exist on existing source tasks.
- Existing target ports must exist on existing target tasks.
- If both source and target ports are known, artifact kinds must match.

6. Validate `delete_data_binding` target:

- Existing target task must exist if `targetTaskId` is used.
- Target port must exist when target task is existing.

7. Recalculate impact from accepted changes only.

### Acceptance Criteria

- Duplicate `nodeRef` changes are not returned to the frontend.
- Invalid existing task references are not returned to the frontend.
- Existing port mismatches do not produce binding changes.
- Impact counts match the filtered change list.

## Phase 3: Prevent Duplicate-Purpose Node Creation

### Objective

Reduce duplicated workflow nodes when the LLM proposes creating a task that already exists.

### Minimal Rule

Drop `create_node` changes when all are true:

- Existing task title normalized equals new task title normalized.
- Existing assigned agent matches the new `agentSlug`, when both are known.

Suggested title normalization:

```ts
private normalizeComparableTitle(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
```

### Tradeoff

This catches exact duplicate-purpose nodes but intentionally avoids fuzzy matching in the first pass. Fuzzy title matching could reject legitimate variants like `Research LVMH` and `Research Veolia`.

### Acceptance Criteria

- Exact title + same-agent duplicate create requests are filtered out.
- Similar-but-distinct nodes are still allowed.

## Phase 4: Fix `nodeRef` vs `targetTaskId` Misuse

### Objective

Stop update/delete changes from treating logical `nodeRef` values as existing task IDs.

### Changes

In `normalizeWorkflowChange()`:

- For `update_node`, use only `targetTaskId`.
- For `delete_node`, use only `targetTaskId`.
- Do not fallback to `item.nodeRef` for update/delete.

### Acceptance Criteria

- `update_node` with only `nodeRef` is rejected.
- `delete_node` with only `nodeRef` is rejected.
- `create_node` can still use `anchor.nodeRef` to refer to earlier created nodes.

## Phase 5: Align Workflow Summary Port Shape

### Objective

Avoid LLM confusion caused by summary ports using `type` while prompt examples use `artifactKind`.

### Changes

In `buildWorkflowSummary()` and `buildSelectedNodeContext()`:

- Emit `artifactKind` instead of `type` for input and output ports.
- If frontend/backend flow objects still use `type` internally, map `p.type` to `artifactKind` in the summary only.

### Acceptance Criteria

- Prompt context and prompt contract use the same port field name.
- Existing frontend contracts are unaffected.

## Phase 6: Strengthen Data Binding Deletion Contract

### Objective

Avoid over-deleting all bindings targeting the same input port.

### Backend Changes

Extend `delete_data_binding` normalized shape to optionally include:

- `sourceTaskId`
- `sourceNodeRef`
- `sourcePort`
- `sourceKind`

Keep `targetTaskId` / `targetNodeRef` / `targetPort` required.

### Frontend Changes

Update `PlaybookIntentWorkflowChange` in `YellowStorm/front/src/modules/playbook/types.ts` to mirror the backend.

Update `applyDataBindingChange()` in `PlaybookCanvasPage.tsx`:

- If source fields are present, delete only the matching binding.
- If source fields are absent, keep existing behavior as fallback for backward compatibility.

### Prompt Change

Update `intent.analyze` to prefer source-specific `delete_data_binding` when source information is available from `dataBindings[]`.

### Acceptance Criteria

- Deleting one binding no longer removes unrelated bindings targeting the same input port when source details are present.
- Existing old suggestions without source fields still work.

## Phase 7: Frontend Apply-Time Guardrails

### Objective

Make the frontend resilient if invalid suggestions still pass backend normalization.

### Changes

In `PlaybookCanvasPage.tsx`:

1. Do not create a node when explicit anchors were provided but none resolve.

Current behavior creates an orphan:

```ts
if (hasExplicitAnchors && anchorTasks.length === 0) {
  const newTask = createIntentTask(...);
  nextTasks = [...nextTasks, newTask];
  return true;
}
```

Replace with a no-op and optionally collect an application warning.

2. Add a lightweight `applicationWarnings: string[]` local array.

3. For unresolved references, invalid ports, invalid bindings, and skipped create-node anchors, push a warning.

4. If the entire plan applies zero meaningful changes, show an error toast instead of saving an unchanged graph.

5. Run `reconcileRequiredNodeOutputBindings()` for `single_change` create paths as well as workflow plans.

### Acceptance Criteria

- Invalid anchors do not create orphan nodes.
- A suggestion that applies no changes does not save.
- Single-change create suggestions attempt required binding reconciliation.
- Silent no-ops become observable to users or developers.

## Phase 8: Required Input Integrity Check

### Objective

Ensure required input ports are not left unbound after applying suggestions.

### Changes

Add a local post-apply validation function in `PlaybookCanvasPage.tsx`:

```ts
function findUnboundRequiredInputs(tasks, edges, dataBindings): Array<{ taskId: string; portId: string }> {
  // A required input is valid if it has a node-output binding, or exactly one compatible non-conditional incoming edge targeting that input port.
}
```

Use it after `reconcileRequiredNodeOutputBindings()` and before `commitGraph()`.

First implementation should warn rather than block, because existing workflows may already contain required-but-unbound ports.

### Acceptance Criteria

- Newly created required ports without bindings are detected.
- User gets a warning or non-blocking error state.
- No false blocking on existing legacy workflows.

## Phase 9: Tests

### Backend Unit Tests

Create or extend tests for `PlaybookFlowIntentService` normalization.

Recommended cases:

1. Drops duplicate `create_node.nodeRef` in one plan.
2. Drops `update_node` with unknown `targetTaskId`.
3. Drops `delete_node` with unknown `targetTaskId`.
4. Drops `create_edge` referencing an unknown existing task.
5. Drops `create_edge` referencing a task scheduled for deletion.
6. Drops `create_data_binding` when source port does not exist.
7. Drops `create_data_binding` when target port does not exist.
8. Drops `create_data_binding` when artifact kinds mismatch.
9. Drops exact duplicate title + agent `create_node` against existing workflow.
10. Recalculates impact from accepted changes.

### Frontend Tests

If existing canvas tests are too heavy, extract pure helpers only when needed.

Recommended cases:

1. `delete_data_binding` with source fields deletes only one binding.
2. `delete_data_binding` without source fields preserves backward-compatible target-port deletion.
3. Invalid explicit anchor does not create a node.
4. Applying a plan with all changes skipped does not save.
5. Single-change create runs required binding reconciliation.

### Verification Commands

Backend:

```bash
npm test -- playbook-flow-intent
npx tsc --noEmit --pretty false
```

Frontend:

```bash
npm test -- intent
npx tsc --noEmit --pretty false
```

Use the actual narrow test names once test files are identified.

## Rollout Order

1. Phase 5 first because it is low-risk and improves LLM contract clarity.
2. Phases 1, 2, and 4 together because they share backend validation plumbing.
3. Phase 3 after basic validation, to avoid over-filtering during initial rollout.
4. Phase 6 as a paired backend/frontend contract update.
5. Phases 7 and 8 as frontend hardening after backend validation is in place.
6. Phase 9 throughout; add tests with each phase rather than at the end.

## Non-Goals

- No fuzzy semantic deduplication in the first pass.
- No new external validation library.
- No complete rewrite of `PlaybookCanvasPage.tsx`.
- No prompt-only solution for graph integrity; prompts remain advisory, validation enforces correctness.
- No hard failure for every legacy required-port issue until existing workflows are assessed.

## Open Questions

1. Should exact duplicate task title alone be enough to block creation, or should agent match be required?
2. Should invalid plans be filtered silently, returned with warnings, or rejected as no suggestions?
3. Should frontend warnings be user-facing toasts or developer-only logs at first?
4. Can old workflows contain multiple bindings to the same target input port intentionally?
5. Should `single_change` be deprecated for all generated nodes and reserved only for update/delete operations?

## Recommended First PR

Implement a narrow backend-first PR:

- Build `IntentWorkflowValidationContext`.
- Use `artifactKind` in prompt context summaries.
- Reject duplicate `nodeRef`s.
- Reject update/delete unknown `targetTaskId`s.
- Reject edge/data-binding references to unknown tasks or unknown created refs.
- Remove `nodeRef` fallback for update/delete.
- Add focused backend tests.

This first PR addresses the highest-risk incoherent workflow bugs without changing frontend behavior or wire contracts.
