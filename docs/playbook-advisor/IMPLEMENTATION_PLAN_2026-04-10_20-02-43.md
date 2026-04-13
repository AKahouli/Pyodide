# Playbook Advisor Implementation Plan

> Status: draft
> Created: 2026-04-10 20:02:43 UTC
> Scope: rename the current Judge/Reflection feature to Playbook Advisor, make recommendations tool-aware, and add an automatic remediation mode for step and workflow runs.

## Goals

1. Rebrand the user-facing feature as `Playbook Advisor`.
2. Make advisor recommendations explicitly evaluate tool usage using the stored `toolTrace` and `llmPromptTrace` data.
3. Add an automatic remediation execution mode that iterates until a step-level `overallScore > 80` or a configurable remediation turn limit is reached.
4. Keep the implementation maintainable, commented where orchestration is non-obvious, and safe for heavy production usage.

## Product Naming

- User-facing feature name: `Playbook Advisor`
- Recommended automatic mode name: `Advisor Autopilot`
- Suggested internal implementation name: `auto_remediation`

Rationale:
- `Playbook Advisor` better reflects analysis plus actionable recommendations.
- `Advisor Autopilot` communicates that the system can apply bounded automated improvements.
- Keeping an internal technical name separate from the product label makes future renaming cheaper.

## Current State Summary

- Step-level advisor data already exists through the current judge/reflection pipeline.
- Workflow-level summary already exists after node-level evaluations complete.
- Tool traces are already persisted at step level and shown in the UI.
- Step optimization already exists as a manual action.
- Full playbook rewrite and new optimized playbook generation already exist as manual actions.
- Current advisor evaluation is asynchronous and post-step, which is acceptable for manual review but not sufficient for true in-flight automatic remediation during workflow execution.

## Target Capabilities

### 1. Playbook Advisor rename

- Rename user-facing labels, tabs, badges, toasts, help text, and admin prompt titles from `Judge` / `Reflection` wording to `Advisor` wording.
- Keep backend field names and route names stable in the first phase unless there is a strong reason to migrate them.
- Treat a full internal rename as a separate later phase because it touches stored data, SSE events, tests, and API contracts.

### 2. Tool-aware recommendations

The advisor must explicitly analyze tool behavior, not only final output quality.

Add structured step-level advisor signals for:
- `toolUsageScore`
- `toolSelectionIssues`
- `missingToolCalls`
- `redundantToolCalls`
- `toolOutputUseIssues`
- `toolSequencingIssues`
- `toolUsageStrengths`
- `toolUsageRecommendation`

Add execution-level summary signals for:
- `toolUsageIssues`
- `crossStepToolPatterns`
- `rootCauseTaskIds`
- `confidence`
- `highImpactRecommendations`

### 3. Advisor Autopilot

When enabled for a step run or workflow run:

1. Execute the step.
2. Run step-level advisor evaluation.
3. Check whether `overallScore > targetScore`.
4. If not, and if remediation turns remain, automatically apply a safe recommendation.
5. Re-run the step.
6. Re-evaluate.
7. Stop when the target score is reached, the turn limit is reached, the advisor abstains, or no safe fix is available.

Recommended default policy:
- `targetScore = 80`
- `maxTurns = 2` or `3`
- Only auto-apply step-scoped remediations during active execution.
- Do not auto-generate a brand-new playbook in the middle of a running workflow in the first version.

## Safety Boundaries

The first production version of `Advisor Autopilot` should only auto-apply changes that are operationally safe during an active execution.

Allowed in active execution:
- Step rewrite in place
- Preserve task id
- Preserve graph topology
- Preserve input and output ports
- Preserve document and data-source mappings
- Preserve replay and output-format bindings where possible

Not allowed in active execution for v1:
- Mid-run graph rewrites
- Mid-run task id changes
- Mid-run edge rewrites that alter downstream routing
- Mid-run generation of a completely new playbook as part of the same execution

Allowed after workflow completion:
- Recommend or manually trigger `update current playbook`
- Recommend or manually trigger `generate new optimized playbook`

## Architecture Plan

### Phase 1. User-facing rename to Playbook Advisor

Scope:
- Frontend locales
- Execution detail tab labels
- Recommendation pane labels
- Node badges and tooltips
- Toolbar toggle copy
- Toast messages
- Admin prompt labels and descriptions

Non-goals:
- No route rename
- No schema rename
- No SSE event rename

Reasoning:
- This gives immediate product clarity with low migration risk.

### Phase 2. Tool-aware step advisor

