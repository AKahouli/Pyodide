# Playbook Module (Backend)

The playbook module provides a visual workflow builder where users create, edit, execute, and monitor multi-step AI agent workflows. Each playbook consists of connected steps (nodes) that are executed in topological order, with real-time status tracking via SSE, human-in-the-loop interrupts, and production-hardened safeguards for scalability.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Directory Structure](#directory-structure)
- [Module Configuration](#module-configuration)
- [Execution schedule (backend reference)](#execution-schedule-backend-reference)
- [Controllers](#controllers)
- [Services](#services)
  - [Playbook schedule runner](#playbook-schedule-runner)
  - [Execution schedule mapper](#execution-schedule-mapper)
  - [Execution schedule upsert builder](#execution-schedule-upsert-builder)
  - [Schedule due evaluation (pure utils)](#schedule-due-evaluation-pure-utils)
- [Schemas](#schemas)
  - [Execution schedule (embedded)](#execution-schedule-embedded)
- [Interfaces (API responses)](#interfaces-api-responses)
- [gRPC Integration](#grpc-integration)
- [SSE Streaming](#sse-streaming)
- [Execution Engine](#execution-engine)
- [Performance & Scalability](#performance--scalability)
- [Guards & Decorators](#guards--decorators)
- [DTOs](#dtos)
- [API Endpoints](#api-endpoints)
- [Data Flow](#data-flow)

---

## Overview

The playbook module provides:

- **Playbook Management**: CRUD operations for multi-step AI workflows with workspace attachments
- **Visual Canvas Persistence**: Store node positions, edges, and task configurations
- **AI Generation**: Generate complete playbooks from a text prompt via gRPC `GeneratePlaybook`
- **AI Designer**: Iterative playbook modifications via natural language chat (`DesignPlaybook`), with message history and revert
- **Execution Orchestration**: Topological execution via gRPC `RunStep` (per-task) or `RunPlaybookWorkflow` (full LangGraph streaming)
- **Real-time Streaming**: Dedicated SSE endpoint for live execution status updates
- **Interrupt/Resume Flow**: Human-in-the-loop support for approval, review, and clarification with stale interrupt filtering
- **Single-Step Execution**: Run individual steps in isolation (others marked as skipped)
- **Stop Execution**: Cancel a running or interrupted execution, marking remaining tasks as skipped
- **Execution History**: Sequential execution numbering with lightweight summary listings and full detail on demand
- **Sharing**: Clone and share playbooks with other users by email, with in-app notifications and SSE events
- **Favorites**: Toggle favorite status on playbooks for quick access
- **Bulk Delete**: Delete multiple playbooks at once
- **Token Tracking**: Per-task and per-execution input/output/total token counts with model name
- **Concurrency Control**: Per-level step parallelism with configurable limits
- **Document Size Guards**: Component array caps and data truncation to prevent MongoDB 16MB limit
- **Execution schedule (data model)**: Each playbook may store **one** embedded `executionSchedule` (see [Execution schedule](#execution-schedule-embedded)) for automatic runs. Clients read it via `GET` `/playbooks/:id/schedule` ([`getSchedule`](#services)), set or clear via `PUT` / `DELETE` ([`UpsertPlaybookScheduleDto`](dto/upsert-playbook-schedule.dto.ts), [`buildExecutionScheduleDocument`](#execution-schedule-upsert-builder)). Full playbook responses still map schedule with [`mapExecutionScheduleToData`](#execution-schedule-mapper).
- **Scheduled runs (cron)**: [`PlaybookScheduleRunnerService`](#playbook-schedule-runner) evaluates due schedules **once per minute**, starts `executePlaybook` with `executionTrigger: 'scheduled'` when [`isExecutionScheduleDueThisMinute`](#schedule-due-evaluation-pure-utils) matches, then updates `executionSchedule.lastScheduledRunAt`. If gRPC is unavailable, the tick is skipped. When a playbook already has **RUNNING** or **INTERRUPTED** work, the scheduled tick is skipped (info log). **Full narrative:** [Execution schedule (backend reference)](#execution-schedule-backend-reference).
- **List summaries**: Paginated playbook list items include **`scheduleEnabled`** — `true` when `executionSchedule.enabled` is true (see [`PlaybookSummaryResponse`](#interfaces-api-responses)).
- **Execution trigger**: Each `PlaybookExecution` stores `executionTrigger`: `manual` (default) for user-initiated runs, or `scheduled` when started by the schedule runner. Exposed on full and summary execution responses.

---

## Architecture

```
+-----------------------------------------------------------------------------+
|                         PLAYBOOK MODULE (NestJS)                            |
+-----------------------------------------------------------------------------+
|                                                                             |
|  +------------------+    +------------------+    +------------------+       |
|  |   Controllers    |<-->|    Services      |<-->|    Schemas       |       |
|  |  (REST + SSE)    |    |  (Business Logic)|    |   (MongoDB)      |       |
|  +--------+---------+    +--------+---------+    +------------------+       |
|           |                       |                                         |
|           v                       v                                         |
|  +------------------+    +------------------+                               |
|  |  PlaybookStream  |    |   Execution      |                               |
|  |    Gateway       |    |    Service        |                               |
|  |  (SSE Manager)   |    |  (gRPC Client)   |                               |
|  +--------+---------+    +--------+---------+                               |
|           |                       |                                         |
|           v                       v                                         |
|  +--------------------------------------------------------------+          |
|  |                         External Services                     |          |
|  |  +-----------+  +------------------+  +--------------+        |          |
|  |  |  MongoDB  |  | AI Service (gRPC)|  | Agent Module |        |          |
|  |  | (Mongoose)|  | RunStep / Resume |  |  (findByIds) |        |          |
|  |  +-----------+  +------------------+  +--------------+        |          |
|  +--------------------------------------------------------------+          |
|                                                                             |
+-----------------------------------------------------------------------------+
```

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| **NestJS 10** | Backend framework with dependency injection |
| **MongoDB/Mongoose** | Database with schema validation and embedded subdocs |
| **gRPC** | Unary and streaming calls to AI service for step execution |
| **Server-Sent Events (SSE)** | Real-time execution status to browser clients |
| **RxJS** | Reactive stream handling for SSE |
| **JWT** | Authentication for both REST and SSE endpoints |
| **Protocol Buffers** | gRPC message definitions (shared `chatbot.proto`) |
| **class-validator** | DTO validation with nested object support and array size limits |
| **Swagger/OpenAPI** | API documentation |
| **@nestjs/schedule** | Cron (`@Cron`) for the [`PlaybookScheduleRunnerService`](#playbook-schedule-runner); `ScheduleModule.forRoot()` in [`app.module.ts`](../../app.module.ts) |

---

## Directory Structure

```
playbook/
├── playbook.module.ts                    # Module definition
├── config/
│   └── playbook.config.ts               # Module configuration (gRPC, SSE, limits, schedule concurrency policy)
├── schemas/
│   ├── playbook.schema.ts               # Playbook model (tasks, edges, workspaces, favorites, executionSchedule)
│   ├── execution-schedule.schema.ts     # Embedded schedule (daily/weekly/monthly/advanced payloads)
│   ├── playbook-execution.schema.ts     # Execution model (task results, components, tokens, executionTrigger)
│   └── playbook-design-message.schema.ts # Design message model (snapshots, revert chain)
├── dto/
│   ├── create-playbook.dto.ts           # Create playbook (name, description, workspaces)
│   ├── update-playbook.dto.ts           # Update with nested task/edge validation + array limits
│   ├── generate-playbook.dto.ts         # Generate from prompt (name, prompt, workspaces)
│   ├── design-playbook.dto.ts           # Design query (query string)
│   ├── playbook-query.dto.ts            # Paginated list query (search, sort, filters)
│   ├── execute-playbook.dto.ts          # Execute (optional singleStepTaskId, query)
│   ├── resume-playbook.dto.ts           # Resume interrupted execution (approved, reason, feedback)
│   ├── stop-playbook.dto.ts             # Stop execution (executionId)
│   ├── bulk-delete-playbooks.dto.ts     # Bulk delete (ids array, 1-50)
│   ├── clone-share-playbook.dto.ts      # Share by email (emails array, 1-20)
│   ├── upsert-playbook-schedule.dto.ts  # PUT /playbooks/:id/schedule (enabled, timezone, type, mode payloads)
│   └── execution-query.dto.ts           # Execution history pagination
├── interfaces/
│   ├── playbook.interface.ts            # Response types (full + summary + design message)
│   └── playbook-stream.interface.ts     # SSE event type
├── controllers/
│   ├── playbook-stream.controller.ts    # SSE endpoint (listed first for route priority)
│   ├── playbook.controller.ts           # CRUD + schedule upsert/clear + execute + resume + design + share
│   └── playbook-execution.controller.ts # Execution history endpoints
├── services/
│   ├── playbook.service.ts              # CRUD, schedule upsert/clear, response mapping, execution summaries, design messages
│   ├── playbook-schedule-runner.service.ts # Cron: due schedules → executePlaybook(scheduled), lastScheduledRunAt
│   ├── playbook-execution.service.ts    # Execution orchestration, step buffering, token tracking, email links/summaries
│   ├── playbook-context.service.ts      # Workspace context resolution + agent brain contexts
│   ├── playbook-design.service.ts       # AI generation (GeneratePlaybook) + AI designer (DesignPlaybook)
│   ├── playbook-grpc.service.ts         # gRPC client lifecycle, stream management, channel state
│   └── playbook-stream-gateway.service.ts # SSE connection management + heartbeat
├── utils/
│   ├── execution.utils.ts              # Topological sort, concurrency limiter, component mapping
│   ├── execution-schedule.mapper.ts    # Mongo executionSchedule → API ExecutionScheduleData (pure)
│   ├── execution-schedule-upsert.builder.ts # UpsertPlaybookScheduleDto → Mongo subdocument (pure)
│   └── playbook-schedule.util.ts       # isExecutionScheduleDueThisMinute + timezone helpers (pure)
├── guards/
│   ├── playbook-owner.guard.ts          # Ownership verification
│   └── playbook-stream-auth.guard.ts    # SSE JWT authentication (query param + session validation)
└── decorators/
    └── playbook-stream-auth.decorator.ts # Composite @PlaybookStreamAuth() decorator
```

---

## Module Configuration

### Registration

The module is registered in `app.module.ts`:

```typescript
import { PlaybookModule } from './modules/playbook/playbook.module';

@Module({
  imports: [
    // ...
    PlaybookModule,
  ],
})
export class AppModule {}
```

### Configuration Options

[`config/playbook.config.ts`](config/playbook.config.ts) registers the `playbook` namespace.

```typescript
// config/playbook.config.ts (abridged)
export default registerAs('playbook', () => ({
  grpcUrl: process.env.CONVERSATION_GRPC_URL || 'localhost:50051',
  grpcTimeoutMs: parseInt(process.env.PLAYBOOK_GRPC_TIMEOUT_MS || '300000', 10),
  grpcWorkflowTimeoutMs: parseInt(process.env.PLAYBOOK_GRPC_WORKFLOW_TIMEOUT_MS || '600000', 10),
  maxSseConnections: parseInt(process.env.PLAYBOOK_MAX_SSE_CONNECTIONS || '5', 10),
  sseHeartbeatMs: parseInt(process.env.PLAYBOOK_SSE_HEARTBEAT_MS || '15000', 10),
  maxComponentsPerTask: parseInt(process.env.PLAYBOOK_MAX_COMPONENTS_PER_TASK || '200', 10),
  maxComponentDataBytes: parseInt(process.env.PLAYBOOK_MAX_COMPONENT_DATA_BYTES || '500000', 10),
  maxConcurrentSteps: parseInt(process.env.PLAYBOOK_MAX_CONCURRENT_STEPS || '5', 10),
}));
```

| Variable | Default | Description |
|----------|---------|-------------|
| `CONVERSATION_GRPC_URL` | `localhost:50051` | gRPC server address (shared with conversation module) |
| `PLAYBOOK_GRPC_TIMEOUT_MS` | `300000` | gRPC call timeout per step (5 minutes) |
| `PLAYBOOK_GRPC_WORKFLOW_TIMEOUT_MS` | `600000` | gRPC workflow/streaming timeout (10 minutes) |
| `PLAYBOOK_MAX_SSE_CONNECTIONS` | `5` | Max concurrent SSE connections per user |
| `PLAYBOOK_SSE_HEARTBEAT_MS` | `15000` | SSE heartbeat interval |
| `PLAYBOOK_MAX_COMPONENTS_PER_TASK` | `200` | Max components stored per task result |
| `PLAYBOOK_MAX_COMPONENT_DATA_BYTES` | `500000` | Max JSON size per component (500KB) |
| `PLAYBOOK_MAX_CONCURRENT_STEPS` | `5` | Max parallel gRPC calls per topological level |

**Cron scheduling:** `@nestjs/schedule` is initialized in the root [`app.module.ts`](../../app.module.ts) via `ScheduleModule.forRoot()`. The playbook module only registers [`PlaybookScheduleRunnerService`](#playbook-schedule-runner) as a provider.

---

## Execution schedule (backend reference)

Single place for **automatic** playbook runs: one embedded `executionSchedule` on [`Playbook`](#playbook-playbooks-collection), REST endpoints under [`PlaybookController`](#playbookcontroller-playbooks), a **minute** cron in [`PlaybookScheduleRunnerService`](#playbook-schedule-runner), and pure evaluation in [`playbook-schedule.util.ts`](#schedule-due-evaluation-pure-utils).

### End-to-end flow

1. **Configure** — Owner calls `PUT /playbooks/:id/schedule` with [`UpsertPlaybookScheduleDto`](dto/upsert-playbook-schedule.dto.ts). [`PlaybookService.upsertSchedule()`](#playbookservice) persists via [`buildExecutionScheduleDocument()`](#execution-schedule-upsert-builder). Optional `GET` / `DELETE` read or clear the schedule.
2. **Expose** — `GET /playbooks/:id` and list responses include `executionSchedule` or `scheduleEnabled` via [`mapExecutionScheduleToData()`](#execution-schedule-mapper).
3. **Tick** — Every minute, `runDueSchedules()` scans enabled playbooks (`isActive`, `executionSchedule.enabled`), skips if **gRPC unavailable**, then runs [`isExecutionScheduleDueThisMinute()`](#schedule-due-evaluation-pure-utils) for each.
4. **Overlap** — If an execution is **RUNNING** or **INTERRUPTED** for that playbook, the scheduled run is skipped (info log).
5. **Run** — [`executePlaybook(..., { executionTrigger: 'scheduled' })`](#playbookexecutionservice) creates a [`PlaybookExecution`](#playbookexecution-playbook_executions-collection) with `executionTrigger: 'scheduled'`.
6. **Bookkeeping** — `lastScheduledRunAt` is updated **after** `executePlaybook` **returns** (same tick `now`). `executePlaybook` resolves once the execution document exists and the workflow loop has been **started** (it does **not** await completion). If `executePlaybook` **throws** before returning (e.g. gRPC unavailable, playbook not found, active execution conflict), the runner logs a warning and **does not** update `lastScheduledRunAt`.
7. **Notify** — On terminal **completed** or **failed**, [`notifyScheduledRunFinished`](#playbookexecutionservice) sends an optional email to the playbook owner when `executionTrigger === 'scheduled'` (email service available, user has email), including a summary line and link built with [`buildExecutionDetailUrl()`](#playbookexecutionservice) (`app.frontendUrl`).

### REST API (schedule)

| Method | Path | Guard | Request body | Response |
|--------|------|-------|--------------|----------|
| `GET` | `/playbooks/:id/schedule` | [`PlaybookOwnerGuard`](guards/playbook-owner.guard.ts) | — | [`ExecutionScheduleData`](interfaces/playbook.interface.ts) \| `null` (mapped; `null` if no schedule or invalid) |
| `PUT` | `/playbooks/:id/schedule` | Owner | [`UpsertPlaybookScheduleDto`](dto/upsert-playbook-schedule.dto.ts) | Full [`PlaybookResponse`](interfaces/playbook.interface.ts) (includes `executionSchedule`) |
| `DELETE` | `/playbooks/:id/schedule` | Owner | — | Full `PlaybookResponse` with `executionSchedule: null` |

Swagger: [`playbook.controller.ts`](controllers/playbook.controller.ts) (`getSchedule`, `upsertSchedule`, `clearSchedule`).

### Request validation (`UpsertPlaybookScheduleDto`)

| Rule | Details |
|------|---------|
| `enabled` | Required boolean. |
| `enabled === true` | `timezone` (non-empty string, max 64), `type` ∈ `daily` \| `weekly` \| `monthly` \| `advanced`, and exactly one nested payload matching `type` (`daily` / `weekly` / `monthly` / `advanced` DTOs). |
| `enabled === false` | Nested payload not required; [`buildExecutionScheduleDocument`](#execution-schedule-upsert-builder) clears mode payloads and sets `lastScheduledRunAt: null`. |
| Times | All local times use `TIME_LOCAL_REGEX`: **HH:mm** 24h. |
| Weekly | `weekday` 0–6 (0 = Sunday). |
| Monthly | `dayOfMonth` 1–31 or **-1** (last day of month). |
| Advanced `every_n_days` | `intervalDays` required, integer **1–366**. `timeLocal` optional in DTO but **must** match a tick minute for [`isExecutionScheduleDueThisMinute`](#schedule-due-evaluation-pure-utils) to fire for weekday/weekend/every_n_days (see below). |

### Persistence and upsert semantics

- **Disabled** (`enabled: false`): `lastScheduledRunAt` is forced to **`null`**; `daily` / `weekly` / `monthly` / `advanced` subdocs are **`null`** in Mongo.
- **Enabled**: `buildExecutionScheduleDocument` sets only the payload for the selected `type`; others are `null`.
- **Preserve last run**: On upsert, if `enabled` is true and the playbook already had `executionSchedule.lastScheduledRunAt`, that timestamp is passed as `preserveLastRunAt` so saving settings again **does not reset** dedupe state (`PlaybookService.upsertSchedule`).

### Due evaluation (`isExecutionScheduleDueThisMinute`)

Implementation: [`utils/playbook-schedule.util.ts`](utils/playbook-schedule.util.ts). Exported alias: **`shouldRunScheduledExecution`** (same function).

| Behavior | Detail |
|----------|--------|
| **Granularity** | Cron runs **once per minute**; the function answers “should we start a run **in this** UTC instant’s clock minute in the schedule **timezone**?” |
| **Timezone** | `timezone` string; empty/whitespace falls back to **`UTC`**. Uses `Intl` for zoned calendar parts and `YYYY-MM-DD` helpers. |
| **Same-minute dedupe** | If `lastScheduledRunAt` is set and falls in the **same zoned minute** as `now`, returns **`false`** (prevents double-firing in one minute). |
| **daily** | Any `daily.timesLocal` matches current zoned hour:minute. |
| **weekly** | Slot `weekday` matches zoned weekday **and** `timeLocal` matches. |
| **monthly** | For each slot, `dayOfMonth` matches zoned day or **-1** matches last day of month; **and** `timeLocal` matches. |
| **advanced — weekdays** | `timeLocal` matches current minute **and** zoned weekday is Mon–Fri. |
| **advanced — weekend** | Same, Sat–Sun. |
| **advanced — every_n_days** | `timeLocal` matches; **if** `lastScheduledRunAt` is **absent**, returns **`true`** (first run); **else** requires `daysBetweenYmd(last, now) >= max(1, intervalDays)`. |

Invalid or missing `type` / enabled → **`false`**.

### Runner behavior (summary)

| Step | Action |
|------|--------|
| 1 | `EVERY_MINUTE` cron; exit early if `!grpcService.isAvailable`. |
| 2 | Cursor: `isActive: true`, `executionSchedule.enabled: true`. |
| 3 | For each doc, `isExecutionScheduleDueThisMinute(schedule, now)`; continue if false. |
| 4 | `findOne` active execution `RUNNING` \| `INTERRUPTED`; if found, skip (info log). |
| 5 | `executePlaybook(userId, playbookId, {}, '', { executionTrigger: 'scheduled' })` |
| 6 | After `executePlaybook` returns, `$set` `executionSchedule.lastScheduledRunAt` to the tick `now` (marks the minute as consumed; run may still be **in progress** in the background). |

**`createdBy`** is the user id passed to `executePlaybook` (playbook owner).

### Config (schedule-related)

Email deep links use **`app.frontendUrl`** (not under `playbook.*`); see [`PlaybookExecutionService`](#playbookexecutionservice).

### Manual vs `scheduled` `executionTrigger`

| Caller | `executionTrigger` | Notes |
|--------|---------------------|--------|
| `POST /playbooks/:id/execute` ([`playbook.controller.ts`](controllers/playbook.controller.ts) `execute`) | **`manual`** | Always set explicitly; public API must not impersonate scheduled runs. |
| [`PlaybookScheduleRunnerService`](#playbook-schedule-runner) | **`scheduled`** | Internal only; passes empty `userEmail` to [`executePlaybook`](services/playbook-execution.service.ts). |

[`executePlaybook`](services/playbook-execution.service.ts) also rejects starting work if the playbook already has **RUNNING** / **INTERRUPTED** execution (in addition to the runner’s policy check).

### API types and list summaries

- [`ExecutionScheduleData`](interfaces/playbook.interface.ts) — `lastScheduledRunAt` as **ISO string** or `null`.
- [`PlaybookSummaryResponse.scheduleEnabled`](interfaces/playbook.interface.ts) — `true` iff `executionSchedule.enabled === true` (see [`findAllByUser`](#playbookservice) aggregation).

### Tests (schedule)

| File | Focus |
|------|--------|
| [`utils/playbook-schedule.util.spec.ts`](utils/playbook-schedule.util.spec.ts) | Due evaluation, timezones, modes |
| [`services/playbook-schedule-runner.service.spec.ts`](services/playbook-schedule-runner.service.spec.ts) | Runner + policy + gRPC gate |
| [`services/playbook.service.spec.ts`](services/playbook.service.spec.ts) | Schedule upsert/get/clear (when covered) |
| [`controllers/playbook.controller.spec.ts`](controllers/playbook.controller.spec.ts) | HTTP routes |

---

## Controllers

### PlaybookController (`/playbooks`)

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| `POST` | `/playbooks` | JWT | Create a new playbook |
| `GET` | `/playbooks` | JWT | List user's playbooks (paginated summaries) |
| `POST` | `/playbooks/generate` | JWT + UsageLimit | Generate a playbook from a text prompt via AI |
| `POST` | `/playbooks/bulk-delete` | JWT | Bulk delete multiple playbooks |
| `GET` | `/playbooks/:id/schedule` | Owner | Read schedule only ([`ExecutionScheduleData`](interfaces/playbook.interface.ts) \| `null`) |
| `PUT` | `/playbooks/:id/schedule` | Owner | Upsert embedded `executionSchedule` (body: [`UpsertPlaybookScheduleDto`](dto/upsert-playbook-schedule.dto.ts)) |
| `DELETE` | `/playbooks/:id/schedule` | Owner | Clear `executionSchedule` (`null`) |
| `GET` | `/playbooks/:id` | Owner | Get playbook by ID (full tasks/edges) |
| `PATCH` | `/playbooks/:id` | Owner | Update playbook (autosave target) |
| `DELETE` | `/playbooks/:id` | Owner | Soft delete (sets `isActive: false`) |
| `POST` | `/playbooks/:id/favorite` | Owner | Toggle favorite status |
| `POST` | `/playbooks/:id/design` | Owner + UsageLimit | Send a design query to the AI Designer |
| `GET` | `/playbooks/:id/design-messages` | Owner | Get design message history |
| `POST` | `/playbooks/:id/design-messages/:msgId/revert` | Owner | Revert playbook to a previous design message state |
| `POST` | `/playbooks/:id/execute` | Owner + UsageLimit | Start execution, returns `{ executionId }` |
| `POST` | `/playbooks/:id/stop` | Owner | Stop a running or interrupted execution |
| `POST` | `/playbooks/:id/resume` | Owner + UsageLimit | Resume an interrupted execution |
| `POST` | `/playbooks/:id/clone-share` | Owner | Share (clone) the playbook with other users by email |

### PlaybookExecutionController (`/playbooks/:id/executions`)

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| `GET` | `/playbooks/:id/executions` | Owner | List executions (paginated summaries) |
| `GET` | `/playbooks/:id/executions/:execId` | Owner | Get single execution with full task results |

### PlaybookStreamController (`/playbooks/stream`)

| Method | Route | Guard | Description |
|--------|-------|-------|-------------|
| `GET` | `/playbooks/stream?token=...` | PlaybookStreamAuth | SSE endpoint for real-time execution events |

---

## Services

### PlaybookService

CRUD operations, execution history, and design messages with optimized projections:

| Method | Description |
|--------|-------------|
| `create(userId, dto)` | Create a new playbook with empty tasks/edges |
| `findAllByUser(userId, query)` | Paginated list via `$facet` aggregation (`$project` with `$size` for `taskCount`, `lastExecutionAt` lookup, and **`scheduleEnabled`** derived from `executionSchedule.enabled`), supports search, sort, and filters |
| `findById(id)` | Single playbook with full task/edge data |
| `update(id, dto)` | Partial update (supports tasks/edges/workspaces for autosave) |
| `delete(id)` | Soft delete (`isActive: false`) |
| `bulkDelete(userId, ids)` | Bulk soft delete multiple playbooks |
| `toggleFavorite(id)` | Toggle `isFavorite` flag, returns `{ isFavorite }` |
| `cloneForUser(playbookId, targetUserId)` | Create a copy for another user (appends " (shared)" to name) |
| `findRawById(id)` | Returns Mongoose document (used by execution service) |
| `findExecutionsByPlaybook(playbookId, query)` | Paginated execution **summaries** (excludes `taskResults`, `playbookSnapshot`, `interruptPayload`, `threadId`) |
| `findExecutionById(playbookId, execId)` | Single execution with full task results and components |
| `getNextExecutionNumber(playbookId)` | Sequential numbering |
| `getDesignMessages(playbookId)` | Get design message history for a playbook |
| `revertToSnapshot(playbookId, messageId, userId)` | Revert playbook to a previous design message snapshot, creates revert record |
| `getSchedule(playbookId)` | Returns [`ExecutionScheduleData`](interfaces/playbook.interface.ts) \| `null` (single embedded schedule per playbook) |
| `upsertSchedule(playbookId, dto)` | Loads `executionSchedule.lastScheduledRunAt`, builds subdoc via [`buildExecutionScheduleDocument`](#execution-schedule-upsert-builder) (preserves last run when re-enabling), `$set`s `executionSchedule`, returns full playbook |
| `clearSchedule(playbookId)` | `$set` `executionSchedule: null`, returns full playbook |

**Response mappers:**
- `mapToResponse()` — Full playbook DTO (includes `executionSchedule` when present; schedule payload via [`mapExecutionScheduleToData()` from `utils/execution-schedule.mapper.ts`](#execution-schedule-mapper))
- `mapToSummaryResponse()` — Lightweight summary DTO for list views (includes `scheduleEnabled`)
- `mapExecutionToResponse()` — Full execution DTO with taskResults, components, and `executionTrigger`
- `mapExecutionToSummaryResponse()` — Lightweight execution summary DTO (includes `executionTrigger`)
- `mapDesignMessageToResponse()` — Design message DTO

### PlaybookExecutionService

Core orchestration engine with in-memory step caching, concurrency control, and token tracking:

| Method | Visibility | Description |
|--------|------------|-------------|
| `executePlaybook(userId, playbookId, dto, userEmail, options?)` | Public | Entry point: loads playbook, resolves agents, creates execution (with optional `executionTrigger: 'manual' \| 'scheduled'`), starts fire-and-forget loop |
| `resumeExecution(userId, playbookId, dto, userEmail)` | Public | Resumes interrupted execution with human response via gRPC |
| `stopExecution(userId, playbookId, executionId, userEmail)` | Public | Cancels a running/interrupted execution, marks remaining tasks as skipped |
| `findActiveExecutionsByUser(userId)` | Public | Returns active executions, merging in-memory step buffers for fresh catch-up reads |
| `runFullWorkflow(...)` | Private | Delegates to single LangGraph `RunPlaybookWorkflow` gRPC call with streaming |
| `runExecutionLoop(...)` | Private | Iterates topological levels with `pLimit` concurrency control |
| `executeStep(...)` | Private | Sends SSE step_start, calls gRPC `RunStep`, updates DB, sends SSE step_complete |
| `consumePlaybookStream(...)` | Private | Consumes `RunPlaybookWorkflow` streaming response chunks, manages `activeStepBuffers` lifecycle |
| `handleStepUpdate(...)` | Private | Processes individual step updates from stream into in-memory buffer + SSE (no DB writes) |
| `flushStepBuffer(...)` | Private | Batch DB writes at stream end, preserves humanFeedback components |
| `handleStreamInterrupts(...)` | Private | Filters stale interrupts for resumed tasks |
| `recordStreamUsage(...)` | Private | Tracks token usage from streaming responses |
| `mergeTaskResultWithBuffer(...)` | Private | Merges DB task result with in-memory buffer using status weight priority |
| `updateTaskResult(...)` | Private | Atomic array update with component size guard |
| `appendHumanFeedbackComponent(...)` | Private | `$push` with `$slice` to cap component array |
| `updateHumanFeedbackResponse(...)` | Private | Updates pending humanFeedback component with user response |
| `gatherContext(...)` | Private | Builds dependency context from inputKeys and edge parents |
| `markRemainingSkippedAndFail(...)` | Private | Marks PENDING tasks as SKIPPED, sets execution FAILED |
| `markExecutionCompleted(...)` | Private | Sets execution COMPLETED with duration |
| `markExecutionCancelled(...)` | Private | Sets execution CANCELLED with duration, marks remaining tasks as SKIPPED |
| `sendStepNotificationEmail(...)` | Private | Fire-and-forget email notification on step completion/failure/interrupt; optional `executionSummary` line (e.g. run number, step counts, duration) and optional link to execution detail |
| `formatExecutionSummaryForEmail(...)` | Private | Builds the one-line summary string for `executionSummary` |
| `buildExecutionDetailUrl(...)` | Private | Deep link `${frontendBaseUrl}/#/playbooks/:playbookId/executions/:executionId` (hash router) |
| `notifyScheduledRunFinished` / `notifyScheduledRunFinishedAsync` | Private | After a **scheduled** run ends **completed** or **failed**, sends owner email (if email service + user email) with subject and summary from `formatExecutionSummaryForEmail` |

**Constructor config:** reads `app.frontendUrl` (default `http://localhost:5173`) into **`frontendBaseUrl`** (trailing slash stripped) for email links. This uses the app-level frontend URL, not `playbook.*` config.

**In-memory step cache** (`activeStepBuffers`):
- `Map<executionId, Map<taskId, BufferedStepResult>>` — holds references to active step buffers
- Registered when `consumePlaybookStream` starts, deleted after `flushStepBuffer` completes
- `findActiveExecutionsByUser` merges buffer data into DB results using status weight priority (pending=0, running=1, completed/failed/skipped=2)
- Eliminates 2-3 fire-and-forget DB writes per step during streaming
- Zero memory overhead beyond existing `stepBuffer` — just exposes the same reference

### PlaybookScheduleRunnerService

File: [`services/playbook-schedule-runner.service.ts`](services/playbook-schedule-runner.service.ts). Runs on **`@Cron(CronExpression.EVERY_MINUTE)`** when the app process is up.

See **[Execution schedule (backend reference)](#execution-schedule-backend-reference)** for the full flow, REST surface, due algorithm, and tests.

| Concern | Behavior |
|---------|----------|
| **Selection** | Active playbooks with `executionSchedule.enabled === true` (lean cursor, `_id`, `createdBy`, `executionSchedule`) |
| **Due check** | Delegates to [`isExecutionScheduleDueThisMinute()`](#schedule-due-evaluation-pure-utils) for the current UTC `now` |
| **gRPC gate** | If `PlaybookGrpcService.isAvailable` is false, logs at debug and returns (no runs) |
| **Overlap** | If an execution exists with status **RUNNING** or **INTERRUPTED**, the scheduled run is skipped (info log) |
| **Start** | `executePlaybook(userId, playbookId, {}, '', { executionTrigger: 'scheduled' })` |
| **Persistence** | After `executePlaybook` returns, `$set` `executionSchedule.lastScheduledRunAt` to the tick time (start acknowledged, not run finished) |
| **Errors** | Per-playbook `catch`: warn with message, continue cursor |

### PlaybookContextService

Resolves workspace documents and agent brain contexts for gRPC requests:

| Method | Description |
|--------|-------------|
| `buildWorkspaceContexts(workspaceIds)` | Fetches completed documents from workspaces, maps to gRPC format |
| `resolveAgentBrainContexts(agents)` | Parallel resolution of workspace docs for agent brain contexts, mutates agents in-place |

### PlaybookDesignService

AI-powered playbook generation and iterative design:

| Method | Description |
|--------|-------------|
| `generatePlaybook(userId, dto, userEmail)` | Generates a complete playbook from a text prompt via gRPC, creates design message |
| `designPlaybook(userId, playbookId, dto, userEmail)` | Sends design query to AI, snapshots before, updates playbook, returns design message |

**Private helpers:**
- `mapGrpcResponseToTasksAndEdges(response)` — Converts gRPC nodes/edges to DB format
- `generateDesignSummary(before, after)` — Counts added/removed/modified tasks and edges
- `mapDesignMessageToResponse(msg)` — Response DTO mapping

### PlaybookGrpcService

gRPC client lifecycle, stream management, and channel state monitoring:

| Method | Visibility | Description |
|--------|------------|-------------|
| `onModuleInit()` | Lifecycle | Initializes gRPC client with proto loader, watches channel state |
| `onModuleDestroy()` | Lifecycle | Cancels active streams, closes gRPC client |
| `runStep(request)` | Public | Unary gRPC call (5 min timeout) |
| `runPlaybookWorkflow(request)` | Public | Server-side streaming gRPC call |
| `resumePlaybookWorkflow(request)` | Public | Resume streaming gRPC call |
| `resumeStep(request)` | Public | Unary resume call (5 min timeout) |
| `stopPlaybookWorkflow(request)` | Public | Stop execution gRPC call |
| `generatePlaybook(request)` | Public | AI generation gRPC call |
| `registerStream(executionId, call)` | Public | Tracks active stream for cancellation |
| `removeStream(executionId)` | Public | Removes tracked stream |
| `getStream(executionId)` | Public | Retrieves active stream |
| `markCancelled(executionId)` | Public | Flags stream as user-cancelled |
| `wasCancelled(executionId)` | Public | Returns and clears cancellation flag |

**Properties:** `isAvailable` (getter), `workflowTimeoutMs` (getter)

### Utility Functions (`utils/execution.utils.ts`)

Pure utility functions extracted for testability:

| Function | Description |
|--------|-------------|
| `topologicalSortByLevel(tasks, edges)` | Kahn's algorithm returning 2D array of levels |
| `pLimit(concurrency)` | Simple promise-based concurrency limiter |
| `mapGrpcComponents(grpcComps, taskId, max, maxBytes)` | Converts gRPC components with size caps and stable IDs |
| `extractTextFromComponents(grpcComps)` | Extracts first TextComponent content for backward-compatible `output` field |
| `truncateComponentData(data, maxBytes)` | Replaces `data.content` with `[truncated]` if JSON exceeds limit |
| `mergeWithExistingHumanFeedback(existing, new)` | Prepends answered humanFeedback components before new components |

**Constants:** `MAX_COMPONENT_DATA_BYTES_DEFAULT` (500KB), `MAX_COMPONENTS_PER_TASK_DEFAULT` (200), `MAX_CONCURRENT_STEPS_DEFAULT` (5)

### Execution schedule mapper

File: [`utils/execution-schedule.mapper.ts`](utils/execution-schedule.mapper.ts). Pure functions (no Nest DI) so mapping stays testable and separate from `PlaybookService`:

| Export | Description |
|--------|-------------|
| `mapExecutionScheduleToData(sched)` | Converts a persisted `executionSchedule` subdocument (Mongoose or lean) into [`ExecutionScheduleData`](interfaces/playbook.interface.ts). Validates `type` against known schedule modes, normalises `lastScheduledRunAt` to ISO (invalid dates → `null`), maps nested `daily` / `weekly` / `monthly` / `advanced` payloads, and tolerates partial or legacy shapes without throwing. |

`PlaybookService.mapToResponse()` imports and calls `mapExecutionScheduleToData(playbook.executionSchedule)`.

### Execution schedule upsert builder

File: [`utils/execution-schedule-upsert.builder.ts`](utils/execution-schedule-upsert.builder.ts). Pure mapping from validated HTTP input to the Mongo subdocument shape (no Nest DI). `PlaybookService.upsertSchedule()` passes `preserveLastRunAt` when re-enabling so `lastScheduledRunAt` is not reset on every save.

| Export | Description |
|--------|-------------|
| `buildExecutionScheduleDocument(dto, preserveLastRunAt)` | When `enabled=false`, returns a disabled schedule with `lastScheduledRunAt: null` and null mode payloads. When `enabled=true`, requires `type` and nested payload matching `daily` \| `weekly` \| `monthly` \| `advanced`; throws [`BadRequestException`](../../exceptions/exceptions/http.exceptions.ts) for missing type or unknown mode. |

### Schedule due evaluation (pure utils)

File: [`utils/playbook-schedule.util.ts`](utils/playbook-schedule.util.ts). Used only by [`PlaybookScheduleRunnerService`](#playbook-schedule-runner) to decide if **this calendar minute** should trigger a run (timezone-aware local date/time, dedupe via `lastScheduledRunAt`).

| Export | Role |
|--------|------|
| `isExecutionScheduleDueThisMinute(schedule, now?)` | Returns whether the embedded schedule fires for the given instant (default `now = new Date()`) |
| `shouldRunScheduledExecution` | **Alias** for `isExecutionScheduleDueThisMinute` |
| `ScheduleEvalInput` | Type for lean Mongo / DTO-shaped input |
| `zonedYmd`, `daysBetweenYmd` | Gregorian helpers for `every_n_days` |

Per-mode rules and edge cases: **[Execution schedule (backend reference) — Due evaluation](#due-evaluation-isexecutionscheduleduethisminute)**.

Unit tests: [`utils/playbook-schedule.util.spec.ts`](utils/playbook-schedule.util.spec.ts).

### PlaybookStreamGatewayService

SSE connection management (mirrors conversation module pattern):

| Method | Description |
|--------|-------------|
| `registerConnection(userId, connectionId, disconnect$)` | Returns merged event + heartbeat observable (or null if at limit) |
| `removeConnection(userId, connectionId)` | Cleanup on disconnect |
| `sendToUser(userId, event)` | Broadcast to all user connections |
| `isUserConnected(userId)` | Check if user has active connections |

---

## Schemas

### Playbook (`playbooks` collection)

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | 2-100 chars, required, trimmed |
| `description` | String | Max 2000 chars |
| `tasks[]` | Embedded | Array of `PlaybookTask` subdocs |
| `edges[]` | Embedded | Array of `PlaybookEdge` subdocs |
| `workspaces[]` | ObjectId[] | Refs to Workspace (default: []) |
| `createdBy` | ObjectId | Ref to User, indexed |
| `isFavorite` | Boolean | Favorite flag (default: false) |
| `isActive` | Boolean | Soft delete flag (default: true) |
| `executionSchedule` | Embedded \| null | Optional **single** schedule configuration per playbook (see [Execution schedule](#execution-schedule-embedded)); default `null` when not configured |
| `createdAt/updatedAt` | Date | Auto-managed timestamps |

**PlaybookTask subdoc:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Client-generated UUID (= ReactFlow node ID) |
| `title` | String | Step title (max 200) |
| `description` | String | Step description (max 2000) |
| `assignedAgentId` | ObjectId | Optional ref to Agent |
| `executionOrder` | Number | Order within topological level |
| `positionX/positionY` | Number | Canvas coordinates |
| `interruptBefore/After` | Boolean | Pause for approval/review |
| `allowClarification` | Boolean | Enable agent-initiated clarification |
| `clarificationPrompt` | String | Custom clarification message (max 1000) |
| `maxClarifications` | Number | Max clarification rounds (1-10, default: 3) |
| `inputKeys[]` | String[] | Keys to read from dependency outputs |
| `outputKey` | String | Key to store this step's output |

**PlaybookEdge subdoc:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | Edge identifier |
| `sourceId` | String | Source task ID |
| `targetId` | String | Target task ID |

**Indexes:** `(createdBy, updatedAt)`, `(createdBy, isActive, updatedAt)`

### Execution schedule (embedded)

Defined in [`schemas/execution-schedule.schema.ts`](schemas/execution-schedule.schema.ts) and embedded on the Playbook document as `executionSchedule`. It stores **when** a playbook should run automatically (timezone, mode, and mode-specific payloads). REST writes use [`UpsertPlaybookScheduleDto`](dto/upsert-playbook-schedule.dto.ts) and [`buildExecutionScheduleDocument`](utils/execution-schedule-upsert.builder.ts); the schema is the **MongoDB shape**.

**`ExecutionSchedule` subdocument**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | Boolean | Whether automatic runs are active (default: false) |
| `timezone` | String | IANA timezone for interpreting local times (default: `UTC`) |
| `type` | Enum | `daily \| weekly \| monthly \| advanced` — which payload block applies |
| `lastScheduledRunAt` | Date \| null | Last time a scheduled run was triggered (cron / dedupe); default `null` |
| `daily` | Embedded \| null | [`DailySchedulePayload`](#dailyschedulepayload) |
| `weekly` | Embedded \| null | [`WeeklySchedulePayload`](#weeklyschedulepayload) |
| `monthly` | Embedded \| null | [`MonthlySchedulePayload`](#monthlyschedulepayload) |
| `advanced` | Embedded \| null | [`AdvancedSchedulePayload`](#advancedschedulepayload) |

Only the payload matching `type` is typically populated; others remain `null`.

**`DailySchedulePayload`**

| Field | Type | Description |
|-------|------|-------------|
| `timesLocal` | String[] | One or more `HH:mm` (24h) values in the playbook’s `timezone` |

**`WeeklySchedulePayload`**

| Field | Type | Description |
|-------|------|-------------|
| `slots` | `WeeklySlot[]` | One or more weekday + time pairs |

**`WeeklySlot`**

| Field | Type | Description |
|-------|------|-------------|
| `weekday` | Number | `0` = Sunday … `6` = Saturday |
| `timeLocal` | String | `HH:mm` for that weekday |

**`MonthlySchedulePayload`**

| Field | Type | Description |
|-------|------|-------------|
| `slots` | `MonthlySlot[]` | One or more day-of-month + time pairs |

**`MonthlySlot`**

| Field | Type | Description |
|-------|------|-------------|
| `dayOfMonth` | Number | Day of month `1`–`31`, or `-1` for **last day of month** |
| `timeLocal` | String | `HH:mm` for that day |

**`AdvancedSchedulePayload`**

| Field | Type | Description |
|-------|------|-------------|
| `variant` | Enum | `weekdays` (Mon–Fri), `weekend` (Sat–Sun), `every_n_days` (calendar interval) |
| `intervalDays` | Number \| null | Used when `variant === 'every_n_days'` (e.g. every 3 days); DTO requires **1–366** when that variant is selected |
| `timeLocal` | String \| null | **HH:mm** in the playbook timezone; the [due evaluator](#schedule-due-evaluation-pure-utils) requires a **parsable** time that matches the current zoned minute for all advanced variants (otherwise the tick does not fire) |

### PlaybookExecution (`playbook_executions` collection)

| Field | Type | Description |
|-------|------|-------------|
| `playbookId` | ObjectId | Ref to Playbook, indexed |
| `executedBy` | ObjectId | Ref to User, indexed |
| `executionNumber` | Number | Sequential per playbook |
| `currentAttemptNumber` | Number | Current attempt (default: 1) |
| `status` | Enum | `pending \| running \| completed \| failed \| interrupted \| cancelled` |
| `taskResults[]` | Embedded | Array of `TaskResult` subdocs |
| `threadId` | String | LangGraph thread ID (for resume) |
| `interruptPayload` | Mixed | Stored interrupt data |
| `error` | String | Global error message |
| `durationMs` | Number | Total execution time |
| `startedAt/completedAt` | Date | Execution timestamps |
| `singleStepTaskId` | String | If set, only this step runs |
| `executionMode` | String | Global mode (e.g. `live`, replay modes; default: `live`) |
| `executionTrigger` | Enum | `manual` — user/API started run; `scheduled` — started by the schedule runner (default: `manual`) |
| `runEvaluation` | Boolean | Whether evaluation runs (default: false) |
| `replaySourceByTask` | Object \| null | Replay id + validation version per task when using replay |
| `playbookSnapshot` | Mixed | Frozen copy of tasks/edges at execution time |
| `totalInputTokens` | Number | Aggregate input tokens (default: 0) |
| `totalOutputTokens` | Number | Aggregate output tokens (default: 0) |
| `totalTokens` | Number | Aggregate total tokens (default: 0) |
| `attemptHistory` | Object[] | Audit trail of attempts (initial, resume, rerun, etc.) |

**TaskResult subdoc:**

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | String | References PlaybookTask.id |
| `nodeTitle` | String | Snapshot of title at execution time |
| `agentName` | String | Snapshot of agent name |
| `order` | Number | Topological execution order |
| `status` | Enum | `pending \| running \| completed \| failed \| skipped` |
| `output` | String | Extracted text output (backward-compatible) |
| `error` | String | Step error message |
| `durationMs` | Number | Step execution time |
| `startedAt/completedAt` | Date | Step timestamps |
| `components[]` | Object[] | Rich result components `{ id, type, data }` (capped at `maxComponentsPerTask`) |
| `inputTokens` | Number | Input tokens for this step (default: null) |
| `outputTokens` | Number | Output tokens for this step (default: null) |
| `totalTokens` | Number | Total tokens for this step (default: null) |
| `modelName` | String | Model used for this step (default: null) |

**Indexes:**
- `{ playbookId: 1, createdAt: -1 }` — Execution history by playbook
- `{ executedBy: 1, createdAt: -1 }` — User's executions
- `{ playbookId: 1, status: 1 }` — Active execution checks

### PlaybookDesignMessage (`playbook_design_messages` collection)

| Field | Type | Description |
|-------|------|-------------|
| `playbookId` | ObjectId | Ref to Playbook, indexed |
| `createdBy` | ObjectId | Ref to User |
| `userQuery` | String | User's design request (max 5000) |
| `aiSummary` | String | AI-generated summary of changes |
| `snapshotBefore` | Object | Frozen copy of tasks/edges before the change |
| `status` | Enum | `completed \| failed \| reverted` |
| `revertedFromMessageId` | ObjectId | If this is a revert, points to the original message |
| `error` | String | Error message if design failed |
| `createdAt/updatedAt` | Date | Auto-managed timestamps |

**PlaybookSnapshot subdoc (in snapshotBefore):**

| Field | Type | Description |
|-------|------|-------------|
| `tasks[]` | Object[] | Snapshot of all tasks at that point |
| `edges[]` | Object[] | Snapshot of all edges at that point |

**Index:** `{ playbookId: 1, createdAt: -1 }`

---

## Interfaces (API responses)

[`interfaces/playbook.interface.ts`](interfaces/playbook.interface.ts) mirrors persisted fields for REST responses:

| Type | Purpose |
|------|---------|
| `PlaybookSummaryResponse` | List card shape: includes **`scheduleEnabled`** when the embedded schedule is enabled (`executionSchedule.enabled === true`) |
| `ExecutionScheduleType` | `'daily' \| 'weekly' \| 'monthly' \| 'advanced'` |
| `ExecutionScheduleData` | `enabled`, `timezone`, optional `type`, `lastScheduledRunAt` (ISO string), and one of `daily` / `weekly` / `monthly` / `advanced` payload objects (or `null` per field) |
| `DailySchedulePayloadData`, `WeeklySlotData`, `WeeklySchedulePayloadData`, `MonthlySlotData`, `MonthlySchedulePayloadData`, `AdvancedSchedulePayloadData`, `AdvancedScheduleVariant` | Shape of nested schedule payloads (aligned with [`execution-schedule.schema.ts`](schemas/execution-schedule.schema.ts)) |
| `PlaybookResponse` | Includes `executionSchedule: ExecutionScheduleData \| null` |
| `PlaybookExecutionResponse` | Includes `executionTrigger: 'manual' \| 'scheduled'` |
| `PlaybookExecutionSummaryResponse` | Includes `executionTrigger: 'manual' \| 'scheduled'` |

[`mapExecutionScheduleToData()`](utils/execution-schedule.mapper.ts) (used by `PlaybookService.mapToResponse()`) serialises Mongo `executionSchedule` subdocuments and dates to these DTOs. [`buildExecutionScheduleDocument()`](utils/execution-schedule-upsert.builder.ts) maps validated [`UpsertPlaybookScheduleDto`](dto/upsert-playbook-schedule.dto.ts) input to the same Mongo shape for `PUT /playbooks/:id/schedule`.

---

## gRPC Integration

The gRPC service (`PlaybookGrpcService`) uses the shared `chatbot.proto` definition (located at `../conversation/proto/chatbot.proto`). The gRPC client initializes on module init and monitors channel connectivity state.

### RunStep (Unary, 5 min timeout)

Called once per task during `runExecutionLoop`:

**Request fields:**
- `user_context` — User ID and username
- `playbook_id` — Playbook identifier
- `task` — Full `PlaybookTaskConfig` (title, description, agent, interrupt settings)
- `agent` — Resolved `Agent` (name, prompt, tools, chatbot model)
- `context_from_dependencies` — Concatenated outputs from parent tasks
- `workspace_context` — Associated workspace documents

**Response handling:**
- `status: 'completed'` — Store output + components + tokens, continue to next task
- `status: 'failed'` — Mark remaining tasks as skipped, set execution to failed
- `status: 'interrupted'` — Save interrupt payload + humanFeedback component, pause execution

### RunPlaybookWorkflow (Server streaming, 10 min timeout)

Full workflow delegation to LangGraph via streaming. The `consumePlaybookStream` method processes streamed chunks containing step updates, components, and interrupt signals. Includes stale interrupt filtering for resumed tasks to prevent duplicate feedback loops. Token usage is tracked via `recordStreamUsage`.

### GeneratePlaybook (Unary)

Generates a complete playbook (tasks + edges) from a text prompt via `PlaybookDesignService`. Response is mapped via `mapGrpcResponseToTasksAndEdges`. Creates both the playbook and an initial design message record.

### DesignPlaybook (Unary)

Iteratively modifies a playbook via `PlaybookDesignService`. Saves a `PlaybookDesignMessage` with `snapshotBefore` for revert capability. Returns the modified playbook and a design message. Supports message history for context-aware design iterations.

### ResumePlaybookWorkflow / ResumeStep (Unary)

Called when a user responds to an interrupt. Merges existing humanFeedback components with new gRPC results. Includes stale interrupt filtering to prevent re-emitted interrupts from causing feedback loops.

### StopPlaybookWorkflow

Called when a user stops a running execution. Cancels the active gRPC stream on the AI service side.

---

## SSE Streaming

### Dedicated Endpoint

```
GET /api/v1/playbooks/stream?token=<jwt>
```

SSE uses query-parameter authentication since `EventSource` doesn't support custom headers.

### Connection Management

- Max connections per user: configurable (default 5)
- Heartbeat interval: configurable (default 15s)
- Sends `playbook_connected` event on registration
- Sends `error` event if connection limit reached

### Event Types

| Event | Payload | When |
|-------|---------|------|
| `playbook_connected` | `{ connectionId }` | Client connects |
| `playbook_heartbeat` | `{ timestamp }` | Every `sseHeartbeatMs` |
| `playbook_execution_start` | `{ executionId, playbookId, executionNumber, status, executionMode, executionTrigger, taskResults, ... }` | Execution begins |
| `playbook_step_start` | `{ executionId, taskId, status: 'running' }` | Step begins |
| `playbook_step_complete` | `{ executionId, taskId, status, output?, error?, durationMs?, components?, inputTokens?, outputTokens?, totalTokens?, modelName? }` | Step finishes |
| `playbook_execution_complete` | `{ executionId, status, durationMs, skippedTaskIds?, totalInputTokens?, totalOutputTokens?, totalTokens? }` | All steps done |
| `playbook_execution_error` | `{ executionId, error }` | Unrecoverable error |
| `playbook_interrupt` | `{ executionId, taskId, type, message, threadId, taskDescription?, result? }` | Human input needed |
| `playbook_shared` | `{ playbookId }` | Playbook shared with user |

---

## Execution Engine

### Dual Execution Modes

1. **Per-task orchestration** (`runExecutionLoop`): Iterates topological levels, calls `RunStep` per task with concurrency limiting. Used for single-step execution and manual orchestration.

2. **Full workflow** (`runFullWorkflow`): Delegates entire playbook to a single `RunPlaybookWorkflow` gRPC call (LangGraph). Processes streamed response chunks via `consumePlaybookStream`, with step buffering and batch DB writes via `flushStepBuffer`.

### Topological Sort

Uses **Kahn's algorithm** via `topologicalSortByLevel()`:

1. Build adjacency list and in-degree map from edges
2. Queue all nodes with in-degree 0
3. Process queue level by level: for each node, decrement neighbors' in-degree
4. Tiebreaker: `executionOrder` field for nodes at the same topological level
5. Fallback: any unreachable nodes (cycles) appended at the end
6. Returns `any[][]` — 2D array where each inner array is an independent level

### Dependency Context

Before executing a step, the engine gathers outputs from parent tasks:

1. **Input keys**: If the task specifies `inputKeys`, look up outputs by those keys
2. **Edge parents**: For each incoming edge, include the source task's output
3. Context is concatenated and passed as `context_from_dependencies` in the gRPC request

### Single-Step Execution

When `singleStepTaskId` is provided:
- All other tasks are immediately marked as `skipped`
- Only the target task is executed
- Useful for testing individual steps in isolation

### Agent Resolution

Only agents referenced by playbook tasks are loaded:
```typescript
const referencedAgentIds = [...new Set(
  playbook.tasks.filter(t => t.assignedAgentId).map(t => t.assignedAgentId.toString())
)];
const agents = await this.agentService.findByIds(referencedAgentIds, userId);
```

Agent brain/context data is resolved via `resolveAgentBrainContexts` before passing to gRPC.

### Token Tracking

- Each `TaskResult` stores `inputTokens`, `outputTokens`, `totalTokens`, and `modelName` from gRPC responses
- Each `PlaybookExecution` aggregates `totalInputTokens`, `totalOutputTokens`, `totalTokens`
- Streaming responses track usage via `recordStreamUsage`
- Token data is included in SSE `step_complete` and `execution_complete` events

---

## Performance & Scalability

### Concurrency Limiting

Parallel gRPC calls within a topological level are limited by `pLimit(maxConcurrentSteps)` (default 5). Prevents overwhelming the gRPC server when a level has many independent tasks.

### Execution List Projections

The execution list endpoint uses `.select('-taskResults -playbookSnapshot -interruptPayload -threadId')` to return lightweight summaries. Full execution detail is only loaded when viewing a specific execution.

### Playbook List Aggregation

Uses `$facet` aggregation pipeline with:
- `$match` for search (regex on name), date range, and task count filters
- `$project` with `$size` for `taskCount` (no full task arrays)
- `$lookup` for `lastExecutionAt` from executions collection
- `$sort` on configurable field (updatedAt, createdAt, name, taskCount, lastExecutionAt)

### Component Array Guards

- **Per-task cap**: Components capped at `maxComponentsPerTask` (default 200) via array slicing in `updateTaskResult`
- **$push with $slice**: `appendHumanFeedbackComponent` uses `{ $push: { $each: [...], $slice: -maxComponents } }` to atomically cap
- **Data truncation**: Individual components exceeding `maxComponentDataBytes` (default 500KB) have their `content` replaced with `[truncated]`
- **gRPC mapping**: `mapGrpcComponents` applies both caps during conversion

### DTO Validation

- Tasks array: `@ArrayMaxSize(200)` — prevents oversized playbook documents
- Edges array: `@ArrayMaxSize(500)` — prevents excessive edge data
- Bulk delete: `@ArrayMaxSize(50)` — limits batch size
- Clone share: `@ArrayMaxSize(20)` — limits email recipients

### Memory Optimization

- Execution loop loads only necessary fields: `.select('taskResults.taskId taskResults.status playbookSnapshot playbookId startedAt')`
- Agent loading fetches only referenced agents, not all user agents
- Playbook list uses aggregation with `$project` + `$size` (no full task arrays)
- Streaming responses use in-memory step cache (`activeStepBuffers`) with batch DB writes at stream end — zero extra writes per step during streaming

### Database Indexes

| Index | Purpose |
|-------|---------|
| `{ createdBy: 1, updatedAt: -1 }` | Playbook list query |
| `{ createdBy: 1, isActive: 1, updatedAt: -1 }` | Active playbooks filter |
| `{ playbookId: 1, createdAt: -1 }` | Execution history by playbook |
| `{ executedBy: 1, createdAt: -1 }` | User's execution history |
| `{ playbookId: 1, status: 1 }` | Active execution check (avoids collection scan) |
| `{ playbookId: 1, createdAt: -1 }` (design messages) | Design message history |

---

## Guards & Decorators

### PlaybookOwnerGuard

- Validates the `:id` or `:playbookId` param is a valid ObjectId
- Queries only the `createdBy` field (`.select('createdBy').lean()`)
- Compares `createdBy.toString()` with `user._id.toString()`
- Throws `NotFoundException` or `ForbiddenException`

### PlaybookStreamAuthGuard

- Extracts JWT from `?token=` query parameter
- Verifies token with `jwt.secret`, `jwt.issuer`, `jwt.audience`
- Validates `type === 'access'`
- Checks session is still active via `authService.isSessionValid()`
- Attaches `sseUser` to the request object

### @PlaybookStreamAuth() Decorator

Composite decorator combining `SetMetadata` and `UseGuards(PlaybookStreamAuthGuard)`.

---

## DTOs

| DTO | Key Validations | Description |
|-----|-----------------|-------------|
| `CreatePlaybookDto` | `name` (2-100), `description?` (max 2000), `workspaces?` (MongoId[]) | Create a new playbook |
| `UpdatePlaybookDto` | `tasks[]?` (@ArrayMaxSize(200)), `edges[]?` (@ArrayMaxSize(500)), nested validation | Partial update (autosave) |
| `GeneratePlaybookDto` | `name` (2-100), `prompt` (10-5000), `workspaces?` (MongoId[]) | Generate playbook from AI prompt |
| `DesignPlaybookDto` | `query` (5-5000) | AI design modification request |
| `PlaybookQueryDto` | `page` (min 1), `limit` (1-100), `search?`, `sortBy?` (updatedAt/createdAt/name/taskCount/lastExecutionAt), `sortOrder?` (asc/desc), `minTasks?`, `maxTasks?`, `dateField?`, `dateFrom?`, `dateTo?` | List query with pagination, search, sort, and filters |
| `ExecutePlaybookDto` | `singleStepTaskId?`, `query?` (max 10000) | Start execution |
| `ResumePlaybookDto` | `executionId`, `taskId`, `approved` (required boolean), `reason?`, `feedback?` | Resume interrupt with approval/rejection |
| `StopPlaybookDto` | `executionId` (required) | Stop a running execution |
| `BulkDeletePlaybooksDto` | `ids` (MongoId[], 1-50) | Bulk delete |
| `CloneSharePlaybookDto` | `emails` (email[], 1-20) | Share by email |
| `UpsertPlaybookScheduleDto` | `enabled`; when `true`: `timezone`, `type` (`daily` \| `weekly` \| `monthly` \| `advanced`), and nested payload (`daily`/`weekly`/`monthly`/`advanced` via `@ValidateIf`); `TIME_LOCAL_REGEX` HH:mm; monthly `dayOfMonth` 1–31 or -1 | Upsert playbook execution schedule |
| `ExecutionQueryDto` | `page`, `limit` (1-100) | Execution history pagination |

---

## API Endpoints

### Playbook CRUD

```
POST   /api/v1/playbooks                              -> Create playbook
POST   /api/v1/playbooks/generate                     -> Generate playbook from prompt (AI)
POST   /api/v1/playbooks/bulk-delete                  -> Bulk delete multiple playbooks
GET    /api/v1/playbooks                              -> List playbooks (paginated summaries with search/sort/filters)
GET    /api/v1/playbooks/:id                          -> Get playbook (full)
PATCH  /api/v1/playbooks/:id                          -> Update playbook (autosave)
DELETE /api/v1/playbooks/:id                          -> Soft delete playbook
POST   /api/v1/playbooks/:id/favorite                 -> Toggle favorite status
POST   /api/v1/playbooks/:id/clone-share              -> Share playbook by email (clones for recipients)
GET    /api/v1/playbooks/:id/schedule                 -> Get execution schedule (ExecutionScheduleData | null)
PUT    /api/v1/playbooks/:id/schedule                 -> Upsert execution schedule (body: UpsertPlaybookScheduleDto)
DELETE /api/v1/playbooks/:id/schedule                 -> Clear execution schedule
```

### Execution

```
POST   /api/v1/playbooks/:id/execute                  -> Start execution
POST   /api/v1/playbooks/:id/resume                   -> Resume interrupted execution
POST   /api/v1/playbooks/:id/stop                     -> Stop running/interrupted execution
GET    /api/v1/playbooks/:id/executions                -> List executions (paginated summaries)
GET    /api/v1/playbooks/:id/executions/:execId        -> Get single execution (full detail)
```

### AI Designer

```
POST   /api/v1/playbooks/:id/design                   -> Send design query to AI
GET    /api/v1/playbooks/:id/design-messages           -> Get design message history
POST   /api/v1/playbooks/:id/design-messages/:msgId/revert -> Revert to previous design state
```

### SSE Stream

```
GET    /api/v1/playbooks/stream?token=<jwt>            -> SSE connection
```

---

## Data Flow

### Execute Playbook

```
Client                    Controller              ExecutionService           gRPC (AI)         SSE Gateway
  |                          |                         |                       |                   |
  | POST /execute            |                         |                       |                   |
  |------------------------->|                         |                       |                   |
  |                          | executePlaybook()       |                       |                   |
  |                          |------------------------>|                       |                   |
  |                          |                         | Load playbook         |                   |
  |                          |                         | Resolve referenced    |                   |
  |                          |                         |   agents (findByIds)  |                   |
  |                          |                         | Resolve brain contexts|                   |
  |                          |                         | Create execution doc  |                   |
  |                          |                         | Topological sort      |                   |
  |                          |                         |                       |                   |
  | { executionId }          |                         | SSE: execution_start  |                   |
  |<-------------------------|                         |-------------------------------------->|
  |                          |                         |                       |                   |
  |                          |                         | (fire-and-forget)     |                   |
  |                          |                         | For each level:       |                   |
  |                          |                         |   pLimit(5) tasks:    |                   |
  |                          |                         |     SSE: step_start   |                   |
  |                          |                         |-------------------------------------->|
  |                          |                         |     gRPC: RunStep()   |                   |
  |                          |                         |--------------------->|                   |
  |                          |                         |     StepResponse      |                   |
  |                          |                         |<---------------------|                   |
  |                          |                         |     Update DB +tokens |                   |
  |                          |                         |     SSE: step_complete|                   |
  |                          |                         |-------------------------------------->|
  |                          |                         |                       |                   |
  |                          |                         | SSE: execution_complete (+ total tokens)  |
  |                          |                         |-------------------------------------->|
```

### Scheduled run (cron)

```
ScheduleRunner (every minute)     Mongo (playbooks)              ExecutionService
        |                                |                              |
        | find enabled schedules         |                              |
        |------------------------------->|                              |
        | isExecutionScheduleDueThisMinute?                             |
        | active RUNNING/INTERRUPTED? -> apply concurrency policy       |
        | executePlaybook(..., scheduled)                               |
        |-------------------------------------------------------------->|
        | update lastScheduledRunAt      |                              |
        |------------------------------->|                              |
```

### Interrupt/Resume Flow

```
ExecutionService                  gRPC                SSE             Client
      |                            |                   |                |
      | RunStep(task)              |                   |                |
      |--------------------------->|                   |                |
      | status: 'interrupted'      |                   |                |
      |<---------------------------|                   |                |
      |                            |                   |                |
      | Save interruptPayload     |                   |                |
      | Append humanFeedback      |                   |                |
      |   component ($push/$slice)|                   |                |
      | SSE: playbook_interrupt   |                   |                |
      |---------------------------------------------->|                |
      |                            |                   | Interrupt UI   |
      |                            |                   |--------------->|
      |                            |                   | humanResponse  |
      |                            |                   |   (approved,   |
      |                            |                   |    reason,     |
      |                            |                   |    feedback)   |
      |                            |                   |<---------------|
      |                            |                   |                |
      | POST /resume               |                   |                |
      |<---------------------------------------------------------------|
      | Update humanFeedback      |                   |                |
      |   component (answered)    |                   |                |
      | ResumeStep/Workflow()     |                   |                |
      |--------------------------->|                   |                |
      | Continue or interrupt      |                   |                |
      | again                      |                   |                |
```

### Design Flow

```
Client                    Controller              DesignService          PlaybookService
  |                          |                         |                       |
  | POST /design             |                         |                       |
  |------------------------->|                         |                       |
  |                          | designPlaybook()        |                       |
  |                          |------------------------>|                       |
  |                          |                         | Snapshot current      |
  |                          |                         |   tasks/edges         |
  |                          |                         | gRPC: DesignPlaybook  |
  |                          |                         | Map response to       |
  |                          |                         |   tasks/edges         |
  |                          |                         | Update playbook       |
  |                          |                         |---------------------->|
  |                          |                         | Save design message   |
  |                          |                         |   (with snapshot)     |
  | { playbook, message }    |                         |                       |
  |<-------------------------|                         |                       |
```

---

## Testing

Unit tests are colocated in the module as `*.spec.ts` — **14 test files** (counts below are `it`/`test` blocks and change over time).

### Test Coverage

| Area | Test File | Tests (approx.) |
|------|-----------|-----------------|
| **Utils** | `utils/execution.utils.spec.ts` | 44 |
| | `utils/playbook-schedule.util.spec.ts` | 17 |
| **Services** | `services/playbook.service.spec.ts` | 73 |
| | `services/playbook-execution.service.spec.ts` | 78 |
| | `services/playbook-schedule-runner.service.spec.ts` | 11 |
| | `services/playbook-design.service.spec.ts` | 74 |
| | `services/playbook-grpc.service.spec.ts` | 60 |
| | `services/playbook-context.service.spec.ts` | 24 |
| | `services/playbook-stream-gateway.service.spec.ts` | 35 |
| **Guards** | `guards/playbook-owner.guard.spec.ts` | 7 |
| | `guards/playbook-stream-auth.guard.spec.ts` | 11 |
| **Controllers** | `controllers/playbook.controller.spec.ts` | 25 |
| | `controllers/playbook-stream.controller.spec.ts` | 5 |
| | `controllers/playbook-execution.controller.spec.ts` | 4 |

### Running Tests

```bash
# Run all playbook tests
cd back && npx jest --testPathPattern="playbook" --no-coverage

# Run a specific test file
cd back && npx jest --testPathPattern="playbook-execution.service" --no-coverage
```
