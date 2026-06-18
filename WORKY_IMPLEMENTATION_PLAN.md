# Worky (Chief of Staff) — Final Implementation Plan

**Version:** 1.0 (final, development-ready)
**Date:** 2026-06-18
**Runtime target:** Python + **google-adk v2.2.0**; **LLM access via LiteLLM** (ADK `LiteLlm`
model wrapper), provider/model configurable (matching the current platform approach)
**Audience:** Backend, AI/Runtime, Frontend, Platform/DevOps

This is the consolidated, build-ready architecture reference. It supersedes all prior drafts
and contains no revision history.

> **For sequential implementation by an AI coding agent, use the split plan in `docs/worky/`:**
> `00_INDEX.md` (invariants — read first), then `01_FOUNDATIONS.md` → `02_PLANNING.md` →
> `03_EXECUTION_GOVERNANCE.md` → `04_HUMANS_BUDGET_REPORTS.md`. This file remains the canonical
> reference those parts point back to.

---

## 1. Summary

Worky is a Chief-of-Staff feature. A user creates a **Worky Stream**, plans work
conversationally with a **Manager Agent**, refines a **Kanban** plan, sets an optional budget,
and clicks **Start Stream**. Execution then runs as an event-driven, resumable task graph: the
Manager dynamically spawns ephemeral AI workers, binds skills/connectors per task, coordinates
explicitly-assigned humans, replans from results, enforces governance gates, and produces a
final execution report.

**Architectural rule:** **YellowStorm backend (NestJS) owns all product state. The Worky ADK
runtime owns bounded agent reasoning and execution only.**

### 1.1 Component topology

```text
Worky UI (React/Vite)
  sidebar · Kanban · prompt bar · Start Stream · budget/stats · task drawer · admin settings
        | HTTP + SSE
        v
YellowStorm Backend — NestJS  (SINGLE STATE AUTHORITY)
  new `worky` module: streams, tasks, plan versions/deltas, interactions, governance policy,
  budget ledger, human assignment, reports, memory, audit
  reused leaf modules: workspace, agent, agent-type, connector, skill, tool, user, email,
  usage, notifications
        | HTTP (control) + SSE (events)  <-->  HTTP callbacks (state-mutation requests)
        v
worky-adk-runtime — NEW, INDEPENDENT FastAPI service   (google-adk v2.2.0 + LiteLLM)
  Manager LlmAgent (LiteLlm model) · dynamic routing · ephemeral AgentTool workers · per-task
  tool binding · deterministic Sequential workflow agents for gated phases · request_input ·
  checkpoint/resume · AutoTracingPlugin (OTel) -> event bridge
  (no Celery — scheduling lives in NestJS, §4.2/§7)
        |
        v
Platform capabilities (via NestJS): Agent Entity, connector/skill catalogs, workspace, users
```

---

## 2. Runtime isolation — independent FastAPI service

The Worky runtime **MUST be a new, standalone FastAPI service** named `worky-adk-runtime`,
**separate from the existing `yellowstorm-adk` service**.

**Reason:** the existing `yellowstorm-adk` pins an older `google/adk-python` commit and a
different GenAI SDK. Worky requires `google-adk v2.2.0` (GenAI SDK v2.0.0, `gemini-3-flash-preview`,
turns→steps API rename). Sharing a process/venv would force a version conflict on the existing
ADK endpoints. Isolation removes that risk entirely.

**Isolation requirements:**
- New repository directory `worky-adk-runtime/` (sibling of `yellowstorm-adk/`).
- Own `requirements.txt` pinning `google-adk==2.2.0`, its compatible `google-genai==2.x`, and
  `litellm` (same major as the current platform). All agents use ADK's `LiteLlm` model wrapper
  (`from google.adk.models.lite_llm import LiteLlm`) — **no direct provider SDK calls**, so
  provider/model/keys are routed through LiteLLM exactly as today.
- **No Celery / no Celery broker.** The runtime holds no scheduler; all timed work
  (reminders, deadlines, timeouts) is owned by NestJS (§4.2, §7).
- Own `Dockerfile`, own container, own port (default `8011`), own health check.
- Own FastAPI app and ASGI server; **no Python imports from `yellowstorm-adk`**. Any shared
  helper is copied/vendored or extracted to a small versioned package — never a live import.
- Own OpenTelemetry exporter config; own structured logging.
- Independent deploy unit in `docker-compose.yaml` / k8s manifests.
- The existing `yellowstorm-adk` gRPC endpoint is **untouched**.

