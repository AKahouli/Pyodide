# Per-stream Planner/Executor prompts & models

**Date:** 2026-07-27
**Status:** Approved design — ready for implementation plan
**Scope:** `back/src/modules/worky`, `front/src/modules/worky`

## Summary

Give each worky stream four configurable, persisted settings — **planner model,
executor model, planner prompt, executor prompt** — edited from the frontend,
stored on the stream document, and sent to the worky orchestrator over gRPC
using the updated `companion_ai.proto`.

The proto already carries the new fields:

- `RunRequest.executor_model` (4, renamed from `model`), `planner_model` (8),
  `planner_prompt` (9), `executor_prompt` (10)
- `DeliverMailReplyRequest.executor_prompt` (6)

The TypeScript backend has **not** been updated to match, and no prompt fields
exist anywhere yet. The gRPC client still sends the removed `model` field, which
`proto-loader` silently drops — so executor-model selection over gRPC is
currently broken. This design closes that gap.

## Decisions

1. **New canonical fields.** Add brand-new `plannerModelId`, `executorModelId`,
   `plannerPrompt`, `executorPrompt`. The existing `managerModelId` /
   `workerModelId` fields stay in the schema untouched.
2. **UI lives in the Details tab.** Expand the existing `StreamModelsControl`
   card in `OrchestratorPanel`'s Details tab into an "Agent configuration"
   section holding the two model selectors + two prompt textareas.
3. **gRPC scope only.** The new fields feed the gRPC `RunRequest` and
   `DeliverMailReply` only. The separate HTTP planning-turn path (Path B) keeps
   reading `managerModelId` / `workerModelId` unchanged.

## Persistence semantics

Mirrors the existing model-override semantics:

- **Models** (`plannerModelId`, `executorModelId`): a LiteLLM model id, or
  `null` to clear the override (server falls back to the admin default).
- **Prompts** (`plannerPrompt`, `executorPrompt`): free text, or `null`/empty to
  use the server default prompt. Max length 20 000 chars.
- PATCH semantics: field omitted = unchanged; `null` = clear; string = set.

## Backend changes

### Schema — `schemas/worky-stream.schema.ts`
Add four `@Prop`s next to `managerModelId` / `workerModelId`:
- `plannerModelId?: string | null` — `{ type: String, default: null, trim: true, maxlength: 256 }`
- `executorModelId?: string | null` — same
- `plannerPrompt?: string | null` — `{ type: String, default: null, maxlength: 20000 }`
- `executorPrompt?: string | null` — same

### Interface — `interfaces/worky-stream.interface.ts`
Add the same four fields to `IWorkyStreamResponse`.

### DTO — `dto/update-worky-stream.dto.ts`
Add four optional, nullable fields following the existing `managerModelId`
pattern: models `@IsString`/`@MaxLength(256)`; prompts `@IsString`/`@MaxLength(20000)`.
Each `@IsOptional`, nullable (allow clearing).

### Service — `services/worky-stream.service.ts`
- `create()`: default the four to `null`.
- `update()`: add four branches mirroring the `managerModelId` branch (trim
  strings; empty → `null`; set + bump `lastActivityAt` only on real change).
- `toResponse()`: emit the four fields.
- `ensureKickoffContext()` (lines ~165-182): extend the lean projection to also
  return `plannerModelId`, `executorModelId`, `plannerPrompt`, `executorPrompt`.

### gRPC client — `services/worky-orchestrator.grpc-client.service.ts`
- `runTask` `opts` type gains `plannerModel?`, `executorModel?`, `plannerPrompt?`,
  `executorPrompt?`.
- Build the request with `planner_model`, `executor_model`, `planner_prompt`,
  `executor_prompt` (set each only when present/non-empty).
- **Remove the stale `request.model` assignment** (dead field after rename).
- `deliverMailReply` input + payload gain `executorPrompt` → `executor_prompt`.

### Read path — `controllers/worky-message.controller.ts`
- `sendMessage()` and `resumeTurn()`: read the stream's four new values (via the
  extended `ensureKickoffContext` / stream doc), resolve models through the
  existing model resolver, and pass `plannerModel/executorModel/plannerPrompt/
  executorPrompt` into `runTask`.

### Mail path
- `services/worky-mail-webhook.service.ts` and
  `services/worky-mail-catchup.service.ts`: read the wait's stream
  `executorPrompt` and pass it into `deliverMailReply`.

### Build — `back/package.json`
- Add `companion_ai.proto` to the `postbuild` proto-copy list so it ships to
  `dist/` (currently missing).

## Frontend changes

### Types — `front/src/modules/worky/types.ts`
Add to both `WorkyStream` and `UpdateWorkyStreamData`:
`plannerModelId?`, `executorModelId?`, `plannerPrompt?`, `executorPrompt?`
(each `string | null`). `api.updateStream` and `useUpdateStream` are generic —
no other API/hook changes.

### UI — `components/StreamModelsControl.tsx`
Expand into an "Agent configuration" card in the Details tab:
- Two `WorkyModelSelector`s bound to the **new** `plannerModelId` /
  `executorModelId` (labelled Planner / Executor).
- Two prompt `<textarea>`s for `plannerPrompt` / `executorPrompt`.
- Model change persists on select; prompt persists on textarea blur (only when
  the value actually changed), each via
  `updateStream.mutate({ streamId, data: { <field> } })`.
- **Remove the existing Manager / Workers selectors from this card** (their DB
  fields remain, still driving Path B) to avoid four confusing model dropdowns.

### i18n — `locales/en.json` + `locales/fr.json`
Add flat dot-namespaced keys, both files:
- `stream.settings.title`
- `stream.models.planner`, `stream.models.executor`
- `stream.prompts.planner`, `stream.prompts.executor`
- `stream.prompts.plannerPlaceholder`, `stream.prompts.executorPlaceholder`

## Testing

- **BE:** extend `worky-stream.service` spec for the four new update branches +
  `toResponse` mapping; add a gRPC-client mapping test asserting the request
  carries `planner_model/executor_model/planner_prompt/executor_prompt` and no
  longer sends `model`.
- **FE:** extend/add a `StreamModelsControl` test covering render of the two
  selectors + two textareas and that edits call `updateStream` with the right
  field.

## Out of scope

- Repointing the HTTP planning-turn path (Path B) to the new fields.
- Per-turn prompt/model overrides (per-turn model selection was already removed
  from the PromptBar).
- Admin-level default prompt management.

## Open risks

- **Naming coexistence:** stream docs now carry both manager/worker and
  planner/executor model fields. Acceptable per the "gRPC only" decision;
  documented so a future cleanup can retire manager/worker if Path B migrates.
