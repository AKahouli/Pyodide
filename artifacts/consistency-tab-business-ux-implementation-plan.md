# Consistency Tab Business UX Implementation Plan

## Purpose

Refactor the execution step Consistency tab into a business-user decision surface.

The target user should immediately understand:

- whether the latest run can be trusted,
- what business-relevant values changed,
- what action to take next,
- where to open advanced diagnostics when needed.

The current implementation already has the underlying report data. The first implementation should therefore be frontend-first and avoid backend contract changes unless the UI cannot reliably derive field-level differences from existing report structures.

## Current UX Problems

The current tab mixes four different audiences in one continuous view:

- business user: needs a trust decision and changed business facts,
- workflow owner: needs rule health and reference maintenance actions,
- support user: needs run eligibility and skipped/applied sections,
- engineer: needs model metadata, raw judge output, semantic scores, and tool traces.

Observed issues in the demo playbook:

- The top result says `Needs review` with `Score: 90%`.
- The synthesis says `Minor Drift` with `Overall: 87%`.
- The diagnostics later say `Semantic preservation: 60%`.
- `Reference HITL memory` appears near the top even when all values are zero.
- HITL terminology is exposed to business users, although it belongs to human-in-the-loop operations and replay internals.
- The concrete business changes are buried below model and score details.
- Diagnostics are not collapsed, so raw implementation concepts dominate the tab.

## Target UX

Rename the tab from `Consistency` to `Result Check` or `Reference Check`.

Recommended final label:

`Reference Check`

Reason: it ties directly to the new Reference Run vocabulary and answers whether the run stayed aligned with the reference.

The default tab should contain four business-first blocks:

1. Trust banner
2. Business changes
3. Rules checked
4. Recommended fix

Everything else goes under one collapsed `Advanced diagnostics` section.

## Information Architecture

### Default View

```text
Reference Check

[Review needed] Trust level: High with changes
This run mostly follows the reference, but 2 business values changed.

Primary actions:
[Review changes] [Update reference rules] [Accept this run]

Business changes
Company        Field       Reference             This run                  Impact
InVivo Group   Region      Ile-de-France         National footprint         Review
Agrial         Competitor  VIVESCIA              InVivo Group               Changed

Rules checked
[Passed] Same task intent
[Passed] Same companies
[Review] Same region format
[Review] Same competitor mapping
[Needs setup] Expected answer format not defined

Recommended fix
The reference does not define the expected answer format.
[Create expected format from this result] [Edit reference rules]

Advanced diagnostics
```

### Advanced Diagnostics

Collapsed by default.

Contents:

- post-run judge scores,
- model and timestamp,
- raw judge response,
- technical verdict,
- replay eligibility,
- applied and skipped sections,
- signal evaluation,
- semantic preservation internals,
- drift policy,
- structural and tooling diagnostics,
- expected vs observed tool calls,
- human input / HITL details only when relevant.

## Component Scope

Primary implementation file:

- `YellowStorm/front/src/modules/playbook/components/ReplayReportPanel.tsx`

Likely supporting files:

- `YellowStorm/front/src/modules/playbook/components/ReplayReportPanel.test.tsx`
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`
- `YellowStorm/front/src/modules/playbook/locales/en.json`
- `YellowStorm/front/src/modules/playbook/locales/fr.json`
- `YellowStorm/front/src/modules/playbook/types.ts` only if new frontend-only projection types are useful

No backend change is required for the first slice.

Backend may be useful later only if field-level business diffs need to be produced as structured data instead of inferred from `changedPoints`, `missingPoints`, `semanticFindings`, and `driftFindings`.

## Implementation Strategy

### Phase 1: Rename The Surface

Change visible labels:

- `detail.tabs.evaluation`: `Consistency` -> `Reference Check`
- `replayReport.title`: `Consistency` -> `Reference Check`
- `replayReport.postRun.detailsTitle`: `Consistency diagnostics` -> `Advanced diagnostics`
- `replayReport.postRun.title`: avoid `Consistency synthesis`; use `Run comparison` only inside diagnostics if still needed.

Do not rename backend concepts, DTO fields, or stored report fields in this phase.

### Phase 2: Create A Business Projection

Add a local projection builder inside `ReplayReportPanel.tsx` or a small sibling mapper if the component grows too much.

Recommended function:

```ts
function buildReferenceCheckViewModel(report: ReplayRunReport): ReferenceCheckViewModel
```

Suggested shape:

```ts
type ReferenceCheckViewModel = {
  outcome: 'trusted' | 'review' | 'blocked' | 'not_used' | 'pending';
  trustLabel: string;
  trustDescription: string;
  primaryScore: number | null;
  changedItems: BusinessChangeItem[];
  checkedRules: CheckedRuleItem[];
  recommendedActions: ReferenceCheckAction[];
  shouldShowHumanInputSummary: boolean;
};
```

Keep this projection frontend-only at first. It should map existing report fields into clearer business language.

Important rule: display one headline confidence only. Do not show multiple competing scores in the default view.

### Phase 3: Rebuild The Default Layout

Replace the current default order with:

1. Trust banner
2. Recommended actions
3. Business changes
4. Rules checked
5. Reference maintenance prompt
6. Collapsed advanced diagnostics

The trust banner should use one decisive label:

- `Ready to trust`
- `Review needed`
- `Do not trust yet`
- `Reference not used`
- `Check in progress`

Avoid `Pass`, `Warning`, `Fail`, `Skipped` in the default view. Those can remain in advanced diagnostics.

### Phase 4: Business Changes Panel

Create a compact business change list from the best available data.

Initial data sources, in priority order:

1. `postRunEvaluation.changedPoints`
2. `postRunEvaluation.missingPoints`
3. structured semantic findings from `semanticMatch`
4. `driftFindings`
5. `verdictReasons`

First implementation can use readable grouped bullets when structured fields are not available:

```text
Changed answers
- Region values were generalized instead of specific French regions.
- Agrial's competitor changed from VIVESCIA to InVivo Group.

Missing reference rules
- Expected answer format is not defined.
```

If enough structure exists, render a table:

| Item | Field | Reference | This run | Impact |
|------|-------|-----------|----------|--------|

Do not block Phase 1 on perfect structured diff extraction. A clean bullet list is better than exposing raw scoring internals.

### Phase 5: Rules Checked Panel

Render checks as business-readable rule rows.

Source mapping:

- intent signal -> `Same task intent`
- output contract / output format -> `Expected answer format`
- semantic preservation -> `Same answer meaning`
- tool sequence / tool policy -> `Required evidence steps`
- context substitution / context drift -> `Same business context`
- reasoning -> `Same reasoning path`

Statuses:

- `Passed`
- `Changed`
- `Needs setup`
- `Not checked`

Avoid words like `semantic`, `argument shape`, `drift policy`, `tool definition`, and `decision invariants` outside advanced diagnostics.

### Phase 6: Human Input Summary Policy

Remove the visible `Reference HITL memory` block from the default view.

Default behavior:

- If all HITL summary counts are zero and no context drift exists, hide the block completely.
- If human input affected the check, show a plain-language business row:
  - Title: `Human input`
  - Example: `No approvals or clarifications were reused in this check.`
  - Example: `This run asked for one new clarification compared with the reference.`

Move the full HITL counters into `Advanced diagnostics`.

Advanced title:

`Human input diagnostics`

Do not use `HITL` in default business copy. If the acronym remains anywhere, it should be inside advanced diagnostics only.

### Phase 7: Collapse Advanced Diagnostics

Wrap all current technical report sections below the business view in a single collapsed panel:

`Advanced diagnostics`

This panel should contain the existing sections, but grouped and ordered:

1. Evaluation metadata
2. Technical verdict
3. Reference application / eligibility
4. Signal evaluation
5. Semantic and drift details
6. Structural and tooling details
7. Tool call evidence
8. Human input diagnostics
9. Raw judge response

Keep the existing detailed data available, but make it intentionally secondary.

### Phase 8: Action Buttons

Add visible actions only if existing handlers already exist or can be introduced without backend changes.

First slice can use non-destructive links/buttons that open existing surfaces:

- `Review changes`: scroll/focus the Business changes panel.
- `Edit reference rules`: open the existing reference settings modal on the Rules or Settings tab.
- `Create expected format`: open the reference settings modal where output format can be edited.
- `Accept this run`: only implement if an existing validated-reference save action is already available from this context.

If no handler exists yet, render actions as future acceptance criteria instead of inert buttons. Do not add fake controls.

## Copy Requirements

Default business copy should be direct and plain.

Use:

- `Reference Check`
- `Review needed`
- `Ready to trust`
- `Do not trust yet`
- `Reference not used`
- `What changed`
- `Rules checked`
- `Recommended fix`
- `Human input`
- `Advanced diagnostics`

Avoid in the default view:

- HITL
- replay
- baseline
- semantic
- drift policy
- decision invariants
- tool definition
- argument shape
- raw judge
- eligibility

Advanced diagnostics may keep technical labels when useful.

## Visual Design Expectations

The UI should feel like an operational review surface, not a developer log.

Layout:

- one strong top banner,
- concise cards, no cards nested inside cards,
- dense but readable table/list for changes,
- collapsed advanced section,
- stable spacing and no large decorative styling.

Tone:

- green for trust,
- amber for review,
- red for blocked,
- muted gray for not used / not checked.

Responsive behavior:

- On desktop, business changes can be a table.
- On narrow panes/mobile, business changes should become stacked rows.
- Action buttons must wrap without text overflow.

Accessibility:

- statuses must not rely only on color,
- collapsible advanced section needs a clear label and expanded state,
- table headers must remain meaningful,
- buttons must have specific labels.

## Testing Plan

Frontend unit tests:

- `ReplayReportPanel.test.tsx`
  - renders `Reference Check` headline,
  - shows only one headline trust score,
  - maps warning/minor drift into `Review needed`,
  - hides zero-count human input/HITL summary in default view,
  - shows human input summary only when counts or context drift are non-zero,
  - keeps full HITL details inside advanced diagnostics,
  - keeps raw judge response collapsed,
  - renders changed/missing points in business wording.

- `ExecutionStepDetail.test.tsx`
  - tab label changes from `Consistency` to `Reference Check`,
  - `ReplayReportPanel` still renders in the same execution tab.

Locale validation:

- English and French keys added together.
- No new hardcoded user-facing text in React components.

Browser QA:

- Open `http://localhost:5173/#/playbooks/6a22b3e7b4d83379d948c96a`.
- Run or select an execution with a reference check.
- Confirm the default tab shows business summary first.
- Confirm zero HITL state is hidden.
- Expand `Advanced diagnostics` and confirm detailed report content remains available.
- Verify desktop and narrow pane layouts.
- Check console for errors.