**Transport:** NestJS ↔ `worky-adk-runtime` communicate over **HTTP (REST for control, SSE for
event streaming)**, not gRPC, to keep the new service fully decoupled. The runtime calls back
into NestJS over authenticated HTTP for every state mutation (§6).

---

## 3. Core data model (NestJS / MongoDB — Worky-owned)

All collections live in the `worky` module. Mongoose schemas, `timestamps: true`,
ObjectId refs, indexed on `streamId`, `ownerUserId`, `status`.

### 3.1 WorkyStream
```json
{
  "id": "stream_001",
  "ownerUserId": "user_001",
  "workspaceId": "workspace_parent_001",
  "artifactWorkspaceId": "workspace_worky_001",
  "managerAgentId": "agent_manager_001",
  "title": "Benchmark analysis for customer",
  "status": "planning",
  "controlState": "active",
  "schedulerEnabled": false,
  "currentPlanVersion": 3,
  "executionPlanVersion": null,
  "governancePolicyRef": "policy_ws_001",
  "budget": { "limitUsd": 0, "limitTokens": 0, "spendUsd": 0, "tokensUsed": 0, "enforcement": "hard_stop" },
  "startedAt": null, "completedAt": null,
  "activeDurationMinutes": 0,
  "createdAt": "…", "lastActivityAt": "…"
}
```
`status` ∈ `created|planning|start_requested|start_validation_failed|active|partially_blocked|
waiting_for_owner|waiting_for_human|waiting_for_budget_decision|paused|stopped|completed|archived`
`controlState` ∈ `active|pause_requested|paused|resume_requested|stop_requested|stopped`

### 3.2 WorkyTask
```json
{
  "id": "task_001", "streamId": "stream_001",
  "title": "Generate benchmark analysis", "description": "…",
  "lane": "ready",
  "planningStatus": "confirmed",
  "executionState": "not_started",
  "controlState": "active",
  "priority": "high",
  "assigneeType": "ephemeral_ai_agent",
  "assigneeId": null,
  "dependsOn": [],
  "requiredTools": ["connector:web_search", "skill:document_generation"],
  "actionCategory": "internal_analysis",
  "theoreticalDeadlineAt": "…",
  "acceptanceCriteria": ["…"],
  "budgetEstimateUsd": 8.5, "budgetActualUsd": 0,
  "tokensEstimate": 40000, "tokensActual": 0,
  "waitConditions": []
}
```
`lane` ∈ `backlog|ready|running|review|blocked|done` (+ system: `failed|canceled|superseded|archived`)
`executionState` ∈ `not_started|scheduled|running|waiting_for_event|review|done|failed|canceled|superseded`

### 3.3 Other collections
- **WorkyMessage** — owner/assistant prompt-bar turns.
- **WorkyPlanVersion** `{ id, streamId, versionNumber, phase, createdBy, createdFromMessageId, triggerEventId, summary }`.
- **WorkyPlanDelta** `{ id, streamId, basePlanVersion, resultPlanVersion, phase, triggerEventId, status, applyMode, reason, createdBy }` (delta body: `create_tasks|update_tasks|cancel_tasks|clarification_requests`).
- **WorkyInteraction** `{ id, streamId, taskId, type, targetUserId, question, options, status, blockingScope, blocksTaskIds }`; `type` ∈ `clarification|approval|review|missing_input|assignment_disambiguation|budget_decision|deadline_decision|escalation_decision`.
- **WorkyExecutionSnapshot** `{ id, streamId, planVersion, startedByUserId, startedAt, readyTaskIds, blockedTaskIds }` (immutable).
- **WorkyEphemeralWorker** `{ id, streamId, taskId, agentEntityId, role, status, adkSessionId, adkInvocationId, lastCheckpointAt }`.
- **WorkyTaskResult** `{ id, taskId, version, status, summary, contentArtifactId, createdByWorkerId }` (versioned; supersede, never delete).
- **WorkyCostEvent** `{ id, streamId, taskId, type, provider, model, inputTokens, outputTokens, costUsd }`.
- **WorkyTrace** (tool + model) — summaries persisted; raw payload URIs redacted, admin-only.
- **WorkyBudgetReservation** `{ id, streamId, taskId, amountUsd, tokens, status }` (atomic).
- **WorkyMailEventLedger** `{ id, streamId, taskId, kind, dedupKey, sentAt }`.
- **WorkyIdempotencyRecord** `{ streamId, eventId, handledAt }` (unique compound index).
- **WorkyGovernancePolicy** — see §5.
- **WorkyExecutionReport** `{ id, streamId, type, status, markdownArtifactId, summary, generatedAt }`.
- **WorkyAuditEvent** — append-only.

