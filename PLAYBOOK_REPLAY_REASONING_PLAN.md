# Playbook Replay Reasoning Implementation Plan

## Goal

Keep replay logic backend-owned, production-ready, and independent from frontend state or SSE availability.

Playbooks may execute from the UI, API calls, scheduled jobs, webhooks, or external systems. The same replay and artifact capture behavior must apply in all execution paths.

## Core Principles

- Backend persistence is the source of truth.
- Frontend displays persisted artifacts only.
- Frontend must not parse reasoning markers.
- SSE is a display optimization, not a correctness mechanism.
- Replay artifacts must stay independently controllable.
- Tool traces, output format, and reasoning chain must remain separate artifacts.
- Malformed reasoning JSON must not fail playbook execution.

## Immediate Artifact Model

Persist reasoning on task results as a first-class parent attribute:

```ts
FlowTaskResult {
  output: string;
  toolTrace: ToolTraceItem[];
  reasoningChain: PublicReasoningTraceItem[];
}
```

Reasoning chain item:

```ts
type PublicReasoningTraceItem = {
  id: string;
  type: string;
  label: string;
  description: string;
  confidence?: number | null;
};
```

The model output marker contract is:

```md
---PUBLIC_REASONING_TRACE_JSON---
[
  {
    "id": "step_1",
    "type": "observation",
    "label": "Identify requested indicators",
    "description": "Selected common macroeconomic metrics relevant to the user's request.",
    "confidence": 0.9
  }
]
```

The marker content represents public reasoning only. It must not expose private chain-of-thought or internal prompt traces.

## Dedicated Backend Files

Create or modify these backend files:

- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-reasoning.interface.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/observability/playbook-flow-public-reasoning-parser.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/observability/playbook-flow-public-reasoning-parser.service.spec.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/observability/playbook-flow-observability.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-observability.interface.ts`
- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-task-result.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-validated-replay.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-replay.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/playbook-flow.module.ts`

Add later, when replay prompt injection starts:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-replay-artifact.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-replay-prompt.service.ts`

## Phase 1: Add Public Reasoning Parser

Create `playbook-flow-public-reasoning-parser.service.ts`.

Responsibilities:

- Detect exact marker: `---PUBLIC_REASONING_TRACE_JSON---`
- Split raw model output into visible `output` and `reasoningChain`
- Parse JSON safely
- Validate each reasoning item
- Drop invalid entries with warning logs
- Return parse metadata
- Never throw through the execution path

Suggested parser return shape:

```ts
type ParsedPublicReasoning = {
  output: string;
  reasoningChain: PublicReasoningTraceItem[];
  markerFound: boolean;
  parseError?: string;
};
```

Parsing rules:

- No marker: return original output and `reasoningChain: []`.
- Valid marker: strip marker block from visible output and persist parsed items.
- Invalid JSON: preserve visible output before marker, persist empty chain, log warning.
- JSON root must be an array.
- Each item must be an object.
- Required fields: `id`, `type`, `label`, `description`.
- `confidence` is optional and must be a finite number between `0` and `1` when present.
- Cap item count and string lengths for production safety.
- Multiple tool calls before the marker must remain part of the visible output if they were already visible output.

Recommended production limits:

- Max JSON block size: `64 KB`
- Max reasoning items: `50`
- Max label length: `200` characters
- Max description length: `2000` characters

## Phase 2: Persist Reasoning On Task Results

Modify task result schema and execution persistence so the backend captures reasoning once at the observability boundary.

Execution flow:

```txt
NodeCompleted payload
→ extract output/display text
→ public reasoning parser strips marker and parses reasoningChain
→ persist cleaned output + reasoningChain + existing toolTrace
→ expose persisted artifacts through execution APIs
→ optionally stream artifacts over SSE for display
```

Important invariant:

```txt
Parsing and persistence must happen before any SSE/display logic.
```

This guarantees silent API, schedule, webhook, and external executions persist the same artifacts without a browser connected.

## Phase 3: Preserve Multiple Tool Calls Separately

Do not embed tool calls inside `reasoningChain`.

Keep tool traces as a separate artifact array:

```ts
type ToolTraceItem = {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: 'success' | 'failed';
  startedAt?: string;
  completedAt?: string;
};
```

Multiple tool calls remain naturally represented as:

```ts
toolTrace: [
  { id: 'tool_1', toolName: 'search', input: {}, output: {}, status: 'success' },
  { id: 'tool_2', toolName: 'calculator', input: {}, output: {}, status: 'success' },
]
```

Artifact boundaries:

- `toolTrace`: actual tool execution observations.
- `reasoningChain`: public reasoning structure generated by the model.
- `outputFormatGuide`: output structure constraints.

## Phase 4: Copy Reasoning Into Replay Baselines

Validated replay records should become self-contained artifact snapshots.

When validating a task replay, copy from the source task result:

```ts
FlowValidatedReplay {
  referenceOutput: string;
  toolTrace: ToolTraceItem[];
  reasoningChain: PublicReasoningTraceItem[];
  outputFormatGuide?: string | null;
  traceMetadata?: Record<string, unknown>;
}
```

This prevents replay baselines from depending on mutable or archived execution records.

Modify:

- `playbook-flow-validated-replay.schema.ts`
- `playbook-flow-replay.service.ts`
- `playbook-flow-replay.service.spec.ts`

Old records should default to `reasoningChain: []`. No migration is required for the first implementation if schema and response mapping provide defaults.

## Phase 5: Replay Artifact Resolution Later

After capture and persistence are stable, add backend replay artifact resolution.

Create `playbook-flow-replay-artifact.service.ts`.

Responsibilities:

- Resolve replay settings for a task.
- Load selected artifacts from validated replay/output format stores.
- Return a normalized replay context for execution.

Example output:

```ts
type ResolvedReplayArtifacts = {
  outputFormatGuide?: string | null;
  toolTrace?: ToolTraceItem[];
  reasoningChain?: PublicReasoningTraceItem[];
};
```

Create `playbook-flow-replay-prompt.service.ts` later.

Responsibilities:

- Convert resolved artifacts into prompt sections.
- Keep prompt injection deterministic and testable.
- Avoid growing `PlaybookFlowExecutionService` with artifact formatting logic.

Future replay toggles can then stay independent:

```ts
ReplayConfig {
  enabled: boolean;
  replayOutputFormat: boolean;
  replayToolTrace: boolean;
  replayReasoningChain: boolean;
}
```

## Frontend Scope

Frontend changes should be display-only.

Modify later:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`
- `YellowStorm/front/src/modules/playbook/locales/en.json`
- `YellowStorm/front/src/modules/playbook/locales/fr.json`

