# Worky Component-Stream UI — Design

**Date:** 2026-08-13
**Status:** Approved (design) — pending implementation plan
**Branch:** `feature/worky_new_conversation`

## Problem

The worky stream interface has a plain-text chat UI. That is no longer enough:

- The worky manager can now send **files**.
- Tasks / step results can carry **artifacts, markdown, code, charts** — arbitrary rich content.

Meanwhile the main **conversation** module already has a stable, proven "component
stream" UI: the AI streams a structured data model (typed components) and the
frontend renders each component through a type→component registry. We want to
reuse that exact renderer in worky — for **manager chat messages** and for **each
step result** — so worky benefits from an already-working model.

The complication: conversation streams components over **gRPC → SSE**, whereas
worky syncs data over **ElectricSQL** (whole rows, not chunk deltas). We need an
adapter so Electric-synced data feeds the existing renderer. All existing worky
features — realtime voice (Gemini Live), STT/dictation, TTS read-aloud, the
kanban/graph board, clarifications, mobile sheets — must keep working unchanged.

## Core idea

The conversation renderer (`AIMessageContent` + `ai-elements/*`) needs exactly one
input: an ordered `MessageComponent[]` where each component is `{ id, type, data }`.

So the whole feature reduces to: **produce a `MessageComponent[]` for each worky
manager message and each step result**, then feed it to the existing renderer.

Decisions taken during brainstorming:

1. **Source of structured content:** the worky **manager emits components**. It
   writes structured component data (the same `{type,data}` model) into Postgres.
   We define that contract as part of this work.
2. **Row encoding / streaming:** **one row per component, written once complete**
   — no intra-text token streaming. Each Electric row is a fully-formed component;
   components appear progressively (by `ordinal`) as each finishes. This removes
   all append/merge/throttle machinery — the adapter is ~1:1.
3. **Artifacts model:** **dedicated for steps only.** Step file deliverables live
   in a dedicated `plan_step_artifacts` table/shape; chat-message files ride
   inline as `type='artifact'` components in `message_components`.
4. **Owner uploads:** **out of scope.** This effort renders the manager's rich
   output and step results only. Owner→manager file upload (composer) is a later
   effort; `PromptBar` stays text+mic.

## Architecture (end to end)

```
Manager (external) ── writes Postgres rows ──▶ new tables:
   message_components / plan_step_components / plan_step_artifacts
        │
   ElectricSQL  /v1/shape  (new shapes, scoped by session_id, &secret=…)
        │
   NestJS  WorkyElectricConsumerService  (new ShapeStream subscriptions)
        │  map row → Mongo projection upsert + WorkyEvent
   SSE  GET /worky/streams/:id/events   (existing channel, new event types)
        │
   Frontend  subscribeToStreamEvents → Zustand store + React Query
        │  map MessageComponent[] → MessageContentPart[]
   AIMessageContent (SHARED renderer, unchanged) → ai-elements/* renderers
```

This mirrors the existing worky data flow exactly (frontend never touches Electric
directly; the Nest consumer mirrors rows to Mongo and re-broadcasts SSE). We are
adding three parallel shapes to the three that already exist (`messages`,
`plans`, `plan_steps`).

## Data model

### New Postgres tables (written by the manager, synced by Electric)

**`message_components`** — one row per component of a manager chat message.
Chat file attachments are `type='artifact'` rows here.

```
session_id    TEXT NOT NULL,
message_id    TEXT NOT NULL,   -- joins messages(id)
component_id  TEXT NOT NULL,
ordinal       INT  NOT NULL,   -- render order within the message
type          TEXT NOT NULL,   -- ComponentType: text|code|chart|artifact|citation|toolInfo|...
data          JSONB NOT NULL,  -- the conversation per-type payload (see below)
created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
PRIMARY KEY (session_id, component_id)
```

**`plan_step_components`** — one row per component of a step result.

```
session_id    TEXT NOT NULL,
step_id       TEXT NOT NULL,   -- joins plan_steps(session_id, step_id)
component_id  TEXT NOT NULL,
ordinal       INT  NOT NULL,
type          TEXT NOT NULL,
data          JSONB NOT NULL,
created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
PRIMARY KEY (session_id, component_id)
```

**`plan_step_artifacts`** — step file deliverables (verbatim from the request).

