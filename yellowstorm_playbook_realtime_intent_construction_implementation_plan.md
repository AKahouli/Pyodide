# Playbook Realtime Intent Construction Implementation Plan

## Goal

Make playbook construction through intent suggestion inference appear incrementally in the frontend, node by node, while reusing the existing backend intent normalization logic and the existing frontend suggestion application logic.

This must work for:

- Updating an existing playbook.
- Building a new playbook from scratch after a draft playbook exists.

## Current Implementation Summary

The current intent flow is blocking:

1. `PlaybookCanvasPage.tsx` calls `usePlaybookIntentFlow()`.
2. `usePlaybookIntentFlow()` calls `requestPlaybookIntent()`.
3. `requestPlaybookIntent()` posts to `POST /playbooks/:id/intent`.
4. `PlaybookFlowIntentService.analyze()` builds the context, calls LiteLLM once, receives full JSON, normalizes all suggestions, and returns them together.
5. The frontend applies the top suggestion through `handleApplyIntentSuggestion()` when auto-apply is enabled.

Important existing logic to preserve:

- Backend normalization in `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`.
- Frontend graph application in `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx` inside `handleApplyIntentSuggestion()`.
- Deterministic IDs from `createIntentSuggestionApplicationKey()`, `createIntentSuggestionNodeId()`, and `createIntentSuggestionBindingId()`.
- Existing save conflict protection through `expectedDefinitionRevision`.
- Existing blocking endpoint `POST /playbooks/:id/intent` for manual suggestion mode, fallback, and tests.

## Recommended Design

Use a backend construction job plus browser-facing NDJSON streaming.

```text
Frontend
  POST /playbooks/:id/intent-constructions
    starts construction and returns constructionId

Frontend
  GET /playbooks/:id/intent-constructions/:constructionId/stream?after=0
    receives ordered NDJSON events

Backend
  reuses PlaybookFlowIntentService context, normalization, and validation helpers
  emits normalized PlaybookIntentSuggestion deltas

Frontend
  applies each emitted suggestion using handleApplyIntentSuggestion(..., { save: false })
  saves once when the construction completes
```

Do not stream raw LLM tokens to the browser. Stream only normalized, validated graph deltas shaped as existing `PlaybookIntentSuggestion` objects.

## Backend Plan

### 1. Extract Reusable Intent Context

File: `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`

Extract the setup currently inside `analyze()` into a reusable method, for example:

```ts
async buildIntentAnalysisContext(
  flowId: string,
  ownerId: string,
  dto: RequestPlaybookFlowIntentDto,
): Promise<PlaybookIntentAnalysisContext>
```

The context should include:

- LiteLLM HTTP client.
- Flow.
- Selected node validation/result.
- Effective design settings.
- Inference model.
- Prompt template inputs.
- Rendered system and user prompts.
- Validation context.
- Intent normalization limits.

Keep `analyze()` behavior unchanged by making it call the extracted context builder and then perform the same one-shot LiteLLM request.

### 2. Expose Normalization for Construction

The construction service must not duplicate `normalizeSuggestions()`, workflow change validation, task draft normalization, or port normalization.

Add a narrow method on `PlaybookFlowIntentService`, for example:

```ts
normalizeConstructionSuggestions(args: {
  raw: string;
  dto: RequestPlaybookFlowIntentDto;
  selectedNodeId: string | null;
  limits: IntentNormalizationLimits;
  validationContext: IntentWorkflowValidationContext;
  includeFallback: boolean;
}): PlaybookIntentSuggestion[]
```

Use `includeFallback: false` for streamed events. A fallback suggestion should not be emitted as a realtime graph delta unless inference fully fails before any graph mutation and the frontend chooses to use the blocking fallback path.

### 3. Add Construction Event Types

Add backend interfaces in a cohesive file, for example:

`YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-construction.interface.ts`

Core event contract:

```ts
type PlaybookIntentConstructionEvent =
  | { type: 'started'; constructionId: string; playbookId: string; sequence: number; createdAt: string; model: string; baseDefinitionRevision: number }
  | { type: 'progress'; constructionId: string; playbookId: string; sequence: number; createdAt: string; phase: 'planning' | 'generating_node' | 'generating_edges' | 'generating_bindings' | 'completed'; message: string; current?: number; total?: number }
  | { type: 'node_delta'; constructionId: string; playbookId: string; sequence: number; createdAt: string; suggestion: PlaybookIntentSuggestion; nodeRef?: string; nodeIndex?: number; totalNodes?: number }
  | { type: 'edge_delta'; constructionId: string; playbookId: string; sequence: number; createdAt: string; suggestion: PlaybookIntentSuggestion }
  | { type: 'data_binding_delta'; constructionId: string; playbookId: string; sequence: number; createdAt: string; suggestion: PlaybookIntentSuggestion }
  | { type: 'completed'; constructionId: string; playbookId: string; sequence: number; createdAt: string; model: string; finalSuggestionCount: number }
  | { type: 'failed'; constructionId: string; playbookId: string; sequence: number; createdAt: string; message: string; recoverable: boolean }
  | { type: 'cancelled'; constructionId: string; playbookId: string; sequence: number; createdAt: string; reason?: string };
```

Prefer `baseDefinitionRevision` over `basePlaybookUpdatedAt` because the current frontend and backend already use `expectedDefinitionRevision` for intent suggestion conflict checks.

### 4. Add Construction Service

Create:

`YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts`

Responsibilities:

- Start a construction job.
- Store ordered events in memory for the first implementation.
- Stream events through an async generator.
- Support cancellation with `AbortController`.
- Run staged inference.
- Emit only normalized, valid `PlaybookIntentSuggestion` deltas.

In-memory job shape:

```ts
interface PlaybookIntentConstructionJob {
  id: string;
  flowId: string;
  ownerId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  baseDefinitionRevision: number;
  events: PlaybookIntentConstructionEvent[];
  abortController: AbortController;
  waiters: Set<() => void>;
}
```

Rules:

- `sequence` is strictly increasing per construction.
- Every event is appended before any stream consumer receives it.
- `stream(..., afterSequence)` first replays stored events with a higher sequence, then waits for new events.
- `constructionId + sequence` is the frontend idempotency key.
- Validate `ownerId` and `flowId` for every start, stream, and cancel call.

### 5. Staged Inference Strategy

Avoid partial JSON parsing. Use staged calls so each emitted event is complete and deterministic.

Stage A: planning

- Ask the model for a compact construction plan containing node refs, titles, purposes, and likely edge refs.
- Emit a `progress` event for planning.
- Do not mutate the frontend yet.

Stage B: node generation

- For each planned node, ask the model to produce one complete node suggestion.
- Normalize through `PlaybookFlowIntentService`.
- Emit one `node_delta` event per accepted node.
- Each `node_delta` should be a `workflow_plan` with one `create_node` change where possible.

Stage C: edge generation

- After all node deltas have been emitted, ask the model for edges between already emitted node refs.
- Normalize and validate.
- Emit an `edge_delta` event.

Stage D: data binding generation

- After nodes and edges exist, ask the model for data bindings between existing ports.
- Normalize and validate.
- Emit a `data_binding_delta` event.

Stage E: completion

- Emit `completed` only after all accepted graph deltas were emitted.

### 6. Reference Validation During Streaming

Current validation can validate existing task IDs and node refs inside a single workflow plan. Streaming needs an evolving reference map.

The construction service should maintain:

- Existing task IDs from the base flow.
- Emitted node refs from previous `node_delta` events.
- Rejected node refs, with warning logs explaining why they were dropped.

Do not emit an edge or data binding unless its references can be resolved by the frontend at that point. The preferred event order is:

1. Node deltas.
2. Edge deltas.
3. Data binding deltas.

### 7. Add Controller Routes

File: `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts`

Add routes near the existing intent route:

```http
POST /playbooks/:id/intent-constructions
GET /playbooks/:id/intent-constructions/:constructionId/stream?after=0
POST /playbooks/:id/intent-constructions/:constructionId/cancel
```

Use permissions:

- Start: `PLAYBOOK_UPDATE`.
- Stream: `PLAYBOOK_READ`.
- Cancel: `PLAYBOOK_UPDATE`.

Use NDJSON response headers for the stream:

```text
Content-Type: application/x-ndjson; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

Keep `POST /playbooks/:id/intent` unchanged.

### 8. Register Service

File: `YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts`

Register `PlaybookFlowIntentConstructionService` as a provider.

## Frontend Plan

### 1. Add Types

File: `YellowStorm/front/src/modules/playbook/types.ts`

Add construction response and event types matching the backend contract.

Use `baseDefinitionRevision`, not `basePlaybookUpdatedAt`, because `handleApplyIntentSuggestion()` currently accepts `expectedDefinitionRevision`.

### 2. Add Endpoints

File: `YellowStorm/front/src/lib/api/config.ts`

Add under `API_ENDPOINTS.playbooks`:

```ts
intentConstructions: (id: string) => `/playbooks/${id}/intent-constructions`,
intentConstructionStream: (id: string, constructionId: string) => `/playbooks/${id}/intent-constructions/${constructionId}/stream`,
cancelIntentConstruction: (id: string, constructionId: string) => `/playbooks/${id}/intent-constructions/${constructionId}/cancel`,
```

### 3. Add API Helpers

File: `YellowStorm/front/src/modules/playbook/api.ts`

Add:

- `startPlaybookIntentConstruction(playbookId, data)`.
- `streamPlaybookIntentConstruction(playbookId, constructionId, options)`.
- `cancelPlaybookIntentConstruction(playbookId, constructionId)`.

The stream helper should follow the existing `fetch(...).body.getReader()` style used by streaming prompt rewrite code. It must parse NDJSON safely across split chunks and support `AbortSignal`.

### 4. Refactor `handleApplyIntentSuggestion()` Options

File: `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`

Current behavior applies the graph and saves immediately. Add options while preserving defaults:

```ts
type ApplyIntentSuggestionOptions = {
  replaceAll?: boolean;
  expectedDefinitionRevision?: number;
  save?: boolean;
  clearSuggestions?: boolean;
  focus?: boolean;
};
```

Defaults:

- `save: true`.
- `clearSuggestions: true`.
- `focus: true`.

Streaming calls should use:

```ts
handleApplyIntentSuggestion(event.suggestion, {
  expectedDefinitionRevision: baseDefinitionRevision,
  save: false,
  clearSuggestions: false,
  focus: true,
});
```

This preserves existing graph-building logic while preventing one save per node.

### 5. Add Construction Flow Hook Logic

File: `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts`

Extend dependencies with construction helpers and an apply mode. Keep existing blocking `runIntentAnalysis()` path.

Recommended behavior:

- If `intentAutoApply` is enabled, use realtime construction.
- If `intentAutoApply` is disabled, keep the existing suggestion list behavior.
- If streaming fails before any graph delta is applied, fall back to the existing blocking intent flow.
- If streaming fails after at least one graph delta is applied, show an error and keep the partial graph dirty instead of silently reverting.

The hook should track:

- `constructionId`.
- `baseDefinitionRevision`.
- Last received sequence.
- Applied event keys.
- Abort controller.
- Whether any graph delta was applied.

### 6. Add Page State and Cancel Handler

File: `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`

Add state for:

- Construction status: `idle | starting | streaming | completed | failed | cancelled`.
- Progress message.
- Current sequence.
- Construction ID.

Add a cancel handler that:

- Aborts the fetch stream.
- Calls backend cancel endpoint if a construction ID exists.
- Leaves already-applied graph changes as local unsaved changes.
- Clears loading state.

### 7. Add Intent Bar UX

File: `YellowStorm/front/src/modules/playbook/components/PlaybookIntentBar.tsx`

Add props:

```ts
constructionStatus?: 'idle' | 'starting' | 'streaming' | 'completed' | 'failed' | 'cancelled';
constructionProgress?: string;
onCancelConstruction?: () => void;
```

Show progress while starting or streaming. Show a cancel action while a construction is active.

Add localization keys instead of hardcoded user-facing strings.

### 8. New Playbook From Scratch

The same construction endpoint requires a playbook ID, so building from scratch should create or load a draft playbook first, then run the same realtime construction flow.

Existing frontend behavior already supports an `intent` query parameter through `autoIntentRef`. Preserve that flow:

1. Create a blank/draft playbook or navigate to an existing empty playbook.
2. Set `?intent=...` or `intentValue`.
3. Once `playbook` is loaded, `handleSubmitIntent()` runs.
4. Realtime construction streams node deltas into the empty canvas.

Do not add a separate scratch-builder graph application path. An empty existing playbook and a newly created draft playbook must both use the same `handleApplyIntentSuggestion()` path.

## Idempotency and Save Rules

- Backend event idempotency key: `${constructionId}:${sequence}`.
- Frontend should ignore duplicate event keys.
- Suggestion IDs should be deterministic per event so retries do not create duplicate nodes.
- Apply streamed deltas with `save: false`.
- Save once after `completed` using `expectedDefinitionRevision: baseDefinitionRevision` and `clientMutationId: intent-construction-${constructionId}`.
- If the final save conflicts, keep the local graph dirty and show the existing conflict/error message.

## Failure Handling

Before first graph delta:

- Show error or fallback to existing `requestPlaybookIntent()` flow.

After at least one graph delta:

- Do not fallback automatically, because fallback may duplicate or conflict with partial streamed changes.
- Keep local partial construction.
- Show a recoverable error.
- Let the user save, undo, retry from current graph, or reload.

Stream disconnect:

- Reconnect with `after=lastSequence` when practical.
- Ignore duplicate event keys.
- If replay is not available because the in-memory job was lost, treat as recoverable failure.

Cancellation:

- Abort stream.
- Notify backend.
- Keep already-applied graph changes unsaved.

## Testing Plan

Backend tests:

- Construction start returns quickly with `constructionId` and `baseDefinitionRevision`.
- Stream emits ordered sequence numbers.
- Stream replays only events after `after`.
- Each node is emitted as a separate `node_delta`.
- Edge events are emitted only after node events.
- Invalid deltas are not emitted and are logged.
- Cancel emits `cancelled`.
- Model failure emits `failed`.
- Existing `POST /playbooks/:id/intent` tests still pass.

Frontend tests:

- NDJSON stream parser handles split chunks and final line without newline.
- Auto-apply uses construction stream.
- Manual mode still uses blocking `requestPlaybookIntent()`.
- Each `node_delta` calls `handleApplyIntentSuggestion()` with `save: false`.
- Duplicate event sequences are ignored.
- Completion saves once.
- Failure before mutation falls back or shows error.
- Failure after mutation keeps partial graph.
- Cancel aborts and clears loading state.

Browser QA scenario:

1. Open an empty playbook.
2. Enable auto-apply.
3. Enter an intent such as `build a three-step invoice validation workflow`.
4. Confirm first node appears before final completion.
5. Confirm subsequent nodes appear incrementally.
6. Confirm edges/data bindings appear after nodes.
7. Confirm one final save happens after completion.
8. Reload and confirm the graph persists.

## Rollout Plan

1. Add backend construction service and stream endpoints behind no frontend usage.
2. Add frontend types and API helpers.
3. Refactor `handleApplyIntentSuggestion()` to support `save: false` while keeping default behavior unchanged.
4. Enable streaming only for auto-apply intent submissions.
5. Keep manual suggestion mode on the blocking endpoint.
6. Add progress and cancellation UI.
7. Add reconnect/replay support using `after=sequence`.
8. Consider durable event storage only if multi-instance replay or auditability is required.

## Files To Modify

Backend:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-intent-construction.interface.ts`
- `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow.controller.ts`
- `YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts`

Frontend:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/front/src/lib/api/config.ts`
- `YellowStorm/front/src/modules/playbook/api.ts`
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookIntentBar.tsx`
- Relevant localization files under `YellowStorm/front/src/modules/localization/`

Tests:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent-construction.service.spec.ts`
- Existing intent service/controller specs as needed.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.test.tsx`
- `YellowStorm/front/src/modules/playbook/api.test.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookIntentBar.test.tsx`

## Acceptance Criteria

- Nodes appear incrementally during intent construction, not only after inference completes.
- The same behavior works for empty new draft playbooks and existing playbooks.
- Existing backend intent normalization/validation remains the source of truth.
- Existing frontend suggestion application remains the only graph mutation path for streamed deltas.
- Manual suggestion mode still works through the blocking endpoint.
- Auto-apply construction saves once after completion.
- Duplicate stream events do not duplicate nodes, edges, or data bindings.
- Cancellation stops construction without corrupting the canvas.
- Failures before mutation can fall back; failures after mutation preserve the partial local graph.