Frontend rules:

- Do not parse `---PUBLIC_REASONING_TRACE_JSON---`.
- Do not decide replay correctness.
- Do not rely on SSE for persistence.
- Display `reasoningChain` only when the backend API provides it.
- If marker text appears in UI output, treat it as a backend parsing bug.

## Testing Plan

### Parser Tests

Create `playbook-flow-public-reasoning-parser.service.spec.ts`.

Test cases:

- No marker returns original output and empty chain.
- Valid marker returns cleaned output and parsed chain.
- Invalid JSON does not throw.
- Non-array JSON does not throw.
- Invalid items are dropped and warned.
- Confidence outside `0..1` is rejected or normalized based on chosen rule.
- Oversized JSON block is ignored with parse metadata.
- Marker content is stripped from visible output.
- Multiple tool calls are unaffected because they remain in `toolTrace`.

### Execution Tests

Extend execution/observability tests.

Test cases:

- `NodeCompleted` persists cleaned output.
- `reasoningChain` is persisted on `FlowTaskResult`.
- Existing `toolTrace` remains unchanged.
- Parse failure does not fail task execution.
- Parse metadata is added to `traceMetadata`.

### Replay Tests

Extend `playbook-flow-replay.service.spec.ts`.

Test cases:

- Validated replay copies `reasoningChain` from task result.
- Missing old field defaults to `[]`.
- Replay trace responses include `reasoningChain`.
- Tool trace and output format behavior remain independent.

### Frontend Tests Later

Add or extend `ExecutionStepDetail` tests.

Test cases:

- Shows public reasoning section when `reasoningChain` exists.
- Hides or empty-states section when absent.
- Does not display raw marker text in output.
- Tool trace display still works independently.

## Rollout Order

1. Add backend reasoning interface.
2. Add parser service and parser tests.
3. Register parser in `PlaybookFlowModule`.
4. Integrate parser in observability/execution persistence.
5. Add `reasoningChain` to `FlowTaskResult` schema and API response mapping.
6. Copy `reasoningChain` into validated replay baselines.
7. Add backend tests for execution and replay persistence.
8. Add frontend type/display support.
9. Later add replay artifact resolver.
10. Later add replay prompt injection service and independent replay toggles.

## Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Private chain-of-thought leakage | Use public reasoning marker only; never derive from hidden prompt traces. |
| Invalid JSON breaks execution | Parser must never throw through execution; log and continue. |
| Marker appears in user output | Backend strips marker before persistence/display. |
| Frontend becomes authoritative | Frontend only displays backend-provided fields. |
| Output format and reasoning get coupled | Keep output format service separate from reasoning parser and replay service. |
| Old records lack reasoning chain | Default to `[]` in schema/mapping. |
| Multiple tool calls complicate replay | Keep `toolTrace` as independent array artifact. |

## Final Invariant

Replay and artifact capture must behave identically across all execution entry points:

```txt
UI run = API run = scheduled run = webhook run = external system run
```

No browser state, SSE event, or frontend parser should be required for capture, replay, or repeatability.
