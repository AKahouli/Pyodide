# Playbook Rewrite — Implementation Plan

> **Goal.** Replace the existing DAG-only playbook stack with a clean, loop-capable control-flow runtime. No production users today → no migration, no parallel maintenance, no `v2` suffixes. The new module *is* playbook.
>
> **Companion docs.** `PLAYBOOK_REWRITE_GUIDELINES.md` (coding rules), `FRONTEND_GUIDELINES.md`, `BACKEND_GUIDELINES.md`. On conflict, the stricter rule wins.

## Working Mode

- **Long-lived branch** `playbook-rewrite` off `main`. Phases land as PRs into that branch. Final merge to `main` only at Phase 6.
- **Between Phase 1 and Phase 6 the playbook feature is partially broken on the branch.** That is acceptable because no users depend on it.
- **Every phase ends with green CI** on the branch: typecheck, lint, unit tests, build. Integration tests gate phases that need them (marked below).
- **Every PR ≤ ~800 LOC of changes** where feasible. Larger only with a written rationale in the description.

## Glossary

- **Flow** — the new term for a playbook with conditional control flow. Internally the module is still called `playbook`; "flow" is the runtime concept.
- **Router node** — a node whose only job is to emit a `routerLabel` string into state. Successors are conditional edges keyed on that label.
- **Iteration** — the integer counter incremented each time a node executes inside a loop. Non-looped nodes always have `iteration = 0`.

---

# Phase 1 — Data Model & Backend Skeleton

**Goal.** Lock the contract. Nothing executes yet; we are only fixing the shape of data, types, and module boundaries so the rest of the rewrite has stable ground to stand on.

## 1.1 Backend module scaffold