Recommended command-level verification:

```bash
cd YellowStorm/front
npm test -- ReplayReportPanel.test.tsx ExecutionStepDetail.test.tsx
```

If the touched files trigger broader TypeScript concerns, also run:

```bash
cd YellowStorm/front
npm run build
```

## Acceptance Criteria

The change is acceptable when:

- A business user can understand the result in the first screen without scrolling.
- The tab exposes one headline decision, not competing scores.
- Business changes appear before technical diagnostics.
- HITL terminology is absent from the default view.
- Zero-value human input summaries are hidden.
- Advanced users can still access the full report details from a collapsed panel.
- Existing replay/reference report data remains source-of-truth; no backend behavior changes are required.
- English and French locales are updated.
- Focused tests pass.
- Browser QA confirms the demo playbook is readable in the execution step pane.

## Recommended First Implementation Slice

Implement this slice first:

1. Rename the tab and report title to `Reference Check`.
2. Hide the default HITL block when all counts are zero.
3. Move full HITL details into advanced diagnostics.
4. Wrap all existing technical sections in a collapsed `Advanced diagnostics` panel.
5. Keep the current trust banner, but remove competing post-run score cards from the default view.
6. Replace `Consistency synthesis` with a business `What changed` panel using existing `summary`, `changedPoints`, and `missingPoints`.
7. Update tests and locales.

This first slice should deliver the largest UX improvement without backend changes.

## Later Backend Enhancement

Only after the frontend projection proves useful, consider adding a structured business diff to the report contract:

```ts
businessDiff: Array<{
  subject: string;
  field: string;
  referenceValue: string | null;
  currentValue: string | null;
  impact: 'info' | 'review' | 'blocked';
  source: 'judge' | 'rule' | 'tool' | 'format';
}>
```

This would make the business change table deterministic and easier to localize.

Do not add this contract in the first frontend refactor unless existing data cannot support the default UX.
