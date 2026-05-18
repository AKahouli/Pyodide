# Playbook-Flow Observability And Replay Implementation Plan

## Goals

- Create a dedicated Observability subsystem for `playbook-flow` executions.
- Create Replay as a first-class Playbook feature across backend and ADK.
- Restore the traces tab data contract without solving it in the frontend only.
- Keep the implementation maintainable, explicit, and testable across boundaries.

## Non-Goals

- Do not redesign the whole Playbook UI first.
- Do not couple new work to the legacy `playbook` module beyond using it as a reference.
- Do not introduce third-party observability vendors in the first slice.
- Do not store unlimited raw prompts or tool payloads.

## Problem Summary

Current `playbook-flow` traces are missing for two reasons:

- The ADK `flow_engine` path does not record `tool_trace` or `llm_prompt_trace` during step execution.
- The NestJS `playbook-flow` backend does not normalize, persist, stream, or return those fields even if they were emitted.

Replay also exists only as a partial feature today. It is not yet designed as its own subsystem with clear contracts, persistence, and runtime behavior.

## Target Architecture

### Frontend

Keep frontend changes incremental and contract-driven.

- Continue rendering traces in `ExecutionStepDetail.tsx`.
- Keep replay controls in existing Playbook execution views for now.
- Treat the frontend as a consumer of stable backend contracts.
- Distinguish these states in the UI:
  - trace unavailable
  - trace empty
  - trace collection failed
  - historical execution without observability data

### Backend

Add two internal subsystems under `YellowStorm/back/src/modules/playbook-flow/`:

```text
playbook-flow/
  services/
    observability/
      playbook-flow-observability.service.ts
      playbook-flow-observability.mapper.ts
      playbook-flow-trace-redaction.service.ts
    replay/
      playbook-flow-replay.service.ts
      playbook-flow-replay-reference.service.ts
      playbook-flow-replay-execution.service.ts
      playbook-flow-replay-diff.service.ts
      playbook-flow-replay-format-guide.service.ts
  interfaces/
    playbook-flow-observability.interface.ts
    playbook-flow-replay.interface.ts
  dto/
    observability/
      playbook-flow-trace.dto.ts
    replay/
      validate-task-replay.dto.ts
      update-replay-format-guide.dto.ts
      re-execute-flow-replay.dto.ts
```

Boundary rule:

- `PlaybookFlowExecutionService` should keep execution orchestration only.
- `PlaybookFlowObservabilityService` should own trace extraction, normalization, redaction, persistence mapping, and response shaping.
- `PlaybookFlowReplay*Service` classes should own replay validation, activation, execution settings, provenance, staleness, and diffing.

### ADK / Flow Engine

Add explicit subsystems under `yellowstorm-adk/src/flow_engine/`:

```text
flow_engine/
  observability/
    trace_collector.py
    trace_types.py
    usage_extractor.py
    redaction.py
  replay/
    replay_context.py
    replay_policy.py
    replay_diff.py
    validated_replay.py
```

Boundary rule:

- `step.py` should coordinate trace recording, not contain all tracing logic inline.
- `step_tools.py` should report tool calls through an injected collector.
- `step_result.py` should remain focused on result shaping, not observability persistence concerns.

## Data Model Recommendations

### Flow Task Result

Extend `FlowTaskResult` to persist observability fields:

```ts
toolTrace?: Array<{
  callIndex: number;
  toolName: string;
  args: Record<string, unknown>;
  outputSummary?: string | null;
  status?: 'completed' | 'failed' | 'skipped';
  durationMs?: number | null;
  error?: string | null;
}>;

llmPromptTrace?: Array<{
  stage: string;
  model: string;
  prompt: string;
}>;

usage?: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  model?: string | null;
};

semanticMatch?: {
  matchScore?: number;
  semanticSimilarityScore?: number;
  evidenceConsistencyScore?: number;
  judgeScore?: number;
  reason?: string;
  missingPoints?: string[];
  changedPoints?: string[];
  model?: string;
  judgeUsed?: boolean;
};

traceMetadata?: Record<string, unknown>;
```

