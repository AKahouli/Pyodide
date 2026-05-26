# Playbook Replay Post-Run Evaluation Plan

## Goal

Add a non-heuristic, LLM-based replay evaluation that runs after a replay-enabled node completes. This evaluation should compare the final node result against the validated replay baseline and present a clear user-facing synthesis without replacing the existing technical replay report.

The current replay report remains the source of truth for pre-run eligibility and execution-mode decisions. The new post-run evaluation answers a separate question: how well did the completed run preserve the baseline output, intent, reasoning, format, and tool behavior?

## Target UX

The replay tab should be split into two panes:

1. Replay Evaluation Synthesis
2. Replay Evaluation Details

### Replay Evaluation Synthesis

This pane is the default, user-facing summary.

Fields:

- Overall score, 0-100.
- Semantic match score, 0-100.
- Verdict: `match`, `minor_drift`, `major_drift`, or `not_comparable`.
- Summary: one concise paragraph.
- Missing points: baseline expectations absent from the new result.
- Changed points: meaningful differences between baseline and new result.
- Preserved points: important baseline elements preserved in the new result.
- Output format preservation score, 0-100 or `not_applicable`.
- Tool sequence preservation score, 0-100 or `not_applicable`.
- Reasoning preservation score, 0-100 or `not_applicable`.
- Recommended action: `accept`, `review`, or `reject`.

### Replay Evaluation Details

This pane keeps the existing technical report and evidence.

Fields:

- Existing replay eligibility report.
- Baseline output.
- New output.
- Baseline reasoning trace, if present.
- New reasoning trace, if present.
- Baseline tool calls, if present.
- New tool calls, if present.
- Output format guide or output contract, if present.
- Raw structured LLM judge response.
- Existing hashes, invalidation reasons, confidence factors, and replay mode.

## Design Principles

1. Do not use the LLM judge for pre-run eligibility or execution control.
2. Keep deterministic replay eligibility conservative and unchanged.
3. Run the LLM judge only after the node has completed and actual output exists.
4. Store the LLM evaluation result so reports are reproducible and auditable.
5. Keep the MVP small by embedding the post-run evaluation into the existing replay run report document.
6. Use strict JSON output from the judge, never freeform text parsing.
7. Treat judge failures as `not_comparable`, not as pass or fail.

## Backend Plan

### 1. Extend Replay Run Report Schema

Add a nullable `postRunEvaluation` field to the replay run report schema.

Shape:

```ts
type ReplayPostRunEvaluation = {
  judgeUsed: boolean;
  judgeModel: string | null;
  evaluatedAt: Date;
  verdict: 'match' | 'minor_drift' | 'major_drift' | 'not_comparable';
  overallScore: number | null;
  semanticMatchScore: number | null;
  outputFormatScore: number | null;
  toolSequenceScore: number | null;
  reasoningScore: number | null;
  summary: string;
  missingPoints: string[];
  changedPoints: string[];
  preservedPoints: string[];
  recommendedAction: 'accept' | 'review' | 'reject';
  rawJudgeResponse: Record<string, unknown> | null;
  failureReason?: string | null;
};
```

Keep the field optional so existing reports remain valid.

### 2. Add Post-Run Evaluation Service

Create `PlaybookFlowReplayPostRunEvaluationService`.

Responsibilities:

- Load the matched baseline artifacts.
- Load the completed task result.
- Build the judge prompt.
- Call the existing LiteLLM integration.
- Validate the JSON response shape.
- Normalize scores and verdict.
- Persist `postRunEvaluation` on the replay run report.

Service method:

```ts
evaluateCompletedReplayRun(params: {
  executionId: string;
  flowId: string;
  taskId: string;
  iteration: number;
  replayReportId: string;
}): Promise<void>
```

### 3. Trigger After Node Completion

Hook evaluation after `NodeCompleted` processing, only when all conditions are true:

- The node has a completed task result.
- A replay run report exists for the execution/task/iteration.
- The report has a matched baseline id/version.
- `postRunEvaluation` is not already populated.
- The execution mode is `replay_strict`, `replay_flex`, or `replay_adaptive`.

The evaluation should be best-effort. If it fails, log a warning and persist a `not_comparable` evaluation when possible.

### 4. Judge Prompt Contract

Input to the judge:

- Task title.
- Task description.
- Replay mode.
- Baseline output.
- New output.
- Baseline reasoning trace, if present.
- New reasoning trace, if present.
- Baseline tool calls, if present.
- New tool calls, if present.
- Output format guide or output contract, if present.
- Replay planning summary or semantic checklist, if present.

