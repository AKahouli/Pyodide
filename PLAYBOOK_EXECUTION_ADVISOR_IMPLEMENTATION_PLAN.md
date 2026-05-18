# Playbook Execution Advisor Implementation Plan

## Goals

- Make Advisor a first-class Playbook execution feature, not only a frontend tab or design-time helper.
- Add a dedicated backend service under `playbook-flow` for execution advisor orchestration, persistence, and UI event emission.
- Add a dedicated ADK flow-engine advisor service for judging, scoring, remediation planning, and optimized playbook generation.
- Keep browser updates on the existing SSE + SharedWorker path while using gRPC for NestJS to ADK communication.
- Ensure the Advisor tab works for both live executions and historical executions loaded from the API.

## Non-Goals

- Do not replace browser SSE with gRPC-web.
- Do not merge design-time node advising and execution-time judging into one ambiguous service.
- Do not rewrite the full playbook execution engine before delivering the first execution advisor slice.
- Do not make the frontend infer advisor state from raw traces or output text.
- Do not introduce new third-party runtime infrastructure unless existing NestJS, gRPC, SSE, and ADK patterns cannot support the slice.

## Problem Summary

The current Advisor tab in the Playbook execution pane exposes several ownership gaps:

- The tab is implemented as the `judge` tab in `ExecutionStepDetail.tsx`, but it only renders useful data when judge/advisor fields exist on the selected execution task result.
- Live execution can receive advisor data through SSE handlers, but historical execution loading can lose advisor fields during frontend normalization.
- `ExecutionPanel.tsx` does not currently wire an advisor evaluation callback into `ExecutionStepDetail`, so the tab cannot reliably trigger an ad-hoc advisor run.
- Backend advisor code currently includes design-time node advising under `playbook-flow-advisor.service.ts`; execution-time judging deserves a separate service boundary.
- ADK flow-engine advisor responsibilities are not isolated as their own execution-quality service.

Advisor should be treated as an execution subsystem spanning frontend commands, backend orchestration, persisted execution state, backend-to-ADK gRPC, ADK scoring logic, and frontend SSE updates.

## Target Architecture

```text
Frontend browser
  -> REST command: run advisor for execution task
  <- SSE events: advisor progress, result, summary, autopilot updates

NestJS playbook-flow backend
  -> validates permissions and execution state
  -> persists advisor status/results/history
  -> emits existing/new playbook execution SSE events
  -> calls ADK over gRPC

ADK flow-engine advisor service
  -> evaluates task execution quality
  -> scores output, expected match, tool usage, and format compliance
  -> returns issues, evidence, remediation suggestions, and optimized proposals
```

Protocol boundaries:

- Frontend commands stay REST.
- Frontend live updates stay SSE through the existing SharedWorker path.
- Backend to ADK calls use gRPC.
- Long-running ADK evaluation can use server-side gRPC streaming to NestJS, with NestJS translating internal progress into browser SSE events.

## Service Boundaries

### Frontend

The frontend is a consumer of advisor state and should not own judging logic.

Responsibilities:

- Render `TaskResult.judgeResult`, `TaskResult.judgeHistory`, `TaskResult.judgeStatus`, `PlaybookExecution.judgeSummary`, and advisor autopilot state.
- Trigger advisor evaluation through a typed API wrapper.
- Preserve advisor fields when normalizing execution API responses.
- Update live state from SSE events.
- Distinguish these states in the Advisor tab:
  - advisor never run
  - advisor evaluating
  - advisor evaluated
  - advisor failed
  - historical execution missing advisor data

Suggested files:

```text
YellowStorm/front/src/modules/playbook/api.ts
YellowStorm/front/src/modules/playbook/store.ts
YellowStorm/front/src/modules/playbook/types.ts
YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx
YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx
YellowStorm/front/src/modules/playbook/components/AdvisorResultPanel.tsx
```

### Backend

Add an execution-specific advisor subsystem under `playbook-flow`.

Suggested structure:

```text
YellowStorm/back/src/modules/playbook-flow/
  controllers/
    playbook-flow-execution-advisor.controller.ts
  dto/
    advisor/
      run-execution-advisor.dto.ts
      advisor-remediation.dto.ts
  interfaces/
    playbook-flow-execution-advisor.interface.ts
  services/
    advisor/
      playbook-flow-execution-advisor.service.ts
      playbook-flow-execution-advisor.mapper.ts
      playbook-flow-advisor-persistence.service.ts
      playbook-flow-advisor-summary.service.ts
```

Responsibilities:

- Validate user access to the playbook execution and target task.
- Load the execution, playbook snapshot, task result, traces, output, expected output, replay metadata, and output-format contract.
- Build the ADK advisor gRPC request.
- Call the ADK flow-engine advisor service.
- Persist task-level advisor state and execution-level advisor summary.
- Append judge history for repeat evaluations.
- Emit SSE events consumed by existing frontend handlers.
- Return normalized advisor state to the REST caller.

Boundary rules:

- `PlaybookFlowExecutionService` should continue to own execution orchestration.
- `PlaybookFlowExecutionAdvisorService` should own execution advisor lifecycle, status transitions, gRPC calls, persistence, and event emission.
- Existing `PlaybookFlowAdvisorService` should remain design-time node advising unless explicitly renamed/split later.
- Controllers should not write repositories directly; use the advisor service.

### ADK Flow Engine

Add a dedicated advisor package under the flow engine.

Suggested structure:

```text
yellowstorm-adk/src/flow_engine/
  advisor/
    execution_advisor_service.py
    execution_advisor_models.py
    remediation_planner.py
    score_aggregator.py
    evidence_extractor.py
```

Responsibilities:

- Evaluate one executed task from structured runtime context.
- Compare actual output against expected output and output-format requirements.
- Evaluate tool usage and trace behavior.
- Produce score components and overall score.
- Produce issue list with category, severity, message, and evidence.
- Produce remediation suggestions.
- Produce optimized task/playbook proposal when requested.
- Return structured contract data without Mongo, NestJS, or frontend concerns.

## Contract Design

### REST Endpoints

Start with one narrow vertical slice, then expand.

```text
POST /playbook-flows/executions/:executionId/tasks/:taskId/advisor-evaluation
GET  /playbook-flows/executions/:executionId/tasks/:taskId/advisor-evaluation
POST /playbook-flows/executions/:executionId/tasks/:taskId/advisor-remediations
POST /playbook-flows/executions/:executionId/advisor-summary
```

Initial endpoint scope:

- `POST advisor-evaluation` runs advisor for one completed task result.
- It returns the updated task advisor state and, if recomputed, the execution summary.
- It emits the same SSE event shape used by live execution advisor updates.

### Backend To ADK gRPC

Add a flow-engine advisor service to the backend and ADK proto mirrors.

Example shape:

```proto
service FlowExecutionAdvisorService {
  rpc EvaluateTask(TaskAdvisorRequest) returns (TaskAdvisorResult);
  rpc StreamEvaluateTask(TaskAdvisorRequest) returns (stream TaskAdvisorEvent);
  rpc GenerateRemediation(RemediationRequest) returns (RemediationResult);
}
```

Use unary `EvaluateTask` for the first slice unless runtime latency requires progress streaming. Add `StreamEvaluateTask` when the UX needs multi-stage progress.

If any field uses `google.protobuf.Struct`, NestJS must wrap plain JavaScript objects with `toGrpcStruct()` before sending them. Do not pass plain objects directly to Struct-typed fields.

### Advisor Result Shape

Use one explicit typed result across ADK, backend persistence, API responses, SSE events, and frontend rendering.

```ts
type ExecutionAdvisorResult = {
  taskId: string;
  status: 'evaluated' | 'failed';
  overallScore: number;
  confidence: number;
  recommendation: 'keep' | 'review' | 'optimize' | 'rerun';
  reason: string;
  scores: {
    outputQuality: number;
    expectedMatch: number;
    toolUsage: number;
    formatCompliance: number;
  };
  issues: Array<{
    severity: 'low' | 'medium' | 'high';
    category: 'prompt' | 'tool' | 'input' | 'output_format' | 'reasoning';
    message: string;
    evidence?: string;
  }>;
  rewriteHints: string[];
  remediations: Array<{
    target: 'task_prompt' | 'output_format' | 'tool_binding' | 'playbook_edge';
    title: string;
    description: string;
    proposedPatch?: unknown;
  }>;
};
```

