# Worky Implementation — Index & Invariants (READ FIRST)

This folder splits the Worky feature into **4 sequential parts** for implementation by an AI
coding agent. Implement them **in order**; each part depends on the previous one and ends in a
working, testable state.

- Canonical architecture reference: `/WORKY_IMPLEMENTATION_PLAN.md` (single source of truth for
  anything not restated here).
- Part 1 → `01_FOUNDATIONS.md` — backend module, schemas, isolated FastAPI runtime, frontend page shell.
- Part 2 → `02_PLANNING.md` — conversational planning, plan deltas/versions, Kanban projection, prompt bar.
- Part 3 → `03_EXECUTION_GOVERNANCE.md` — ADK runtime execution, ephemeral workers, governance gates, scheduler.
- Part 4 → `04_HUMANS_BUDGET_REPORTS.md` — human tasks, budget, replanning, traceability, reports, memory, hardening.

---

## 0. How to use these documents (rules for the implementing agent)

1. **Do not invent.** If a name, path, or contract is not in the current part or the canonical
   plan, STOP and search the codebase; do not guess. Reuse existing modules by their real paths.
2. **Stay in scope.** Each part has an explicit "Out of scope" list. Do not implement later
   parts early.
3. **Match conventions.** Mirror the nearest existing module (`playbook-flow` backend,
   `playbook` frontend) for structure, naming, DI, error handling, and tests.
4. **Every part ends green:** code compiles, lints, and the part's acceptance tests pass before
   moving on.
5. **No drift on the invariants below.** They are fixed decisions; do not re-litigate them.

---

## 1. Fixed invariants (apply to ALL parts)

- **State authority:** NestJS backend owns ALL product state. The ADK runtime owns bounded
  reasoning/execution ONLY. The runtime never writes Mongo directly — it requests mutations via
  authenticated HTTP callbacks (`/worky/internal/*`).
- **Runtime isolation:** the Worky runtime is a NEW, standalone FastAPI service
  `worky-adk-runtime/` (sibling of `yellowstorm-adk/`). Own venv, `requirements.txt`,
  `Dockerfile`, port `8011`. **No Python imports from `yellowstorm-adk`.** The existing ADK
  service is untouched.
- **LLM access:** ALL agents use ADK's `LiteLlm` model wrapper
  (`from google.adk.models.lite_llm import LiteLlm`). No direct provider SDK calls. Model/keys
  come from the platform LiteLLM config. Model id is NOT hardcoded.
- **ADK version:** `google-adk==2.2.0` (pinned only in the runtime service).
- **No Celery / no broker.** All timed work (reminders/deadlines/timeouts) is owned by NestJS
  via the `WorkyScheduledEvent` collection + a `@nestjs/schedule` claim/lease sweeper.
- **Transport:** NestJS ↔ runtime over HTTP (REST control + SSE events); runtime → NestJS over
  authenticated HTTP callbacks. Not gRPC.
- **Idempotency:** every runtime→backend callback and every event handler is keyed by
  `(streamId, eventId)` via `WorkyIdempotencyRecord`.
- **Governance is admin-configurable**, never hardcoded. Levels: `off | notify | approval |
  hard_block`. Common operations default to `off`. Only external/irreversible categories
  default to `approval`. Stream-owner override enabled, bounded by `max_owner_relax_level`
  (`notify`), never to `off`. The LLM can never self-approve; approval gates are backend-owned.
- **playbook-flow and smart_rag are REFERENCE ONLY** — never a runtime dependency.
- **Dedicated frontend page:** Worky is its own top-level page at `/#/worky`, with a main
  sidebar nav item. Not embedded in chat/playbooks.

---

## 2. Reused platform assets (real paths — reuse, do not recreate)

Backend (`YellowStorm/back/src/modules/`): `workspace`, `agent`, `agent-type`, `connector`,
`skill`, `tool`, `user`, `email`, `usage`, `notifications`, `authorization` (permissions).
Frontend (`YellowStorm/front/src/modules/`): `playbook` (structure reference), `sidebar`,
`workspace`, `conversation-v2` (SSE stream-gateway pattern reference).

---

## 3. Glossary (canonical terms — use these exact names)

Worky Stream · Manager Agent · Ephemeral AI Worker · Human Agent · Plan Delta · Plan Version ·
Kanban lane (`backlog|ready|running|review|blocked|done`) · Interaction (clarification/approval/
review) · Execution Snapshot · Governance Policy / level · WorkyScheduledEvent · Cost Event ·
Execution Report · Owner Memory.

See `/WORKY_IMPLEMENTATION_PLAN.md` §3 for the full data model and §6 for the contract.
