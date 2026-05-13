# Playbook Rewrite — Implementation Plan

> **Goal.** Replace the existing DAG-only playbook stack with a clean, loop-capable control-flow runtime with **strict separation of control flow and data flow**. No production users today → no migration, no parallel maintenance, no `v2` suffixes. The new module *is* playbook.
>
> **Companion docs.** `PLAYBOOK_REWRITE_GUIDELINES.md` (coding rules), `FRONTEND_GUIDELINES.md`, `BACKEND_GUIDELINES.md`. On conflict, the stricter rule wins.

## Working Mode

- **Long-lived branch** `playbook-rewrite` off `main`. Phases land as PRs into that branch. Final merge to `main` only at Phase 6.
- **`main` keeps the working old stack** the whole way through. The rewrite branch is broken between Phase 1 and Phase 6; acceptable because no users depend on it.
- **Backend + Python engine: rewrite.** New module scaffolded under `playbook-flow/` (renamed to `playbook/` in Phase 6 when the legacy module is deleted). New Python package at `flow_engine/`.
- **Frontend: refactor in place.** Stays at `front/src/modules/playbook/`. No new module, no rename. ~70% of files untouched, ~20% gain new sections, ~10% undergo targeted surgery.
- **Every phase ends with green CI** on the branch: typecheck, lint, unit tests, build. Integration tests gate phases that need them.
- **Every PR ≤ ~800 LOC of changes** where feasible. Larger only with a written rationale.
- **Rebase the branch onto `main` weekly** to keep drift manageable.

## Core Design Decisions (locked from day one)

These shape every phase. Changing them mid-rewrite is forbidden.

1. **Control flow ⊥ data flow.** Two independent collections: `controlEdges` and `dataBindings`. See guidelines §4.
2. **Three iteration kinds.** Iterator (foreach), control loop (router cycle), step retry. Each has its own counter and guard.
3. **Routers are the decision.** No separate "router function" layer; the router node returns `{ routerDecisions: { [nodeId]: label } }`.
4. **`__error__` is a reserved label.** Failure routing is first-class.
5. **HITL is first-class.** `human_approval` node kind in Phase 2, not retrofitted.
6. **State uses LangGraph channels with explicit reducers.** No plain `dict` for concurrent fields.
7. **Replay has two modes.** Trace replay (deterministic from recorded events) and re-execution (may diverge).
8. **Schema versioning** on every persisted document from `v1`.
9. **Idempotency keys** on mutating endpoints likely to be retried.
10. **Concurrency limits env-driven**, queue-backed, with worker pool on the Python side.

## Glossary

- **Flow** — runtime concept; same as "playbook" externally. The module is still named `playbook`.
- **Router node** — emits a label into `routerDecisions`; successors are conditional edges keyed on that label.
- **Iteration** — counter scoped to a loop kind (iterator container, control cycle, or step retry).
- **Control edge** — declares "what runs next". Sequential or conditional.
- **Data binding** — declares "what this input port reads". Independent of edges.

---

# Phase 1 — Data Model & Backend Skeleton

**Goal.** Lock the contract. Nothing executes yet; only the shape of data, types, module boundaries, and policies are fixed so later phases stand on stable ground.

**Estimate:** 4–6 working days.

## 1.1 Backend module scaffold

Scaffold under `playbook-flow/` during the rewrite to avoid file collisions with the legacy module; renamed to `playbook/` in Phase 6.

```
modules/playbook-flow/
├── playbook-flow.module.ts
├── controllers/
│   ├── playbook-flow.controller.ts              # CRUD
│   ├── playbook-flow-execution.controller.ts    # run / cancel / status
│   └── playbook-flow-template.controller.ts     # node templates exposure
├── services/
│   ├── playbook-flow.service.ts                 # CRUD orchestration
│   ├── playbook-flow-validator.service.ts       # graph + binding validity
│   ├── playbook-flow-builder.service.ts         # snapshot → gRPC payload
│   ├── playbook-flow-execution.service.ts       # execution lifecycle + queue
│   ├── playbook-flow-results.service.ts         # iteration-keyed writes
│   ├── playbook-flow-queue.service.ts           # per-user FIFO queue
│   └── playbook-flow-idempotency.service.ts     # 24h idempotency cache
├── schemas/
│   ├── playbook-flow.schema.ts
│   ├── playbook-flow-execution.schema.ts
│   ├── playbook-flow-task-result.schema.ts
│   └── playbook-flow-router-decision.schema.ts
├── dto/
│   ├── create-playbook-flow.dto.ts
│   ├── update-playbook-flow.dto.ts
│   ├── playbook-flow-node.dto.ts
│   ├── playbook-flow-control-edge.dto.ts
│   ├── playbook-flow-data-binding.dto.ts
│   └── playbook-flow-router-config.dto.ts
├── mappers/
│   ├── flow-to-snapshot.mapper.ts
│   ├── execution-to-response.mapper.ts
│   └── task-result-to-timeline.mapper.ts
├── interfaces/
│   ├── playbook-flow.interface.ts
│   └── playbook-flow-execution.interface.ts
└── constants/
    ├── node-kinds.ts
    └── reserved-labels.ts                       # __error__, __cancelled__
```

