# Worky Part 4 — Humans, Budget, Replanning, Reports, Memory & Hardening

**Goal:** complete the MVP — explicit human assignment + email/reminders, budgeted execution with
hard stop, dynamic replanning, traceability completeness, final execution report, owner memory,
then hardening.

> Read `00_INDEX.md` first. Requires Parts 1–3 complete.

---

## 1. Prerequisites
Execution graph + ephemeral workers + governance + scheduler (Part 3); traces/cost events;
interactions; SSE board.

## 2. Out of scope (excluded from MVP — do NOT build)
Automatic human assignment; role-based auto-assignment; advanced SLA/escalation; visual workflow
builder; agent marketplace; multi-framework runtime; vector memory; PDF reports (Markdown only);
multi-currency budget; advanced billing; raw full trace replay; WhatsApp changes.

---

## 3. Human agents (explicit-only)

### 3.1 Assignment resolver
- `services/worky-human-assignment.service.ts`: triggered ONLY by explicit owner request in a
  plan (canonical §14.2). Flow: detect explicit human reference → `user` lookup in workspace →
  unique match creates a human `WorkyTask` (`assigneeType=human`); ambiguous → clarification
  interaction; none → ask owner to clarify/invite/select. Never auto-assign.
- On assignment, auto-grant scoped read/comment on the stream workspace via
  `workspace-share.service.ts`.

### 3.2 Email + reminders (uses Part 3 scheduler)
- Email via the `email` module; dedup via `WorkyMailEventLedger` (`dedupKey`). Notification
  content per canonical spec §14.5.
- Schedule reminder `WorkyScheduledEvent`s starting **T-6h** before `theoreticalDeadlineAt`,
  repeat per policy, escalate to owner at deadline; status-gated no-op if done (canonical §15).

### 3.3 Human Kanban updates
- Human assignee actions from the board (in-progress/feedback/request-changes/blocked/done) emit
  events that resume dependent branches (`human_task.feedback_submitted`, etc.). Wire to the
  readiness evaluator + replan trigger.

### 3.4 Acceptance criteria
- "Send it to John for validation" with a unique John → human task + email + workspace share +
  T-6h reminders scheduled; ambiguous John → clarification; feedback resumes the blocked branch.

---

## 4. Budgeted execution

### 4.1 Model & reservations
- `services/worky-budget.service.ts`: budget on the stream (`limitUsd`/`limitTokens`,
  `enforcement=hard_stop`, default `0`=unlimited). **Reserve-before-start**: estimate → atomic
  reserve (`findOneAndUpdate` conditional decrement + `WorkyBudgetReservation`) → start if
  available → record actual via `WorkyCostEvent` (from runtime callbacks) → release unused. Define
  an overspend tolerance band for estimate<actual.
- Cost estimation for unknown skills/connectors: default category cost model + metered-after-run;
  conservative reservation ceiling.

### 4.2 Hard stop
- At limit: stop new tasks, pause running branches at safe checkpoints, create a
  `budget_decision` interaction, set `status=waiting_for_budget_decision`. Owner options:
  increase / cheaper mode / report now / stop (canonical §18.4). The `budget_overrun` governance
  category gates increases.

### 4.3 UI
- `BudgetControl.tsx`: USD (and token) limit input next to the prompt bar; show duration + spend.
  `GET /worky/streams/{id}/{budget,stats}`; `PATCH .../budget`.

### 4.4 Acceptance criteria
- Parallel tasks reserve atomically (no race/overspend beyond band); reaching the limit pauses at
  checkpoints and raises the decision; increase flows through the gate. Tests for the reservation
  race and hard-stop.

---

## 5. Dynamic replanning

- `worky-plan-delta.service.ts` (extend): replanning deltas during execution. Triggers per
  canonical §17.2 (task results, review/failed, human feedback, deadline risk, budget, etc.).
- **Auto-apply vs approval guard** (canonical §17.4) consults the resolved governance policy:
  deltas touching `approval`/`hard_block` categories, objective/deadline/deliverable changes,
  added unrequested human assignees, removed owner validation, or external actions →
  approval-required; safe internal changes → auto-apply. Never delete executed work (cancel
  not-started, supersede done).
- Acceptance: a worker result with missing data triggers a replan that inserts a task and blocks
  the dependent branch; an approval-required replan raises an interaction before applying.

---

## 6. Traceability & final report

### 6.1 Completeness
- Ensure `worky-trace`/`worky-cost-event` persistence from runtime callbacks covers tool calls
  and model calls; task drawer sections complete (canonical §19). Raw payload URIs redacted;
  admin-only.

### 6.2 Execution report (always generated)
- `services/worky-report.service.ts`: generate at terminal state
  (`completed|stopped|canceled|budget_exhausted_and_closed`). Rich report if budget remains;
  lightweight deterministic report (from events/tasks/artifacts/traces) if exhausted (canonical
  §20.7). Contents per §20.6. Store Markdown to workspace `/final-deliverables/
  worky-execution-report.md` + a structured `WorkyExecutionReport` record. **Markdown only** (no PDF).
- `GET/POST /worky/streams/{id}/execution-report`.

### 6.3 Acceptance
- Completing a stream generates the Markdown report + record; a budget-exhausted stream still
  gets the lightweight report.

---

## 7. Owner-scoped memory

- `services/worky-memory.service.ts`: Markdown files under `/worky-owner-memory/{ownerUserId}/…`
  (profile/preferences/people/decision_history/stream_summaries…) + ADK Sessions
  `get_user_state`. Update ONLY on durable learnings (stream completion, stated preference,
  clarified role, recurring instruction, major decision, explicit "remember"). **Confirm before**
  writing durable preferences (canonical §21). Not after every message.
- Acceptance: completing a stream proposes a memory update the owner confirms; declining writes
  nothing.

---

## 8. Hardening (final)

- Idempotency coverage tests (replayed callbacks/events no-op).
- Event-replay / resume tests (kill mid-branch → resume to completion).
- Budget-race test (concurrent reservations).
- Scheduler reliability (missed/overdue reconciliation; terminal no-op).
- Governance resolution tests incl. owner-override ceiling and audit on every evaluation.
- Trace redaction (non-admin cannot see raw payloads).
- Parallel-branch load test.
- Runtime: ADK `RubricBasedMultiTurnTrajectoryEvaluator` smoke on the Manager.
- Confirm: no Celery anywhere; no direct provider SDK (LiteLLM only); no `yellowstorm-adk`
  imports in `worky-adk-runtime`; runtime version isolation intact.

---

## 9. Definition of done (Part 4 = MVP)
All canonical §16 guarantees hold: owner in control; no execution before Start; Kanban always
truthful; explicit-only human assignment with email + T-6h reminders; long-running/event-driven/
resumable tasks; dynamic replanning; visible enforceable budget with hard stop; full
traceability; every terminal stream gets a report; dedicated workspace holds all artifacts;
owner memory scoped + confirmed; NestJS owns state, the isolated LiteLLM-backed ADK runtime owns
reasoning/execution. All tests green; lint/build clean across the three codebases.
