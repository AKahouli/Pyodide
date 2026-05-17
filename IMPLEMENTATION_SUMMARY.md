# Playbook Rewrite — Implementation Summary

> Status as of 2026-05-16. Covers Priorities 0–3 from `PLAYBOOK_REWRITE_REMEDIATION_PLAN.md`.

---

## Priority 0: Contract Alignment

**Status: Complete**

| Decision | Resolution |
|---|---|
| External URL namespace | `/playbooks` externally; `Flow` is internal runtime language only |
| Persisted graph fields | `nodes`, `controlEdges`, `dataBindings` (replacing `tasks`/`edges`) |
| Execution start | `POST /playbooks/:id/executions` |
| Execution detail | `GET /executions/:executionId` |
| HITL resume | `POST /executions/:executionId/resume-approval` |
| Cancellation | `POST /executions/:executionId/cancel` |
| Replay | Separate `trace-replay` and `re-execute` endpoints |

---

## Priority 1: Restore Real-Time Execution

**Status: Complete — 523 backend tests pass**

Backend SSE streaming pipeline restored. Execution events flow from Python runtime through gRPC to NestJS and out to the browser via Server-Sent Events.

Key changes:
- Execution start endpoint returns execution ID immediately
- SSE events broadcast step-level progress (pending → running → completed/failed)
- Interrupt events carry `interruptId`, `taskId`, `type` for HITL
- Frontend SharedWorker + store correctly merge SSE chunks into task results
- Iterator child results preserved through SSE hydration

---

## Priority 2: Complete Execution Lifecycle

**Status: Complete — 63 frontend tests pass**

Delete endpoints live; lifecycle operations wired.

| Operation | Endpoint | Frontend Store Action |
|---|---|---|
| Start execution | `POST /playbooks/:id/executions` | `startExecution` / `executeStep` |
| Fetch execution | `GET /executions/:id` | `fetchExecution` (with cache) |
| Cancel execution | `POST /executions/:id/cancel` | `stopExecution` |
| Resume (HITL) | `POST /executions/:id/resume-approval` | `resumeExecution` |
| Delete execution | `DELETE /executions/:id` | `deleteExecution` |
| Delete all executions | `DELETE /playbooks/:id/executions` | `deleteAllExecutions` |
| Replay (trace) | `POST /executions/:id/trace-replay` | `traceReplayExecution` |
| Re-execute | `POST /executions/:id/re-execute` | `reExecuteExecution` |

Stubbed (intentionally):
- `rerunStepInExecution` — shows `warnUnsupportedExecutionAction()` toast until backend supports targeted step reruns
- `resumeFromStep` — same treatment

---

## Priority 3: Finish Frontend Refactor Properly

**Status: Complete — 83 targeted tests pass, 0 TypeScript errors**

### Phase 1: API / Config / Types Cleanup

#### `types.ts` — New types and extensions
- `RouterDecision` interface: `{ nodeId, label, iteration, createdAt? }`
- `iteration?: number` added to `TaskResult`
- `queued` and `pending_approval` added to `ExecutionStatus` union
- `activeRouterLabel?: string` added to `PlaybookNodeData`
- `routerDecisions?: RouterDecision[]` added to `PlaybookExecution`
- `updateControlEdges(controlEdges: ControlEdge[])` and `updateDataBindings(dataBindings: DataBinding[])` added to `PlaybookActions`

#### `api.compat.ts` — New file (compatibility layer extraction)
Extracted all Playbook↔Flow mapping helpers from `api.ts` into a dedicated module:
- `normalizePlaybook(raw)` — handles both old (`tasks`/`edges`) and new (`nodes`/`controlEdges`) responses
- `normalizeTriggerFields(raw)` — maps `triggerConfig` to legacy `triggers`/`executionSchedule`/`automatedTriggerType`
- `mapFlowNodeToPlaybookTask`, `mapControlEdgeToPlaybookEdge` — backend→frontend normalization
- `taskToFlowNode`, `edgeToControlEdge` — frontend→backend serialization
- `kindToNodeType`, `nodeTypeToKind` — type mapping between Flow kinds and Playbook node types

#### `api.ts` — Retargeted
- Imports all mapping helpers from `./api.compat`
- Removed all inline compatibility function definitions
- `updatePlaybook()` now sends `nodes`, `controlEdges`, `dataBindings` when present — uses `!== undefined` guards (not `.length > 0`) so empty arrays correctly signal clear-state to backend
- Removed debug `console.log('[DEBUG] updatePlaybook body:', ...)`

#### `api.test.ts` — Modernized
- Fixed mock: added `patch`, `put`, `delete` to hoisted `apiClientMock`
- Aligned test expectations to current route shapes:
  - Repeatability task route: `/playbooks/{id}/repeatability/{taskId}`
  - Trigger schedule: `put` to `/playbooks/{id}/triggers/schedule`
  - Trigger mail clear: `delete` to `/playbooks/{id}/triggers/mail`