---

## 4. Execution model

### 4.1 Phases
- **Planning:** Manager converses, asks `request_input` clarifications, proposes Plan Deltas.
  NestJS validates, versions, applies, projects Kanban. **No execution, no worker spawn.**
- **Execution (after Start Stream):** immutable snapshot created; ready branches start;
  Manager dynamically routes and spawns ephemeral workers; tasks are event-driven and
  resumable; replanning occurs from results/feedback; report generated at terminal state.

### 4.2 Long-running, event-driven rule
All tasks are long-running by contract: no request blocking, every wait condition persisted,
every resume triggered by an event, no active polling for task progress. Fast-path inline
completion is allowed when a task has no wait condition.

**Scheduling (no Celery).** Timed events (reminders, deadlines, timeouts) are owned by NestJS
via a durable **`WorkyScheduledEvent`** collection + a NestJS scheduler worker:
- Each timer is persisted as `{ id, streamId, taskId, eventType, fireAt, status, claimToken }`.
- A `@nestjs/schedule` interval sweeper (every ~30s) atomically **claims** due events
  (`findOneAndUpdate` with a lease/claimToken for multi-instance safety) and dispatches them as
  normal Worky events into the event handler — then marks them `fired`.
- Firing a timer whose task is already terminal is a **status-gated no-op**.
- A startup/daily **reconciliation sweep** re-queues any overdue, unclaimed timers (crash
  recovery). If Redis is already available, BullMQ delayed jobs MAY back the same
  `WorkyScheduledEvent` records for sub-second precision, but the Mongo collection remains the
  source of truth so no message broker is required.

### 4.3 Dynamic graph & ephemeral workers (ADK v2.2.0)
| Need | ADK construct |
|---|---|
| LLM access (all agents) | ADK **`LiteLlm`** model wrapper → LiteLLM router (provider/model configurable, same as current platform) |
| Manager plans & routes | `LlmAgent(model=LiteLlm(...))` orchestrator + agent transfer (peer mode) |
| Deterministic sub-pipelines | Workflow agents: Sequential / Parallel / Loop |
| Dynamic task graph (replanning) | Graph workflow runtime (dynamic workflows) |
| Ephemeral worker per task | `AgentTool` (sub-Runner), tool-bound per task |
| Per-task tool binding | Tools assembled from platform catalog at spawn (`RestApiTool`/`OpenAPIToolset`, `httpx_client_factory`) |
| Clarification | `request_input` |
| Owner memory | Sessions `get_user_state(app_name, user_id)` |
| Trace + cost | `AutoTracingPlugin` (OTel) + `gen_ai.*` metrics → bridged to WorkyCostEvent/WorkyTrace |

Worker tool binding is validated and granted by NestJS via the existing **Agent Entity**
mechanism; the runtime requests a binding, NestJS creates the ephemeral agent entity and
returns the scoped tool set.

### 4.4 Start validation
Before snapshot: ≥1 task; workspace exists; Manager exists; dependencies valid & acyclic;
executable tasks have assignment strategy; human assignments explicit & resolved-or-blocked;
required tools available-or-blocked; gated external actions have approval gates; deadlines
valid where required; budget allows execution (or unlimited). **Start Stream is always
clickable**; the backend returns full / partial / globally-blocked outcomes.

---

## 5. Governance — determinism dial (admin-configurable)

Gating is **policy-driven**, never hardcoded. Common operations are never blocked by default.

### 5.1 Levels
`off` (no gate) · `notify` (runs + audit/owner notification, non-blocking) · `approval`
(deterministic Sequential workflow agent + mandatory backend HITL gate before the impacting
step) · `hard_block` (action disabled).

### 5.2 Categories & default levels
| Action category | Default |
|---|---|
| internal_analysis / research / drafting / replanning | `off` |
| internal_artifact_write | `off` |
| internal_platform_notification | `off` |
| external_send | `approval` |
| customer_facing_release | `approval` |
| external_comms | `approval` |
| budget_overrun | `approval` |
| cancel_human_task | `approval` |

### 5.3 Admin config (`WorkyGovernancePolicy`, workspace scope)
```json
{
  "scope": "workspace",
  "default_level": "off",
  "categories": {
    "external_send":           { "level": "approval" },
    "customer_facing_release": { "level": "approval" },
    "external_comms":          { "level": "approval" },
    "budget_overrun":          { "level": "approval" },
    "cancel_human_task":       { "level": "approval" }
  },
  "allow_stream_owner_override": true,
  "max_owner_relax_level": "notify"
}
```
- Resolution: **stream override (if permitted) → workspace policy → feature default.**
- Owner override is enabled by default but bounded: an owner may relax a category only to
  `max_owner_relax_level` (e.g. `approval`→`notify`), **never to `off`**, and may always make
  it stricter. All overrides audited.
