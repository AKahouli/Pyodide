
# Playbook Architecture

> **Slug:** `playbook` | **Status:** 🚧 draft | **Last Updated:** 2026-04-23 00:00 UTC

This folder documents the current playbook system and the integration points an AI coding agent needs to extend it safely.

## Overview

Playbooks are directed graphs of steps (tasks) connected by typed ports. A playbook execution can run in two modes:

1. `single-step` - executes one selected task
2. `full-workflow` - executes the whole graph through the ADK/LangGraph runtime

The frontend renders and edits the graph. The NestJS backend persists the playbook, starts executions, and streams status to the UI. The ADK service performs step execution and graph orchestration.

## Main Components

### Frontend

- `front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
  - canvas page, execution panel, step selection, edge deletion, node click handling
- `front/src/modules/playbook/components/PlaybookNode.tsx`
  - custom node renderer with multiple input/output handles
- `front/src/modules/playbook/hooks/usePlaybookCanvas.ts`
  - local graph state, `onConnect`, node/edge sync
- `front/src/components/ai-elements/edge.tsx`
  - custom React Flow edge renderer

### Backend

- `back/src/modules/playbook/controllers/playbook.controller.ts`
  - playbook CRUD and replay endpoints
- `back/src/modules/playbook/controllers/playbook-execution.controller.ts`
  - execution/step-execution mutation endpoints
- `back/src/modules/playbook/services/playbook.service.ts`
  - playbook persistence, listing, cloning, summaries
- `back/src/modules/playbook/services/playbook-execution.service.ts`
  - execution orchestration, SSE updates, gRPC request building
- `back/src/modules/playbook/services/playbook-grpc.service.ts`
  - wrapper around gRPC calls to the ADK service

### ADK Service

- `yellowstorm-adk/src/grpc_server/chatbot_servicer.py`
  - gRPC server implementation for `RunStep`, `RunPlaybookWorkflow`, `ResumeStep`, `ResumePlaybookWorkflow`
- `yellowstorm-adk/src/langgraph_engine/graph_builder.py`
  - builds the execution graph and emits step updates
- `yellowstorm-adk/src/langgraph_engine/workflow_service.py`
  - runs full-workflow and resume flows
- `yellowstorm-adk/src/langgraph_engine/step_executor.py`
  - single-step execution logic
- `yellowstorm-adk/src/langgraph_engine/port_resolution.py`
  - resolves port-bound inputs, validates routing, stages artifacts

## Output Routing Architecture

The playbook output-routing refactor split step execution into two explicit output modes:

### `plain`

- Used when the model response should stream normally.
- The executor keeps the standard streaming path.
- Final artifacts are emitted deterministically as normalized `artifacts[]`.
- This path does not require structured fields from the model response.

### `structured_final_response`

- Used when the task requires a structured final answer.
- The primary model response must include both `display_text` and `outputs`.
- The executor no longer performs a second synthesis inference pass.
- The structured payload is parsed directly from the primary response.

The mode decision now lives in `yellowstorm-adk/src/langgraph_engine/step_executor.py` and must stay aligned with graph construction and port resolution in `graph_builder.py` and `port_resolution.py`.

### Prompt catalog implications

- `task.output_ports.structured_response` is now a required built-in prompt key.
- `output_routing.synthesis` is obsolete and should not remain in built-in defaults.
- `task.output_ports.note` should reflect the current output-routing behavior and wording.

## Data Model

### Task

Key fields:

- `id`
- `title`
- `description`
- `assignedAgentId`
- `inputPorts[]`
- `outputPorts[]`
- `inputFilesByPort[]`
- `executionOrder`
- `enabled`

### Port

Ports are typed by `artifactKind`.

Current kinds:

- `text`
- `document`
- `code`
- `image`
- `data`
- `dashboard`

### Edge

Edges must preserve both source and target port ids.

Important fields:

- `sourceId`
- `targetId`
- `sourceOutputPortId`
- `targetInputPortId`

Do not collapse edge identity to node ids only. Multiple edges between the same nodes are valid if they target different ports.

## Runtime Flow

### Full Workflow

1. Frontend sends `POST /playbooks/:id/execute`
2. Backend creates an execution record and emits `playbook_execution_start`
3. Backend builds the gRPC `RunPlaybookWorkflow` request
4. ADK builds the graph, resolves port inputs, and streams step updates
5. Backend consumes the stream and sends SSE step updates to the UI
6. Backend finalizes execution state from the buffered step results

### Single Step

1. Frontend sends `POST /playbooks/:id/executions/:executionId/rerun-step`
2. Backend builds a `RunStep` request for one task
3. ADK runs only that step and returns a unary response

- Frontend optimistic state now treats replay-mode single-step reruns (`replay_strict`, `replay_flex`, `replay_adaptive`) differently from resume/live reruns.
- Replay-mode reruns clear only the targeted task back to `running` and preserve the rest of the workflow's prior task results in the execution panel.
- The ADK single-step graph path preserves `node_inputs_by_port` from the gRPC request so replay-mode steps can resolve input-port artifacts from previous workflow results before port validation runs.
- Backend rerun-step routing now synthesizes a default text artifact from a completed upstream step's persisted `output` when older executions do not have explicit `artifacts[]` recorded yet.
- `resume-from-step` and live reruns still clear downstream task state because they are expected to recompute the remaining workflow.

## Backend Endpoints

### Playbook CRUD

- `GET /playbooks`
- `GET /playbooks/:id`
- `POST /playbooks`
- `PATCH /playbooks/:id`
- `DELETE /playbooks/:id`

### Execution

- `POST /playbooks/:id/execute`
- `POST /playbooks/:id/executions/:executionId/rerun-step`
- `POST /playbooks/:id/executions/:executionId/resume-from-step`
- `GET /playbooks/:id/executions`
- `GET /playbooks/:id/executions/:executionId`

## Mail Trigger Auto-Renew Cutoff

Mail trigger subscriptions support an optional `autoRenewUntil` cutoff.

- The backend stores the cutoff on the playbook mail trigger config and serializes it back to the frontend as an ISO string.
- The sync-subscription path rejects past cutoffs with a `400 Bad Request`.
- The renewal service skips playbooks whose cutoff has already passed.
- The Microsoft Graph client caps subscription expiration at the earlier of the Graph renewal window and the configured cutoff.
- The frontend date picker sends a local calendar date as an end-of-day UTC cutoff.

### Replay / Validation

- `GET /playbooks/:id/tasks/:taskId/replays`
- `POST /playbooks/:id/tasks/:taskId/validate-replay`
- `POST /playbooks/:id/tasks/:taskId/replays/:replayId/activate`
- `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId/format-guide`

## gRPC Surface

The backend currently calls these ADK RPCs:

- `RunStep`
- `RunPlaybookWorkflow`
- `ResumeStep`
- `ResumePlaybookWorkflow`

The gRPC request must include:

- tasks with input/output port metadata
- edges with `source_output_port_id` / `target_input_port_id`
- workspace context
- validated replays when applicable
- step execution modes

## Port Resolution Rules

The current resolver behavior is important:

- edges are validated against existing task ids and port ids
- input ports may receive multiple upstream sources
- `upstream_bindings` is the canonical resolved shape for a port
- `artifacts_by_port` stores produced artifacts under `sourceTaskId:sourcePortId`
- file artifacts are assigned to output ports in declaration order when kinds match

Do not reintroduce logic that:

- rejects multiple upstream edges to one input port
- strips real `in-...` / `out-...` ids that are part of stored port ids
- assumes only the first output port matters

## Stream Semantics

Backend SSE events:

- `playbook_execution_start`
- `playbook_step_start`
- `playbook_step_complete`
- `playbook_interrupt`
- `playbook_execution_complete`

ADK step stream events:

- `in_progress`
- `completed`
- `failed`
- `skipped`
- `suspended`

### Parallel tool progress

- `step_executor.py` now emits incremental `tool_trace` snapshots as each parallel tool call completes.
- The payload shape is unchanged.
- This lets the UI surface tool progress in realtime while slower parallel tool calls are still running.

## Rendering Notes

- The execution step detail view now deduplicates mirrored synthetic text components before rendering the answer.
- The remaining component-backed answer preserves clickable inline citations.
- This prevents duplicate assistant text when structured and synthetic answer fragments overlap.

The backend expects every terminal task to emit a terminal step update. If the ADK returns a terminal graph state without a step update, the backend may think the stream ended prematurely.

## Known Gotchas

1. A task with no assigned agent must still emit a failed step update.
2. The frontend uses React Flow handles directly. Keep handle ids consistent with stored port ids.
3. A task can have multiple incoming edges to the same input port. The resolver merges them.
4. Multiple file artifacts can target the same artifact kind. Preserve output order.
5. If a step fails in the ADK without a step update, the backend will mark the execution as failed at stream end.

## Current Debugging Notes

- `playbook_execution.service.ts` is the place to inspect if the UI says the stream ended early.
- `graph_builder.py` is the place to inspect if a task never emits a terminal step update.
- `port_resolution.py` is the place to inspect if a graph is rejected before execution.
- `step_executor.py` is the place to inspect output-mode selection, structured parsing, and plain artifact normalization.
- `playbook_tool_factory.py` now sets connector MCP `X-Brain-ID` from the selected default playbook workspace id (`output_workspace_id`) instead of agent brain ids.
- `calculator.py` now safely allowlists `abs(x)` and `round(x[, ndigits])` so playbook tool execution does not loop on calculator errors for rounded expressions.
- `PlaybookNode.tsx` and `usePlaybookCanvas.ts` are the places to inspect if a link attaches to the wrong port.

## Suggested Follow-up Work

- Add richer artifact-kind metadata to step results and workflow prompts.
- Add explicit multi-source prompt formatting when a single input port receives multiple upstreams.
- Tighten type coverage around playbook edges and port ids.
- Add one end-to-end test for a workflow with multiple upstreams feeding one input port.
