# Playbook Advisor Feature: Implementation Plan

## Goal

Make the Playbook Advisor more deterministic, robust, and useful for improving node task execution and whole-playbook design.

The advisor should evaluate execution quality, explain concrete issues, and support two explicit remediation actions:

- **Optimize step**: always attempts to optimize the selected node only.
- **Optimize playbook**: always attempts to optimize the current playbook/workflow.

Advisor scores, thresholds, recommendations, and `rewriteHints` must not gate whether the user can run either action. Metrics should explain and prioritize issues; the clicked action should determine remediation scope.

## Current System Summary

Relevant backend files:

- `YellowStorm/back/src/modules/playbook-flow/controllers/playbook-flow-execution-advisor.controller.ts` - exposes execution advisor evaluation and remediation endpoints.
- `YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.service.ts` - orchestrates task evaluation, remediation item extraction, remediation intent generation, and suggestion selection.
- `YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-llm-advisor-evaluator.service.ts` - builds the LLM advisor prompt and calls LiteLLM.
- `YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-heuristic-advisor-evaluator.service.ts` - delegates heuristic scoring to the ADK through gRPC.
- `YellowStorm/back/src/modules/playbook-flow/services/advisor/playbook-flow-execution-advisor.mapper.ts` - maps gRPC/LLM judge results into backend DTOs and normalizes score/enums.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-prompt-seed.ts` - contains built-in advisor prompt templates, especially `judge.node_reflection` and `intent.analyze`.
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-intent.service.ts` - generates `PlaybookIntentSuggestion` objects from remediation intents.

Relevant frontend files:

- `YellowStorm/front/src/modules/playbook/components/ExecutionPanel.tsx` - starts advisor evaluation from execution UI.
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx` - displays step details, judge output, remediation items, and apply actions.
- `YellowStorm/front/src/modules/playbook/components/AdvisorResultPanel.tsx` - renders advisor scores and findings.
- `YellowStorm/front/src/modules/playbook/utils/playbook-intent-flow.ts` - previews and applies advisor remediation through `handleApplyAdvisorIntent`.
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx` - owns graph mutation via `handleApplyIntentSuggestion`.
- `YellowStorm/front/src/modules/playbook/api.ts` and `types.ts` - advisor API calls and DTOs.

Relevant ADK files:

- `yellowstorm-adk/src/flow_engine/advisor/execution_advisor_service.py` - deterministic execution advisor evaluation.
- `yellowstorm-adk/src/flow_engine/advisor/score_aggregator.py` - deterministic scoring helpers.
- `yellowstorm-adk/src/flow_engine/advisor/evidence_extractor.py` - extracts issue signals from output/tool evidence.
- `yellowstorm-adk/src/flow_engine/advisor/execution_advisor_models.py` - advisor request/result models.

## Current Issues

1. Remediation is partly recommendation-gated.
   
   Current deterministic logic sets `recommendation` by score threshold:

   ```text
   overallScore < 50  => generate_new_optimized_playbook
   overallScore < 75  => update_current_playbook
   otherwise          => none
   ```

   This is fine as advisor opinion, but not as action control.

2. Step auto-fix is tied to `rewriteHints`.

   Current deterministic logic sets:

   ```text
   safeAutoFixType = optimize_step if rewriteHints else none
   ```

   This is too restrictive. A step can need optimization because of handoff risk, weak tools, unsupported claims, missing format constraints, missing HITL rules, or vague expected result even when `rewriteHints` is empty.

3. Metrics are too shallow for robust execution.

   The heuristic path mostly scores output presence, simple expected-result substring match, and tool trace issue count. This is useful as a fallback but not enough to guide robust remediation.

4. Recommendation and remediation responsibilities are mixed.

   The advisor should separate:

   - evaluation: what happened and how good it was
   - recommendation: what action the advisor prefers
   - remediation action: what the user clicked
   - application: validated mutation of the playbook

5. Optimization should improve task contracts, not only wording.

   Robust node execution depends on clear task purpose, required inputs, output contract, expected result, tool guidance, handoff rules, and HITL/clarification rules.

## Target Behavior

### Optimize Step

When the user clicks **Optimize step**, the system must always attempt a selected-node optimization.

Required behavior:

- Return exactly one `single_change` suggestion.
- Use `operationType: "update_node"`.
- Use `targetTaskId` equal to the selected node id.
- Preserve graph topology: no node creation, deletion, reordering, or reconnection.
- Preserve unrelated nodes, edges, ports, and data bindings.
- Prefer updating task description and execution contract.
- Change title, ports, output format, HITL policy, or blocker hints only when needed for correctness.
- Work even if advisor score is high.
- Work even if `recommendation` is `none`.
- Work even if `rewriteHints` is empty.
- Work even if no remediation items are selected by using a generic step-optimization fallback intent.

### Optimize Playbook

When the user clicks **Optimize playbook**, the system must always attempt broader workflow optimization.

Allowed behavior:

- Update multiple nodes when findings indicate cross-node issues.
- Improve handoffs, output contracts, expected results, validation/evaluation steps, HITL blockers, and tool guidance.
- Add, remove, or reconnect nodes only when required by the workflow goal and graph correctness.
- Preserve the original business intent.
- Prefer minimal valid workflow changes.
- Return a valid `workflow_plan` or other allowed playbook-intent suggestion shape.
- Work regardless of score thresholds, `recommendation`, or `rewriteHints`.

## Design Principle

The advisor should be deterministic in control flow and LLM-powered in content generation.

Deterministic control flow:

- selected action determines scope
- backend builds action-specific remediation intent
- backend validates returned suggestion shape
- frontend applies only validated suggestions

LLM content generation:

- rewrite the step contract
- improve playbook structure
- propose better handoffs/tooling/HITL rules
- produce business-readable explanations

## Proposed Data Flow

```text
Completed task result
        ↓
Run advisor evaluation
        ↓
Judge result: metrics + findings + recommendation
        ↓
User clicks Optimize step or Optimize playbook
        ↓
Backend builds action-specific remediation intent
        ↓
Intent service returns PlaybookIntentSuggestion(s)
        ↓
Backend validates suggestion against clicked action
        ↓
Frontend previews and applies suggestion
        ↓
handleApplyIntentSuggestion mutates the playbook
```

## Phase 1: Remove Action Gating

### Objective

Make optimization buttons deterministic and user-action-driven.

### Backend Changes

1. Treat `recommendation` as display/advisory metadata only.

2. Stop using `safeAutoFixType` or `rewriteHints` as a requirement for `optimize-step`.

3. Update `buildRemediationIntent` in `playbook-flow-execution-advisor.service.ts` so `optimize-step` always works.

4. Add fallback findings text when selected items are empty:

   ```text
   No specific advisor findings were selected. Improve this selected task so future executions are more deterministic, robust, and aligned with the expected output.
   ```

5. Keep strict backend validation for step optimization:

   ```ts
   suggestion.kind === 'single_change'
   suggestion.operationType === 'update_node'
   suggestion.targetTaskId === targetTaskId
   ```

6. For playbook optimization, select the highest-confidence non-fallback valid workflow-level suggestion.

### Frontend Changes

1. Ensure the UI does not hide or disable Optimize step because of score/recommendation/rewrite hints.

2. Ensure Optimize playbook remains available regardless of score/recommendation/rewrite hints.

3. Keep frontend validation in `handleApplyAdvisorIntent` for step scope safety.

### Verification

- A high-scoring step can still be optimized.
- A step with `rewriteHints: []` can still be optimized.
- A step with `recommendation: "none"` can still be optimized.
- Optimize step rejects graph-changing suggestions.
- Optimize playbook accepts valid workflow-plan suggestions.

## Phase 2: Strengthen Remediation Intent Prompting

### Objective

Make generated remediation more relevant and robust by giving the intent engine better structure.

### Optimize-Step Intent Requirements

The backend remediation intent should include:

- selected task id
- selected task title
- selected task description
- expected result, if configured
- output format guide, if configured
- task output summary, when available
- tool trace summary, when available
- selected remediation items, if any
- full judge result summary, if available
- upstream/downstream context, when practical
- strict scope constraints

The generated step should improve:

- task purpose
- required inputs
- success criteria
- expected result
- output format/contract
- evidence-grounding requirements
- tool-use guidance
- handoff readiness
- HITL/clarification rules

### Optimize-Playbook Intent Requirements

The backend remediation intent should include:

- playbook goal
- current graph summary
- all selected findings
- affected node ids
- cross-node handoff risks
- repeated tool/format issues
- downstream impact summary
- strict instruction to preserve the original business intent
- instruction to prefer minimal valid graph changes

The generated playbook should improve:

- graph structure
- node ordering and dependencies
- data bindings and port compatibility
- validation/evaluation nodes when useful
- HITL checkpoints
- tool placement and sequencing
- handoffs between nodes