Every file ≤ 300 lines. Every service ≤ one responsibility.

## 1.2 Schemas

**`playbook-flow.schema.ts`**

```ts
{
  id, ownerId, schemaVersion: 1,
  name, description,
  triggerConfig, settings: { recursionLimit, maxParallelism },
  nodes: FlowNode[],
  controlEdges: ControlEdge[],
  dataBindings: DataBinding[],
  timestamps,
}
```

- `FlowNode` discriminated by `kind: 'step' | 'router' | 'iterator' | 'human_approval'`.
- `ControlEdge` discriminated by `kind: 'sequential' | 'conditional'`.
- `DataBinding` source discriminated by `kind: 'node-output' | 'trigger' | 'state' | 'constant' | 'expression'`.

**`playbook-flow-execution.schema.ts`**

```ts
{
  id, flowId, ownerId, schemaVersion: 1,
  status, startedAt, endedAt?, error?,
  recursionLimit, maxParallelism, inputContext,
  idempotencyKey?,
  pendingApproval: { nodeId, iteration, prompt } | null,
}
```

**`playbook-flow-task-result.schema.ts`**

```ts
{ executionId, taskId, iteration, status, output, error?, startedAt, endedAt }
```

- Compound unique index `(executionId, taskId, iteration)`.
- Compound index `(executionId, taskId)` for "all iterations of this task".

**`playbook-flow-router-decision.schema.ts`**

```ts
{ executionId, routerNodeId, iteration, label, decidedAt }
```

Append-only. Drives trace replay.

## 1.3 DTOs

Strict `class-validator`. Discriminated `@Type` on every union. Router config: `outputLabels.length >= 1`, `maxIterations` in `[1, PLAYBOOK_RECURSION_LIMIT_MAX]`. Data-binding source types validated by discriminator.

## 1.4 Validator service (rules on save)

Each rule = one method, one test:

1. Unique node ids.
2. Every control-edge endpoint references an existing node.
3. Every conditional edge's source is a router.
4. Router `outputLabels` fully covered by outgoing conditional edges.
5. Every router has a terminal route.
6. Cycles must include a router with `maxIterations`.
7. Iterator containers' children form a DAG internally.
8. Every required input port has exactly one data binding.
9. `node-output` binding source node is reachable in the control graph.
10. `iteration: 'previous'` only when source node lies on a cycle.
11. Data-binding source type matches target input-port type.
12. Every router that follows a node that can fail handles `__error__`, or the failure path is explicitly `propagate`.

## 1.5 Configuration (env)

`config/playbook-flow.config.ts` with Joi schema:

```
PLAYBOOK_MAX_CONCURRENT_PER_USER=3
PLAYBOOK_EXECUTION_QUEUE_MAX_DEPTH=50
PLAYBOOK_MAX_PARALLELISM_PER_EXECUTION=5
PLAYBOOK_RECURSION_LIMIT_DEFAULT=25
PLAYBOOK_RECURSION_LIMIT_MAX=50
PLAYBOOK_PYTHON_WORKER_POOL_SIZE=8
PLAYBOOK_PYTHON_WORKER_MAX_INFLIGHT=4
PLAYBOOK_IDEMPOTENCY_TTL_HOURS=24
```

## 1.6 Queue & idempotency services

- `playbook-flow-queue.service.ts`: in-memory FIFO per user with Mongo-backed persistence so queued executions survive restarts. Position broadcast via SSE.
- `playbook-flow-idempotency.service.ts`: Mongo collection `flow_idempotency_keys` (TTL index 24h). `(userId, key)` unique; payload hash stored to detect mismatched bodies.

## 1.7 gRPC contract

In `yellowstorm-adk/grpc/proto/` mirrored in backend `proto/`:

- Service `PlaybookFlowRuntime` with `Run(stream Event)`, `Cancel(executionId)`, `ResumeApproval(executionId, decision, payload)`.
- `FlowSnapshot` message: `nodes`, `controlEdges`, `dataBindings`, `settings`.
- Event types: `NodeStarted`, `NodeCompleted`, `NodeFailed`, `RouterDecision`, `IterationIncremented`, `ApprovalRequested`, `ApprovalResolved`, `ExecutionCompleted`, `ExecutionFailed`.
- `postbuild` script copies new `.proto` files.

## 1.8 Controllers

Thin, `@RequirePermissions('playbook.*')`:

- `POST /api/v1/playbooks` — create
- `GET /api/v1/playbooks` — list (paginated)
- `GET /api/v1/playbooks/:id` — read
- `PATCH /api/v1/playbooks/:id` — update (validates on save)
- `DELETE /api/v1/playbooks/:id`
- `POST /api/v1/playbooks/:id/executions` — start (`Idempotency-Key` header)
- `GET /api/v1/playbooks/:id/executions` — list
- `GET /api/v1/executions/:id` — read with iteration-keyed results
- `POST /api/v1/executions/:id/cancel`
- `POST /api/v1/executions/:id/resume-approval`
- `GET /api/v1/executions/:id/router-decisions` — for trace replay

## 1.9 OpenTelemetry skeleton

Span helpers registered in the module (real spans emitted from Phase 2 onward). Span attributes: `executionId`, `flowId`, `taskId`, `iteration`, `routerDecision`, `nodeKind`, `userId`.

## 1.10 Acceptance criteria

- [ ] All schemas, DTOs, validators ship with unit tests (happy + error paths). Every validation rule (§1.4) has a dedicated test.
- [ ] Idempotency: two identical `POST /executions` with same key return identical execution id; mismatched body returns `ERR_1009`.
- [ ] Queue: 4th concurrent execution for a user enters queue; 51st returns `ERR_1007`.
- [ ] Config: missing env var refuses boot.
- [ ] `npm run build`, `npm test`, `npm run lint` green.
- [ ] `POST /executions` returns a real execution id and `status: 'queued'`; execution stays queued (no runtime yet).
- [ ] No code from the legacy `playbook` module is imported by the new module.

---

# Phase 2 — New LangGraph Engine

**Goal.** Working Python runtime supporting sequential, conditional, iterator, parallel topologies, plus HITL and `__error__` routing. Tested through gRPC fixtures, not through frontend.

**Estimate:** 8–10 working days.

## 2.1 Package scaffold

```
yellowstorm-adk/src/flow_engine/
├── __init__.py
├── state.py                          # ExecutionState TypedDict with reducers
├── reducers.py                       # set-by-key, append, max-of, etc.
├── builder/
│   ├── __init__.py                   # compose(snapshot) -> CompiledGraph
│   ├── sequential.py
│   ├── conditional.py
│   ├── iterator.py
│   ├── parallel.py
│   ├── human_approval.py
│   └── guards.py                     # iteration counter, error label injection
├── bindings/
│   ├── resolver.py                   # resolve DataBindings → node inputs at entry
│   └── types.py
├── nodes/
│   ├── step.py
│   ├── router.py                     # writes routerDecisions, no decision logic
│   └── human_approval.py             # interrupts the graph
├── runtime/
│   ├── invoker.py                    # ainvoke / astream wrapper
│   ├── events.py                     # gRPC event emission
│   ├── checkpointer.py               # ported from legacy, verified shared backend
│   ├── artifacts.py                  # iteration-aware artifact routing
│   ├── ports.py                      # port resolution
│   └── tracing.py                    # OTel spans
├── workers/
│   ├── pool.py                       # asyncio worker pool
│   └── dispatcher.py                 # accepts gRPC Run, routes to worker
├── grpc_service.py                   # PlaybookFlowRuntime servicer
└── tests/
    ├── test_sequential.py
    ├── test_conditional.py
    ├── test_iterator.py
    ├── test_parallel.py
    ├── test_human_approval.py
    ├── test_guards.py
    ├── test_bindings.py
    ├── test_error_routing.py
    ├── test_workers.py
    └── fixtures/
        ├── linear.json
        ├── retry_loop.json
        ├── recovery_branch.json
        ├── max_iterations.json
        ├── human_approval.json
        └── nested_parallel.json
```

Every file ≤ 300 lines. No imports from legacy `langgraph_engine`.

## 2.2 State model

```python
class ExecutionState(TypedDict):
    execution_id: str
    flow_id: str
    inputs: dict[str, Any]
    task_outputs: Annotated[dict[tuple[str, int], Any], set_by_key]
    iterations: Annotated[dict[str, int], max_of]
    router_decisions: Annotated[dict[str, str], set_by_key]
    errors: Annotated[list[ExecutionError], append]
    pending_approval: Annotated[Optional[PendingApproval], last_write]
    cancelled: Annotated[bool, or_]
```

Every field has an explicit reducer. No plain `dict` fields.

## 2.3 Builder

`builder.compose(snapshot)`:

1. Re-validate snapshot at the gRPC boundary (defensive — backend already validated).
2. Group nodes by kind. Instantiate step / router / iterator / human-approval nodes.
3. Wire sequential edges via `add_edge`.
4. Wire conditional edges via `add_conditional_edges(source, lambda s: s['router_decisions'][source], {label: target})`.
5. `guards.inject_iteration_counter` wraps every node inside a cycle to increment `iterations[node_id]`.
6. `guards.inject_error_routing` wraps every node so failure writes `__error__` into `router_decisions` for the nearest downstream router.
7. Iterator containers compile their internal subgraph then add fan-in.
8. Configure `interrupt_before` / `interrupt_after` on human-approval nodes.
9. Compile to `StateGraph` with checkpointer attached.

