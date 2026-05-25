# Playbook Replay Flex Remediation Plan

## Goal

Bring the current Replay Flex implementation back in line with the original target behavior by turning the existing drift-reporting layer into a baseline-driven replay execution system.

The current implementation already has baseline fields, replay planning primitives, report schema fields, and a Replay Report UI. The remaining work is to make execution and evaluation produce real replay evidence instead of sparse or skipped reports.

## Target Behavior

- Replay the same task intent.
- Replay the same major reasoning stages.
- Replay the same tool purposes and argument shapes.
- Enforce the same output contract.
- Allow context substitution and data-dependent result changes.
- Report drift and confidence explicitly.

## Current Gaps

### Runtime Gaps

- Replay Flex does not yet guarantee that baseline tool calls are replayed with substituted context.
- Observed intent is not available at runtime, so intent drift usually becomes `intent_not_evaluated`.
- Context substitution exists as planning metadata, but it is not strongly enforced against tool args and output content.
- Reasoning, tool sequence, argument shape, and output contract signals are often missing from reports.
- Semantic evaluation is not instantiated against the substituted baseline, so valid context changes are not fully distinguishable from drift.

### Reporting Gaps

- Reports can render mostly empty sections while still implying a full Replay Flex evaluation happened.
- `skipped` reports do not clearly separate why each signal was not evaluated.
- The UI does not distinguish `not evaluated`, `not applicable`, `passed`, and `failed` per signal.
- Execution step details do not show top replay confidence or drift reasons beside the step result.

### Implementation Gaps

- No dedicated drift service owns replay drift orchestration.
- Drift findings and confidence UI are inlined instead of reusable components.
- Observability does not explicitly preserve all structured runtime facts needed for drift scoring.
- Phase 3 test coverage is incomplete.

## Design Principles

1. Compare against the instantiated baseline, not the original baseline.
2. Let execution modes define strictness: `Replay Strict`, `Replay Flex`, `Replay Adaptive`.
3. Use LLMs for semantic understanding and context extraction, but use code for validation, scoring, and final verdicts.
4. Treat missing evaluation evidence as `not_evaluated`, never as pass.
5. Make every skipped or blocked signal visible in the report.

## Replay Execution Flow

```text
1. Start replay-enabled step execution
   |
   v
2. Load active validated replay baseline
   - intentKey
   - reasoningOutline
   - toolTraceTemplate
   - outputContract
   - driftPolicy
   - acceptedExamples
   |
   v
3. Resolve context substitution
   - extract current task variables
   - map baseline values to current values
   - validate required variables and confidence
   |
   v
4. Instantiate replay plan
   - intent expectation
   - reasoning stages
   - tool steps and substituted args
   - output contract
   - semantic checklist
   |
   v
5. Execute with mode-specific replay constraints
   - Replay Strict
   - Replay Flex
   - Replay Adaptive
   |
   v
6. Capture structured runtime observations
   - observed intent if available
   - reasoning trace
   - tool trace
   - tool args
   - output format
   - final output
   |
   v
7. Evaluate drift against instantiated baseline
   - context substitution
   - intent
   - reasoning
   - tool purpose
   - tool sequence
   - argument shape
   - output contract
   - semantic preservation
   |
   v
8. Apply drift policy and persist report
```

## Execution Mode Semantics

### Replay Strict

Use for deterministic regression replay.

- Same intent required.
- Same reasoning stages required.
- Same tool names required.
- Same tool order required.
- Same argument shape required.
- Argument values may change only through approved substitutions.
- Extra tools are forbidden unless explicitly optional in the baseline.
- Output contract is enforced.
- Stale baseline context in tool args or output is a failure.

### Replay Flex

Use for same workflow pattern with context substitution.

- Same intent required.
- Same required reasoning stages expected.
- Same tool purposes required.
- Equivalent tools may be allowed when policy permits.
- Same argument shape expected.
- Argument values must reflect context substitution.
- Extra tools are allowed only when they support the same goal.
- Output contract is enforced.
- Stale baseline context is a failure when it affects the task subject, time range, or required metric.

### Replay Adaptive

Use when the agent may adapt strategy while preserving the task goal.

- Same intent required.
- Reasoning stages are scored, not strictly required.
- Tool purposes are scored, not strictly required.
- Equivalent and additional tools are allowed.
- Argument substitution is still required when baseline variables appear.
- Output contract is enforced.
- Semantic preservation carries more weight than exact tool choreography.

## Phase 1: Signal Semantics And Report Honesty

### Outcome

Replay reports accurately show which signals were evaluated, which were skipped, and why.

### Backend Tasks

- Add per-signal evaluation status fields to replay reports:
  - `intentStatus`
  - `reasoningStatus`
  - `toolSequenceStatus`
  - `argumentShapeStatus`
  - `outputContractStatus`
  - `semanticStatus`
  - `contextSubstitutionStatus`