Backend work:
- Extend the step advisor prompt contract to require structured tool-usage findings.
- Persist the new fields in task-level advisor results.
- Add clear comments around the advisor result normalization path because this contract will evolve repeatedly.

Frontend work:
- Show tool-usage findings in the Playbook Advisor tab.
- Distinguish content-quality findings from tool-usage findings.
- Keep the UI readable by grouping findings into small sections.

Testing:
- Prompt-contract parsing tests
- Store/UI rendering tests
- Regression tests for missing or partial tool traces

### Phase 3. Tool-aware execution summary

Backend work:
- Expand execution-summary aggregation input to include tool-usage-derived summaries per task.
- Update the execution-summary prompt to reason about repeated tool misuse, missing tools, noisy tool usage, and likely root-cause steps.
- Extend the execution summary schema with `toolUsageIssues`, `rootCauseTaskIds`, and `confidence`.

Frontend work:
- Show workflow-level advisor findings separately from step-level findings.
- Make CTA explanations include tool-related reasoning when relevant.

Testing:
- Summary aggregation tests
- SSE/store merge tests for new summary fields

### Phase 4. Admin-configurable Advisor settings

Add a dedicated Playbook admin settings surface near the existing playbook prompts area.

Recommended settings:
- `advisorAutopilotEnabledByDefault`
- `advisorAutopilotTargetScore`
- `advisorAutopilotMaxTurns`
- `advisorAutopilotAllowToolBasedRemediation`
- `advisorAutopilotAllowWorkflowRewrite`
- `advisorAutopilotAllowNewPlaybookGeneration`
- `advisorAutopilotTimeoutMs`

Recommended implementation approach:
- Keep prompt templates in the existing prompt registry.
- Add structured advisor settings in a playbook-specific admin settings endpoint or storage layer.
- Avoid burying these operational settings inside prompt templates.

### Phase 5. Step-run Advisor Autopilot

This is the safest first autopilot implementation.

Flow:
1. Run a single step.
2. Evaluate the step with Playbook Advisor.
3. If the score is below target and safe remediation is available, call the existing step optimization path.
4. Refresh the execution snapshot for the step.
5. Re-run the step.
6. Record turn history and stop when thresholds are met.

Why first:
- Existing step rerun mechanics already exist.
- Snapshot refresh for a single task is already aligned with current backend behavior.
- Blast radius is much lower than whole-workflow autopilot.

### Phase 6. Workflow-run Advisor Autopilot

This phase must be implemented in the execution orchestration path, not only in the async post-step advisor pipeline.

Required behavior:
- After a step completes, block downstream execution until the advisor autopilot decision is resolved.
- If remediation is needed and allowed, optimize the step and rerun it before downstream tasks consume the output.
- Continue the workflow only after the final accepted step result is known.

Recommended orchestration location:
- ADK / LangGraph task execution path for synchronous control.

Why:
- The current backend advisor pipeline is asynchronous and can race with downstream scheduling.
- Inline orchestration is the only reliable way to keep workflow state coherent under repeated remediation turns.

### Phase 7. Post-run workflow recommendations

Keep the existing end-of-run workflow recommendation behavior.

Use it for:
- structural workflow issues
- repeated tool misuse across steps
- handoff and contract quality issues
- recommendations to update the current playbook or generate a new one

This remains complementary to autopilot, not a replacement.

## Data Model Evolution

### Step-level advisor result

Recommended additions:

```json
{
  "overallScore": 72,
  "confidence": 0.84,
  "toolUsageScore": 58,
  "toolSelectionIssues": [],
  "missingToolCalls": [],
  "redundantToolCalls": [],
  "toolOutputUseIssues": [],
  "toolSequencingIssues": [],
  "toolUsageStrengths": [],
  "safeAutoFixType": "optimize_step|none",
  "recommendation": "none|update_current_playbook|generate_new_optimized_playbook",
  "reason": ""
}
```

### Execution-level advisor summary

Recommended additions:

```json
{
  "overallScore": 68,
  "confidence": 0.81,
  "rootCauseTaskIds": ["task-2"],
  "toolUsageIssues": [],
  "crossStepToolPatterns": [],
  "highImpactRecommendations": [],
  "recommendation": "update_current_playbook|generate_new_optimized_playbook",
  "reason": ""
}
```

### Autopilot execution metadata

Recommended execution-level metadata:
- `advisorMode`: `manual|autopilot`
- `advisorAutopilotTargetScore`
- `advisorAutopilotMaxTurns`
- `advisorAutopilotStatus`: `idle|running|completed|stopped|failed`