```
session_id    TEXT NOT NULL,
step_id       TEXT NOT NULL,   -- joins plan_steps(session_id, step_id)
artifact_id   TEXT NOT NULL,
file_path     TEXT NOT NULL,   -- the storage key, stored raw
filename      TEXT NOT NULL,
artifact_kind TEXT,            -- image | data | code | document, or NULL
mime_type     TEXT,
size          BIGINT,
created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
PRIMARY KEY (session_id, artifact_id)
```

> The manager owns the real DDL in its own Postgres (this repo does not own it).
> These definitions are the **contract** the manager must satisfy; we mirror them
> as TypeScript row interfaces in `worky-electric.contract.ts`.

### `data` payload = the conversation per-type model

`data` is exactly the conversation module's per-type payload, so the shared
renderer consumes it without translation. Representative examples:

- `text`     → `{ content: string }`
- `code`     → `{ content, language, filename }`
- `chart`    → `{ title, kind, data, config, series, ... }` (JSON-string fields, normalized as in conversation)
- `artifact` → `{ file_path, filename, mime_type }`
- `citation`, `toolInfo`, `chainOfThought`, `sources`, etc. — as defined in the
  conversation `Component` oneof / `MessageContentPart` union.

The `type` string is the discriminant end to end, identical to conversation.

### Backward-compatibility (critical)

- The existing `messages` shape **keeps** its plain-text `content`. A manager
  message has **both** a `content` string and component rows. The manager keeps
  writing a plain-text `content` summary so that:
  - **TTS read-aloud** (`ChatMessageThread.tsx`, uses `message.content`) keeps working,
  - notifications / previews keep working,
  - the **no-component fallback** renders text when no component rows exist.
- **Owner messages** and **voice-transcript messages** have no component rows →
  they render via the text fallback, unchanged.
- **Existing history** (messages/steps with only a `content`/`result` string)
  renders exactly as today.

## Backend — the Nest adapter

All additive, following the exact pattern in
`back/src/modules/worky/services/worky-electric-consumer.service.ts`.

1. **Contract** (`back/src/modules/worky/electric/worky-electric.contract.ts`):
   add `PgMessageComponentRow`, `PgPlanStepComponentRow`, `PgPlanStepArtifactRow`.

2. **Mapper** (`back/src/modules/worky/electric/worky-electric.mapper.ts`):
   add `mapMessageComponent`, `mapPlanStepComponent`, `mapPlanStepArtifact`, each
   returning `{ set, event }` like the existing mappers. `data` passes through as
   the component payload (JSON), preserving the `{type,data}` shape.

3. **Shape subscriptions** (`worky-electric-consumer.service.ts` `onModuleInit`):
   add `subscribe('message_components', …)`, `subscribe('plan_step_components', …)`,
   `subscribe('plan_step_artifacts', …)`, each with `replica:'full'` and its own
   `WorkyElectricCursor` (already keyed by `shape`). New handlers
   `handleMessageComponents`, `handlePlanStepComponents`, `handlePlanStepArtifacts`
   resolve `session_id → stream` via `streamService.findByAiSessionId`, upsert the
   projection, and `events.emit(...)`.

4. **Config** (`back/src/config/worky.config.ts`): add table-name env vars
   (`electricMessageComponentsTable`, `electricPlanStepComponentsTable`,
   `electricPlanStepArtifactsTable`) with sensible defaults.

5. **Mongo projections** (`back/src/modules/worky/schemas/`): three new schemas —
   `worky_message_components`, `worky_plan_step_components`,
   `worky_plan_step_artifacts` — keyed by `(streamId, externalId)` with parent
   external id (`messageExternalId` / `stepExternalId`) and `ordinal`.
   Separate collections (not an embedded `components[]` array) so the
   row-per-component upsert stays idempotent and matches the shape model.

6. **SSE events** (`worky-event.interface.ts`): extend the `WorkyEvent` union with
   `message.component.appended`, `task.component.appended`, `task.artifact.appended`
   (payload = parent external id + the mapped component/artifact).

7. **REST** (finalized): **messages** carry `components` **inline** in the existing
   `GET :id/messages` response (chat is always visible; components are integral).
   **Step results** use a **dedicated lazy endpoint** `GET /worky/tasks/:id/result-content`
   returning `{ components, artifacts }`, fetched only when the task drawer opens —
   this keeps the frequently-refetched board response lean. SSE events drive live
   invalidation of both.