Each builder file owns its topology — no cross-imports.

## 2.4 Data-binding resolver

`bindings.resolver.resolve(node, state)` runs at node entry, returns the input payload. Pure function. Handles:

- `node-output` with `iteration: 'current' | 'previous' | <number>`.
- `trigger` dot-path.
- `state` dot-path.
- `constant`.
- `expression` (sandboxed Jinja-style — no Python eval).

First-iteration `previous` resolves to `None`. Out-of-cycle `previous` rejected at build time, so resolver never sees it.

## 2.5 Router nodes

A router is a step node whose output is constrained to `Literal[*outputLabels]`. The node's executor writes the label into `router_decisions[nodeId]`. The conditional-edges dispatcher reads it. No second "router function" layer.

Max-iterations enforcement: `guards.iteration_counter` checks `iterations[router_id] >= max_iterations` *before* the router executes; if exceeded, writes the configured terminal label directly and skips the router body. The terminal label is the one whose target is `END` or outside the router's cycle (determined at build time, exactly one must exist per §1.4 rule 5).

## 2.6 HITL

`human_approval` node uses LangGraph's `interrupt_before`. On entry:

1. Writes `pending_approval = { nodeId, iteration, prompt }`.
2. Emits `ApprovalRequested` event.
3. Graph suspends, state checkpointed.

`PlaybookFlowRuntime.ResumeApproval(executionId, decision, payload)`:

1. Loads checkpoint.
2. Writes resumed state with the user's decision.
3. Continues the graph.

Approval timeout (configurable) cancels the execution.

## 2.7 Recursion limit

Every `astream` invocation passes `config={"recursion_limit": execution.recursionLimit}`. Server-side hard ceiling enforced from `PLAYBOOK_RECURSION_LIMIT_MAX`.

## 2.8 Worker pool

`workers.pool` runs `PLAYBOOK_PYTHON_WORKER_POOL_SIZE` asyncio workers. Each handles up to `PLAYBOOK_PYTHON_WORKER_MAX_INFLIGHT` concurrent executions. Dispatcher routes incoming gRPC `Run` calls round-robin. Replicas scale horizontally.

## 2.9 OTel instrumentation

Spans emitted per the guidelines §13. Backend execution service registers a parent span; per-node spans nest under it via context propagation through gRPC.

## 2.10 Backend wiring

`playbook-flow-execution.service.ts` becomes a real gRPC client. Consumes the event stream, writes:

- `task_results` (iteration-keyed)
- `router_decisions` (append-only)
- `executions` (status + `pendingApproval`)

Cancellation: backend calls `Cancel(executionId)`; Python sets `state.cancelled = true` which guards check at every node entry.

## 2.11 Acceptance criteria