- Unlisted category → `default_level`. Every gate evaluation (including `off`) is audited.

### 5.4 Enforcement (defense in depth; applies at `approval`/`hard_block` only)
1. Tools for a gated category are **not bound** to the Manager — only to the deterministic
   workflow agent for that category. At `off`/`notify` the tool runs normally.
2. The approval gate is a **backend-owned** `WorkyInteraction`; the workflow agent blocks on
   the real `interaction.responded` event. The LLM can never self-approve.
3. The auto-apply-vs-approval replan guard consults the resolved policy: a delta touching an
   `approval`/`hard_block` category is approval-required; touching `off` is auto-applicable.
4. `request_input` clarification is always allowed.

### 5.5 Approval-gate flow
```text
Manager reaches gated step -> runtime calls CheckGovernance(category) -> "approval"
runtime enters Sequential workflow agent: step1 prepare (no send tool bound)
  -> RequestInteraction(type=approval) -> NestJS creates pending WorkyInteraction
                                          emits interaction.requested (SSE to owner)
  [runtime step BLOCKS on real event]
owner responds: POST /worky/interactions/{id}/respond
  -> NestJS persists + emits interaction.responded
       Approved: NestJS binds send tool to workflow agent -> Resume -> step2 execute send
       Rejected: workflow agent ends -> task blocked/superseded -> replan trigger
  -> PersistTaskResult + EmitAudit + RecordCostEvent
```
`notify` runs without blocking (audit + notify). `off` runs silently. `hard_block` refuses.

---

## 6. NestJS ↔ worky-adk-runtime contract

### 6.1 NestJS → runtime (control; HTTP, SSE responses)
```http
POST /runtime/streams/{id}/planning-turn     # body: owner_message, context_snapshot  -> SSE PlanningEvent
POST /runtime/streams/{id}/start             # body: execution_snapshot                -> SSE ExecutionEvent
POST /runtime/streams/{id}/resume            # body: resume_event                      -> SSE ExecutionEvent
POST /runtime/streams/{id}/replan            # body: trigger_event                     -> SSE PlanningEvent
POST /runtime/tasks/{id}/cancel
POST /runtime/streams/{id}/stop
GET  /runtime/health
```

### 6.2 runtime → NestJS (state-mutation requests; authenticated HTTP callbacks)
Runtime tool calls map to these; **NestJS is the authority**. All idempotent by
`(streamId, eventId)`.
```http
POST /worky/internal/streams/{id}/plan-delta           -> applied | rejected
POST /worky/internal/streams/{id}/spawn-worker          -> workerBinding (Agent Entity + scoped tools)
POST /worky/internal/tasks/{id}/result
POST /worky/internal/streams/{id}/interaction           -> interactionId  (clarification/approval/review)
POST /worky/internal/streams/{id}/governance/check      -> resolvedLevel
POST /worky/internal/streams/{id}/budget/reserve        -> reservation | denied
POST /worky/internal/streams/{id}/cost-event
POST /worky/internal/streams/{id}/artifact
POST /worky/internal/streams/{id}/audit
```
Auth: service-to-service token (mTLS or signed JWT). Callbacks for `approval`/`hard_block`
categories receive tool bindings only after the gate resolves.

---

## 7. Humans, deadlines, reminders

- **Explicit-only assignment (MVP):** the Manager may assign a human only when the owner
  explicitly requests it. Resolver: detect reference → `user` lookup in workspace → unique
  match creates human task; ambiguous → clarification; none → ask owner.
- On assignment, auto-grant scoped read/comment on the stream workspace via
  `workspace-share.service.ts`.
- **Email** via `email` module; dedup via `WorkyMailEventLedger`.
- Human updates from Kanban (in-progress / feedback / request-changes / blocked / done) emit
  events that resume dependent branches.
- **Reminders:** NestJS `WorkyScheduledEvent` timers (§4.2) starting **T-6h** before
  `theoreticalDeadlineAt`, repeat per policy, escalate to owner at deadline; status-gated no-op
  if already done. No Celery.

---

## 8. Budget

- Default `0` = unlimited. Owner sets USD and/or token limits. UI shows USD; tokens internal.
- **Reserve-before-start:** estimate → atomic reserve (`findOneAndUpdate` conditional decrement
  + `WorkyBudgetReservation`) → start if available → record actual via `WorkyCostEvent` →
  release unused. Defined overspend tolerance band for estimate<actual.
