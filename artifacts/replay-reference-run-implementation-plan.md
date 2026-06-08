# Reference Run UX Implementation Plan

## Purpose

Refactor the Playbook replay experience into a business-facing **Reference Run** system.

A Reference Run is a trusted past execution that defines what a task should preserve in future runs. The UI must help users understand whether a future result is still trustworthy, what changed, and what action to take next.

This plan intentionally separates business UX from technical replay internals. Replay, fingerprints, raw captures, snapshots, and drift signals remain available, but only as advanced diagnostics.

## Observed UX Failure

The current demo playbook exposes contradictory replay states:

- Canvas node shows `Replay baseline v3` and `84%`.
- Execution details show `Step mode: Live`.
- Report shows `Applied mode: Replay (Strict)`.
- Verdict shows `Skipped`.
- Eligibility shows `Confidence: 58%`.
- Reasons include `node snapshot changed`, `flow snapshot changed`, and `Baseline output contract is missing`.

This creates a trust problem. A business user cannot tell whether replay worked, whether it was skipped, whether the result is acceptable, or what to do next.

The refactor must create one clear story:

> This task has a trusted reference. The latest run either matched it, drifted from it, skipped it, or needs an update.

## Design Principles

- Business first: default views explain intent, expected output, consistency, and next actions.
- Technical second: raw captures, hashes, snapshots, and JSON live behind an explicit advanced section.
- One status: the node badge, result panel, and modal must agree on the latest status.
- One vocabulary: use `Reference Run`, `Consistency`, and `Rules`; avoid mixing baseline, replay, capture, and evaluation in default UI.
- Actionable states: every warning, skipped state, or missing requirement must offer a repair action.
- No raw layout noise: `positionX`, `positionY`, canvas layout, and transient UI state must not appear in default UX.
- Progressive disclosure: summary first, details second, diagnostics last.

## Vocabulary

### User-Facing Terms

| Technical term | Business term |
|---|---|
| Replay baseline | Reference Run |
| Replay Evaluation | Consistency |
| Capture tab | Technical Details |
| Replay config | Rules |
| Strict replay | Exact consistency |
| Flex replay | Flexible consistency |
| Adaptive replay | Advisory consistency |
| Trace Replay | Reuse saved tool steps |
| Node snapshot changed | Step definition changed |
| Flow snapshot changed | Workflow context changed |
| Output contract | Expected answer format |
| Tool policy | Required tool steps |
| Fingerprints | Technical fingerprints |

### Copy Rules

- Do not show `baseline` in default UI.
- Do not show `node snapshot`, `flow snapshot`, `hash`, or `fingerprint` outside Technical Details.
- Do not use `skipped` alone. Always explain what was skipped and why.
- Avoid `applied mode` in default UI. Use `Reference used` or `Reference not used`.
- Use concrete business nouns: `answer`, `format`, `fields`, `tools`, `instructions`, `reference`.

## Information Architecture

### Surfaces

1. Canvas node badge
2. Reference Run modal
3. Run settings
4. Execution step details
5. Consistency result panel
6. Technical details

Each surface has a different responsibility.

| Surface | Responsibility |
|---|---|
| Canvas badge | Fast trust status |
| Reference Run modal | Configure and inspect the trusted reference |
| Run settings | Choose how future runs use references |
| Execution step details | Show what happened in the selected run |
| Consistency panel | Explain whether the run honored the reference |
| Technical details | Preserve raw replay diagnostics |

## Canvas Node Badge

### Goal

Let users understand at a glance whether a task has a usable trusted reference.

### Badge States

| State | Label | Visual intent |
|---|---|---|
| No reference | `No reference` | Neutral outline |
| Ready | `Reference ready` | Positive |
| Used and passed | `Consistent` | Positive with score if available |
| Used with warnings | `Needs review` | Warning |
| Not used | `Reference not used` | Warning |
| Blocked | `Reference blocked` | Error |
| Updating | `Updating reference` | Loading |

### Badge Text Rules

- Prefer state over score.
- Only show score when it represents the same latest run shown in the execution panel.
- Do not show `84%` on the node if the selected/latest report says `58%`.
- If the current selected run differs from the latest badge state, show the badge as reference-level status, not selected-run status.

### Tooltip

Tooltip must explain one thing and one action.

Examples:

```text
Reference ready. Future runs will be checked against Run #1.
```

```text
Reference not used. The task definition changed since Run #1.
```

