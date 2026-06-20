# Worky Part 3 — Execution, Ephemeral Workers, Governance & Scheduler

**Goal:** Start Stream runs the plan as an event-driven, resumable task graph. The Manager
dynamically spawns ephemeral AI workers (LiteLLM via ADK), binds tools per task, and the
**admin-configurable governance gates** enforce approval on constrained phases. Add the NestJS
scheduler (no Celery).

> Read `00_INDEX.md` first. Requires Parts 1–2 complete.

> **IMPLEMENTATION STATUS (branch `aga-worky-002`, audited 2026):** most of Part 3 is built and
> faithful — start validation/snapshot, governance with owner-relax ceiling, approval gates,
> ephemeral-worker binding callbacks, and the NestJS scheduler. **One gap remains: the
> backend→runtime execution trigger is NOT wired** (see §3.2a). `WorkyRuntimeClient` only has
> `ping()`, and `worky-execution.service` emits `start_task`/`spawn_ephemeral_agent` commands
> that have **no consumer**, so the runtime's `/runtime/streams/{id}/start` flow never fires.
> The planning loop IS wired (`worky-planning.service` calls `/planning-turn`). Closing §3.2a
> is what makes execution actually run.

---

## 1. Prerequisites
Planning + plan deltas + Kanban (Part 2); Manager planning agent; internal callbacks; schemas.

## 2. Out of scope
- Human-task email/reminders content & escalation (Part 4 — but the scheduler infra is built here).
- Budget reservations/hard-stop, final reports, owner memory (Part 4).
- Multi-currency, advanced trace replay (excluded from MVP entirely).

---

## 3. Backend tasks

### 3.1 Start validation + execution snapshot
- `services/worky-execution.service.ts`: implement `POST /worky/streams/{id}/start`. Validate
  per canonical §4.4 (≥1 task; workspace+Manager exist; deps valid & acyclic; executable tasks
  have assignment strategy; required tools available-or-blocked; gated external actions have
  gates; deadlines valid; budget allows). Always clickable → returns outcome
  `fully_executable | partially_executable | globally_blocked` with explanations.
- Create immutable `WorkyExecutionSnapshot` (planVersion, ready/blocked task ids). Set stream
  `status=active|partially_blocked`, `schedulerEnabled=true`, `executionPlanVersion`.

### 3.2 Readiness evaluator & event-driven resume
- `worky-execution.service.ts`: readiness evaluator recomputes the affected DAG branch on each
  event (canonical §11.2). Emit commands (`start_task`, `spawn_ephemeral_agent`,
  `resume_runtime_branch`). Persist `waitConditions` on waiting tasks. NO polling.
- `worky-event.service.ts`: event→reducer→readiness→commands→handlers loop; all idempotent.

### 3.2a Backend→runtime execution trigger (REQUIRED — do not leave as commands-only)
> Emitting commands is NOT sufficient. The commands MUST be dispatched to the runtime, or
> execution never actually runs. A command with no handler that calls the runtime is a bug.
- Extend `services/worky-runtime.client.ts` beyond `ping()` with real methods:
  `start(streamId, { ready_task_ids, context_snapshot, worker_model_id })`,
  `resume(streamId, resume_event)`, `stop(streamId)`, `cancelTask(taskId)` — each calling the
  runtime HTTP endpoints in §4 (mirror how `worky-planning.service.ts` already `fetch`es
  `/runtime/streams/{id}/planning-turn` and consumes the SSE).
- A **command handler** (in `worky-execution.service.ts` or `worky-event.service.ts`) MUST
  consume `start_task`/`spawn_ephemeral_agent` by calling `runtimeClient.start(...)` right after
  the snapshot is created, and `resume_runtime_branch` by calling `runtimeClient.resume(...)`.
  The runtime then drives workers and calls back the existing `/worky/internal/*` endpoints
  (`spawn-worker`, `tasks/{id}/result`).