- Added 2 new tests:
  - "sends empty flow arrays so the backend can clear persisted canvas state"
  - "omits flow arrays when they were not part of the update payload"

#### `config.ts` — Pruning deferred
`playbooks.*` and `playbookFlows.*` endpoint blocks share the same backend routes. Removing entries would break callers that still use `API_ENDPOINTS.playbooks.*`. Deferred to Phase 6.

### Phase 2: Canvas + Store + DataBindings

#### `store.ts` — New actions
- `updateControlEdges(controlEdges: ControlEdge[])` — sets `currentPlaybook.controlEdges`, marks dirty
- `updateDataBindings(dataBindings: DataBinding[])` — sets `currentPlaybook.dataBindings`, marks dirty
- `saveCurrentPlaybook()` now includes `controlEdges` in the API call payload

#### `usePlaybookCanvas.ts` — Switched to ControlEdge persistence
- **Load**: uses `controlEdges` when present (length > 0), falls back to `playbookEdgesToFlowEdges(edges)`
- **Persist**: all edge mutations (connect, remove, node-delete cascade) flow through `flowEdgesToControlEdges` → `updateControlEdges`
- **Undo/redo sync**: same fallback logic as load
- **Cycle rejection toast**: added `showWarning(t('canvas.cycleRejected'))` when `wouldCreateCycle()` rejects an edge (previously silent)

#### `PlaybookDataBindingSection.tsx` — Replaced "coming soon"
Minimal editable list for data bindings:
- Source kind selector: `node-output`, `trigger`, `state`, `constant`, `expression`
- Contextual fields per source kind (source node/port for node-output, constant value, expression input)
- Add/remove/update binding support
- Optional `targetNodeId` prop to filter bindings for a specific node
- Uses `updateDataBindings` from store

#### `PlaybookCanvasPage.tsx` — Router + execution integration
- Router creation (`handleAddRouterNode`) initializes `outputPorts` with `['retry', 'done', '__error__']`
- `activeRouterLabelMap` built from `execution.routerDecisions` and overlaid onto canvas nodes during execution
- `liveNodes` memo dependency array updated with `activeRouterLabelMap`

### Phase 3: UI Polish

#### Router terminal route visibility — `RouterNode.tsx`
| Label | Visual |
|---|---|
| `done` | Green badge + `CheckCircle2` icon, green border |
| `__error__` | `AlertTriangle` icon, destructive coloring (was red-only) |
| Regular (e.g. `retry`) | Primary color (unchanged) |
| Active decision | Green badge with `GitBranch` icon showing the runtime routing label |

#### Approval iteration context — `PlaybookDesignerPanel.tsx`
- Computed `interruptIterationIndex` from `interruptedTask.iteration`
- Computed `interruptIterationCount` by counting same-taskId entries in `taskResults`
- Iteration badge shown in approval banner when `count > 1`: "Iteration X of Y"

#### Pending approval click-through — `ExecutionPanel.tsx`
- `handleSelectStep` now checks if the clicked step is the currently interrupted task
- If so, auto-switches copilot mode to `'interrupt'` to show the approval panel

#### Status badges — `PlaybookStatusBadge.tsx`
Already implemented: `queued` (blue clock), `pending_approval` (yellow hand), `cancelled` (grey X).

#### Settings — `PlaybookFlowSettingsDrawer.tsx`
Already implemented and wired: `recursionLimit` (1-100) and `maxParallelism` (1-32) inputs call `updatePlaybook()` directly from `PlaybookCanvasPage.tsx:2403`.

#### Replay UI — `ExecutionStepDetail.tsx`
Already implemented: separate `traceReplayExecution` (RotateCcw icon) and `reExecuteExecution` (Play icon) buttons with distinct hint text. Per-step rerun skipped (backend stub).

### Phase 4: Test Fixes

#### `usePlaybookCanvas.test.tsx` — Migrated to ControlEdge assertions
- Updated store mock: added `updateControlEdges: vi.fn()` and `updateDataBindings: vi.fn()`
- Migrated all 5 `storeFns.updateEdges` references to `storeFns.updateControlEdges`
- Updated expected call argument shapes from `PlaybookEdge` (`sourceId`/`targetId`) to `ControlEdge` (`source`/`target`/`kind`)
- 20/20 canvas tests pass

#### `PlaybookNodeEditor.test.tsx` — Fixed missing mock
- Added `useCurrentPlaybook` export to store mock (needed by `PlaybookDataBindingSection` which renders inside `PlaybookNodeEditor`)
- 6/6 tests pass

### i18n — Locale keys added

