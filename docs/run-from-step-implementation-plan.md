# Run from Step — Implementation Plan

## Feature Summary

Add a "Run from this step" action on completed playbook executions. When invoked on a completed step node, it creates a **new execution** that replays from the LangGraph checkpoint immediately before that step, re-executing the chosen step and all downstream nodes. The original completed execution remains untouched.

This is a **new replay path**, not an extension of the existing `ResumeFromStep` interrupt-resume path.

---

## Architecture

### Flow

```
User right-clicks completed step → Frontend calls new endpoint
  → Backend validates source execution, creates new queued execution
    → Backend calls new ADK gRPC RunFromCheckpoint RPC
      → ADK composes graph from source snapshot
      → ADK walks checkpoint history on source thread_id
      → ADK finds checkpoint where target node is in .next
      → ADK calls update_state() to patch execution_id
      → ADK streams from that checkpoint via astream(None, checkpoint_config)
      → Events stream back with new execution_id
  → Backend persists task results under new execution
  → Frontend switches to new execution via SSE
```

### Key Constraint

LangGraph `update_state()` forks within the **same** `thread_id` — it cannot cross threads. So the replay stays on the source execution's LangGraph thread but uses `update_state` to patch `execution_id` to the new value before streaming. Backend task results and SSE events use the new execution id.

### Scope — First Version

- Only top-level `step` nodes (no iterator children).
- Only `completed` source executions.
- Only step nodes with a `completed` task result for the target iteration.
- Target iteration defaults to 0 if not specified.

---

## Files to Change

### Proto (both copies must stay identical)

| File | Change |
|------|--------|
| `YellowStorm/back/src/modules/playbook-flow/proto/playbook-flow.proto` | Add `RunFromCheckpoint` RPC + messages |
| `yellowstorm-adk/grpc/proto/playbook-flow.proto` | Mirror backend proto |

### ADK / Runtime

| File | Change |
|------|--------|
| `yellowstorm-adk/src/flow_engine/grpc_service.py` | Implement `RunFromCheckpoint` streaming RPC |
| `yellowstorm-adk/src/grpc_server/server.py` | Log new RPC availability |
| `yellowstorm-adk/src/flow_engine/tests/test_grpc_service.py` | Unit tests for checkpoint selection, state patch, missing checkpoint |
| `yellowstorm-adk/src/flow_engine/tests/test_proto_drift.py` | No change (existing parity test covers it) |

### Backend

| File | Change |
|------|--------|
| `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-execution.schema.ts` | Add `replaySource` embedded schema |
| `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-execution.interface.ts` | Add `IReplayFromStepPayload` |
| `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts` | Add `runFromStep(...)` method + `callGrpcRunFromCheckpoint(...)` |
| `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-execution.controller.ts` | Add new endpoint, replace 501 stub on `rerun-step` |
| `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.spec.ts` | Unit tests |
| `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.e2e.spec.ts` | E2E tests |

### Frontend

| File | Change |
|------|--------|
| `YellowStorm/front/src/lib/api/config.ts` | Add `runFromStep` endpoint entry |
| `YellowStorm/front/src/modules/playbook/api.ts` | Add `runPlaybookFromStep(...)` wrapper |
| `YellowStorm/front/src/modules/playbook/types.ts` | Add store action signature |
| `YellowStorm/front/src/modules/playbook/store.ts` | Add `runFromStep` store action |
| `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx` | Wire `canRunFromStep` + handler |
| `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx` | Add context menu item |
| `YellowStorm/front/src/modules/playbook/locales/en.json` | Labels |
| `YellowStorm/front/src/modules/playbook/locales/fr.json` | Labels |
| `YellowStorm/front/src/modules/playbook/store.test.ts` | Store action test |
| `YellowStorm/front/src/modules/playbook/api.test.ts` | API wrapper test |

---

## Proto Changes

Add to `playbook-flow.proto`:

```protobuf
service PlaybookFlowRuntime {
  rpc Run(RunRequest) returns (stream RunEvent);
  rpc Cancel(CancelRequest) returns (CancelResponse);
  rpc ResumeApproval(ResumeApprovalRequest) returns (ResumeApprovalResponse);
  rpc ResumeFromStep(ResumeFromStepRequest) returns (ResumeFromStepResponse);
  rpc RunFromCheckpoint(RunFromCheckpointRequest) returns (stream RunEvent);
}

message RunFromCheckpointRequest {
  string execution_id = 1;          // new backend execution id
  string source_execution_id = 2;   // completed execution (also the LangGraph thread_id)
  string flow_id = 3;
  string owner_id = 4;
  FlowSnapshot snapshot = 5;        // source execution's persisted snapshot
  google.protobuf.Struct input_context = 6;
  RunSettings settings = 7;
  string target_node_id = 8;        // step to replay from
  int32 target_iteration = 9;       // iteration of that step (default 0)
}
```