8. **Artifact download:** artifacts carry `file_path` (storage key). Reuse the
   conversation module's existing `POST /conversations/artifact-url` resolution
   (frontend `getArtifactDownloadUrl(filePath, filename)` →
   `DocumentService.generateSasUrl`) — the existing `ArtifactPartRenderer` already
   calls it, so rendering step artifacts as `type='artifact'` parts gets
   download/preview for free.

## Frontend

1. **Reuse the mapper (cross-module import, no relocation):** worky imports the
   pure `mapComponentsToContentParts()` from `@/modules/conversation/utils` and the
   `MessageComponent` type from `@/modules/conversation/types` directly. Both are
   already pure (no React, no gRPC) and handle every component type worky needs
   (including `artifact`). `AIMessageContent` is **already** shared
   (worky's `TaskResultPanel` uses it today) and stays unchanged. This avoids a
   risky refactor of the stable conversation module — the reuse is identical, only
   the import direction differs. (If conversation→worky coupling ever needs
   breaking, the pure mapper can later be relocated to `components/ai-elements/`
   with re-exports; not required for this feature.)

2. **Types** (`front/src/modules/worky/types.ts`): `WorkyMessage` gains
   `components?: MessageComponent[]`; the board task type gains
   `components?: MessageComponent[]` and `artifacts?: WorkyArtifact[]`.

3. **Chat** (`front/src/modules/worky/components/ChatMessageThread.tsx` →
   `MessageBubble`): if `message.components?.length`, render
   `<AIMessageContent parts={mapComponentsToContentParts(message.components)} />`;
   otherwise the current `<p>{message.content}</p>`. Owner bubbles stay plain text.

4. **Store** (`front/src/modules/worky/store.ts`): add `upsertMessageComponent`
   (append/replace by `component_id`, sort by `ordinal`) and the equivalent for
   step components/artifacts. `appendMessage`'s id-dedupe stays.

5. **SSE hub** (`front/src/modules/worky/components/WorkyStreamPage.tsx`): route
   the three new event types to store updates / React-Query invalidation alongside
   the existing `switch`.

6. **Step results** (`front/src/modules/worky/components/TaskDetailDrawer.tsx` →
   `TaskResultPanel`, plus mobile `components/mobile/TaskDetailSheet.tsx`): render
   the step's `components` via `AIMessageContent`, plus an artifacts file-list from
   `plan_step_artifacts` (downloadable chips). Keep the current `result` string as
   the fallback when no components exist.

## Non-regression (explicit)

Untouched: realtime voice (Gemini Live) session, STT/dictation, TTS read-aloud,
kanban/graph/agent board, clarifications, mobile sheets, owner-message write path
(gRPC `RunTask` kickoff). The two render swaps (chat bubble, step result) are
additive and guarded by "has components?", so anything without component rows
renders exactly as today.

## Testing

- **Backend unit:** the three new mappers (row→`{set,event}`); consumer handling
  of the new shapes (mirror + emit + cursor persistence); unknown-session and
  control-message handling — mirroring existing `worky-electric` specs.
- **Frontend unit:** `MessageBubble` component-vs-text fallback; `TaskResultPanel`
  components + artifacts + fallback; store upsert/ordering by `ordinal`; SSE event
  routing in the hub.
- **Contract test:** a shared fixture asserting worky's `MessageComponent` shape
  stays byte-identical to the conversation `{type,data}` model, so the shared
  renderer never drifts.

## Out of scope

- Owner→manager file upload (composer/`PromptBar` changes, upload endpoint,
  storage write path). Separate later effort.
- Token-level streaming of manager prose in worky (chosen: components appear
  complete/progressively).
- Any change to the conversation module's own transport or renderer beyond the
  shared extraction of the mapper/type.

## Open items (resolved during planning)

- Exact artifact `file_path`→download endpoint/util to reuse from conversation.
- Components inline-in-REST vs dedicated endpoints (leaning inline + SSE deltas).
- Which component types the manager emits first (renderer already supports all;
  no frontend work needed per-type since the registry is complete).
- Whether existing worky data needs a migration (there is an untracked
  `back/scripts/migrate-postgres.ts` in flight — confirm interaction at plan time).
```