Keep field names consistent across boundaries. If gRPC uses snake_case, backend mappers must convert explicitly to frontend camelCase.

## Persistence Model

Persist advisor data additively on existing execution records.

Task result fields:

```text
judgeStatus
judgeResult
judgeError
judgeHistory
advisorStopReason
advisorOptimizationHistory
```

Execution fields:

```text
judgeSummaryStatus
judgeSummary
advisorAutopilotEnabled
advisorAutopilotTargetScore
advisorAutopilotMaxTurns
advisorAutopilotStatus
advisorAutopilotTaskId
advisorAutopilotAttemptCount
advisorAutopilotLastError
```

Rules:

- Advisor results must survive reloads and historical execution viewing.
- Re-running advisor should append to `judgeHistory` and update the current `judgeResult`.
- Failed advisor runs should persist `judgeStatus = 'failed'` and a useful error message.
- Do not drop advisor fields during backend response shaping or frontend normalization.

## SSE Event Model

Keep browser-facing streaming on SSE.

Use or extend these events:

```text
step_judge_started
step_judge_updated
judge_summary_updated
advisor_autopilot_updated
advisor_remediation_updated
```

Rules:

- Emit `step_judge_started` before calling ADK for ad-hoc advisor runs.
- Emit `step_judge_updated` after persistence succeeds.
- Emit failure events loudly with task id and sanitized error text.
- Avoid frontend-only optimistic success for advisor results.
- Preserve multi-tab behavior through the existing SharedWorker SSE architecture.

## Implementation Phases

### Phase 1: Stabilize Current Advisor Tab

Purpose: make the current UI truthful and durable before broader extraction.

Tasks:

- Preserve task-level advisor fields in `normalizeTaskResult()`.
- Preserve execution-level advisor fields in `normalizeExecution()`.
- Wire `ExecutionPanel.tsx` to pass `onRequestRunAdvisorEvaluation` into `ExecutionStepDetail.tsx`.
- Add or expose a store action for running advisor evaluation for one selected execution task.
- Ensure the Advisor tab renders a visible empty state, evaluating state, failed state, and evaluated state.
- Add frontend tests for historical execution advisor data and the run advisor CTA.

Verification:

- Vitest coverage for `api.ts` normalization.
- Vitest coverage for `ExecutionPanel` passing the advisor callback.
- Manual browser check that a historical execution with persisted advisor data renders the Advisor tab.

### Phase 2: Backend Execution Advisor Service

Purpose: move execution advisor ownership into a dedicated backend service.

Tasks:

- Add `PlaybookFlowExecutionAdvisorService` under `playbook-flow/services/advisor/`.
- Add `PlaybookFlowExecutionAdvisorController` with one task-level run endpoint.
- Add DTOs and interfaces for advisor requests/responses.
- Move status transition and persistence logic into the advisor service.
- Emit advisor SSE events from the advisor service after persistence.
- Add unit tests for success, ADK failure, missing execution, missing task, and repeated run history append.

Verification:

- Jest tests for controller/service.
- API call manually starts advisor for one task and updates persisted execution data.
- Reloading the execution returns advisor fields from the API.

### Phase 3: ADK Flow-Engine Advisor Service

Purpose: isolate judging/scoring/remediation logic in ADK.

Tasks:

- Add `flow_engine/advisor` package.
- Define typed Python models for request, result, issues, scores, and remediation suggestions.
- Implement `ExecutionAdvisorService.evaluate_task()`.
- Implement score aggregation and evidence extraction.
- Implement remediation planner for prompt and output-format changes first.
- Add gRPC service method and wire it into the ADK gRPC server.
- Mirror proto changes in backend and ADK.

Verification:

- Pytest coverage for scoring, issue categories, missing expected output, malformed output, and tool-trace evidence.
- Backend gRPC mapper tests confirm Struct fields arrive correctly.
- One end-to-end run from NestJS to ADK returns persisted advisor data.

### Phase 4: Advisor Summary And Autopilot

Purpose: support execution-level guidance and iterative optimization.

Tasks:

- Add execution summary recomputation after task advisor results change.
- Add summary endpoint if manual refresh is needed.
- Formalize autopilot state transitions: `idle`, `running`, `judging`, `optimizing`, `rerunning`, `completed`, `stopped`, `failed`.
- Persist autopilot attempt count, target score, max turns, current task id, and last error.
- Emit `advisor_autopilot_updated` for every state transition.
- Prevent unbounded loops by enforcing max turns and terminal states.

Verification:

- Backend tests for summary aggregation and autopilot state transitions.
- ADK tests for optimization proposal generation.
- Browser check that Advisor tab updates during autopilot without reload.

### Phase 5: Remediation Review And Apply

Purpose: convert advisor suggestions into controlled playbook edits.

Tasks:

- Normalize remediation suggestions into patch-like backend-owned operations.
- Add preview endpoint for selected remediation items.
- Add apply endpoint that updates the playbook through existing playbook-flow design/update services.
- Keep user review mandatory before applying changes to the current playbook.
- Persist applied remediation metadata for auditability.

Verification:

- Backend tests for safe patch generation and invalid target rejection.
- Frontend tests for review dialog selection and apply behavior.
- Manual check that applying remediation updates the playbook without corrupting control edges or data bindings.

## Cross-Boundary Invariants

- Frontend never fabricates advisor scores.
- Backend is the source of truth for persisted advisor status and result state.
- ADK returns structured advisor output and does not mutate database state.
- REST command responses, SSE events, Mongo persistence, and gRPC result mapping must use the same logical field names.
- Any dropped issue, remediation item, or ADK event must be logged at warn level with task id and rule/reason.
- Historical execution detail API must return the same advisor state the live SSE path produced.
- Control-flow edges and data bindings must not be modified by advisor remediation unless the user explicitly applies reviewed changes.

## Testing Plan

### Frontend

- `api.ts` normalization keeps all advisor fields.
- `ExecutionStepDetail.tsx` renders empty, evaluating, failed, summary-only, and full-result states.
- `ExecutionPanel.tsx` passes the advisor run callback.
- Store action updates state from advisor run response and SSE events.

Suggested command:

```bash
npm test -- --run src/modules/playbook
```

### Backend

- Advisor controller validates route params and delegates only to service.
- Advisor service transitions task status to evaluating, evaluated, or failed.
- Advisor service appends `judgeHistory` on repeat runs.
- Advisor service emits SSE events after persistence.
- gRPC mapper preserves nested scores, issues, remediations, and Struct fields.

Suggested command:

```bash
npm test -- playbook-flow
```

### ADK

- Advisor service scores representative successful and failed task outputs.
- Remediation planner returns safe structured suggestions.
- gRPC conversion preserves request context and result fields.
- Missing optional context produces degraded but useful advisor output, not a silent empty response.

Suggested command:

```bash
conda activate meta
poetry run pytest tests/flow_engine
```

## Rollout Strategy

1. Ship Phase 1 first to make existing advisor data visible and actionable.
2. Ship Phase 2 behind the existing playbook-flow execution UI path.
3. Ship Phase 3 with backend fallback disabled if ADK advisor is unavailable; failures should be visible in `judgeError`.
4. Enable summary and autopilot after single-task advisor evaluation is stable.
5. Enable remediation apply only after preview and audit behavior is covered by tests.

## Open Questions

- Should advisor evaluation be allowed for failed or skipped task results, or only completed task results?
- Should advisor runs consume user quota, admin quota, or a dedicated evaluation budget?
- Should advisor results be visible to all users with execution read access, or only users with playbook edit access?
- What score threshold should drive `review`, `optimize`, and `rerun` recommendations?
- Which remediation targets are safe in the first apply slice: prompt only, output format only, or both?

## First Vertical Slice

The smallest useful slice is:

1. Frontend preserves advisor fields from execution API responses.
2. Frontend exposes a run advisor CTA in the execution Advisor tab.
3. Backend adds one task-level advisor endpoint under `playbook-flow`.
4. Backend service calls ADK over gRPC for one completed task result.
5. Backend persists `judgeStatus`, `judgeResult`, and `judgeHistory`.
6. Backend emits `step_judge_started` and `step_judge_updated` SSE events.
7. Reloading the execution still shows the Advisor result.

This slice proves the end-to-end contract without committing to the full autopilot/remediation workflow first.