- [ ] Python: `pytest` green, `ruff` clean, `mypy --strict` clean.
- [ ] Backend integration test in CI (docker-compose) runs: linear, retry-loop, recovery-branch, iterator, human-approval, parallel.
- [ ] Two-process concurrent execution test against the shared checkpointer (verifies it's actually shared).
- [ ] Cancel reflected within ≤ 1 second.
- [ ] HITL: graph suspends, resume-approval continues from checkpoint.
- [ ] Max-iterations exit forces terminal label, doesn't error out.
- [ ] `__error__` routing test: failing node + router that handles `__error__` reaches the recovery branch.
- [ ] OTel spans emitted and queryable in the local collector.

---

# Phase 3 — Port Templates, Settings, Intent, Generation, Design Chat, MCP, Tools

**Goal.** Bring all clean, reusable backend pieces into the new module, cleaning as we go. **Copy** (not import); legacy gets deleted in Phase 6.

**Estimate:** 5–7 working days.

## 3.1 Backend ports

| Source | Target | Treatment |
|--------|--------|-----------|
| `playbook-node-template.service.ts` + schema | `playbook-flow-node-template.*` | Add `kind` discriminator; new built-in kinds: router, iterator, human_approval. |
| `playbook-prompt-template.*` + renderer | `playbook-flow-prompt-template.*` | Port as-is, simplify oversized files. |
| `playbook-output-format.*` | `playbook-flow-output-format.*` | Port. |
| `playbook-settings.service.ts` + `playbook-settings.dto.ts` | `playbook-flow-settings.*` | Port; add recursion-limit and parallelism settings. |
| `playbook-intent.service.ts` | `playbook-flow-intent.service.ts` | Port; DAG-only output by default. New `enableLoops` opt-in flag (initially produces no loops — extending the LLM prompt is a follow-up task post-Phase 6). |
| `playbook-design.service.ts` + design-message schema | `playbook-flow-design.*` | Port; topology-agnostic. |
| `playbook-node-advisor.service.ts` + `playbook-execution-advisor.service.ts` + `playbook-node-suggestions.service.ts` | `playbook-flow-advisor.service.ts` (consolidated) | Port + rewrite suggestion logic for iteration-aware results. |

## 3.2 Python ports

| Source | Target | Treatment |
|--------|--------|-----------|
| `mcp_client_factory.py` | `flow_engine/mcp/client.py` | Move. |
| `playbook_tool_factory.py` | `flow_engine/tools/factory.py` | Move + simplify. |
| `action_executor.py` | `flow_engine/nodes/action.py` | Move, split if > 300 lines. |
| `generate_playbook_prompt.py` | `flow_engine/generation/prompt.py` | Port; DAG-only initial output (loops are a follow-up). |
| `playbook_node_advisor.py` | `flow_engine/advisor/node_advisor.py` | Port + adapt for iteration awareness. |

## 3.3 What is NOT ported

Anything tied to DAG-only semantics, `isStale`, or single-output task results. Rewritten in earlier phases:

- `playbook-execution-graph.service.ts` → superseded by `playbook-flow-builder.service.ts` + validator.
- `playbook-replay.service.ts` → rewritten in Phase 5.
- `playbook-judge-enrichment.service.ts` → rewritten in Phase 5.
- `playbook-repeatability.service.ts` → rewritten in Phase 5.
- `langgraph_engine/graph_builder.py` (2713 lines) → replaced by `builder/` subpackage.
- `langgraph_engine/workflow_service.py` → replaced by `flow_engine/grpc_service.py`.

## 3.4 Cleanup rules during port

- File > 300 lines on arrival → split before commit.
- Function > 50 lines → split before commit.
- Dead branches, commented code, `// TODO` without issue → deleted.
- Tests come along; rewrite tests dependent on DAG-only behaviour.

## 3.5 Acceptance criteria

- [ ] New module owns its node template catalog. Old tables not read by new module.
- [ ] MCP, tools, prompt rendering, output formatting all reachable from a flow execution.
- [ ] Integration test: flow with real MCP-backed tool step + prompt template + output format runs end-to-end.
- [ ] Intent produces a valid `FlowSnapshot` (sequential edges, default data bindings) for a sample prompt.
- [ ] Generation produces a valid `FlowSnapshot` for a sample prompt.
- [ ] Design chat creates and updates a flow conversationally.
- [ ] Advisor returns suggestions on a 2-iteration execution.
- [ ] No file in the new module exceeds 300 lines.

---

# Phase 4 — Frontend Refactor (in place)

**Goal.** Adapt the existing playbook frontend module to the new backend contract. **No new module, no rewrite.** The frontend stays at `front/src/modules/playbook/`; ~70% of files are untouched, ~20% gain new sections, ~10% undergo targeted surgery. UI/UX preserved by construction.

**Estimate:** 12–17 working days, split into six PR-sized sub-phases. All PRs land on the `playbook-rewrite` branch; `main` keeps the working old stack until Phase 6.

See [UI_INVENTORY.md](UI_INVENTORY.md) for the file-by-file touch map.

## 4a. Types & API client (1–2 days)

**One PR.** Foundation for everything downstream.

- Replace `PlaybookEdge` in `types.ts` with discriminated `ControlEdge` (`kind: 'sequential' | 'conditional'`).
- Add `DataBinding` type (separate collection, not on edges).
- Extend `PlaybookNode` discriminator: existing `step` / `iterator` + new `router` / `human_approval`.
- Update `api.ts` to new endpoints; add `Idempotency-Key` header support.
- Update Zustand store action signatures; no UI changes yet.
- Exhaustive `switch (kind)` with `never` defaults wherever the type is consumed — TypeScript will surface every consumer that needs an update.

**Done when:** types compile against a sample new-backend payload, store actions covered by existing test shapes adapted, `npm run build` green. No visual change.

## 4b. Canvas hook surgery (3–4 days)

The 600+ line `hooks/usePlaybookCanvas.ts` is the most DAG-poisoned file. Surgical refactor:

- Split into focused helpers under `hooks/helpers/`:
  - `control-edge-serializer.ts` — sequential + conditional edge ↔ React Flow edge.
  - `data-binding-serializer.ts` — bindings ↔ data-layer edges (rendered, not persisted as React Flow edges).
  - `cycle-router-validator.ts` — replaces `wouldCreateCycle`; allows cycles only through routers with `maxIterations`.
  - `node-serializer.ts` — pulled out of the main hook.
- `usePlaybookCanvas.ts` itself ≤ 300 lines, composing the helpers.
- Existing canvas consumers (`PlaybookCanvasPage`, `PlaybookNode`, `PlaybookTriggerNode`, `PlaybookIteratorContainerNode`) only update their type imports.
- Delete `utils/migrate-ports.ts`, `utils/intent-edge-ports.ts`, `utils/iterator-ports.ts` once consumers no longer reference them.

**Done when:** canvas loads, saves, validates against new backend. No router/HITL UI yet. No visual change to existing nodes/edges.

## 4c. New node kinds & editor sections (3–4 days)

Add new components alongside existing ones. **No edits to unrelated files.**

- New: `components/RouterNode.tsx` — step-node shell with handle-per-`outputLabel`.
- New: `components/HumanApprovalNode.tsx` — step-node shell with pause icon.
- New: edge components for conditional + `__error__` edges (dashed, labelled, alert-color variants).
- Extend `components/PlaybookNodeEditor.tsx` with conditional sections:
  - Router section: `outputLabels` list editor + `maxIterations` field. Visible when `node.kind === 'router'`.
  - Human-approval section: prompt template + timeout. Visible when `node.kind === 'human_approval'`.
  - Data-binding section: per-input-port source picker (node-output / trigger / state / constant / expression) + iteration selector. Visible for all kinds.
- Extend `ConnectorSidebar.tsx`: add router + human-approval to the node palette.

**Done when:** retry/fix/done flow from the user story is buildable and savable via UI.

## 4d. Execution surfaces iteration-aware (2–3 days)

In-place modifications to existing components. JSX structure preserved; data shape changes.

- `ExecutionStepList.tsx`: group by `(taskId)` with collapsible iteration accordion when count > 1.
- `ExecutionStepDetail.tsx`: iteration selector to jump between iterations of the same task.
- `ExecutionHeader.tsx`: queue position when status is `queued`; recursion-budget remaining when running.
- `PlaybookStatusBadge.tsx`: new statuses `queued`, `pending_approval`, `cancelled`.
- `BaselineBadgePopover.tsx`: per-iteration baseline targeting.

**Done when:** retry loop visibly iterates in the step list; statuses correct.

## 4e. New surfaces (2–3 days)

- Data-layer toggle on `PlaybookToolbar.tsx` (icon button; persisted preference in localStorage).
- Replace `InterruptDialog.tsx` with new HITL approval dialog inside the execution view (approve / reject / edit + iteration context + timeout countdown). Reuses Dialog primitive.
- Trace-replay vs re-execute action separation: two distinct buttons in execution detail with explicit copy.
- Recursion-limit & max-parallelism fields in the flow settings drawer.
- Router-decision badges inline in `ExecutionStepList` between iterations.

**Done when:** all new surfaces functional; existing surfaces unchanged.

## 4f. Cleanup pass (1 day)

**Surgical, not sweeping.** Only files touched in 4a–4e get cleaned.

- Delete dead branches in touched files (DAG-only assumptions, single-output assumptions).
- Delete commented code, `TODO`-without-issue, `// removed X` markers.
- Run `ts-prune` on the module; delete unused exports.
- Ensure no file > 300 lines, no function > 50.

Files not touched in 4a–4e remain as-is. The cleanup pass is not a license to drift visual design.

## 4.7 Frontend acceptance criteria (whole phase)

- [ ] User story example (retry/fix/done with `max_attempts`) buildable, runnable, observable end-to-end from UI.
- [ ] All `preserve` rows in [UI_INVENTORY.md](UI_INVENTORY.md) compile and render unchanged.
- [ ] All `extend` rows show only the new affordances described in the inventory.
- [ ] No new strings outside what's needed for new affordances; existing locale keys unchanged.
- [ ] `npm run build`, `npm test`, `npm run lint` green.
- [ ] No file > 300 lines, no function > 50 lines in touched files.
- [ ] No imports from old backend endpoints; all API calls go through new endpoints.

---

# Phase 5 — Replay, Evaluation, Repeatability, Scheduling, Mail Triggers

**Goal.** Backend surrounding features rewritten or ported, all iteration-aware. Frontend pieces stay in place — only API call sites and store actions retarget.

**Estimate:** 4–6 working days (down from 8–12 since frontend isn't being rebuilt).

## 5.1 Trace replay vs re-execution

Two distinct user actions:

- **Trace replay** (`POST /executions/:id/trace-replay`) — deterministic. Reconstructs the timeline from persisted node outputs + router decisions. No LLM calls. For debugging and demos.
- **Re-execution** (`POST /executions/:id/re-execute`) — runs again with the same inputs. LLM-driven decisions may diverge. UI warns "may diverge from original".

Trace replay reads `playbook-flow-task-result` + `playbook-flow-router-decision` collections; emits the same SSE events the live execution would have.

## 5.2 Evaluation

- Rewritten `playbook-flow-evaluation.service.ts`.
- Baseline anchored to `(taskId, iteration)`. Default iteration = 0 for non-loop nodes, last iteration for loop nodes; user can pin a specific iteration.
- Evaluation runs over a re-execution (not trace replay — needs fresh outputs).
- Eval results stored with iteration awareness.

## 5.3 Repeatability

Rewritten as two metrics:

- **Structural repeatability** — across N re-executions with the same inputs, does the same set of `(taskId)` get visited, and within bounded iteration variance?
- **Content repeatability** — for each `(taskId, iteration)`, does output match within similarity threshold?

Each metric is a separate service method, separately scored, separately surfaced in UI.

## 5.4 Scheduling

- Port `playbook-schedule-runner.service.ts` → `playbook-flow-schedule.service.ts`.
- Schedule schemas / DTOs / util functions copied + simplified.
- Schedule fires now call the new execution service (with idempotency keyed on `(scheduleId, fireTime)`).
- Tests ported.

## 5.5 Mail triggers

- Port the `playbook-mail-*` cluster wholesale into `playbook-flow-mail/`.
- Most code is independent of execution model — light cleanup, remove DAG-only assumptions.
- Webhook idempotency keyed on Microsoft Graph notification id.

## 5.6 Frontend surfaces

Existing components stay in place. Only the surrounding wiring is updated:

- `AdvisorResultPanel.tsx` — adapt to per-iteration suggestions (extends existing component, doesn't replace).
- `RepeatabilityDetails.tsx` — internal layout updated for two-metric model; component shell preserved.
- Schedule UI and Mail trigger UI: API call sites in their store/api layer point at the new endpoints. JSX and styling unchanged.
- Replay UI: the trace-replay vs re-execute split lands in Phase 4e; here we wire it to backing data.

## 5.7 Acceptance criteria

- [ ] Trace replay of a 3-iteration retry-loop execution reproduces the exact same timeline events deterministically.
- [ ] Re-execution warns and runs; output may differ; eval baselines still apply.
- [ ] Cron-scheduled flow fires and produces an execution.
- [ ] Mail-triggered flow fires from a webhook and produces an execution.
- [ ] Schedule fire deduped on retries via idempotency.
- [ ] Repeatability metrics computed and surfaced for a 3-run sample.

---

# Phase 6 — Delete Legacy & Cut Over

**Goal.** One PR that deletes the old `playbook` module entirely, renames `playbook-flow` → `playbook`, drops legacy Mongo collections, merges to `main`.

**Estimate:** 2–3 working days.

## 6.1 Deletion checklist

- [ ] `YellowStorm/back/src/modules/playbook/` (legacy backend module) deleted.
- [ ] `yellowstorm-adk/src/langgraph_engine/` deleted.
- [ ] Old proto files removed from `proto/` and `yellowstorm-adk/grpc/proto/`.
- [ ] Old backend endpoints removed from `API_ENDPOINTS`.
- [ ] Old error codes removed from `ErrorCode` enum (frontend + backend in sync).
- [ ] Frontend module stays at `front/src/modules/playbook/` — no rename, no deletion (it was refactored in place).
- [ ] Old Mongo collections dropped via one-shot script `scripts/drop-legacy-playbook-collections.ts` — run once, then deleted from repo.

## 6.2 Backend rename

- Backend `playbook-flow/` → `playbook/` (the old one is now gone).
- `flow_engine/` kept (engine package name doesn't need to mirror the module name).
- Update all backend imports, proto package names, telemetry events.
- Frontend `api.ts` updates the endpoint constants if the rename changes URLs.

## 6.3 Final verification

- [ ] `npm test`, `pytest` both green.
- [ ] `npm run build` produces a smaller bundle than before (sanity check).
- [ ] `ts-prune` reports zero unused exports in the new module.
- [ ] No file in playbook surface > 300 lines, no function > 50 lines.
- [ ] Manual smoke: create flow, run retry loop, HITL approval, cancel mid-execution, schedule, trace replay, re-execute.
- [ ] Visual regression: frontend `preserve` rows from [UI_INVENTORY.md](UI_INVENTORY.md) pass screenshot diff against the pre-rewrite baseline.
- [ ] PR description lists every deleted directory and dropped collection.

## 6.4 Merge

- [ ] PR `playbook-rewrite` → `main`.
- [ ] Tag merge commit `playbook-rewrite-complete`.
- [ ] Delete `playbook-rewrite` branch.

---

# Coverage Matrix (full feature inventory)

Backend rewrites, frontend refactors in place.

| # | Feature | Backend | Frontend | Treatment |
|---|---------|---------|----------|-----------|
| 1 | Core Canvas + CRUD | Phase 1 (rewrite) | Phases 4a–c (refactor) | Control/data split |
| 2 | Execution Engine | Phase 2 (rewrite) | Phase 4d (refactor) | Reducers, routers, HITL, error routing |
| 3 | Iterator | Phase 2 (rewrite) | Phase 4a–c (types only) | Coexists with control loops; no mixing v1 |
| 4 | Judge / Evaluation | Phase 5 (rewrite) | Phase 5 (existing UI retargeted) | Iteration-aware backend |
| 4 | Advisor | Phase 3 (port) | Phase 5 (existing UI retargeted) | Per-iteration suggestions |
| 5 | Repeatability | Phase 5 (rewrite) | Phase 5 (existing component, two-metric layout) | Structure + content metrics |
| 6 | AI Settings | Phase 3 (port) | Phase 4a (api.ts retarget) | Topology-agnostic |
| 6 | Intent | Phase 3 (port) | Phase 4a (api.ts retarget) | DAG-only initial output, loops as follow-up |
| 7 | Mail Trigger | Phase 5 (port) | Phase 5 (api.ts retarget) | Existing UI unchanged |
| 8 | HITL Interrupts | Phase 2 (rewrite) | Phase 4e (new dialog replaces `InterruptDialog`) | `human_approval` node, `pendingApproval` state |
| 9 | Replay | Phase 5 (rewrite) | Phase 4e (trace/re-execute split) | Trace replay vs re-execution split |
| 10 | Execution Schedule | Phase 5 (port) | Phase 5 (api.ts retarget) | Existing UI unchanged |
| 11 | Artifact Routing | Phase 3 (port) | n/a | Iteration-aware backend |
| 12 | Playbook Generation | Phase 3 (port) | Phase 4a (api.ts retarget) | DAG-only initial output, loops as follow-up |
| 13 | Output Format Templates | Phase 3 (port) | Phase 4a (api.ts retarget) | Topology-agnostic |
| 14 | Node Templates | Phase 3 (port) | Phase 4c (palette additions) | Add router + human_approval kinds |
| 15 | Design Chat | Phase 3 (port) | Phase 4a (api.ts retarget) | Existing UI unchanged |

---

# Total Estimate

| Phase | Estimate |
|-------|----------|
| 1. Data model & backend skeleton | 4–6 days |
| 2. New LangGraph engine + HITL | 8–10 days |
| 3. Port templates / settings / intent / generation / design chat / advisor / MCP / tools | 5–7 days |
| 4. Frontend refactor (6 sub-phases, in place) | 12–17 days |
| 5. Replay / eval / repeatability / scheduling / mail | 4–6 days |
| 6. Delete legacy & cut over | 2 days |
| **Total working days** | **35–48 days** |

Wall-clock factor ≈ 1.5× for one engineer ⇒ **2.5–3.5 months solo**.
With two engineers in parallel (one on backend + engine, one on frontend refactor — frontend can start once Phase 1 contract is locked), **5–8 weeks calendar time**.

---

# Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Iteration-keyed results break replay/eval invariants we don't notice until Phase 5 | Phase 2 integration test records ≥ 2 iterations and reads them back. |
| LangGraph version surprises | Lock LangGraph version in `pyproject.toml` at Phase 2 start. Upgrade is a separate task. |
| Checkpointer not actually shared under load | Phase 3 acceptance includes a 2-process concurrent execution test. |
| Frontend ↔ backend type drift on the long branch | Paired-update PRs per contract change, per guideline §18. CI rejects partial-layer PRs. |
| "Just one more thing" scope creep | New features go in post-rewrite PRs against `main`, not into `playbook-rewrite`. The branch's only goal is parity + loops + HITL. |
| Long branch drift | Weekly rebase onto `main`. Dedicated rebase day if conflicts pile up. |
| HITL approval timeouts orphan executions | Timeout job cancels stuck executions and writes a clear `error.code`. Tested in Phase 2. |
| Replay non-determinism confuses users | Trace replay vs re-execute are separate actions with distinct UI affordances and warning copy. |
| OTel collector unavailable in dev | Tracing is best-effort: missing collector logs a warning, never breaks execution. |
| Worker pool starvation under burst load | Queue + per-user cap absorb bursts; horizontal scaling for sustained load. Phase 1 queue depth metric exposed. |

---

# Definition of Done (whole rewrite)

- [ ] All 6 phases' acceptance criteria met.
- [ ] User-story example (retry/fix/done with `max_attempts`) runs end-to-end through the UI.
- [ ] Every feature in the coverage matrix above has a working successor.
- [ ] No file in playbook surface (backend + frontend + flow_engine) exceeds 300 lines.
- [ ] No function exceeds 50 lines.
- [ ] `ts-prune` and `ruff` report zero violations in the playbook surface.
- [ ] All user-facing strings in EN + FR.
- [ ] Legacy `playbook` module and `langgraph_engine` package deleted.
- [ ] `main` builds, tests pass, smoke test from §6.3 passes.