- **Hard stop** at limit: stop new tasks, pause running branches at safe checkpoints, create
  `budget_decision` interaction, set `waiting_for_budget_decision`. Owner: increase / cheaper
  mode / report now / stop.
- Cost estimation for unknown skills/connectors: default category cost model + metered-after-run;
  conservative reservation ceiling.

---

## 9. Traceability, reports, memory

- **Task drawer:** overview, versioned results, artifacts, tool calls, agent traces (ADK
  session/invocation ids, steps, retries, checkpoints), cost/tokens, dependencies, timeline.
  Raw payloads redacted by default; admin-only.
- **Final report (always generated)** at `completed|stopped|canceled|budget_exhausted_and_closed`.
  Rich if budget remains; lightweight deterministic (from events/tasks/artifacts/traces) if not.
  Stored to workspace `/final-deliverables/worky-execution-report.md` + structured JSON record.
- **Owner-scoped memory:** Markdown files under `/worky-owner-memory/{ownerUserId}/…` +
  ADK Sessions `get_user_state`. Updated only on durable learnings; **confirm before** writing
  durable preferences.

---

## 10. Backend — NestJS `worky` module (detailed)

### 10.1 Module layout (follows existing module conventions)
```text
YellowStorm/back/src/modules/worky/
  worky.module.ts
  index.ts
  controllers/
    worky-stream.controller.ts        # streams CRUD + lifecycle (start/pause/resume/stop)
    worky-message.controller.ts       # prompt-bar messages + planning turns
    worky-board.controller.ts         # Kanban projection
    worky-task.controller.ts          # task ops + results/artifacts/traces/timeline
    worky-interaction.controller.ts   # clarification/approval/review respond/cancel
    worky-budget.controller.ts        # budget get/patch + stats
    worky-report.controller.ts        # execution report get/generate
    worky-events.controller.ts        # SSE live updates (Sse() endpoint)
    worky-internal.controller.ts      # runtime -> backend callbacks (§6.2), service-auth guard
    admin/worky-governance.controller.ts  # admin governance policy CRUD
  services/
    worky-stream.service.ts           # aggregate lifecycle, status/control_state transitions
    worky-planning.service.ts         # message turn -> runtime planning-turn call (SSE relay)
    worky-plan-delta.service.ts       # validate/version/apply deltas, Kanban projection source
    worky-execution.service.ts        # start validation, snapshot, readiness evaluator
    worky-task.service.ts             # task CRUD, lane/state transitions, results
    worky-interaction.service.ts      # interaction lifecycle + approval-gate resolution
    worky-governance.service.ts       # policy resolution (stream->workspace->default), audit
    worky-human-assignment.service.ts # explicit-only resolver, workspace share grant
    worky-budget.service.ts           # atomic reservations, cost events, hard-stop
    worky-scheduler.service.ts        # WorkyScheduledEvent sweeper (@nestjs/schedule)
    worky-report.service.ts           # rich/lightweight report generation
    worky-memory.service.ts           # owner Markdown memory, confirm-before-write
    worky-event.service.ts            # event store, idempotency, SSE fan-out (stream-gateway)
    worky-runtime.client.ts           # HTTP/SSE client -> worky-adk-runtime (§6.1)
    worky-audit.service.ts            # append-only audit
  dto/                                # class-validator DTOs per endpoint
  interfaces/                         # typed contracts (events, deltas, policy, runtime msgs)
  schemas/                            # Mongoose schemas (§3)
  guards/
    worky-stream-access.guard.ts      # owner/share scoped access
    worky-service-auth.guard.ts       # mTLS/signed-JWT for /worky/internal/* callbacks
  constants/
```

### 10.2 Cross-cutting conventions (reuse platform standards)
- URI-versioned routes (`v1`), global `api` prefix. `JwtAuthGuard` + `@CurrentUser` on
  client routes; `@RequirePermissions(...)` + `PermissionsGuard` for RBAC.
- New permissions: `worky:stream:read|write`, `worky:stream:execute` (start/stop),
  `worky:interaction:respond`, `worky:admin:governance`.
- `/worky/internal/*` callbacks bypass `JwtAuthGuard` and use `WorkyServiceAuthGuard`
  (service-to-service token) instead; never exposed to browsers.
- All mutations emit a `WorkyAuditEvent`; all runtime callbacks pass through idempotency
  (`WorkyIdempotencyRecord`, unique `(streamId, eventId)`).
- SSE via the existing conversation-v2 stream-gateway pattern (per-user pipe, heartbeats).