Output must be JSON only:

```json
{
  "verdict": "match",
  "overallScore": 95,
  "semanticMatchScore": 98,
  "outputFormatScore": 90,
  "toolSequenceScore": null,
  "reasoningScore": 95,
  "summary": "The new output preserves the baseline analysis with minor wording differences.",
  "missingPoints": [],
  "changedPoints": ["The new output uses a shorter explanation of domestic demand."],
  "preservedPoints": ["France GDP growth in 2000", "Macro-economic interpretation", "Concise analysis format"],
  "recommendedAction": "accept"
}
```

Validation rules:

- Clamp numeric scores to 0-100.
- Convert missing optional dimensions to `null`.
- Reject unknown verdicts as `not_comparable`.
- Reject freeform/non-JSON responses and persist `failureReason`.

### 5. API Response

Return `postRunEvaluation` as part of existing replay report listing responses.

No new endpoint is required for the MVP.

## Frontend Plan

### 1. Update Replay Report Types

Add `postRunEvaluation` to frontend replay report types.

### 2. Split Replay Report UI

In the existing replay evaluation tab:

- Add `Replay Evaluation Synthesis` above the current technical report.
- Move the current report body under `Replay Evaluation Details`.
- If `postRunEvaluation` is missing, show a neutral loading/empty state: `Post-run evaluation is not available for this run yet.`

### 3. Synthesis Rendering

Render:

- Verdict badge.
- Overall score.
- Semantic match score.
- Summary.
- Missing points.
- Changed points.
- Preserved points.
- Output format preservation.
- Tool sequence preservation.
- Reasoning preservation.
- Recommended action.

Keep technical invalidation reasons in the Details pane, not the Synthesis pane.

## Admin Setting: Configurable Eligibility Threshold

### Goal

Make the replay eligibility confidence threshold configurable from Admin > Playbook settings instead of keeping it hardcoded in backend replay eligibility logic.

### Proposed Setting

Add a playbook setting:

- Key: `replayEligibilityConfidenceThreshold`
- Label: `Replay eligibility confidence threshold`
- Type: number
- Unit: percent
- Default: `70`
- Min: `0`
- Max: `100`
- Scope: global admin setting for all playbooks in the current deployment

### Backend Actions

1. Locate the existing admin/system settings module used by Admin pages.
2. Add `replayEligibilityConfidenceThreshold` to the persisted playbook settings schema or configuration model.
3. Expose it through the existing Admin > Playbook settings read/update API.
4. Inject the setting into replay eligibility evaluation.
5. Replace the hardcoded confidence threshold with the configured value, falling back to `70` when unset or invalid.
6. Include the effective threshold in replay reports as `eligibilityThreshold` so users can audit why a replay was skipped.

### Frontend Actions

1. Add a numeric input under Admin > Playbook settings.
2. Validate 0-100 client-side.
3. Save through the existing settings API.
4. Display helper text: `Replay runs below this confidence are skipped before post-run evaluation.`

### Tests

Backend tests:

- Default threshold remains 70 when no setting exists.
- Replay applies when confidence is equal to or above the configured threshold.
- Replay skips when confidence is below the configured threshold.
- Replay report includes the effective threshold.

Frontend tests:

- Admin setting renders with the default value.
- Values below 0 or above 100 are rejected.
- Saving sends the expected settings payload.

## MVP Implementation Order

1. Add `postRunEvaluation` schema field and frontend type.
2. Add post-run evaluation service with strict JSON LLM judge response.
3. Trigger service after replay-enabled node completion.
4. Render `Replay Evaluation Synthesis` above existing report details.
5. Move existing technical report into `Replay Evaluation Details`.
6. Add Admin > Playbook setting for `replayEligibilityConfidenceThreshold`.
7. Wire configured threshold into replay eligibility and report it.
8. Add focused backend and frontend tests.
9. Run browser QA on one replay-flex playbook.

## Non-Goals For MVP

- Do not replace deterministic eligibility with LLM decisions.
- Do not create a separate collection unless the embedded report field becomes too large.
- Do not add multi-baseline selection logic.
- Do not add streaming updates for the LLM evaluation.
- Do not block node completion on post-run evaluation success.

## Open Questions

- Should post-run LLM evaluation run for skipped replay reports, or only when replay was applied?
- Should `not_comparable` count as warning or neutral in the UI?
- Should the admin threshold be global only, or later overridable per playbook?
