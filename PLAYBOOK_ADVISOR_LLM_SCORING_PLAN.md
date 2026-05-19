# Playbook Advisor LLM Scoring Implementation Plan

## Goal

Add a user-selectable Advisor scoring mode for playbook-flow executions:

- `llm` scoring: default mode, uses the existing Admin > Playbook Settings > Advisor Evaluation Model.
- `heuristic` scoring: current deterministic ADK evaluator, retained as a fast/cost-free fallback.

The Advisor should remain enabled by `reflectionEnabled`, and scoring mode should decide how each completed step is evaluated.

## Current State

- `reflectionEnabled` controls automatic per-step Advisor evaluation during execution.
- `advisorAutopilotEnabled` controls iterative optimization behavior and should remain separate from scoring mode.
- `PlaybookFlowExecutionAdvisorService` currently calls `PlaybookFlowDesignGrpcService.evaluateTask()`.
- The ADK `EvaluateTask` path is deterministic and returns `model = "deterministic-execution-advisor"`.
- The current deterministic path creates no LLM call, no LiteLLM usage, and no LLM prompt trace.
- Admin Playbook Settings currently include `inferenceModelId`, `nodeSuggestionsMode`, and `approvalSuggestionMode`.
- The Playbook Settings UI has one model picker, currently used for playbook design inference.
- Built-in prompt seed already includes `judge.node_reflection`, but it is not used by the new playbook-flow advisor path.

## Product Decisions

- Default scoring mode is `llm`.
- Heuristic scoring remains available as an explicit user choice.
- Advisor LLM scoring uses the Admin Playbook Settings Advisor Evaluation Model.
- The scoring mode is selected in run settings, near the Advisor toggle and autopilot controls.
- Use one enum field, not multiple booleans.

```ts
type AdvisorScoringMode = 'llm' | 'heuristic';
```

## Recommended UX

In the Playbook run settings panel:

```text
Advisor: On / Off
Scoring: LLM-based / Heuristic
Step Autopilot: On / Off
Target score: visible when Step Autopilot is On
Max turns: visible when Step Autopilot is On
```

Defaults:

```ts
reflectionEnabled = false
advisorScoringMode = 'llm'
advisorAutopilotEnabled = false
```

Display result provenance in the Advisor panel and node badge details where practical:

```text
Evaluated 82% · LLM
Evaluated 57% · Heuristic
```

## Data Model Changes

### Flow Definition

Add to `PlaybookFlow`:

```ts
advisorScoringMode?: 'llm' | 'heuristic';
```

Default to `llm` when missing.

Suggested files:

```text
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts
YellowStorm/back/src/modules/playbook-flow/dto/create-playbook-flow.dto.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow.service.ts
YellowStorm/front/src/modules/playbook/types.ts
YellowStorm/front/src/modules/playbook/api.ts
```

### Flow Execution

Add to `FlowExecution`:

```ts
advisorScoringMode?: 'llm' | 'heuristic';
```

Persist the selected mode at execution start so historical executions are reproducible even if the playbook setting changes later.

Suggested files:

```text
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-execution.schema.ts
YellowStorm/back/src/modules/playbook-flow/dto/start-playbook-flow-execution.dto.ts
YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-execution.controller.ts
YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts
```

### Task Judge History

Extend `FlowTaskJudgeHistoryEntry`:

```ts
scoringMode?: 'llm' | 'heuristic';
usage?: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  model?: string | null;
} | null;
llmPromptTrace?: Array<{
  stage: string;
  model: string;
  prompt: string;
}>;
```

Also consider storing `scoringMode` on the current `judgeResult` or adjacent task result field if the UI needs it without reading history.

Suggested file:

```text
YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-task-result.schema.ts
```

## Admin Settings Changes

Add a dedicated Advisor Evaluation Model field to Admin Playbook Settings.