### 10.3 Client-facing API surface
```http
POST   /worky/streams                          GET /worky/streams
GET    /worky/streams/{id}                      PATCH /worky/streams/{id}
POST   /worky/streams/{id}/{pause|resume|stop|start}
POST   /worky/streams/{id}/messages             GET /worky/streams/{id}/messages
GET    /worky/streams/{id}/board
PATCH  /worky/streams/{id}/budget               GET /worky/streams/{id}/budget
GET    /worky/streams/{id}/stats
POST   /worky/streams/{id}/tasks                GET /worky/tasks/{id}   PATCH /worky/tasks/{id}
POST   /worky/tasks/{id}/{assign|move|pause|resume|cancel|review}
GET    /worky/tasks/{id}/{results|artifacts|traces|timeline}
GET    /worky/streams/{id}/interactions
POST   /worky/interactions/{id}/{respond|cancel}
GET/POST /worky/streams/{id}/execution-report
GET    /worky/streams/{id}/events               # SSE live updates
# Admin
GET/PUT /worky/admin/governance-policy          # workspace-scoped
# Internal (service-auth only; runtime -> backend, §6.2)
POST   /worky/internal/streams/{id}/{plan-delta|spawn-worker|interaction|governance/check|budget/reserve|cost-event|artifact|audit}
POST   /worky/internal/tasks/{id}/result
```

### 10.4 Request → state → runtime flow (planning turn example)
```text
POST /worky/streams/{id}/messages (JwtAuthGuard, stream-access guard)
  -> worky-message.service persists WorkyMessage, emits owner_message.received
  -> worky-planning.service calls runtime POST /runtime/streams/{id}/planning-turn (SSE)
  -> runtime streams PlanningEvent; Manager calls back POST /worky/internal/.../plan-delta
       -> worky-plan-delta.service validates (acyclic, schema, governance class) -> versions -> applies
       -> worky-event.service fans out kanban.updated over SSE to the owner
  -> controller returns 202 + the live updates arrive on /worky/streams/{id}/events
```

---

## 11. Frontend — dedicated Worky page (detailed)

Worky is its own **dedicated top-level page** (not embedded in chat or playbooks), reached
from the main left navigation.

### 11.1 Routing (hash router, lazy-loaded, under RootGuard)
Add to `Router.tsx` children of `/` (consistent with `playbooks`, `workspace`):
```tsx
const WorkyPage        = React.lazy(() => import('./modules/worky').then(m => ({ default: m.WorkyPage })));
const WorkyStreamPage  = React.lazy(() => import('./modules/worky').then(m => ({ default: m.WorkyStreamPage })));
// routes
{ path: 'worky',             element: <WorkyPage /> },          // dedicated landing (sidebar + empty/last stream)
{ path: 'worky/:streamId',   element: <WorkyStreamPage /> },    // selected stream
// admin (under /admin children)
{ path: 'worky-governance',  element: <WorkyGovernancePage /> },
```
A nav item **“Worky”** is added to the main sidebar (`modules/sidebar`) linking to `/#/worky`,
with an unread/pending-approvals badge.

### 11.2 Module structure (mirrors `playbook` module conventions)
```text
YellowStorm/front/src/modules/worky/
  index.ts                      # exports WorkyPage, WorkyStreamPage, WorkyGovernancePage
  api.ts                        # REST calls (typed)
  types.ts                      # Stream, Task, Lane, Interaction, Delta, Policy, events
  store.ts                      # Zustand: board state, selected stream, optimistic deltas
  uiStore.ts                    # UI-only: drawer open, selected task, panel sizes
  machines/                     # XState: streamLifecycle, planningTurn, approvalGate
  query/                        # React Query hooks (useStreams, useBoard, useStream)
  stream/                       # SSE client for /worky/streams/{id}/events (NDJSON reader)
  hooks/
  components/
    WorkyPage.tsx               # layout: <StreamSidebar/> + <StreamWorkspace/>
    WorkyStreamPage.tsx
    StreamSidebar.tsx           # list, search, status filter, New Stream
    StreamHeader.tsx            # title, status, control_state, controls
    StreamControls.tsx          # Start / Pause / Resume / Stop (state-aware)
    BudgetControl.tsx           # USD/token limit input + spend/duration stats
    KanbanBoard.tsx             # lanes Backlog|Ready|Running|Review|Blocked|Done
    KanbanCard.tsx              # task card (assignee, deadline, cost, blocker, indicators)
    PromptBar.tsx               # message input + Start Stream button
    PlanDeltaToast.tsx          # "what changed" diff + Undo (planning auto-apply)
    TaskDetailDrawer.tsx        # overview/results/artifacts/toolCalls/traces/cost/timeline
    InteractionPanel.tsx        # clarifications + approval/review actions
    ApprovalModal.tsx           # approve/revise/reject for gated actions
    ActivityFeed.tsx
    admin/WorkyGovernancePage.tsx  # per-category level editor + override settings
  locales/                      # i18n strings
  constants/
```