```text
Expected answer format is missing. Create it from the latest output.
```

### Click Behavior

Clicking the badge opens the Reference Run modal on `Overview`.

Do not open directly on technical capture.

## Reference Run Modal

### Modal Structure

Tabs:

1. `Overview`
2. `Rules`
3. `History`
4. `Technical Details`

Default tab:

- Badge click: `Overview`
- Step editor entry: `Rules`
- Consistency panel action: contextual target, usually `Overview` or `Rules`
- Advanced diagnostics link: `Technical Details`

### Header

Header content:

- Title: `Reference Run`
- Subtitle: plain-language purpose
- Status badge
- Reference run number
- Last updated timestamp

Example:

```text
Reference Run
Trusted answer from Run #1. Future runs are checked against this reference.

Needs update
Captured Jun 5, 2026
```

### Footer

Footer actions:

- Primary: contextual save or repair action
- Secondary: `Cancel`
- Destructive: `Remove reference`

Rules:

- Destructive action must stay visually separated.
- `Save` should be disabled when no changes exist.
- If a child modal opens, preserve the existing save-before-modal-handoff invariant.

## Modal Tab: Overview

### Goal

Answer in under 10 seconds:

- What is trusted?
- Is it usable?
- What changed?
- What should I do?

### Layout

Use four stacked sections:

1. Status summary
2. Trusted answer
3. What changed
4. Recommended actions

No nested cards. Use simple sections with compact rows.

### Status Summary

Required fields:

- Status label
- One-sentence explanation
- Reference run number
- Latest checked run number, when available
- Consistency score, when valid

State examples:

```text
Ready
Future runs can use this reference.
Reference: Run #1
```

```text
Needs update
The task now asks for additional fields that were not in the reference.
Reference: Run #1
Latest check: Run #19
```

```text
Reference not used
The latest run was live because the reference rules could not be applied.
Reference: Run #1
Latest check: Run #19
```

### Trusted Answer

Show the answer users care about, not raw JSON.

For text output:

- Use a readable preview.
- Preserve line breaks.
- Clamp long text with `Show full answer`.

For table-like output:

- Render as a compact table if structure is detectable.
- Otherwise render as formatted text.

For missing output:

```text
No trusted answer was captured.
Capture a new reference from a completed run.
```

### What Must Stay True

Show detected or configured rules as business chips or rows:

- Same answer structure
- Required fields: company name, region
- Required tool: web search
- Reasoning checkpoints: analyzed input, composed summary

Each row should have:

- Label
- Status: active, missing, unchecked
- Optional source: captured, configured, inferred

### What Changed

When a latest run exists, show a business diff.

Example for the observed playbook:

```text
Task instructions changed
Reference asked for 2 companies with company name and region.
Latest run asks for 3 companies with company name, region, revenue, and competitor.
```

If only raw backend reasons exist, map them:

- `node_snapshot_changed` -> `Step definition changed`
- `flow_snapshot_changed` -> `Workflow context changed`
- `baseline_output_contract_missing` -> `Expected answer format is missing`

Do not show raw reason codes in Overview.

### Recommended Actions

Actions must match the current state.

| Condition | Actions |
|---|---|
| Missing expected format | `Create expected format from latest output`, `Edit expected format` |
| Task changed | `Update reference from latest run`, `Review changes` |
| Too strict | `Switch to flexible consistency`, `Edit rules` |
| Tool mismatch | `Review required tool steps`, `Allow equivalent tools` |
| No reference | `Create reference from latest successful run` |
| Report pending | `Refresh status` |

Action buttons must be explicit. Avoid generic `Fix`.

## Modal Tab: Rules

### Goal

Let business users define what consistency means without understanding replay internals.

### Layout

Sections:

1. Answer expectations
2. Tool expectations
3. Reasoning expectations
4. Allowed variation
5. Advanced rule mapping, collapsed

### Answer Expectations

Controls:

- Toggle: `Keep the same answer structure`
- Field checklist: required output fields
- Button: `Edit expected answer format`
- Preview: current expected format status

Expected format status:

| Status | Label |
|---|---|
| Captured from reference | `Captured from reference answer` |
| Configured manually | `Configured manually` |
| Missing | `Missing expected format` |
| Outdated | `May be outdated` |

There must be no state where Settings says output format is enabled but Overview says no format exists without explaining the mismatch.

### Tool Expectations

Controls:

- Toggle: `Require the same tool steps`
- Toggle: `Allow extra tools`
- Tool list with required/optional status

Example:

```text
Required tool steps
1. Web search

Allowed:
- Search query may change
- Additional sources may be used
```

### Reasoning Expectations

Controls:

- Toggle: `Preserve reasoning checkpoints`
- List of checkpoints

Example:

```text
Reasoning checkpoints
- Analyze the request
- Compose the company summary
```

Avoid displaying chain-of-thought-like content as a default. Show high-level checkpoints only.

### Allowed Variation

Controls:

- `Allow different values or entities`
- `Allow wording changes`
- `Allow additional sources`
- `Allow extra rows`
- `Require the same number of items`

The UI must make strictness understandable.

Suggested presets:

- `Exact`: same structure, same fields, same tools, minimal variation
- `Flexible`: same intent and structure, values may change
- `Advisory`: compare and report drift without blocking replay use

Use presets as shortcuts, but keep detailed controls visible.

### Advanced Rule Mapping

Collapsed by default.

Show how business controls map to backend config:

- `replayOutputFormat`
- `replayToolTrace`
- `replayReasoningTrace`
- drift policy fields

This is for advanced users only.

## Modal Tab: History

### Goal

Show how the reference performs over time.

### Content

- Reference run card
- Latest run card
- Consistency checks list
- Reference updates list

### Reference Run Card

Fields:

- Run number
- Date
- Model
- Tool count
- Output preview
- Created by, if available

### Consistency Checks

Each row:

- Run number
- Date
- Status
- Score, if valid
- One-line reason
- Action: `View check`

Examples:

```text
Run #19 - Reference not used - Task definition changed
Run #18 - Needs review - Expected format missing
Run #17 - Consistent - 91%
```

### Empty State

```text
No consistency checks yet.
Run this step to compare it with the reference.
```

## Modal Tab: Technical Details

### Goal

Preserve the current power-user inspection capability without making it the default experience.

### Sections

All collapsed by default:

- Captured metadata
- Raw captured output
- Expected answer format
- Tool calls
- Reasoning trace
- Prompt trace
- Raw node snapshot
- Technical fingerprints
- Trace metadata
- Raw report reasons

### Rules

- JSON appears only here.
- Raw snapshots appear only here.
- `positionX`, `positionY`, and other layout fields may appear here but must never be part of Overview wording.
- Add `Copy JSON` per technical section.
- Add a short warning: `Technical details are for debugging and may include internal workflow fields.`

## Execution Step Details

### Current Issue

The selected step can show `Live`, `Trace Replay`, `Replay Evaluation`, and `Replay (Strict)` together. This should become one coherent execution story.

### Required Display

In the step header, show:

- Execution mode used for this run
- Reference status for this run
- Link to Consistency tab

Labels:

| Current state | New label |
|---|---|
| Live with no reference | `Live run` |
| Live because reference skipped | `Live run - reference not used` |
| Replay applied strict | `Exact reference used` |
| Replay applied flex | `Flexible reference used` |
| Replay planned but pending report | `Checking consistency` |

Do not show `Applied mode: Replay (Strict)` in the main step header.

## Consistency Result Panel

### Tab Label

Rename `Replay Evaluation` to `Consistency`.

### Goal

Explain whether the selected run honored the Reference Run.

### Layout

1. Outcome card
2. Business diff
3. Recommended actions
4. Signal diagnostics
5. Technical link

### Outcome Card States

#### Consistent

```text
Consistent with reference
The result preserved the expected answer structure and required tool steps.
Score: 91%
```

#### Needs Review

```text
Needs review
The result mostly follows the reference, but one rule needs attention.
Score: 74%
```

#### Reference Not Used

```text
Reference was not used
The latest run was live because the task definition changed and the expected answer format is missing.
```

#### Pending

```text
Checking consistency
The run completed. The consistency check is still being prepared.
```

#### Not Applicable

```text
No reference for this step
Create a reference from a successful run to compare future results.
```

### Business Diff

Render business-level changes before signal tables.

Example:

```text
Changed instructions
Reference: find 2 agro-sector companies in France with company name and region.
Latest run: find 3 agro-sector companies in France with company name, region, revenue, and competitor.
```

If field-level diff is unavailable, use mapped reason categories and say what data is missing.

### Signal Diagnostics

Move existing signal rows below the business explanation.

Label the section:

```text
Diagnostics
```

Rows:

- Context substitution
- Intent
- Reasoning
- Tool sequence
- Argument shape
- Expected answer format
- Semantic preservation

Each row should include:

- Status badge
- Plain-language summary
- Optional `Technical details` link

### Contradiction Guard

The panel must never show:

- `Run replay evaluation` and `No evaluation available` after a report is visible.
- `Applied mode Replay` and `Replay was not applied` without explaining that it was the requested mode, not the used mode.
- A score in the header that differs from the score in the report.

## Run Settings

### Goal

Let users decide how references participate in future executions.

### Required Controls

Workflow-level:

- `Run live`
- `Use reference runs when available`
- `Check consistency only`

Step-level override:

- `Use workflow default`
- `Live run`
- `Exact reference`
- `Flexible reference`
- `Check only`

### Copy

`Exact reference`:

```text
Use the trusted reference only when the step still matches its rules.
```

`Flexible reference`:

```text
Use the trusted reference while allowing approved changes in values or wording.
```

`Check only`:

```text
Run live, then compare the result with the reference.
```

This distinction is critical. Users must understand whether Reference Run changes execution or only evaluates it.

## Empty, Loading, and Error States

### No Reference

```text
No reference run yet
Create one from a successful run to compare future results.
```

Action:

- `Create reference from latest successful run`

### Missing Expected Format

```text
Expected answer format is missing
The system can compare meaning, but it cannot verify the answer structure yet.
```

Actions:

- `Create from latest output`
- `Edit manually`

### Reference Loading

```text
Loading reference run
```

Do not show destructive actions while reference data is loading.

### Report Pending

```text
Checking consistency
The run is complete. The consistency report is still being generated.
```

Action:

- `Refresh`

### Report Failed

```text
Consistency check failed
The run completed, but the consistency report could not be generated.
```

Actions:

- `Retry check`
- `View technical details`

### Stale Reference

```text
Reference may be outdated
The task changed after this reference was captured.
```

Actions:

- `Review changes`
- `Update reference`

## Visual Design Expectations

### Tone

Operational, calm, and precise. This is a workflow governance tool, not a marketing surface.

### Density

- Overview should be readable without scrolling on a typical desktop modal where possible.
- Rules may scroll.
- Technical Details may be dense.

### Components

- Use status badges for readiness and outcomes.
- Use compact comparison rows for diffs.
- Use switches for rules.
- Use segmented controls for consistency presets.
- Use accordions only in Technical Details or lower-priority diagnostics.
- Use icons only when they clarify state: check, alert, blocked, refresh, settings.

### Do Not

- Do not nest cards inside cards.
- Do not show raw JSON in Overview, Rules, or History.
- Do not use hero-scale typography.
- Do not use decorative gradients or ornamental visuals.
- Do not present more than one primary action per state.

## Accessibility Expectations

- Tabs must use accessible tab roles and keyboard navigation.
- Status color must be accompanied by text.
- Every repair action must have clear button text.
- Technical accordions must expose expanded/collapsed state.
- Dynamic report updates should use polite live-region messaging where feasible.
- Buttons must not rely on icons only unless they have accessible labels and tooltips.

## Responsive Expectations

Desktop:

- Modal may use two-column layouts in Overview when space allows.
- Consistency panel should keep outcome card fixed at top of tab content.

Tablet/mobile:

- Modal sections stack vertically.
- Long reference answer previews collapse earlier.
- Technical sections remain accordions.
- Primary action stays visible at bottom if the modal scrolls.

## Data Mapping Expectations

### Reference Summary Model

Create a frontend projection model even before backend contract changes.

Suggested shape:

```ts
type ReferenceRunSummary = {
  status: 'none' | 'ready' | 'consistent' | 'needs_review' | 'not_used' | 'blocked' | 'pending';
  title: string;
  description: string;
  referenceRunLabel?: string;
  latestRunLabel?: string;
  score?: number;
  trustedAnswerPreview?: string;
  missingRequirements: ReferenceRequirement[];
  businessChanges: ReferenceBusinessChange[];
  actions: ReferenceAction[];
};
```

Keep this projection local to replay UI until it proves useful elsewhere.

### Business Change Model

```ts
type ReferenceBusinessChange = {
  kind: 'task_instructions' | 'expected_format' | 'tool_steps' | 'workflow_context' | 'unknown';
  title: string;
  description: string;
  referenceValue?: string;
  currentValue?: string;
  severity: 'info' | 'warning' | 'blocking';
};
```