```ts
interface AdminPlaybookSettings {
  inferenceModelId: string | null;
  advisorEvaluationModelId: string | null;
  nodeSuggestionsMode: 'auto' | 'manual';
  approvalSuggestionMode: 'auto' | 'manual';
}
```

Default:

```ts
advisorEvaluationModelId = null
```

`null` means use the global default model.

Suggested files:

```text
YellowStorm/back/src/modules/system/interfaces/playbook-settings.interface.ts
YellowStorm/back/src/modules/system/system.service.ts
YellowStorm/front/src/modules/admin/types.ts
YellowStorm/front/src/modules/admin/pages/PlaybookSettingsPage.tsx
YellowStorm/front/src/modules/admin/api.ts
```

Validation rule:

- `advisorEvaluationModelId`, when provided, must refer to an active model.
- Keep the existing design `inferenceModelId` behavior unchanged.

## Backend Architecture

Split evaluation into explicit strategies behind the existing advisor orchestrator.

```text
PlaybookFlowExecutionAdvisorService
  -> chooses scoring mode
  -> emits judge started / updated SSE
  -> persists judge status, result, history

HeuristicAdvisorEvaluator
  -> calls existing ADK EvaluateTask gRPC method

LlmAdvisorEvaluator
  -> builds judge.node_reflection prompt
  -> resolves Advisor Evaluation Model from Admin Playbook Settings
  -> calls LiteLLM
  -> records UsageService usage
  -> returns normalized FlowExecutionJudgeResult plus trace metadata
```

Suggested new files:

```text
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-heuristic-advisor-evaluator.service.ts
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-llm-advisor-evaluator.service.ts
YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-advisor-model.service.ts
```

Keep `PlaybookFlowExecutionAdvisorService` as the lifecycle owner. It should not contain prompt rendering or LiteLLM parsing details.

## LLM Evaluation Flow

```text
Step completed
  -> execution.reflectionEnabled?
  -> scoring mode = execution.advisorScoringMode ?? 'llm'
  -> emit step_judge_started
  -> LlmAdvisorEvaluator.evaluate()
      -> load execution snapshot and task result context
      -> load judge.node_reflection prompt
      -> resolve Admin Playbook Settings advisorEvaluationModelId
      -> fallback to global default model if advisorEvaluationModelId is null
      -> call LiteLLM /v1/chat/completions with response_format json_object
      -> parse and normalize result
      -> record usage with UsageType.PLAYBOOK
      -> return judgeResult, model, usage, llmPromptTrace
  -> persist judgeStatus = evaluated
  -> append judgeHistory with scoringMode = llm
  -> emit step_judge_updated
```

Recommended usage endpoint:

```text
playbook-flow.advisor-evaluation
```

## Heuristic Evaluation Flow

```text
Step completed
  -> execution.reflectionEnabled?
  -> scoring mode = heuristic
  -> emit step_judge_started
  -> HeuristicAdvisorEvaluator.evaluate()
      -> call existing ADK EvaluateTask gRPC method
      -> normalize TaskAdvisorResult
      -> return judgeResult, model = deterministic-execution-advisor
  -> persist judgeStatus = evaluated
  -> append judgeHistory with scoringMode = heuristic
  -> emit step_judge_updated
```

No usage record is expected for heuristic mode because it does not consume tokens.

## Prompt Contract

Use the existing built-in prompt key:

```text
judge.node_reflection
```

Required template variables:

```text
taskTitle
taskDescription
workflowGoal
expectedResult
upstreamContextJson
taskOutput
artifactsJson
toolTraceJson
promptTraceJson
```

The LLM must return strict JSON compatible with `FlowExecutionJudgeResult`:

```json
{
  "accuracyScore": 80,
  "completenessScore": 75,
  "resultMatchingScore": 70,
  "overallScore": 76,
  "confidence": 85,
  "toolUsageScore": 90,
  "expectedResultSource": "node_field",
  "expectedResultType": "semantic_description",
  "expectedResultMatched": true,
  "expectedResultReason": "The output covers the requested summary.",
  "missingFacts": [],
  "incoherences": [],
  "unsupportedClaims": [],
  "handoffRisks": [],
  "rewriteHints": [],
  "toolSelectionIssues": [],
  "missingToolCalls": [],
  "redundantToolCalls": [],
  "toolOutputUseIssues": [],
  "toolSequencingIssues": [],
  "toolUsageStrengths": [],
  "toolUsageRecommendation": "Tool usage was appropriate.",
  "safeAutoFixType": "none",
  "recommendation": "none",
  "reason": "The step output is aligned with the expected result."
}
```

Clamp numeric scores to `0..100` and default invalid enum values to the current safe defaults.

## Frontend Changes

### Run Settings

Add a scoring selector next to the Advisor toggle.

Suggested files:

```text
YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx
YellowStorm/front/src/modules/playbook/components/PlaybookRunSettingsDialog.tsx
YellowStorm/front/src/modules/playbook/types.ts
YellowStorm/front/src/modules/playbook/api.ts
```

If there is no dedicated run settings component, keep the change inside the existing settings section in `PlaybookCanvasPage.tsx`.

### State and API

- Include `advisorScoringMode` in playbook update PATCH bodies.
- Include `advisorScoringMode` in execution POST bodies.
- Normalize missing values to `llm`.
- Preserve scoring mode in execution/task response normalization.

### Display

- Show scoring mode in Advisor tab history entries.
- Prefer `historyEntry.scoringMode`; fallback to `judgeResult.scoringMode` if added there; fallback to `llm` for new executions and `heuristic` only when model is `deterministic-execution-advisor`.
- Do not show token usage in the node badge; keep detailed usage in the Advisor tab.

## REST and SSE Contracts

### Execution Start Payload

Add:

```json
{
  "reflectionEnabled": true,
  "advisorScoringMode": "llm"
}
```

### Manual Advisor Evaluation Payload

Optionally allow override:

```json
{
  "iteration": 0,
  "advisorScoringMode": "llm"
}
```

If omitted, use the execution's persisted mode.

### SSE Payloads

Extend `step_judge_started` and `step_judge_updated` with:

```ts
advisorScoringMode?: 'llm' | 'heuristic';
```

For `step_judge_updated`, include usage and history metadata through `judgeHistoryEntry` rather than inflating every badge update.

## Observability and Traces

LLM scoring must produce visible traces.

Minimum trace persistence:

```ts
llmPromptTrace: [
  {
    stage: 'advisor_evaluation',
    model,
    prompt: userPrompt
  }
]
```

Recommended usage persistence:

```ts
usage: {
  inputTokens,
  outputTokens,
  totalTokens,
  model
}
```

Also call:

```ts
usageService.recordUsage({
  userId,
  inputTokens,
  outputTokens,
  usageType: UsageType.PLAYBOOK,
  modelName,
  endpoint: 'playbook-flow.advisor-evaluation',
});
```

Do not record usage for heuristic mode.

## Migration and Backward Compatibility

- Existing playbooks without `advisorScoringMode` should behave as `llm` after this change.
- Existing executions without `advisorScoringMode` should display `llm` unless their judge history model is `deterministic-execution-advisor`.
- Existing admin settings without `advisorEvaluationModelId` should use `null`, meaning global default model.
- No data migration is required if schema defaults and normalization handle missing fields.

## Implementation Phases

### Phase 1: Contracts and Settings

- Add `advisorEvaluationModelId` to backend admin playbook settings.
- Add `advisorEvaluationModelId` to frontend admin types and settings page.
- Validate selected Advisor Evaluation Model is active.
- Add `advisorScoringMode` to playbook, execution DTOs, schemas, API types, and normalization.
- Default all missing `advisorScoringMode` values to `llm`.

Verification:

```bash
npm test -- --run src/modules/admin
npm test -- --run src/modules/playbook
npm run build
```

### Phase 2: Backend Strategy Split