- Inject `WorkyRuntimeClient` into the execution service. The start flow is:
  `start validation → snapshot → runtimeClient.start(...) → SSE/callbacks update state`.
- **Acceptance for this step:** after `POST /worky/streams/{id}/start` on a ready plan, the
  runtime `/start` endpoint is actually invoked (assert via a spy/mock in the service test), and
  a stubbed/mock runtime that posts a `task.completed` callback drives the task to `done`.

### 3.3 Governance policy engine (admin-configurable)
- `services/worky-governance.service.ts`: resolve the level for `(streamId, actionCategory)`:
  **stream override (if allowed, capped by `max_owner_relax_level`) → workspace policy →
  `default_level`** (canonical §5). Persist/serve `WorkyGovernancePolicy`.
- `controllers/admin/worky-governance.controller.ts`: `GET/PUT /worky/admin/governance-policy`
  (permission `worky:admin:governance`). Per-category level editor, `allow_stream_owner_override`,
  `max_owner_relax_level`.
- `POST /worky/internal/streams/{id}/governance/check` returns the resolved level to the runtime.
  Every evaluation (including `off`) writes a `WorkyAuditEvent`.

### 3.4 Approval-gate flow (backend-owned)
- On a runtime `interaction(type=approval)` callback for a gated category: create a pending
  `WorkyInteraction`, emit `interaction.requested` (SSE). The runtime branch BLOCKS on the real
  event. `POST /worky/interactions/{id}/respond`:
  - **Approved** → emit `interaction.approved`; the backend authorizes the runtime to bind the
    gated tool (return binding on the runtime's resume call). Resume the branch.
  - **Rejected** → emit `interaction.rejected`; task → `blocked|superseded`; trigger replan.
- The LLM can NEVER self-approve. `notify` level: no block, emit audit + owner notification.
  `hard_block`: refuse the action.

### 3.5 Ephemeral worker binding (Agent Entity)
- On `POST /worky/internal/streams/{id}/spawn-worker` `{taskId, role, tool_refs}`: validate tool
  availability/permissions, create an **ephemeral Agent Entity** (existing `agent` module) bound
  to ONLY the requested `connector`/`skill`/`tool` for that task, persist `WorkyEphemeralWorker`,
  return the scoped `WorkerBinding`. Gated-category tools are withheld until approval (§3.4).

### 3.6 Pause/resume/stop & task ops
- Implement `POST /worky/streams/{id}/{pause|resume|stop}` (control_state transitions) and
  `POST /worky/tasks/{id}/{move|pause|resume|cancel|review}`. Cancel only `not_started`;
  supersede `done` (never delete); owner-requested human tasks need approval to cancel
  (canonical §17.5).

### 3.7 Scheduler (NO Celery)
- `services/worky-scheduler.service.ts`: `WorkyScheduledEvent` collection
  `{id,streamId,taskId,eventType,fireAt,status,claimToken}`. A `@nestjs/schedule` interval
  (~30s) atomically claims due events (`findOneAndUpdate` lease), dispatches them into the event
  handler, marks `fired`. Status-gated no-op for terminal tasks. Startup reconciliation sweep
  re-queues overdue unclaimed timers. (BullMQ optional only if Redis already present; Mongo is
  source of truth.)

### 3.8 Backend acceptance criteria
- Start on a fully-ready plan → snapshot + active; partial start blocks only dependent branches;
  globally-blocked returns explanation without starting.
- **Start actually invokes the runtime** (§3.2a): the runtime `/start` endpoint is called after
  snapshot creation, and a runtime `task.completed` / `tasks/{id}/result` callback drives the
  task to `done`. A start that only emits commands without calling the runtime FAILS this check.
- An `external_send` task at level `approval` blocks until owner approves; reject triggers
  replan; `off` runs without a gate; admin can change levels; owner override respects the ceiling
  and can never reach `off`.
- Worker spawn binds only requested tools; gated tools withheld pre-approval.
- Scheduler fires a due event and is idempotent/no-op when the task is terminal.
- Tests: start-validation matrix, governance resolution (incl. override ceiling), approval-gate
  approve/reject, scheduler claim/lease + reconciliation.

---

## 4. Runtime tasks — execution agents (ADK 2.2.0, LiteLLM)

### 4.1 Execution entry
- `routers/execution.py`: implement `POST /runtime/streams/{id}/start` and `/resume`. Drive the
  Manager (`LlmAgent`, dynamic routing via peer-mode transfer) to execute ready tasks; stream
  `ExecutionEvent`s; persist state ONLY via backend callbacks.

### 4.2 Ephemeral workers
- `agents/worker_factory.py`: for a task, call `backend_client.spawn_worker(...)` to obtain the
  scoped binding, then build an ephemeral worker as an **`AgentTool`** (sub-Runner) with
  `model=build_model()` (LiteLlm) and ONLY the bound tools. Retire after completion. Bind tools
  from the platform catalog via `RestApiTool`/`OpenAPIToolset` (httpx_client_factory) using the
  binding. Submit results via `backend_client.task_result(...)`.

### 4.3 Gated phases = deterministic workflow agents
- `agents/gated.py`: for any task whose `governance/check` returns `approval`/`hard_block`, run
  a deterministic **Sequential workflow agent** `[prepare → request approval (HITL) → execute]`.
  The execute step's tool is bound ONLY after the backend returns approval. The Manager has NO
  direct access to gated tools. `request_input` allowed anywhere for clarification.

### 4.4 Bounded, resumable invocations + tracing
- Each step: wake → load state (from the start/resume payload) → one bounded step → emit
  callbacks/events → checkpoint via ADK session/state → exit. Wire `AutoTracingPlugin` (OTel);
  bridge `gen_ai.*` + tool/model spans to `backend_client.cost_event(...)` and trace callbacks.

### 4.5 Runtime acceptance criteria
- pytest (mocked LiteLLM + mocked backend): a ready task spawns a worker bound to only the
  requested tools and submits a result; a gated task routes through the Sequential agent and
  blocks until approval; cost events are emitted.

---

## 5. Frontend tasks — execution & governance

### 5.1 Execution controls & live board
- `StreamControls.tsx`: Start/Pause/Resume/Stop, state-aware (XState `streamLifecycle`). Start
  shows partial/blocked validation explanations inline.
- Kanban now reflects running/review/blocked/done transitions live via SSE; cards show running
  state, blocker reasons, replan indicators.

### 5.2 Approval & task drawer
- `ApprovalModal.tsx`: approve/revise/reject for gated actions; badge on the stream; action stays
  blocked until response (mirrors backend; UI cannot self-approve).
- `TaskDetailDrawer.tsx`: overview, results, artifacts, tool calls, agent traces (ADK session/
  invocation ids), cost/tokens, dependencies, timeline (canonical §9). Raw payloads hidden unless
  admin.

### 5.3 Governance admin page
- `admin/WorkyGovernancePage.tsx` (route `/admin/worky-governance`, permission-gated): per-
  category level editor, owner-override toggle, relax ceiling. Calls `/worky/admin/governance-policy`.

### 5.4 Frontend acceptance criteria
- Start a stream → tasks run and progress on the board live; a gated action raises the approval
  modal and only proceeds after approval; the task drawer shows traces/cost; admin can edit the
  policy. Lint/build clean; component test for approval-gate UI state.

---

## 6. Definition of done (Part 3)
Start Stream executes the plan as a resumable event-driven graph; the Manager spawns tool-scoped
ephemeral workers via LiteLLM; constrained phases enforce backend-owned approval per the
admin-configurable policy (with bounded owner override); the NestJS scheduler fires timed events
without Celery. Tests green; lint/build clean across backend, runtime, frontend.