### Action Model

```ts
type ReferenceAction = {
  id: 'update_reference' | 'create_format' | 'edit_rules' | 'switch_flexible' | 'retry_check' | 'view_technical';
  label: string;
  priority: 'primary' | 'secondary';
};
```

## Backend Expectations

Phase 1 should not require backend changes.

Later backend work should:

- Provide replay-relevant field diffs instead of only hash mismatch reasons.
- Distinguish requested execution mode from actual mode used.
- Distinguish reference readiness score from latest run consistency score.
- Normalize output format status.
- Exclude layout-only fields from business replay invalidation.

## Technical Scope By Phase

### Phase 1: UI Rename and IA

Frontend-only.

Files:

- `YellowStorm/front/src/modules/playbook/components/ReplayBaselineSettingsDialog.tsx`
- `YellowStorm/front/src/modules/playbook/components/ReplayReportPanel.tsx`
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`
- `YellowStorm/front/src/modules/playbook/components/BaselineBadgePopover.tsx`
- `YellowStorm/front/src/modules/playbook/locales/en.json`
- `YellowStorm/front/src/modules/playbook/locales/fr.json`
- Existing colocated tests

Tasks:

- Rename default UI to Reference Run and Consistency.
- Replace modal tabs with Overview, Rules, History, Technical Details.
- Move raw capture sections into Technical Details.
- Add top-level outcome card in Consistency panel.
- Add empty/loading/error states.

### Phase 2: Summary Projection

Frontend-only unless required data is missing.

Tasks:

- Add `buildReferenceRunSummary()`.
- Map raw reason codes to business changes.
- Generate recommended actions from report state.
- Add contradiction guard logic for score/status display.

### Phase 3: Output Format Coherence

Frontend first, backend if source-of-truth mismatch is confirmed.

Tasks:

- Audit output format source.
- Ensure one status is shown everywhere.
- Implement `Create from latest output` action if existing APIs support it.
- Remove contradictory "format guide updated" messaging.

### Phase 4: Replay-Relevant Diffs

Backend plus frontend.

Tasks:

- Create normalized comparison object for replay-relevant task fields.
- Exclude layout and UI-only fields from business-facing replay invalidation.
- Persist/report field-level business diffs.
- Keep raw fingerprints for diagnostics.

### Phase 5: Repair Actions

Frontend plus existing mutation paths.

Tasks:

- Update reference from latest run.
- Create expected format from latest output.
- Switch preset to flexible consistency.
- Retry consistency check.
- Open technical details from any report reason.

## Test Expectations

### Unit Tests

Add/adjust tests for:

- Modal opens on correct default tab per entry point.
- Overview hides raw technical fields.
- Rules maps toggles to existing replay config.
- Missing output format shows one coherent state.
- Skipped report renders business reason and repair actions.
- Existing raw details remain available in Technical Details.
- Badge status does not display stale or contradictory score.

### Browser QA

Use the demo playbook:

`http://localhost:5173/#/playbooks/6a22b3e7b4d83379d948c96a`

Validate:

- Badge opens Overview.
- Business user can identify trusted answer.
- Missing expected format is understandable.
- Latest run with skipped replay explains why.
- Technical JSON is hidden by default and available in Technical Details.
- Mobile layout does not overlap or truncate key controls.

### Reviewer Gate

Required for implementation PRs because this touches runtime frontend behavior and replay interpretation.

## Acceptance Criteria

- A business user can explain what the Reference Run is without reading technical details.
- The node badge, modal, and result panel show a consistent status for the same run.
- Overview and Consistency screens contain no raw JSON, hashes, `positionX`, or `positionY`.
- Missing output format has one coherent status and a repair action.
- A skipped reference explains business impact, not raw snapshot mismatch.
- Every blocked state has at least one next action.
- Advanced users can still inspect all current raw capture sections.
- Existing replay execution semantics are preserved until backend phases explicitly change them.

## Recommended First Implementation Slice

Build the smallest high-impact slice:

1. Rename default UI to Reference Run and Consistency.
2. Rebuild the modal IA with Overview, Rules, History, Technical Details.
3. Move existing capture accordions into Technical Details.
4. Add a business outcome card to the Consistency panel.
5. Add summary mapping for the current observed skipped reasons.
6. Fix badge/report score contradiction by preferring status when the score source is ambiguous.

This slice should improve comprehension without changing replay execution behavior.
