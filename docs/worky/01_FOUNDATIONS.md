# Worky Part 1 — Foundations

**Goal:** stand up the skeletons end-to-end: NestJS `worky` module + data model, the isolated
`worky-adk-runtime` FastAPI service, the NestJS↔runtime contract (stubbed), and the dedicated
frontend Worky page shell. After this part a Stream can be created and viewed; no planning or
execution logic yet.

> Read `00_INDEX.md` first. All invariants there are binding.

---

## 1. Prerequisites
- None (first part). Confirm reused modules exist at the paths in `00_INDEX.md` §2.

## 2. Out of scope (DO NOT implement here)
- Planning conversation / plan deltas (Part 2).
- ADK agent reasoning, ephemeral workers, execution, governance gates (Part 3).
- Human tasks, budget enforcement, reports, memory (Part 4).
- Keep runtime endpoints as **stubs** that return static/echo responses.

---

## 3. Backend tasks

### 3.1 Create the module
Path: `YellowStorm/back/src/modules/worky/` — mirror an existing module (e.g. `project/`).
Create `worky.module.ts`, `index.ts`, and the folder layout from canonical plan §10.1
(controllers/, services/, dto/, interfaces/, schemas/, guards/, constants/). Register
`WorkyModule` in `app.module.ts`.

### 3.2 Mongoose schemas (canonical plan §3 — implement ALL collections as schemas now)
`schemas/`: `worky-stream.schema.ts`, `worky-task.schema.ts`, `worky-message.schema.ts`,
`worky-plan-version.schema.ts`, `worky-plan-delta.schema.ts`, `worky-interaction.schema.ts`,
`worky-execution-snapshot.schema.ts`, `worky-ephemeral-worker.schema.ts`,
`worky-task-result.schema.ts`, `worky-cost-event.schema.ts`, `worky-trace.schema.ts`,
`worky-budget-reservation.schema.ts`, `worky-mail-event-ledger.schema.ts`,
`worky-idempotency-record.schema.ts`, `worky-governance-policy.schema.ts`,
`worky-scheduled-event.schema.ts`, `worky-execution-report.schema.ts`, `worky-audit-event.schema.ts`.
- Use exact field names/enums from canonical §3. `timestamps: true`. Indexes on `streamId`,
  `ownerUserId`, `status`. Unique compound index `(streamId, eventId)` on idempotency record.

### 3.3 Guards & permissions
- `guards/worky-stream-access.guard.ts` — owner or workspace-share scoped access.
- `guards/worky-service-auth.guard.ts` — validates a service-to-service token for
  `/worky/internal/*`. Bypasses `JwtAuthGuard`.
- Register new permissions in the `authorization` module: `worky:stream:read|write`,
  `worky:stream:execute`, `worky:interaction:respond`, `worky:admin:governance`.

### 3.4 Stream lifecycle (minimal)
- `services/worky-stream.service.ts`: `create`, `findAllForUser`, `findById`, `patch`.
  On `create`: also create the dedicated artifact workspace via the existing
  `workspace-initializer.service.ts` with the folder layout from canonical §5.2 of the spec,
  and create a Manager agent entity (`agent` module, `Agent Type = Manager`). Persist refs.
- Add `Agent Type = Manager` via the `agent-type` module (seed/migration).
- `controllers/worky-stream.controller.ts`: `POST/GET /worky/streams`,
  `GET/PATCH /worky/streams/{id}` (JwtAuthGuard + access guard + permissions). Other lifecycle
  endpoints (start/pause/resume/stop) return `501 Not Implemented` stubs for now.

### 3.5 Runtime HTTP client + internal callback controller (stubs)
- `services/worky-runtime.client.ts`: typed HTTP/SSE client to `worky-adk-runtime` (base URL
  from config, default `http://worky-adk-runtime:8011`). Methods per canonical §6.1 — may
  no-op/echo in Part 1.
- `controllers/worky-internal.controller.ts` (guarded by `WorkyServiceAuthGuard`): implement
  idempotency check + persist for `plan-delta`, `spawn-worker`, `interaction`,
  `governance/check`, `budget/reserve`, `cost-event`, `artifact`, `audit`, `tasks/{id}/result`.
  In Part 1 these may just validate, store the idempotency record, and return a stub ack.
- `services/worky-event.service.ts` + `worky-audit.service.ts`: event store + append-only audit.

### 3.6 SSE endpoint
- `controllers/worky-events.controller.ts`: `GET /worky/streams/{id}/events` using NestJS
  `@Sse()`, following the `conversation-v2` stream-gateway pattern (per-user pipe + heartbeat).

### 3.7 Backend acceptance criteria
- `POST /worky/streams` creates a stream + dedicated workspace + Manager agent; returns the
  aggregate. `GET` list/detail work with access control. Unauthorized/forbidden paths covered.