- Each status should support:
  - `not_evaluated`
  - `not_applicable`
  - `passed`
  - `warning`
  - `failed`
- Include a machine-readable reason when a signal is not evaluated.
- Ensure skipped replay reports do not compute misleading partial scores.
- Keep existing report fields for read compatibility.

### Frontend Tasks

- Update `ReplayReportPanel.tsx` to render per-signal status.
- Hide or collapse empty sections unless there is a specific `not_evaluated` reason to show.
- Add clear copy for skipped reports, for example:
  - `Replay was skipped because context confidence was below threshold.`
  - `Tool sequence was not evaluated because no observed tool trace was captured.`
- Add reusable components:
  - `ReplayConfidenceBadge.tsx`
  - `ReplayDriftFindingsList.tsx`

### Tests

- Add report rendering tests for:
  - fully evaluated report
  - skipped report
  - partial report with missing semantic signal
  - partial report with missing tool trace

## Phase 2: Context Substitution Model

### Outcome

Replay Flex resolves and persists an inspectable mapping from baseline context to current task context.

### Backend Tasks

- Expand replay planning so context mapping includes:
  - `variableKey`
  - `baselineValue`
  - `currentValue`
  - `valueType`
  - `confidence`
  - `matched`
  - `source`
  - `reason`
- Use deterministic extraction where possible for dates, tickers, IDs, and obvious entity names.
- Use an LLM only when deterministic extraction is insufficient.
- Validate required variables before execution.
- Block or downgrade replay when required substitutions are unresolved.
- Persist the instantiated replay plan on the execution or report for auditability.

### LLM Context Mapping Prompt

Use strict JSON output.

```text
You are resolving context substitutions for a replay baseline.

Given the baseline task, current task, and expected variables, map baseline values to current values.

Return valid JSON only. Do not infer values that are not present or strongly implied.
```

Required JSON shape:

```json
{
  "variables": [
    {
      "key": "country",
      "baselineValue": "France",
      "currentValue": "Germany",
      "confidence": 0.98,
      "matched": true,
      "reason": "Current task explicitly asks for Germany."
    }
  ],
  "unresolvedVariables": [],
  "warnings": []
}
```

### Frontend Tasks

- Show context substitution in `ExecutionStepDetail.tsx`.
- Use or refine `ReplayContextMappingCard.tsx`.
- Surface unresolved or low-confidence substitutions before the report details.

### Tests

- Add tests for deterministic mapping.
- Add tests for unresolved required variables.
- Add tests for stale baseline entity detection.

## Phase 3: Tool Replay Enforcement

### Outcome

Replay execution follows the validated tool choreography with context-substituted arguments according to the selected replay mode.

### Backend Tasks

- Instantiate `toolTraceTemplate` into expected tool steps:
  - tool name
  - tool purpose
  - required flag
  - order index
  - argument shape
  - substituted argument values
- Inject the instantiated tool plan into node execution context.
- Add mode-specific tool policy derivation:
  - strict: same tool names and order
  - flex: same tool purposes and argument shape
  - adaptive: baseline tools advisory but scored
- Capture observed tool trace with:
  - tool name
  - call index
  - args
  - status
  - output summary
  - purpose if available
- Compare observed tool trace against the instantiated plan.

### Tool Drift Findings

Support findings such as:

- `missing_required_tool`
- `wrong_tool_order`
- `tool_purpose_mismatch`
- `argument_shape_mismatch`
- `stale_context_value_in_tool_args`
- `additional_tools_not_allowed`
- `tool_output_not_useful`

### Frontend Tasks

- Use or refine `ReplayExecutionPlanCard.tsx`.
- Show expected vs observed tool calls.
- Highlight stale substituted values in observed args.

### Tests

- Strict mode fails on missing required tool.
- Strict mode fails on extra tool.
- Flex mode passes equivalent tool when policy allows it.
- Flex mode fails stale baseline value in args.
- Adaptive mode warns but does not fail on justified alternative tool.

## Phase 4: Semantic Evaluation With Instantiated Expectations

### Outcome

Semantic evaluation detects missing points, changed points, extra points, unsupported claims, and stale context references against the substituted task expectation.

### Backend Tasks

- Add baseline semantic checklist generation during validation.
- Store checklist items with:
  - `key`
  - `description`
  - `variables`
  - `severity`
  - `source`
- Instantiate checklist items with the current context mapping before evaluation.
- Run semantic judge after execution using:
  - current task
  - final output
  - instantiated checklist
  - context mapping
  - output contract
- Validate the LLM response with a schema.
- Persist structured semantic findings.

### LLM Semantic Judge Prompt

Use strict JSON output.

```text
You are evaluating whether a replay output preserved the expected semantics after context substitution.

Do not compare the output against the original baseline entities directly.
Use only the instantiated expectations.

Classify differences as:
- missingPoints
- changedPoints
- extraPoints
- staleContextReferences
- unsupportedClaims

Return valid JSON only.
```

