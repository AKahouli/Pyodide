# Worky Part 2 — Conversational Planning & Kanban

**Goal:** the owner can converse with the Manager Agent in the prompt bar; the Manager proposes
**Plan Deltas**; the backend validates/versions/applies them; the **Kanban** reflects the plan
live over SSE. Planning only — **no execution, no worker spawn** (Start Stream still stubbed).

> Read `00_INDEX.md` first. Requires Part 1 complete.

---

## 1. Prerequisites (from Part 1)
Worky module + schemas; isolated runtime healthy; runtime client + internal callbacks
(idempotent); dedicated frontend page with sidebar + empty Kanban; LiteLLM model factory.

## 2. Out of scope
- Start validation/snapshot, execution, ephemeral workers, governance enforcement (Part 3).
- Human assignment notifications, budget enforcement, reports, memory (Part 4).
- During planning: NO task is executed, NO worker spawned, NO email sent.

---

## 3. Backend tasks

### 3.1 Messages & planning turn
- `services/worky-planning.service.ts` + `controllers/worky-message.controller.ts`:
  `POST /worky/streams/{id}/messages` persists a `WorkyMessage` (role=owner), emits
  `owner_message.received`, then calls runtime `POST /runtime/streams/{id}/planning-turn` with
  the **context snapshot**: latest owner message, current Kanban, current plan version, owner
  memory ref, stream memory ref, budget settings (canonical spec §8.1). Relays the runtime SSE
  to the stream event channel. `GET /worky/streams/{id}/messages` lists history.
- Respect stream phase: only allowed when `status ∈ {created, planning, ...}` pre-execution.

### 3.2 Plan Delta validation/versioning/apply
- `services/worky-plan-delta.service.ts`. On `POST /worky/internal/streams/{id}/plan-delta`
  (from runtime), apply this exact pipeline:
  1. **Schema validate** the delta body (`create_tasks|update_tasks|cancel_tasks|
     clarification_requests`) against `interfaces/` types.
  2. **Concurrency check** `base_plan_version == stream.currentPlanVersion`; else reject with
     `stale_base_version` (runtime must refetch).
  3. **Graph validate:** no dependency cycles, all `depends_on` refs exist, no orphan refs.
  4. **Governance classification (planning):** tag each created task with its `actionCategory`;
     do not enforce gates yet (Part 3) but persist the category.
  5. **Apply** atomically: create/update/cancel tasks, create clarification `WorkyInteraction`s.
  6. **Version:** create `WorkyPlanVersion` (increment), link `WorkyPlanDelta`
     (`applyMode=auto`, `status=applied`).
  7. Emit `plan_delta.applied`, `plan_version.created`, `kanban.updated`.
- Rejections return a typed error to the runtime; nothing is partially applied (transaction).

### 3.3 Kanban projection
- `services/worky-task.service.ts` + `controllers/worky-board.controller.ts`:
  `GET /worky/streams/{id}/board` returns lanes `backlog|ready|running|review|blocked|done`
  derived from each task's `lane`/`executionState`/`planningStatus` per canonical §7.2 (planning
  lane semantics). Blocked tasks include their blocker reason (clarification ref).

### 3.4 Clarifications during planning
- A `clarification_requests` entry → `WorkyInteraction(type=clarification|assignment_disambiguation)`
  blocking the referenced task(s). `POST /worky/interactions/{id}/respond` records the answer,
  emits `interaction.responded`, and triggers a follow-up planning turn so the Manager can
  resolve and re-delta.

### 3.5 Backend acceptance criteria
- A message → runtime planning turn → plan-delta callback → validated/applied → board reflects
  new tasks; plan version increments; SSE emits `kanban.updated`.
- Stale `base_plan_version` is rejected; cyclic deps rejected; partial application impossible.
- Clarification answer drives a follow-up turn. Unit tests for the delta pipeline (each failure
  mode) + projection.

---

## 4. Runtime tasks — Manager planning agent (real, LiteLLM)

### 4.1 Manager agent
- `agents/manager.py`: build an ADK `LlmAgent(model=build_model(), tools=[...])` — the
  Chief-of-Staff. System instruction encodes: plan-before-execute; produce **incremental Plan
  Deltas, not full re-plans**; ask clarification via `request_input`; never execute during
  planning; respect budget/phase. Use `request_input` for clarifications.
- Replace the Part 1 stub `planning-turn` with the real agent invocation. The agent's structured
  output is converted to a Plan Delta and sent via `backend_client.plan_delta(...)` with an
  `eventId`. Stream a user-facing `assistant_response` SSE event back.

### 4.2 Structured Plan Delta output
- `agents/schemas.py`: pydantic models matching the backend delta `interfaces/` exactly (create/
  update/cancel/clarifications). The agent MUST emit this shape; validate before sending. On
  validation failure, retry once with the error, else surface a clarification.

### 4.3 Bounded turns
- Each planning turn is a single bounded invocation: load context snapshot → reason → emit delta
  + response → exit. No long-lived loops. Persist nothing locally (backend is authority).

### 4.4 Runtime acceptance criteria
- pytest with a mocked LiteLLM response: planning turn yields a schema-valid delta and calls the
  backend client. Invalid model output triggers the retry/clarification path.

---

## 5. Frontend tasks — planning experience

### 5.1 Prompt bar + planning
- Enable `PromptBar.tsx`: send to `POST /worky/streams/{id}/messages`; show assistant responses
  streamed via SSE. Show a thinking/streaming indicator.
- `stream/`: subscribe to `/worky/streams/{id}/events`; handle `kanban.updated`,
  `plan_version.created`, `interaction.requested`, `assistant_response`.

### 5.2 Kanban (live)
- `KanbanBoard.tsx` + `KanbanCard.tsx`: render lanes from `GET .../board`; reconcile live via
  SSE. Cards show title, assignee type, lane, deadline, indicators (blocker/clarification).
  Use `@xyflow/react`/Zustand patterns from `playbook` as reference (board state in `store.ts`,
  server truth via React Query `['worky','board',streamId]`).

### 5.3 Plan delta UX
- `PlanDeltaToast.tsx`: planning deltas **auto-apply** with a visible "what changed" summary +
  **Undo** (Undo calls a delta-revert turn). 
- `InteractionPanel.tsx`: list pending clarifications; answering posts to
  `/worky/interactions/{id}/respond`.

### 5.4 Start Stream (UI only)
- Render the **Start Stream** button (always clickable) but in Part 2 it calls the stubbed
  start endpoint and shows "execution available in next phase". Real behavior in Part 3.

### 5.5 Frontend acceptance criteria
- Typing a goal produces visible assistant text + tasks appearing on the Kanban live; answering
  a clarification updates the board. Optimistic delta + Undo works. Lint/build clean; component
  test for board reconciliation from an SSE `kanban.updated` event.

---

## 6. Definition of done (Part 2)
Multi-turn conversational planning works end-to-end: Manager proposes incremental deltas, the
backend validates/versions/applies them, clarifications resolve, and the dedicated Kanban
updates live. No execution occurs. Tests green; lint/build clean across all three codebases.