- `/worky/internal/*` rejects requests without the service token; accepts with it; idempotent.
- Jest unit tests for `worky-stream.service` (create wires workspace+agent) and the two guards.

---

## 4. Runtime tasks — `worky-adk-runtime` (NEW isolated FastAPI service)

### 4.1 Scaffold
Path: `worky-adk-runtime/` (repo root, sibling of `yellowstorm-adk/`).
```text
worky-adk-runtime/
  app/
    main.py                # FastAPI app, /health, route includes
    config.py              # env: BACKEND_BASE_URL, SERVICE_TOKEN, LITELLM_*, PORT=8011
    routers/
      planning.py          # POST /runtime/streams/{id}/planning-turn  (SSE) — stub
      execution.py         # start/resume/stop/cancel — stubs
    clients/
      backend_client.py    # authenticated HTTP client -> NestJS /worky/internal/*
    agents/                # (filled in Part 3) Manager + worker factories
    telemetry.py           # AutoTracingPlugin / OTel setup
  requirements.txt         # google-adk==2.2.0, google-genai==2.x, litellm, fastapi, uvicorn, httpx
  Dockerfile
  README.md
  tests/
```
- `requirements.txt` pins `google-adk==2.2.0` and `litellm`. **No import from `yellowstorm-adk`.**
- `main.py`: `/health` returns `{status:"ok", adk_version, model_provider:"litellm"}`.
- Add the service to `docker-compose.yaml` as an independent unit on port 8011.

### 4.2 LiteLLM wiring (no agents yet, just the model factory)
- `agents/model.py`: `def build_model() -> LiteLlm` using `from google.adk.models.lite_llm
  import LiteLlm`, configured from `config.py` (provider/model/base/keys via LiteLLM env).
  A unit test asserts a `LiteLlm` instance is constructed (no live call).

### 4.3 Backend client
- `clients/backend_client.py`: methods for each `/worky/internal/*` callback (canonical §6.2),
  sends the service token, includes `eventId` for idempotency. Used by stubs to prove the loop.

### 4.4 Stub planning endpoint (proves the contract)
- `POST /runtime/streams/{id}/planning-turn`: accept `{owner_message, context_snapshot}`,
  stream one SSE `PlanningEvent`, and call back `POST /worky/internal/streams/{id}/plan-delta`
  with a hardcoded 1-task delta. This validates the full round-trip in Part 1.

### 4.5 Runtime acceptance criteria
- `docker compose up worky-adk-runtime` healthy on 8011; `/health` OK.
- Calling the stub planning endpoint results in a `plan-delta` callback the backend persists
  (visible via `GET /worky/streams/{id}/board` returning that 1 task once Part 2 projection
  exists; for Part 1, assert via the backend internal controller test/log).
- pytest: model factory builds `LiteLlm`; backend client sends the service token.

---

## 5. Frontend tasks — dedicated Worky page shell

### 5.1 Routing & nav
- Create module `YellowStorm/front/src/modules/worky/` mirroring `playbook` structure
  (`index.ts`, `api.ts`, `types.ts`, `store.ts`, `uiStore.ts`, `query/`, `stream/`,
  `components/`, `locales/`, `constants/`).
- In `Router.tsx`, add lazy routes under `/`: `{ path: 'worky', element: <WorkyPage/> }` and
  `{ path: 'worky/:streamId', element: <WorkyStreamPage/> }` (RootGuard, consistent with
  `playbooks`/`workspace`).
- Add a **“Worky”** nav item in `modules/sidebar` linking `/#/worky` (badge wiring optional now).

### 5.2 Components (shells)
- `WorkyPage.tsx`: layout `<StreamSidebar/>` + `<StreamWorkspace/>`.
- `StreamSidebar.tsx`: list streams (React Query `useStreams`), search, status filter,
  **+ New Stream** (calls `POST /worky/streams`, navigates to `/worky/:id`).
- `WorkyStreamPage.tsx`: `<StreamHeader/>` (title/status) + empty `<KanbanBoard/>` placeholder
  + disabled `<PromptBar/>` (enabled in Part 2).
- `api.ts`: typed calls for streams list/create/get. `types.ts`: Stream/Task/Lane types from
  canonical §3 (only fields needed now).

### 5.3 Frontend acceptance criteria
- Navigating to `/#/worky` renders the dedicated page with the sidebar.
- Creating a stream adds it to the sidebar and routes to `/worky/:id` showing the header and an
  empty Kanban placeholder. No console errors; lint passes.
- Component test for `StreamSidebar` create+list.

---

## 6. Definition of done (Part 1)
Stream create→list→view works through the dedicated page; the isolated runtime is healthy and
can round-trip a stub plan-delta callback into the backend with idempotency + service auth; all
schemas exist; tests green; lint/build clean on backend, runtime, frontend.