## Phase 3: Redesign Advisor Metrics

### Objective

Make metrics diagnostic, not gatekeeping, and make them more useful for robust execution.

### Current Metrics to Keep

- `accuracyScore`
- `completenessScore`
- `resultMatchingScore`
- `overallScore`
- `confidence`
- `toolUsageScore`
- `expectedResultMatched`
- `expectedResultReason`

### Metrics to Add

Execution quality metrics:

- `relevanceScore` - whether output stayed focused on task intent.
- `specificityScore` - whether output is concrete enough for downstream use.
- `formatComplianceScore` - whether output respects expected format, ports, schema, or guide.

Execution robustness metrics:

- `evidenceGroundingScore` - whether claims are backed by upstream context or tool outputs.
- `handoffReadinessScore` - whether downstream nodes can consume the output reliably.
- `hitlAppropriatenessScore` - whether the step should have paused for clarification, approval, or review.
- `determinismScore` - whether the task instruction is precise enough to produce stable outputs.

Remediation priority metrics:

- `stepOptimizationPriority` - expected value of optimizing the selected step.
- `playbookOptimizationPriority` - expected value of broader workflow optimization.
- `riskSeverity` - `low | medium | high | critical`.
- `blockingIssueCount` - count of severe issues that can break execution.
- `downstreamImpactLevel` - `none | low | medium | high`.

### Overall Score Formula

Replace simple averaging with weighted scoring:

```text
overallScore =
  accuracyScore            * 0.25 +
  completenessScore        * 0.15 +
  resultMatchingScore      * 0.15 +
  relevanceScore           * 0.10 +
  formatComplianceScore    * 0.15 +
  evidenceGroundingScore   * 0.10 +
  handoffReadinessScore    * 0.10
```

Apply caps for critical failures:

- Empty output: cap at 20.
- Task error: cap at 25.
- Expected result clearly unmet: cap at 60.
- Required output format violated: cap at 65.
- Unsupported critical claims: cap at 70.
- Downstream handoff impossible: cap at 60.

### Recommendation Semantics

Replace threshold-only recommendation semantics with action-oriented advisory metadata.

Proposed fields:

```ts
recommendedAction:
  | 'optimize_step'
  | 'optimize_playbook'
  | 'review_only'
  | 'add_hitl_guard'
  | 'improve_tooling'
  | 'improve_output_contract'

availableActions: {
  optimizeStep: true;
  optimizePlaybook: true;
}
```

Important rule:

```text
recommendedAction may influence UI emphasis, but available remediation actions remain user-driven.
```

## Phase 4: Improve Remediation Items

### Objective

Make remediation items structured enough to drive deterministic optimization and useful previews.

### Current Categories

- `structure`
- `prompt`
- `contract`
- `handoff`
- `tooling`
- `evidence`

### New or Expanded Categories

- `format`
- `hitl`
- `determinism`
- `expected_result`

### Proposed Remediation Item Shape

```ts
{
  id: string;
  category: AdvisorRemediationCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number;
  scope: 'task' | 'playbook';
  targetTaskId: string | null;
  title: string;
  description: string;
  rationale?: string;
  suggestedAction:
    | 'optimize_step'
    | 'optimize_playbook'
    | 'add_hitl_guard'
    | 'improve_tooling'
    | 'improve_output_contract';
  blocking: boolean;
  defaultSelected: boolean;
  source: {
    kind: 'judge_result';
    field: string;
    index: number;
  };
}
```

### Default Selection Rules

- Critical/high blocking issues default selected.
- Format, handoff, expected-result, evidence, and HITL issues default selected.
- Tool strengths and low-severity observations do not default selected.
- Default selection is a UI convenience only; it must not gate action availability.

## Phase 5: Prompt Template Updates

### Objective

Align the judge and remediation prompts with the new metrics and action model.

### `judge.node_reflection`

Update the prompt to require:

- all current metrics
- new robustness metrics
- issue severity
- downstream impact
- recommended action
- remediation targets
- explicit distinction between diagnostic findings and available actions

The prompt should state:

```text
Do not decide whether optimization is allowed. Optimization actions are user-driven. Your role is to evaluate quality, identify risks, and recommend the most useful next action.
```

### `intent.analyze`

Strengthen advisor-specific instructions when the intent is remediation-driven:

- For optimize-step, produce only a `single_change/update_node` suggestion.
- For optimize-playbook, prefer minimal valid workflow plans.
- Preserve graph validity, port compatibility, and data bindings.
- Do not invent agents or templates.
- Improve task contracts, not just wording.

## Phase 6: Backend Validation and Safety

### Objective

Make remediation application safe regardless of LLM output quality.

### Optimize-Step Validation

Reject if suggestion:

- is not `single_change`
- is not `update_node`
- targets another task
- creates/deletes/reorders/reconnects nodes
- modifies unrelated tasks
- changes ports or bindings unless explicitly allowed and internally valid

### Optimize-Playbook Validation

Reject if suggestion:

- references unknown task ids
- uses invalid node refs
- invents agents or template types
- creates invalid edges
- creates required input ports without compatible bindings
- leaks iterator-body nodes into the outer graph
- deletes nodes without preserving the original business goal or explaining impact

### Preview Requirements

Preview should return:

- selected suggestion
- all candidate suggestions
- expected definition revision
- generated remediation intent
- validation status
- validation warnings/errors

## Phase 7: Frontend UX Updates

### Objective

Make advisor actions clear and predictable.

### UI Behavior

- Always show Optimize step when a task is selected.
- Always show Optimize playbook when an execution/playbook is available.
- Show advisor recommendation as guidance, not a requirement.
- Show metrics grouped by quality, robustness, and remediation priority.
- Show severity and downstream impact on remediation items.
- Let users select/deselect remediation items.
- Allow optimize actions even with no selected remediation item.

### Preview UX

For step optimization, show before/after for:

- title
- description
- expected result
- output format/ports, if changed
- HITL/blocker hints, if changed

For playbook optimization, show:

- nodes to create/update/delete
- edges to create/delete
- data bindings to create/delete
- affected nodes
- expected business outcome

## Phase 8: Testing Strategy

### Backend Tests

- `optimize-step` builds a valid intent with selected findings.
- `optimize-step` builds a valid fallback intent with no findings.
- `optimize-step` rejects non-`update_node` suggestions.
- `optimize-step` rejects suggestions targeting the wrong task.
- `optimize-playbook` selects a valid workflow-level suggestion.
- Metrics mapper clamps new scores and normalizes new enums.
- Remediation extraction produces severity/confidence/category fields.

### Frontend Tests

- Optimize step button is available regardless of score/recommendation/rewrite hints.
- Optimize playbook button is available regardless of score/recommendation/rewrite hints.
- Step remediation rejects invalid preview suggestion shapes.
- Empty selected findings still calls preview remediation.
- Metrics display groups quality, robustness, and priority fields.

### ADK Tests

- Empty output caps overall score.
- Task error caps overall score.
- Missing expected result does not prevent scoring other dimensions.
- Format violations reduce `formatComplianceScore` and cap overall.
- Unsupported critical claims reduce `evidenceGroundingScore`.
- Handoff issues reduce `handoffReadinessScore`.

## Phase 9: Rollout Plan

1. Implement action gating removal first.
2. Add fallback optimize-step and optimize-playbook intents.
3. Strengthen backend suggestion validation.
4. Add frontend UI availability and validation tests.
5. Add new metrics to DTOs and mapper with backward-safe display handling.
6. Update `judge.node_reflection` prompt to emit new metrics.
7. Update ADK heuristic metrics and score aggregation.
8. Add richer remediation item fields.
9. Improve preview UX after backend safety is stable.

## Success Criteria

- Clicking Optimize step always attempts a selected-node update.
- Clicking Optimize playbook always attempts workflow optimization.
- Scores, thresholds, `recommendation`, `safeAutoFixType`, and empty `rewriteHints` do not block user-triggered remediation.
- Step optimization cannot mutate unrelated nodes or graph structure.
- Playbook optimization returns validated workflow-level changes.
- Metrics explain quality, robustness, and remediation priority.
- Remediation items carry category, severity, confidence, target, suggested action, and blocking status.
- Generated node updates improve execution determinism, relevance, output format, expected result, tool guidance, handoff readiness, and HITL rules.
- Existing `handleApplyIntentSuggestion` remains the single frontend graph mutation path.

## Non-Goals

- Do not let LLM output directly mutate persisted playbooks without validation.
- Do not use score thresholds to disable remediation actions.
- Do not depend on `rewriteHints` to allow optimization.
- Do not duplicate frontend graph mutation logic outside `handleApplyIntentSuggestion`.
- Do not broaden optimize-step into graph changes unless the user explicitly chose playbook optimization.