Recommended task-level metadata:
- `advisorTurnCount`
- `advisorTurnHistory[]`
- `lastAdvisorAction`
- `lastAdvisorScoreDelta`
- `advisorStopReason`

## Maintainability Rules

These rules are required because this logic will evolve repeatedly and run in production.

1. Keep policy separate from orchestration.
Policy decides whether to remediate, what action is allowed, and when to stop.
Orchestration decides how to rerun safely.

2. Centralize advisor decision logic.
Create a single decision module that answers:
- Is autopilot enabled?
- Is the score below target?
- Is the recommendation safe to auto-apply?
- Are turns remaining?
- What is the stop reason?

3. Keep prompt parsing defensive.
Every LLM response must be normalized and validated before use.
Never let malformed advisor payloads directly drive execution control.

4. Comment only the non-obvious parts.
Add concise comments around:
- stop-condition evaluation
- snapshot refresh behavior
- downstream-blocking workflow logic
- safety guards that prevent graph-shape drift

5. Preserve stable interfaces where possible.
Do not rename stored fields, SSE events, and routes in the same phase as autopilot orchestration unless there is a strong migration plan.

6. Prefer append-only history.
Advisor turn history, applied actions, score deltas, and stop reasons should be recorded rather than overwritten.

7. Make retries and timeouts explicit.
Advisor calls, optimization calls, and reruns should use named timeout constants and bounded retry policies.

8. Fail safe.
If advisor evaluation fails during autopilot, execution should stop autopilot cleanly and either continue in manual mode or mark the execution with a clear failure state based on configured policy.

## Reliability Requirements

1. Every autopilot turn must be idempotent from the perspective of persistence.
2. Downstream workflow continuation must never occur before an in-flight remediation decision completes.
3. Step rewrites must preserve identifiers and mappings required by the active snapshot.
4. Every advisor-generated action must be auditable.
5. The system must expose why autopilot stopped.
6. Admin-configured limits must always override prompt suggestions.
7. Invalid advisor output must degrade safely, never mutate execution state unpredictably.

## Observability Requirements

Add structured logs and metrics for:
- advisor evaluation started
- advisor evaluation completed
- advisor evaluation failed
- autopilot turn started
- autopilot action applied
- autopilot rerun started
- autopilot rerun completed
- autopilot stopped with reason

Recommended labels:
- `executionId`
- `taskId`
- `turn`
- `scoreBefore`
- `scoreAfter`
- `targetScore`
- `actionType`
- `stopReason`

Recommended metrics:
- advisor success rate
- advisor failure rate
- average turns per autopilot execution
- average score improvement per turn
- percentage of runs stopped by limit
- percentage of runs stopped by advisor abstain

## Testing Strategy

### Unit tests

- Advisor result normalization with partial and invalid payloads
- Tool-usage summarization helpers
- Autopilot stop-condition policy
- Safe-action policy
- Settings fallback logic

### Integration tests

- Step execution with autopilot disabled
- Step execution with autopilot enabled and one successful remediation turn
- Step execution that hits max turns
- Step execution where advisor abstains
- Workflow execution that blocks downstream tasks until the remediation loop resolves
- Admin settings update and runtime usage

### Regression tests

- No graph drift during step-only optimization
- No invalid workspace or mapping mutation from advisor-generated payloads
- Existing manual recommendation actions continue to work
- Existing execution streaming still surfaces advisor state correctly

## Recommended Delivery Order

1. Playbook Advisor user-facing rename
2. Tool-aware step advisor fields and UI
3. Tool-aware execution summary
4. Admin-configurable advisor settings
5. Step-run Advisor Autopilot
6. Workflow-run Advisor Autopilot
7. Optional internal backend/API rename from `judge` to `advisor`

## Open Decisions

1. Whether to keep all backend `judge*` naming stable indefinitely or migrate it later.
2. Whether autopilot failure should stop the entire workflow or degrade to manual advisory mode.
3. Whether `targetScore` should be global only or overridable per run.
4. Whether workflow-level autoplay should ever permit automatic full-playbook regeneration.

## Recommendation

Proceed with a conservative production rollout:

1. Rename the feature to `Playbook Advisor` in the UI first.
2. Add explicit tool-aware advisor outputs.
3. Launch `Advisor Autopilot` for single-step runs before enabling it for full workflows.
4. Keep workflow autopilot restricted to step-safe remediations in the first production version.
5. Preserve current backend contracts during the early phases to reduce migration risk.