For frontend compatibility, the execution detail response should still flatten usage into:

- `inputTokens`
- `outputTokens`
- `totalTokens`
- `modelName`

### Validated Replay

Extend validated replay persistence with:

- `toolCalls`
- `llmPromptTrace`
- `referenceUsage`
- `referenceSemanticMatch`
- `traceMetadata`
- `referenceFlowRevision` or equivalent provenance
- `referenceNodeSnapshot`
- `staleness`

## API And Contract Recommendations

### Execution Detail

`GET /executions/:executionId` should return observability fields on every task result:

```json
{
  "taskId": "step-1",
  "iteration": 0,
  "status": "completed",
  "output": "...",
  "displayText": "...",
  "toolTrace": [],
  "llmPromptTrace": [],
  "inputTokens": 123,
  "outputTokens": 45,
  "totalTokens": 168,
  "modelName": "gpt-4o-mini",
  "semanticMatch": null,
  "traceMetadata": {}
}
```

### Stream Events

`playbook_step_complete` should include the same observability fields so the store can hydrate without a later refetch.

### Replay Endpoints

Keep existing routes where possible and complete the missing behavior behind them:

- `POST /playbooks/:id/tasks/:taskId/validate-replay`
- `GET /playbooks/:id/tasks/:taskId/replays`
- `POST /playbooks/:id/tasks/:taskId/replays/:replayId/activate`
- `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId/format-guide`
- `PATCH /playbooks/:id/tasks/:taskId/replays/:replayId`
- `DELETE /playbooks/:id/tasks/:taskId/replays/:replayId`
- `POST /executions/:executionId/trace-replay`
- `POST /executions/:executionId/re-execute`
- `GET /executions/:executionId/replay-diff?baselineExecutionId=...`

Recommended separation:

- `trace-replay`: deterministic reconstruction of the event timeline from stored execution data
- validated replay baseline: stored expected tool calls, prompts, output, and format guidance
- replay diff: compares baseline vs actual execution outcome

## gRPC / Proto Recommendations

Short term:

- Keep using `RunEvent.payload` for observability data to minimize churn.
- Explicitly document and test required payload keys:
  - `tool_trace`
  - `llm_prompt_trace`
  - `usage`
  - `semantic_match`
  - `trace_metadata`

For replay, expand `RunRequest` with typed replay settings in both proto copies:

- `YellowStorm/back/src/modules/playbook-flow/proto/playbook-flow.proto`
- `yellowstorm-adk/grpc/proto/playbook-flow.proto`

Suggested additions:

- `ReplaySettings`
- `ValidatedReplay`
- `ToolTraceItem`
- `LLMPromptTraceItem`

Important cross-boundary rule:

- Any nested struct fields must be wrapped correctly on the backend side when sent over gRPC.
- Add boundary tests for every new cross-process field.

## Phased Implementation

### Phase 0: Contract Audit

- Trace all readers and writers of task result payloads in frontend, backend, and ADK.
- Add a fixture for a `NodeCompleted` payload that includes observability fields.
- Decide which replay modes ship first.

Recommendation:

- Ship `live` and `replay_strict` first.

### Phase 1: Backend Observability Foundation

- Add observability interfaces.
- Extend `FlowTaskResult` schema.
- Create observability service, mapper, and redaction service.
- Update `PlaybookFlowExecutionService` to delegate `NodeCompleted` payload parsing.
- Update execution detail response mapping.
- Update stream event emission to include observability fields.

### Phase 2: ADK Observability Emission

- Create `flow_engine/observability` package.
- Add a `TraceCollector` abstraction.
- Record prompt traces before model calls.
- Record tool traces during tool execution.
- Extract usage when available.
- Include observability payload in `NodeCompleted`.

### Phase 3: Replay Backend Refactor