### 11.3 Screen layout (dedicated page)
```text
+----------------------------------------------------------------------+
|  Top nav: … | Worky (active) | …                                     |
+--------------------+-------------------------------------------------+
| Stream Sidebar     | StreamHeader  [status][controls][budget][stats] |
|  + New Stream      |-------------------------------------------------|
|  search / filter   | KanbanBoard                                     |
|  Stream A (badges) |  Backlog | Ready | Running | Review | Blocked|Done
|  Stream B          |   cards…   cards…   cards…                      |
|  Stream C          |                                                 |
|                    | (TaskDetailDrawer slides over on card click)    |
|                    |-------------------------------------------------|
|                    | InteractionPanel (pending clarifications/appr.) |
|                    | PromptBar ………………………………………  [Start Stream]      |
+--------------------+-------------------------------------------------+
```

### 11.4 State & data flow
- **React Query** owns server state (streams list, board, stream detail) with cache keys
  `['worky','board',streamId]`; mutations optimistically patch the Zustand board store.
- **Zustand `store.ts`** holds the live board projection + pending optimistic deltas; **XState
  machines** drive `streamLifecycle` (planning→start_requested→active→…→completed) and the
  `approvalGate` (pending→approved/rejected) so the UI can’t enter illegal states.
- **SSE (`stream/`)** subscribes to `/worky/streams/{id}/events`; incoming `kanban.updated`,
  `interaction.requested`, `task.*`, `budget.*` events reconcile the store (server is truth,
  optimistic patches rolled back on divergence). Same NDJSON `fetch().body.getReader()` pattern
  already used by the playbook stream.
- Planning deltas **auto-apply with a visible diff + Undo** (`PlanDeltaToast`); execution
  changes are read-only reflections of backend state.

### 11.5 UX behaviors
- **Start Stream** always clickable; on partial/blocked it surfaces the validation explanation
  inline rather than failing silently.
- Cards show: assignee type/name, lane, execution state, priority, deadline, budget/cost,
  blocker reason, replan & approval/clarification indicators, artifact count, last update.
- **Approval gates** raise `ApprovalModal` + a badge on the stream; the action stays blocked
  until the owner responds (mirrors backend gate; UI cannot self-approve).
- **Governance admin page** (admin-only) edits per-category levels, the owner-override toggle,
  and the relax ceiling; respects the `worky:admin:governance` permission.
- Accessibility/i18n via existing `locales` + Radix UI + Tailwind, consistent with the app.

---

## 12. Phased delivery plan

### Phase 0 — Foundations & runtime spike (weeks 1–2)
- `Agent Type = Manager`. `worky` NestJS module skeleton + core schemas.
- Scaffold **`worky-adk-runtime`** FastAPI service (isolated, `google-adk==2.2.0` + `litellm`,
  agents via `LiteLlm`, Docker, port 8011, OTel). Vertical spike: prompt → Manager plan →
  NestJS persists tasks → one ephemeral `AgentTool` worker runs a trivial tool → result
  persisted → Kanban renders. Proves the HTTP contract (§6) end-to-end.
- NestJS `WorkyScheduledEvent` collection + `@nestjs/schedule` sweeper skeleton (no Celery).

### Phase 1 — Stream + planning (weeks 3–4)
- Stream CRUD + dedicated workspace (`workspace-initializer`). Prompt/message model; planning
  turns; `request_input`; Plan Delta validate/version/apply; Kanban projection. Frontend:
  **dedicated `/worky` page + route + sidebar nav item** (§11), stream sidebar/header/Kanban/
  prompt bar/Start Stream, React Query + Zustand + XState wiring, SSE subscription.

### Phase 2 — Execution & dynamic graph (weeks 5–7)
- Start validation + snapshot. Manager dynamic routing; ephemeral workers + per-task tool
  binding via Agent Entity. Readiness evaluator; event-driven resume; checkpoint/resume;
  pause/resume/stop. Task drawer with results/artifacts/traces (OTel bridge).

### Phase 3 — Governance, humans, deadlines (weeks 7–8)
- Governance policy engine + admin settings; deterministic workflow agents + tool-isolation;
  approval-gate flow. Human assignment resolver; email + ledger; `WorkyScheduledEvent`
  reminders (T-6h) + deadlines via the NestJS sweeper; interactions + partial interruption.