No other new messages. The response reuses the existing `RunEvent` stream.

---

## ADK Implementation

### New RPC: `RunFromCheckpoint`

In `grpc_service.py`:

1. Compose graph from the supplied `snapshot` using the shared checkpointer.
2. Build config: `{"configurable": {"thread_id": source_execution_id}}`.
3. Walk `graph.get_state_history(config)` to find the checkpoint where:
   - `target_node_id` is in `snapshot.next` (the frontier).
   - `snapshot.values["iterations"].get(target_node_id, 0) == target_iteration`.
4. If no matching checkpoint, yield `ExecutionFailed` and return.
5. Call `graph.update_state(target_checkpoint.config, {"execution_id": execution_id})` to patch the state with the new execution id.
6. Stream from the forked checkpoint:
   ```python
   async for event in emit_events(execution_id, stream_graph(graph, None, ...)):
       yield event
   ```
   Note: `graph_input=None` because we replay from checkpoint, not from scratch.
7. Register in `_active_executions` so `Cancel` works mid-replay.
8. No interrupt/approval resume handling needed (if a HITL node fires, it creates a pending_approval on the new execution normally).

### Checkpoint Selection Logic

```python
def _find_checkpoint_before_target(graph, source_thread_id, target_node_id, target_iteration):
    config = {"configurable": {"thread_id": source_thread_id}}
    for state_snapshot in graph.get_state_history(config):
        next_nodes = state_snapshot.next or ()
        if target_node_id in next_nodes:
            iterations = (state_snapshot.values or {}).get("iterations", {})
            if iterations.get(target_node_id, 0) == target_iteration:
                return state_snapshot
    return None
```

### Edge Cases

- **No matching checkpoint**: yield `ExecutionFailed` with clear message.
- **Iterator child target**: reject upfront — checkpoint history for iterator body subgraphs is not addressable at this level.
- **Multiple matching checkpoints**: pick the one closest to completion (latest in history iteration, which is first in the iterator).
- **Interrupt fires during replay**: normal `NodeSuspended`/`ApprovalRequested` handling; the new execution goes to `pending_approval`.

---

## Backend Implementation

### Schema Change

Add to `FlowExecution` schema:

```typescript
@Schema({ _id: false })
export class ReplaySource {
  @Prop({ required: true, type: String })
  executionId!: string;

  @Prop({ required: true, type: String })
  taskId!: string;

  @Prop({ required: false, type: Number, default: 0 })
  iteration?: number;
}
```

```typescript
// On FlowExecution class:
@Prop({ required: false, type: ReplaySource })
replaySource?: ReplaySource;
```

### Service Method: `runFromStep(executionId, ownerId, { taskId, iteration? })`

1. Load source execution with `+snapshot`.
2. Validate: owner match, `status === 'completed'`, task result exists and is `completed`, node is a top-level `step`.
3. Create a new `FlowExecution` document:
   ```typescript
   new this.executionModel({
     flowId: source.flowId,
     ownerId,
     status: 'queued',
     recursionLimit: source.recursionLimit,
     maxParallelism: source.maxParallelism,
     inputContext: source.inputContext,
     snapshot: source.snapshot,
     replaySource: { executionId: source.id, taskId, iteration: iteration ?? 0 },
   })
   ```
4. Queue it via `queueService.admit(...)`.
5. `drainQueue(ownerId)`.

### New gRPC Call: `callGrpcRunFromCheckpoint(executionId, flowId, ownerId, sourceExecution, taskId, iteration)`

Similar to `callGrpcRun` but calls `RunFromCheckpoint` instead of `Run`:

```typescript
const request = {
  execution_id: executionId,          // new
  source_execution_id: sourceExecution.id,
  flow_id: flowId,
  owner_id: ownerId,
  snapshot: /* source execution's snapshot, enriched with agents */,
  input_context: toGrpcStruct(sourceExecution.inputContext || {}),
  settings: { recursion_limit, max_parallelism },
  target_node_id: taskId,
  target_iteration: iteration,
};
const call = this.playbookFlowClient.RunFromCheckpoint(request);
// same event handling as callGrpcRun
```

### Queue Drain Integration

In `drainQueue`, detect replay executions (have `replaySource`) and route to `callGrpcRunFromCheckpoint` instead of `callGrpcRun`.

### Controller Endpoint

Replace the 501 stub on `rerun-step` or add a new endpoint:

```
POST /playbooks/:flowId/executions/:executionId/run-from-step
Body: { taskId: string; iteration?: number }
```

---

## Frontend Implementation

### API Config