**`en.json`** — 19 new keys:
- `canvas.cycleRejected`
- `dataBindingEditor.*` (16 keys: title, description, empty, addBinding, sourceKind, sourceNode, sourcePort, targetPort, constantValue, expression, removeBinding, nodeOutput, trigger, state, constant, expressionLabel)

**`fr.json`** — 19 new keys (French translations)

---

## Verification

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors |
| Backend tests | 523 pass |
| Frontend tests (playbook module) | 83/83 targeted pass |
| Pre-existing failures | `PlaybookScheduleSheet.test.tsx` (9 — missing `useConnectedAppStore` mock, unrelated) |

---

## Files Modified (P0–P3)

### Backend (`YellowStorm/back/`)
- `src/modules/playbook-flow/controllers/playbook-flow-execution.controller.ts`
- `src/modules/playbook-flow/playbook-flow.module.ts`
- `src/modules/playbook-flow/services/playbook-flow-execution.service.ts`

### Frontend (`YellowStorm/front/`)
- `src/lib/api/config.ts`
- `src/modules/playbook/types.ts`
- `src/modules/playbook/api.ts`
- `src/modules/playbook/api.compat.ts` **(new)**
- `src/modules/playbook/api.test.ts`
- `src/modules/playbook/store.ts`
- `src/modules/playbook/store.test.ts`
- `src/modules/playbook/hooks/usePlaybookCanvas.ts`
- `src/modules/playbook/hooks/usePlaybookCanvas.test.tsx`
- `src/modules/playbook/hooks/helpers/control-edge-serializer.ts`
- `src/modules/playbook/components/PlaybookCanvasPage.tsx`
- `src/modules/playbook/components/PlaybookDataBindingSection.tsx`
- `src/modules/playbook/components/PlaybookDesignerPanel.tsx`
- `src/modules/playbook/components/PlaybookNodeEditor.tsx`
- `src/modules/playbook/components/PlaybookNodeEditor.test.tsx`
- `src/modules/playbook/components/RouterNode.tsx`
- `src/modules/playbook/components/ExecutionPanel.tsx`
- `src/modules/playbook/components/ExecutionPanel.test.tsx`
- `src/modules/playbook/components/ExecutionStepDetail.tsx`
- `src/modules/playbook/locales/en.json`
- `src/modules/playbook/locales/fr.json`

### Python ADK (`yellowstorm-adk/`)
- `src/flow_engine/builder/__init__.py`
- `src/flow_engine/builder/guards.py`
- `src/flow_engine/tests/test_workers.py`

---

## Remaining Priorities

### Priority 4: Restore Feature Parity Through New Semantics
Intent, generation, design chat, node advisor, evaluation, repeatability, trace replay, re-execution, scheduling, mail trigger, node templates. Frontend-heavy.

### Priority 5: Backend Runtime Hardening
gRPC stream consumption, compound `task_result` keys `(executionId, taskId, iteration)`, `router_decisions` persistence, queue management, idempotency, cancellation, HITL approval relay, error routing, recursion budget enforcement.

### Priority 6: Route Compatibility Strategy
Normalize execution/cancel/resume/trigger routes in frontend config. Mechanical cleanup — delete stale old-route usage from `config.ts` and `api.ts`.

### Priority 7: Backend ↔ LangGraph Flow Engine Contract Gaps
Proto field semantics verification, `google.protobuf.Struct` wrapping, boundary contract testing between NestJS and Python.

---

## Key Design Decisions

1. **Empty arrays are meaningful** — `updatePlaybook()` uses `!== undefined` guards (not `.length > 0`) so sending `nodes: []` correctly clears persisted canvas state on the backend.
2. **No fallback/mirroring** — The user confirmed the playbook feature is not in production, so switching from `PlaybookEdge` to `ControlEdge` persistence doesn't need backward compatibility.
3. **Config pruning deferred** — `playbooks.*` and `playbookFlows.*` endpoint blocks share the same backend routes; removing entries would break callers. Deferred to P6.
4. **Per-step rerun skipped** — `rerunStepInExecution` is a backend stub (`warnUnsupportedExecutionAction`). Adding a UI button for a stub is misleading.
5. **Cycle rejection is no longer silent** — `wouldCreateCycle()` in `cycle-router-validator.ts` already correctly permits cycles only through routers with `maxIterations > 0`. The only gap was UX: the rejection happened silently. Now a toast explains why.
6. **InterruptDialog.tsx is orphaned** — Defined but never imported. The `PlaybookDesignerPanel` has its own inline interrupt flow. Added iteration context there instead.
7. **`api.ts` was reconstructed from git** — After multiple failed piecemeal edits corrupted it, the file was restored via `git show HEAD:...` and is now clean at ~1434 lines.