### Phase 4 — Budget, replanning, report, memory (weeks 9–10)
- Budget model/UI; cost events; atomic reservations + hard-stop. Replanning loop +
  auto-apply/approval guard. Final report. Owner memory + confirm-before-write.

### Phase 5 — Hardening (week 11)
- Idempotency, event-replay, budget-race, scheduler reliability, trace redaction,
  governance-resolution tests (incl. override ceiling), parallel-branch load test,
  ADK `RubricBasedMultiTurnTrajectoryEvaluator` smoke.

**Indicative MVP: 11 weeks** for 1 backend + 1 runtime + 1 frontend engineer.

---

## 13. Build inventory

**Net-new:**
- `worky` **NestJS module** (state authority) — schemas (§3), client API (§10), internal
  callback API (§6.2), Kanban projection, plan-delta validator, governance engine, human
  resolver, budget reservation/ledger, report generator, memory writer, runtime HTTP client.
- **`worky-adk-runtime`** standalone FastAPI service (§2) — Manager `LlmAgent` (via `LiteLlm`),
  dynamic routing, ephemeral `AgentTool` worker factory + per-task tool binding, Sequential
  gated workflow agents, `request_input`, checkpoint/resume, `AutoTracingPlugin`→callback
  bridge, NestJS HTTP client.
- **NestJS scheduler** — `WorkyScheduledEvent` collection + `@nestjs/schedule` claim/lease
  sweeper + reconciliation sweep (replaces Celery).
- Frontend `worky` module (§11) — **dedicated `/worky` page** (lazy route + sidebar nav),
  Kanban, prompt bar, task drawer, budget control, interaction/approval UI, governance admin
  page; `api.ts`/`types.ts`/`store.ts`/`machines`/`query`/`stream`/`locales`.

**Reused as-is:** `workspace`, `agent`, `agent-type`, `connector`, `skill`, `tool`, `user`,
`email`, `usage`, `notifications`; LiteLLM config from the current platform; existing SSE
stream-gateway; `@xyflow/react`/Zustand front patterns.

**Reference only (not a dependency):** `playbook-flow`; `yellowstorm-adk` / `smart_rag`.

---

## 14. Risks & mitigations

| Risk | Mitigation |
|---|---|
| ADK v2.2.0 version conflict with old endpoint | **Independent FastAPI service**, isolated venv/container, no shared imports (§2) |
| LLM proposes unsafe replan/external action | Backend decides; governance engine + tool-isolation; LLM only proposes |
| Parallel-task budget race | Atomic reservation + conditional decrement; overspend band |
| Duplicate/replayed events | `WorkyIdempotencyRecord` keyed by `(streamId, eventId)` |
| Missed reminders | Durable `WorkyScheduledEvent` timers + leased sweeper; status-gated no-op; daily reconciliation sweep (no Celery) |
| LLM provider/model drift or lock-in | All calls via LiteLLM (`LiteLlm` wrapper); model id in config, swap without code change |
| Budget hard-stop mid-branch inconsistency | Pause only at safe checkpoints; release reservation on abort |
| Gating blocks routine work | Common categories default `off`; admin-configurable; owner override bounded |
| Preview model instability | Model selected via LiteLLM config; pin a stable model and swap providers/models without code change |

---

## 15. Configuration defaults

- Runtime: Python, `google-adk==2.2.0`, **LLM via LiteLLM (`LiteLlm` wrapper)**, provider/model
  from platform LiteLLM config (no hardcoded model), FastAPI port `8011`. No Celery.
- Scheduling: NestJS `WorkyScheduledEvent` + `@nestjs/schedule` sweeper (~30s interval).
- Budget default `0` (unlimited); enforcement `hard_stop`.
- Governance: `default_level=off`; external/irreversible categories `approval`;
  `allow_stream_owner_override=true`, `max_owner_relax_level=notify`.
- Reports: Markdown for MVP (PDF later). Reminders: T-6h, repeat 120 min, escalate at deadline.
- Memory writes for durable preferences: confirm before write.

---

## 16. Key guarantees

Owner stays in control; no execution before Start Stream (unless explicitly requested); Kanban
always reflects plan/execution state; human assignment explicit-only (MVP); every task
long-running/event-driven/resumable; dynamic replanning from feedback; budget visible &
enforceable; everything traceable; every terminal stream gets a report; dedicated workspace
holds all artifacts; **NestJS owns state, the isolated ADK runtime owns reasoning/execution**.