```typescript
// In API_ENDPOINTS.playbooks:
runFromStep: (playbookId: string, executionId: string) =>
  `/playbooks/${playbookId}/executions/${executionId}/run-from-step`,
```

### API Wrapper

```typescript
export async function runPlaybookFromStep(
  playbookId: string,
  executionId: string,
  data: { taskId: string; iteration?: number },
): Promise<{ executionId: string }> { ... }
```

### Store Action

```typescript
runFromStep: async (playbookId, sourceExecutionId, taskId, iteration) => {
  const result = await api.runPlaybookFromStep(playbookId, sourceExecutionId, { taskId, iteration });
  // SSE onExecutionStart will hydrate the new execution
  set({ executingPlaybookIds: [...s.executingPlaybookIds, playbookId] });
}
```

### Canvas Enablement

```typescript
const canRunFromStep = useCallback((nodeId: string) => {
  if (!currentExecution || currentExecution.playbookId !== id) return false;
  if (currentExecution.status !== 'completed') return false;
  if (hasActiveExecution) return false;
  const task = currentExecution.taskResults.find(
    (tr) => tr.taskId === nodeId && tr.status === 'completed'
  );
  if (!task) return false;
  const node = playbook?.tasks.find((t) => t.id === nodeId);
  if (!node || node.containerConfig?.parentIteratorId) return false;
  return true;
}, [currentExecution, id, hasActiveExecution, playbook]);
```

### Context Menu

Add to `PlaybookNode.tsx` context menu:

```tsx
<ContextMenuItem
  disabled={!actions?.canRunFromStep(id)}
  onClick={() => actions?.onRunFromStep(id)}
>
  <FastForward className="h-4 w-4" />
  {t('node.runFromStep')}
</ContextMenuItem>
```

### i18n Keys

```json
// en.json
"node.runFromStep": "Run from this step"

// fr.json
"node.runFromStep": "Relancer depuis cette étape"
```

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Replaying from wrong checkpoint skips/duplicates the target step | Select checkpoint where `target_node_id in snapshot.next` + match iteration; test with ADK unit tests |
| Source execution is mutated | Backend always creates a new execution; ADK events use `execution_id` from request, not source thread |
| State still contains old `execution_id` after fork | `update_state` patches it before `astream`; test that downstream nodes see new id |
| Router replay diverges to a different path | Accept as intended; label UI as "Run from step" not "identical replay" |
| Iterator child steps not checkpoint-addressable | Reject upfront; restrict to top-level step nodes |
| External side effects repeat (tool calls, writes) | Accept; future enhancement could add side-effect guards |
| Source snapshot differs from current playbook | Use source execution's persisted snapshot, not current canvas |
| Backend execution service file already oversized (2275 lines) | Keep changes surgical; extract `callGrpcRunFromCheckpoint` but do not broad-refactor |

---

## Verification Plan

### ADK Tests
- Finds checkpoint where `target_node_id in snapshot.next` and iteration matches.
- Rejects when no matching checkpoint exists.
- Patches `execution_id` in replayed state.
- Emits events with new `execution_id`.
- Handles target iteration > 0.
- Rejects iterator child targets.

### Backend Tests
- Endpoint rejects non-owned execution.
- Endpoint rejects non-completed source execution.
- Endpoint rejects missing or non-completed task result.
- Endpoint rejects iterator child node.
- Creates new queued execution with `replaySource` lineage.
- `drainQueue` routes replay executions to `RunFromCheckpoint`.

### Frontend Tests
- API wrapper posts to correct endpoint.
- Store action calls API and sets executing flag.
- `canRunFromStep` returns true only for completed step nodes in completed executions.
- `canRunFromStep` returns false for active/failed executions, iterator children, missing task results.

### Manual QA
1. Run a playbook to completion.
2. Right-click a completed top-level step.
3. Click "Run from this step".
4. Verify a new execution appears and streams from the selected step.
5. Verify original execution remains unchanged.
6. Verify no browser console/network errors.

---

## Commands

```bash
# ADK tests
conda run -n meta pytest src/flow_engine/tests/test_grpc_service.py -v

# Backend tests
npm test -- playbook-flow-execution.service.spec.ts playbook-flow-execution.e2e.spec.ts

# Frontend tests
npm test -- src/modules/playbook/store.test.ts src/modules/playbook/api.test.ts

# Proto regeneration (if needed)
conda run -n meta python -m grpc_tools.protoc \
  --proto_path=grpc/proto \
  --python_out=src/grpc_generated \
  --grpc_python_out=src/grpc_generated \
  grpc/proto/playbook-flow.proto
```

---

## Memory Tier

**Full** — new cross-boundary feature with new REST endpoint, new gRPC RPC, durable execution lineage, and LangGraph checkpoint replay behavior.