Required JSON shape:

```json
{
  "score": 82,
  "preservedPoints": ["metric", "summary_structure"],
  "missingPoints": [
    {
      "key": "time_window",
      "expected": "Discuss GDP for Germany in 2000.",
      "observed": "The answer does not clearly mention 2000.",
      "severity": "warning"
    }
  ],
  "changedPoints": [],
  "extraPoints": [],
  "staleContextReferences": [],
  "unsupportedClaims": [],
  "verdict": "warning"
}
```

### Frontend Tasks

- Split semantic UI into:
  - preserved points
  - missing points
  - changed points
  - extra points
  - stale context references
  - unsupported claims
- Make semantic evaluation status visible when no semantic judge result exists.

### Tests

- Detect missing required semantic point.
- Detect stale baseline country/year in output.
- Allow changed numeric values when context changes.
- Fail invalid LLM response as `not_evaluated`, not pass.

## Phase 5: Dedicated Drift Service

### Outcome

A single backend service owns replay drift orchestration and report derivation.

### Backend Tasks

- Add `playbook-flow-replay-drift.service.ts`.
- Move orchestration out of report service while keeping pure scoring helpers in `playbook-flow-replay-drift.util.ts`.
- Service responsibilities:
  - collect instantiated baseline inputs
  - collect observed runtime inputs
  - run deterministic comparisons
  - invoke semantic evaluator when required
  - apply mode-specific drift policy
  - build final report fields
- Keep report service focused on persistence and retrieval.

### Tests

- Add focused unit tests for each drift category.
- Add report-level tests for verdict derivation.

## Phase 6: Observability And Runtime Evidence

### Outcome

Replay reports are based on structured runtime evidence, not fragile free-form parsing.

### Backend / ADK Tasks

- Preserve structured observations for:
  - reasoning stages
  - tool calls
  - tool args
  - tool outputs
  - output contract checks
  - semantic judge result
  - observed intent if available
- Keep `TraceCollector.set_observed_intent_key()` as the runtime intent extension point.
- Add a real runtime intent classifier before using observed intent as an evaluated signal.
- Ensure missing observations create `not_evaluated` findings with reasons.

### Tests

- Verify tool trace survives from ADK to NestJS.
- Verify trace metadata fields survive serialization boundaries.
- Verify missing trace data is reported loudly.

## Phase 7: UI Integration And Manual QA

### Outcome

The Replay Evaluation tab accurately explains replay quality and does not overpromise when signals are missing.

### Frontend Tasks

- Update `ExecutionStepDetail.tsx` to show:
  - replay confidence
  - top blocking findings
  - top warnings
  - context substitution summary
- Update `ReplayReportPanel.tsx` to prioritize:
  - verdict reason
  - evaluated signals
  - missing evidence
  - action items
- Add empty-state copy for every signal.

### Manual QA Scenario

1. Validate a baseline with at least one tool call.
2. Run Replay Strict with only context variables changed.
3. Confirm required tools replay with substituted args.
4. Run Replay Flex with equivalent context changes.
5. Confirm same tool purpose is preserved.
6. Run Replay Adaptive with an alternative valid tool path.
7. Confirm alternative tool use is reported as adaptive drift, not hidden.
8. Confirm semantic findings show missing, changed, extra, and stale context points when applicable.
9. Confirm skipped reports explain exactly which signal blocked replay.

## Verification Plan

### Backend

- `npm test -- playbook-flow-replay-drift`
- `npm test -- playbook-flow-replay-report.service.spec.ts`
- `npm test -- playbook-flow-execution.service.spec.ts`
- Targeted integration test for one replay execution with tool traces.

### Frontend

- `npm test -- ReplayReportPanel.test.tsx`
- `npm test -- ExecutionStepDetail.test.tsx`
- `npm test -- api.test.ts`

### ADK

- Run Python tests after activating the expected environment.
- Verify trace payloads include structured observations where available.

### Browser QA

- Replay Baseline dialog.
- Execution Step Detail.
- Replay Evaluation tab.
- Desktop, tablet, and mobile layouts.
- Console errors and failed network requests.

## Suggested Delivery Order

1. Phase 1: report honesty and per-signal status.
2. Phase 2: explicit context substitution model.
3. Phase 3: tool replay enforcement.
4. Phase 4: semantic evaluation with instantiated expectations.
5. Phase 5: dedicated drift service extraction.
6. Phase 6: observability hardening.
7. Phase 7: UI polish, tests, and browser QA.

## Success Criteria

- Replay Strict fails when required baseline tools are missing, reordered, stale, or extra.
- Replay Flex passes context-substituted tool replay and reports allowed data changes.
- Replay Adaptive allows justified alternate tool paths while preserving intent and output contract.
- Semantic evaluation compares current output against instantiated expectations.
- Reports show why every signal passed, failed, warned, or was not evaluated.
- UI no longer displays empty drift sections as if a full evaluation occurred.