- Extract current gRPC heuristic call into `HeuristicAdvisorEvaluator`.
- Add `LlmAdvisorEvaluator` using `judge.node_reflection`, LiteLLM, model resolution, usage recording, and strict JSON parsing.
- Update `PlaybookFlowExecutionAdvisorService` to select evaluator by scoring mode.
- Persist `scoringMode`, `usage`, and `llmPromptTrace` in `judgeHistory`.
- Emit scoring mode in judge SSE events.

Verification:

```bash
npm test -- playbook-flow-execution-advisor
npm run build
```

### Phase 3: Frontend Run Settings and Display

- Add run setting selector: `LLM-based` / `Heuristic`.
- Include mode in playbook PATCH and execution POST.
- Show mode in Advisor tab current result and history.
- Keep node badge compact.

Verification:

```bash
npm test -- --run src/modules/playbook
```

Browser QA:

- Advisor ON + LLM mode creates an LLM usage trace and non-deterministic model name.
- Advisor ON + Heuristic mode returns `deterministic-execution-advisor` and no token usage.
- Manual re-run appends history with the selected mode.

### Phase 4: Hardening

- Add tests for invalid LLM JSON fallback to failed judge status.
- Add tests for missing advisor model fallback to global default model.
- Add tests for inactive advisor model rejection in Admin Settings.
- Add tests that heuristic mode does not call LiteLLM or `UsageService.recordUsage()`.
- Add tests that LLM mode does not call ADK `EvaluateTask`.

## Key Tests

### Backend

- `SystemService` preserves `advisorEvaluationModelId` in playbook settings.
- Admin settings rejects inactive `advisorEvaluationModelId`.
- Execution start persists `advisorScoringMode = 'llm'` by default.
- Advisor service selects LLM evaluator when mode is missing or `llm`.
- Advisor service selects heuristic evaluator when mode is `heuristic`.
- LLM evaluator records usage with endpoint `playbook-flow.advisor-evaluation`.
- LLM evaluator appends `llmPromptTrace` and usage to judge history.
- Heuristic evaluator appends `scoringMode = 'heuristic'` and no usage.

### Frontend

- Admin Playbook Settings renders separate Advisor Evaluation Model selector.
- Run settings default scoring selector value is `llm`.
- `updatePlaybook()` sends `advisorScoringMode`.
- `executePlaybook()` sends `advisorScoringMode`.
- Advisor history renders mode labels.

## Risks

- LLM evaluator can increase execution cost because Advisor auto-runs after each completed step when `reflectionEnabled` is on.
- LLM evaluator latency may make the `Evaluating...` state more visible but can slow result availability.
- Prompt output may be invalid JSON; the service must fail loudly and persist `judgeError` instead of silently falling back to heuristic mode.
- Admin-selected model may be deleted or disabled after an execution starts; resolve and validate at evaluation time with a clear failure if no usable fallback exists.
- Existing `FlowTaskLlmPromptTraceItem` stores prompt but not response; if full response trace is required, extend the schema intentionally rather than overloading `prompt`.

## Open Questions

- Should manual advisor re-run allow temporary scoring-mode override, or always use the execution's persisted mode?
- Should LLM advisor usage count against the executing user, the playbook owner, or a workspace/admin budget?
- Should the LLM response text be stored for audit, or only the parsed normalized judge result?
- Should Advisor Evaluation Model be shared with execution summary evaluation later, or only per-step scoring?

## Smallest Useful Slice

1. Add `advisorEvaluationModelId` to Admin Playbook Settings.
2. Add `advisorScoringMode` defaulting to `llm` on playbook and execution start.
3. Implement LLM evaluator in backend using `judge.node_reflection` and the configured Advisor Evaluation Model.
4. Keep current ADK evaluator as `heuristic` mode.
5. Persist mode, usage, and prompt trace in judge history.
6. Add run settings selector and send mode in execution payload.
7. Verify LLM mode produces LiteLLM usage traces and heuristic mode does not.