New folder `YellowStorm/back/src/modules/playbook/` (after we delete the old one in Phase 6 we keep the same path; for now, scaffold under `playbook-flow/` and rename in Phase 6's deletion PR — this avoids file collisions during the rewrite).

```
modules/playbook-flow/
├── playbook-flow.module.ts
├── controllers/
│   ├── playbook-flow.controller.ts          # CRUD
│   └── playbook-flow-execution.controller.ts # run / cancel / status
├── services/
│   ├── playbook-flow.service.ts             # CRUD orchestration
│   ├── playbook-flow-validator.service.ts   # graph validity, router coverage
│   ├── playbook-flow-builder.service.ts     # snapshot → gRPC payload
│   ├── playbook-flow-execution.service.ts   # execution lifecycle
│   └── playbook-flow-results.service.ts     # iteration-keyed result writes
├── schemas/
│   ├── playbook-flow.schema.ts
│   ├── playbook-flow-execution.schema.ts
│   └── playbook-flow-task-result.schema.ts
├── dto/
│   ├── create-playbook-flow.dto.ts
│   ├── update-playbook-flow.dto.ts
│   ├── playbook-flow-node.dto.ts
│   ├── playbook-flow-edge.dto.ts
│   └── playbook-flow-router-config.dto.ts
├── mappers/
│   ├── flow-to-snapshot.mapper.ts
│   └── execution-to-response.mapper.ts
├── interfaces/
│   ├── playbook-flow.interface.ts
│   └── playbook-flow-execution.interface.ts
└── constants/
    └── node-kinds.ts
```

Every file ≤ 300 lines. Every service ≤ one responsibility (see filename).

## 1.2 Schemas

**`playbook-flow.schema.ts`**
- `id`, `ownerId`, `name`, `description`, `triggerConfig`, `settings`, `nodes: FlowNode[]`, `edges: FlowEdge[]`, timestamps.
- `FlowNode` discriminated by `kind: 'step' | 'router' | 'iterator'`.
- `FlowEdge` discriminated by `kind: 'sequential' | 'conditional'`; conditional edges carry `routerLabel: string`.
- Router nodes carry `routerConfig: { outputLabels: string[]; maxIterations: number }`.

**`playbook-flow-execution.schema.ts`**
- `id`, `flowId`, `ownerId`, `status`, `startedAt`, `endedAt`, `error?`, `recursionLimit`, `inputContext`.
- No embedded results — those live in their own collection.

**`playbook-flow-task-result.schema.ts`**
- `executionId`, `taskId`, `iteration`, `status`, `output`, `error?`, `startedAt`, `endedAt`.
- **Compound index** `(executionId, taskId, iteration)` unique.
- **Compound index** `(executionId, taskId)` for "all iterations of this task" reads.

## 1.3 DTOs

Strict `class-validator` everywhere. Discriminated `@Type` for `FlowNodeDto` and `FlowEdgeDto`. Router config validation: `outputLabels.length >= 1`, `maxIterations >= 1 && <= 100`.

## 1.4 Validator service (rules enforced on save)

1. Every node id is unique.
2. Every edge endpoint references an existing node.
3. Every conditional edge's source node is a router.
4. Every router's `outputLabels` is fully covered by outgoing conditional edges (no unmapped label, no extra labels).
5. Every router has at least one terminal route (reaches `END` without passing through the same router again).
6. Any cycle must include at least one router with `maxIterations` set.
7. Iterator containers' children must form a DAG internally (loops inside iterators are disallowed for v1).

Each rule is one method on the validator. One test per rule.

## 1.5 gRPC contract update

In `yellowstorm-adk/grpc/proto/` mirror in backend `proto/`:
- New service `PlaybookFlowRuntime` with `Run(stream Event)` and `Cancel(executionId)`.
- `FlowSnapshot` message with `repeated FlowNode nodes`, `repeated FlowEdge edges`, `RouterConfig` sub-message.
- Event types: `NodeStarted`, `NodeCompleted`, `NodeFailed`, `RouterDecision`, `IterationIncremented`, `ExecutionCompleted`, `ExecutionFailed`.
- `postbuild` script extended to copy new `.proto`.

## 1.6 Controllers

Thin. `@RequirePermissions('playbook.*')`. Endpoints:
- `POST /api/v1/playbooks` — create
- `GET /api/v1/playbooks` — list (paginated)
- `GET /api/v1/playbooks/:id` — read
- `PATCH /api/v1/playbooks/:id` — update (validates on save)
- `DELETE /api/v1/playbooks/:id`
- `POST /api/v1/playbooks/:id/executions` — start
- `GET /api/v1/playbooks/:id/executions` — list
- `GET /api/v1/executions/:id` — read with results grouped by `(taskId, iteration)`
- `POST /api/v1/executions/:id/cancel`

## 1.7 Acceptance criteria

- [ ] All schemas, DTOs, validators ship with unit tests (happy + error paths).
- [ ] Validator rejects every invalid graph variant covered in §1.4.
- [ ] `npm run build`, `npm test`, `npm run lint` green.
- [ ] No execution path is wired yet — `POST /executions` returns 501 with `ERR_1000` or a clearly-marked "not yet implemented" code. We add the proper code in Phase 2.
- [ ] No code from the old `playbook` module is imported by the new module.

**Estimated duration:** 3–4 days.

---

# Phase 2 — New LangGraph Engine

**Goal.** A working Python runtime that can build and execute flows with sequential, conditional, iterator, and parallel topologies. No frontend yet; tested through gRPC fixtures.

## 2.1 Package scaffold

```
yellowstorm-adk/src/flow_engine/
├── __init__.py
├── state.py                 # ExecutionState TypedDict
├── builder/
│   ├── __init__.py          # compose() entrypoint
│   ├── sequential.py        # add_edge wiring
│   ├── conditional.py       # router nodes + add_conditional_edges
│   ├── iterator.py          # iterator container expansion
│   ├── parallel.py          # fan-out / fan-in
│   └── guards.py            # iteration counter injection
├── routers/
│   └── base.py              # router function factory
├── nodes/
│   ├── step.py              # step node executor
│   └── router.py            # router node executor
├── runtime/
│   ├── invoker.py           # ainvoke / astream wrapper
│   └── events.py            # gRPC event emission
├── grpc_service.py          # PlaybookFlowRuntime servicer
└── tests/
    ├── test_sequential.py
    ├── test_conditional.py
    ├── test_iterator.py
    ├── test_parallel.py
    ├── test_guards.py
    └── fixtures/
        ├── linear.json
        ├── retry_loop.json
        ├── recovery_branch.json
        └── max_iterations.json
```

Every file ≤ 300 lines. `flow_engine` does not import from the legacy `langgraph_engine`.

## 2.2 State model

```python
class ExecutionState(TypedDict):
    execution_id: str
    flow_id: str
    inputs: dict[str, Any]
    task_outputs: dict[tuple[str, int], Any]   # (task_id, iteration) -> output
    iterations: dict[str, int]                 # task_id -> current iteration
    router_decisions: dict[str, str]           # router_node_id -> last emitted label
    errors: list[ExecutionError]
```

Iteration is a first-class field. No "blob of dict" escape hatch.

## 2.3 Builder

`builder.__init__.compose(snapshot)`:
1. Validate snapshot (defensive: backend already validated, but gRPC boundary re-checks shape).
2. Group nodes by kind. Instantiate step nodes, router nodes, iterator containers.
3. Wire sequential edges via `add_edge`.
4. Wire conditional edges via `add_conditional_edges(source, router_fn, {label: target})`.
5. Inject iteration counter into the state-update of every node inside a cycle.
6. Compile to a `StateGraph`.

Each builder file owns its topology — no cross-imports between `sequential.py` and `conditional.py`.

## 2.4 Router functions

`routers.base.make_router(router_node_id, output_labels, max_iterations)` returns a pure `(state) -> Literal[...]` function. The function:
1. Reads `state.iterations[router_node_id]`.
2. If `>= max_iterations`, returns a designated terminal label (the first label whose target is `END` or outside the loop, determined at build time).
3. Otherwise returns `state.router_decisions[router_node_id]`.

The actual decision string is written by the router node executor *before* the router function runs. The router function never calls an LLM — it's just dispatch.

## 2.5 Recursion limit & cost cap

Every `ainvoke` / `astream` call passes `config={"recursion_limit": flow.settings.recursionLimit}` with a server-side hard ceiling (e.g. 50). Per-execution token-cost cap is checked at every node entry — if exceeded, raise `CostLimitExceeded` which the gRPC layer translates to `ExecutionFailed`.

## 2.6 gRPC service

`PlaybookFlowRuntime` implements:
- `Run(RunRequest) -> stream Event`: builds graph, invokes with streaming, emits events.
- `Cancel(CancelRequest)`: cooperative cancellation via an asyncio event in the state.

## 2.7 Backend wiring

`playbook-flow-execution.service.ts` becomes a real client of `PlaybookFlowRuntime`. Streams events into `playbook-flow-results.service.ts` which writes iteration-keyed task results.

## 2.8 Acceptance criteria

- [ ] Python: `pytest` green, `ruff` clean, `mypy --strict` clean.
- [ ] Backend integration test runs a linear flow and a retry-loop flow end-to-end against a real `PlaybookFlowRuntime` instance (docker-compose in CI).
- [ ] Fixture-driven tests cover: linear, parallel, iterator, retry-loop, recovery-branch, max-iterations exit.
- [ ] `POST /executions` returns a real execution id; `GET /executions/:id` returns iteration-keyed results.
- [ ] Cancel works mid-execution and is reflected within ≤ 1 second.

**Estimated duration:** 5–7 days.

---

# Phase 3 — Port Node Templates, Prompts, MCP, Tools

**Goal.** Move the parts of the old module that are clean and reusable into the new one, simplifying as we go. We **copy** (not import) so we can drop the legacy completely in Phase 6.

## 3.1 What to port (clean, reusable)

| Source | Target | Notes |
|--------|--------|-------|
| `playbook-node-template.service.ts` | `playbook-flow-node-template.service.ts` | Drop legacy fields not used by `FlowNode`. |
| `playbook-node-template.schema.ts` | `playbook-flow-node-template.schema.ts` | Add `kind` (step/router/iterator) discriminator. |
| `playbook-prompt-template.schema.ts` + renderer | `playbook-flow-prompt-template.*` | Rename only if shape changes. |
| `playbook-output-format.*` | `playbook-flow-output-format.*` | As-is unless logic simplifies. |
| `langgraph_engine/mcp_client_factory.py` | `flow_engine/mcp/client.py` | Move, do not duplicate. |
| `langgraph_engine/playbook_tool_factory.py` | `flow_engine/tools/factory.py` | Move, simplify. |
| `langgraph_engine/action_executor.py` | `flow_engine/nodes/action.py` | Move and split if > 300 lines. |
| `langgraph_engine/checkpointer.py` | `flow_engine/runtime/checkpointer.py` | Move, verify shared backend (Postgres/Redis, not in-memory). |
| `langgraph_engine/artifact_routing.py` | `flow_engine/runtime/artifacts.py` | Move, retire DAG-only assumptions. |
| `langgraph_engine/port_resolution.py` | `flow_engine/runtime/ports.py` | Adapt for iteration-aware outputs. |

## 3.2 What is NOT ported

Anything tied to DAG-only semantics, `isStale` flagging, or single-output task results. We rewrite, not copy:

- `playbook-execution-graph.service.ts` — superseded by `playbook-flow-builder.service.ts` + `playbook-flow-validator.service.ts`.
- `playbook-execution-advisor.service.ts` — re-evaluate need; if kept, rewrite for iteration awareness.
- `playbook-replay.service.ts` — rewritten in Phase 5.
- `playbook-judge-enrichment.service.ts` — rewritten in Phase 5 if still needed.
- `langgraph_engine/graph_builder.py` (2713 lines) — replaced by the new `builder/` subpackage in Phase 2.
- `langgraph_engine/workflow_service.py` — replaced by `flow_engine/grpc_service.py`.

## 3.3 Cleanup rules during port

- File > 300 lines on arrival → split before commit.
- Function > 50 lines → split before commit.
- Dead branches, commented code, `// TODO` without issue → deleted.
- Tests come along; if the old test depended on DAG-only behaviour, rewrite the test.

## 3.4 Acceptance criteria

- [ ] New module owns its node template catalog. Old node template tables not read by new module.
- [ ] MCP, tools, prompt rendering, output formatting all reachable from a new flow execution.
- [ ] Integration test: a flow with a real MCP-backed tool step + a prompt template + an output format runs end-to-end.
- [ ] No file in the new module exceeds 300 lines.

**Estimated duration:** 4–6 days.

---

# Phase 4 — Frontend Rebuild

**Goal.** Same UX, new types. The user sees the canvas they know plus router nodes and conditional edges. The old playbook module on the frontend is left in place but unreachable from routing — deleted in Phase 6.

## 4.1 Module scaffold

```
front/src/modules/playbook-flow/
├── index.ts                   # barrel
├── types.ts                   # FlowNode, FlowEdge (discriminated), RouterConfig
├── api.ts                     # typed wrappers
├── store.ts                   # Zustand
├── locales/
│   ├── en.json
│   └── fr.json
├── pages/
│   ├── PlaybookFlowListPage.tsx
│   ├── PlaybookFlowCanvasPage.tsx
│   └── PlaybookFlowExecutionPage.tsx
├── hooks/
│   ├── usePlaybookFlowCanvas.ts            # ≤ 300 lines
│   ├── usePlaybookFlowExecutionStream.ts
│   └── helpers/
│       ├── edge-serializer.ts
│       ├── node-serializer.ts
│       └── cycle-validator.ts              # router-aware
├── components/
│   ├── canvas/
│   │   ├── FlowCanvas.tsx
│   │   ├── StepNode.tsx
│   │   ├── RouterNode.tsx
│   │   ├── IteratorNode.tsx
│   │   ├── SequentialEdge.tsx
│   │   └── ConditionalEdge.tsx
│   ├── editor/
│   │   ├── NodeEditorDrawer.tsx
│   │   ├── RouterLabelsEditor.tsx
│   │   └── MaxIterationsField.tsx
│   └── timeline/
│       ├── ExecutionTimeline.tsx
│       └── IterationGroup.tsx
└── services/
    └── flowExecutionStreamService.ts        # SSE singleton
```

Every file ≤ 300 lines. The store is one file; split into `store.canvas.ts`, `store.execution.ts` re-exported from `store.ts` only if it exceeds the cap.

## 4.2 Types

```ts
export type FlowEdge =
  | { id: string; kind: 'sequential'; sourceId: string; targetId: string; sourceOutputPortId?: string; targetInputPortId?: string }
  | { id: string; kind: 'conditional'; sourceId: string; targetId: string; routerLabel: string };

export type FlowNode =
  | { id: string; kind: 'step';     /* step-specific */ }
  | { id: string; kind: 'router';   routerConfig: { outputLabels: string[]; maxIterations: number } }
  | { id: string; kind: 'iterator'; /* iterator-specific */ };
```

Components branch on `kind` via exhaustive `switch` with a `never` default.

## 4.3 Canvas behaviour

- Router node renders one labelled handle per `outputLabel`. Connecting from a labelled handle produces a `kind: 'conditional'` edge.
- Connecting from a step node produces `kind: 'sequential'`.
- `cycle-validator.ts` allows cycles only if they pass through a router with `maxIterations` set.
- Edge appearance: solid for sequential, dashed/coloured for conditional, with the `routerLabel` rendered on the edge.

## 4.4 Execution view

- Timeline groups events by `(taskId, iteration)`. Iteration N renders as a collapsible row beneath taskId.
- Live cost + iteration count displayed; warning chip when within 20% of `maxIterations`.

## 4.5 Routing

`Router.tsx` points playbook routes to the new pages. Old paths kept as redirects to the new pages (frontend-only; deleted in Phase 6).

## 4.6 Acceptance criteria

- [ ] Create / edit / save / delete a flow end-to-end through the UI.
- [ ] Build and run the retry-loop example from the user story through the UI.
- [ ] Timeline shows two iterations of `generate_answer` then `improve_answer` then end.
- [ ] All strings in `en.json` + `fr.json`.
- [ ] `npm run build`, `npm test`, `npm run lint` green.
- [ ] No file exceeds 300 lines; no function exceeds 50.

**Estimated duration:** 6–8 days.

---

# Phase 5 — Port Scheduling, Mail Triggers, Evaluation, Replay

**Goal.** Bring the surrounding features (scheduling, mail-driven triggers, evaluation baselines, replay) onto the new module, adapted for iteration awareness.

## 5.1 Scheduling

`playbook-schedule-runner.service.ts` ported to `playbook-flow-schedule.service.ts`. Same cron/timetable semantics; just calls the new execution service. Schedule schemas, DTOs, util functions copied and simplified. Tests ported.

## 5.2 Mail triggers

`playbook-mail-*` services ported wholesale into `playbook-flow-mail/` subfolder. They are largely independent of the execution model so most code is reusable. Hook them to the new execution service; remove DAG-only assumptions if any leak through.

## 5.3 Evaluation

`playbook-evaluation*` ported with the iteration-keyed result model. A baseline is now anchored to `(taskId, iteration=0)` by default but can target a specific iteration. Replay re-executes with the same inputs and checkpoints.

## 5.4 Replay

`playbook-validated-replay` ported. Replay rules updated: replaying a node inside a loop replays the whole loop from that node's entry, not just one iteration, unless the user explicitly pins an iteration.

## 5.5 Acceptance criteria

- [ ] Cron-scheduled flow fires and produces an execution.
- [ ] Mail-triggered flow fires from a webhook and produces an execution.
- [ ] An evaluation baseline created on a flow execution passes its assertions on replay.
- [ ] Replay of a looped flow produces deterministic iteration count given identical inputs (modulo LLM nondeterminism, which is acknowledged in the test as a "stable structure" check, not exact-output).

**Estimated duration:** 4–6 days.

---

# Phase 6 — Delete Legacy & Cut Over

**Goal.** One PR that deletes the old `playbook` module entirely, renames `playbook-flow` → `playbook`, drops legacy Mongo collections, and merges the rewrite branch to `main`.

## 6.1 Deletion checklist

- [ ] `YellowStorm/back/src/modules/playbook/` deleted (the old one).
- [ ] `yellowstorm-adk/src/langgraph_engine/` deleted.
- [ ] `YellowStorm/front/src/modules/playbook/` deleted.
- [ ] Old proto files removed from `proto/` and `yellowstorm-adk/grpc/proto/`.
- [ ] Old endpoints removed from `API_ENDPOINTS`.
- [ ] Old error codes removed from `ErrorCode` enum (frontend + backend in sync).
- [ ] Old locale keys removed.
- [ ] Old Mongo collections dropped via a one-shot script `scripts/drop-legacy-playbook-collections.ts` — run once, then deleted.

## 6.2 Rename

- `playbook-flow/` → `playbook/` (backend, frontend).
- `flow_engine/` → keep as `flow_engine/` (the engine package name doesn't have to match the module name; or rename to `playbook_engine` for symmetry — decide in this PR).
- Update all imports, locale namespaces, routes, telemetry events.

## 6.3 Final verification

- [ ] `npm test` and `pytest` both green.
- [ ] `npm run build` produces a smaller bundle than before (sanity check: dead code is gone).
- [ ] `ts-prune` reports zero unused exports in the new module.
- [ ] No file in the entire playbook surface exceeds 300 lines.
- [ ] Manual smoke: create a flow, run a retry loop, verify timeline, schedule it, cancel an in-flight execution.
- [ ] PR description lists every deleted directory and every dropped collection.

## 6.4 Merge

- [ ] PR `playbook-rewrite` → `main`. Squash merge if branch history is noisy, otherwise merge commit to preserve phase boundaries.
- [ ] Tag the merge commit `playbook-rewrite-complete`.
- [ ] Delete the `playbook-rewrite` branch.

**Estimated duration:** 1–2 days.

---

# Total Estimate

| Phase | Estimate |
|-------|----------|
| 1. Data model & backend skeleton | 3–4 days |
| 2. New LangGraph engine | 5–7 days |
| 3. Port templates, MCP, tools | 4–6 days |
| 4. Frontend rebuild | 6–8 days |
| 5. Scheduling, mail, eval, replay | 4–6 days |
| 6. Delete legacy & cut over | 1–2 days |
| **Total** | **23–33 days** |

Wall-clock will be longer than working days because of review cycles, CI flakes, and the inevitable "we missed a contract layer somewhere" Phase-1.5 fixups. Plan for ~6 weeks calendar time for one engineer, ~3–4 weeks with two.

---

# Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Iteration-keyed results break replay/eval invariants we don't notice until Phase 5 | Add a Phase-2 integration test that records two iterations and reads them back — catches schema issues early. |
| LangGraph version pinning surprises | Lock the LangGraph version in `pyproject.toml` at Phase 2 start. Upgrade is a separate, later task. |
| Checkpointer not actually shared (in-memory by accident) under load | Phase 3 acceptance includes a 2-process concurrent execution test against the configured checkpointer. |
| Frontend ↔ backend type drift during the long branch | One paired-update PR per contract change, per the rule in §13 of the guidelines. Reject partial-layer PRs. |
| "Just one more thing" scope creep on the rewrite | New features go into post-rewrite PRs against `main`, not into `playbook-rewrite`. The branch's only goal is parity + loops. |
| Long branch drifts from `main` | Rebase `playbook-rewrite` onto `main` weekly. If conflicts get hairy, schedule a dedicated rebase day rather than letting them accumulate. |

---

# Definition of Done (whole rewrite)

- [ ] All 6 phases' acceptance criteria met.
- [ ] User-story example (retry / fix / done loop with `max_attempts`) runs end-to-end through the UI.
- [ ] No file in the playbook surface (backend + frontend + flow_engine) exceeds 300 lines.
- [ ] No function exceeds 50 lines.
- [ ] `ts-prune` and `ruff` report zero violations in the playbook surface.
- [ ] All user-facing strings in EN + FR.
- [ ] Legacy `playbook` module and `langgraph_engine` package are deleted from the repository.
- [ ] `main` builds, tests pass, smoke test from §6.3 passes.