- Refactor replay into dedicated replay services.
- Capture validated replay baselines from successful executions.
- Store output, traces, usage, semantic match, and node reference snapshot.
- Add replay staleness detection.
- Add replay diff service.

### Phase 4: Replay Runtime Support In ADK

- Add replay settings to proto.
- Pass replay settings from backend to ADK.
- Parse replay settings in ADK `grpc_service.py`.
- Add replay context and replay policy packages.
- Implement strict replay first.
- Return replay provenance in node result payloads.

### Phase 5: Frontend Integration

- Align types with backend contracts.
- Ensure store hydrates traces consistently from stream and detail fetches.
- Update `ExecutionStepDetail.tsx` to show usage/model summary and better unavailable states.
- Update compare/replay views to use replay diff endpoint.
- Add i18n keys.

### Phase 6: Hardening

- Add truncation and redaction limits.
- Ensure observability failures do not fail execution.
- Warn loudly on dropped or invalid trace payloads.
- Revisit storage strategy if trace size becomes a problem.

## Testing Strategy

### Backend

Add Jest coverage for:

- observability mapper
- redaction service
- execution service persistence of trace fields
- execution detail response mapping
- replay baseline capture
- replay diff logic
- replay execution settings wiring

### ADK

Add pytest coverage for:

- trace collector
- redaction behavior
- `step.py` payload emission
- `step_tools.py` tool trace capture, including failures
- replay context and strict replay behavior
- gRPC boundary preservation of observability fields

### Frontend

Add Vitest coverage for:

- store hydration from stream and detail responses
- trace rendering states in `ExecutionStepDetail.tsx`
- replay diff rendering
- API response normalization

### Contract Tests

Add one focused boundary test for this full path:

```text
ADK NodeCompleted.payload
-> gRPC RunEvent.payload
-> NestJS unwrap/normalize
-> FlowTaskResult persistence
-> execution detail response
-> frontend TaskResult shape
```

This is the highest-value test because current failures are silent drops.

## Rollout Strategy

1. Store observability data first, with minimal UI dependency.
2. Stream observability fields through existing step-complete events.
3. Capture validated replay baselines with observability attached.
4. Add strict replay execution mode.
5. Add replay diff endpoint and UI.
6. Add flex/adaptive replay only if needed after strict replay stabilizes.

## Risks

- Trace fields may silently drop across the gRPC `Struct` boundary.
- Prompt traces may leak secrets if redaction is weak.
- Embedded trace storage may grow too large.
- Partial stream updates may overwrite complete trace state with empty arrays.
- Replay semantics may become ambiguous if strict mode is not clearly defined first.
- Proto drift between backend and ADK may break replay rollout.

## Open Questions

1. Should the first replay release support only `replay_strict`?
2. In strict replay, should the task short-circuit to the baseline result or execute under constraints?
3. How long should prompt traces be retained?
4. Should prompt/tool traces be visible to all execution readers or only elevated roles?
5. Is embedded trace storage acceptable for the first release?
6. Should ADK-reported usage be treated only as observability, while quota remains the backend source of truth?

## Recommended Sequence

1. Backend observability schema and services
2. ADK observability emission
3. Backend persistence and response mapping
4. Frontend validation of the traces tab
5. Replay baseline capture
6. Replay proto and runtime wiring
7. Strict replay execution
8. Replay diff endpoint and compare UI
9. Optional flex/adaptive replay modes

## Key Design Rules

- Execution orchestration stays in `PlaybookFlowExecutionService`.
- Observability ownership stays in `PlaybookFlowObservabilityService`.
- Replay ownership stays in dedicated replay services.
- ADK observability and replay packages own runtime logic on the Python side.
- The frontend should consume stable contracts, not infer replay behavior on its own.

## Notes On Maintainability

- Add comments only where they explain invariants, cross-boundary mapping rules, redaction decisions, or replay semantics.
- Keep mapper and normalization code out of monolithic services.
- Prefer additive contracts and explicit versioned behavior over hidden fallback logic.
- Treat trace drops as warnings with execution id, task id, and reason.
