# Playbook Step Result Pane Implementation Plan

## Goal

Restore the old high-quality step result experience in the new playbook-flow runtime and UI.

The target user experience is:

- The step result pane shows a clear human-readable answer for each step.
- Generated files render as explicit artifacts with filename, kind, and download/open actions.
- Structured multi-port outputs remain available for data flow and downstream bindings.
- The result pane does not dump raw JSON unless there is no better presentation available.
- Existing control-flow and data-binding behavior remains unchanged.

## Problem Summary

The old implementation had a richer result contract than the new playbook-flow path.

Old playbook runtime behavior:

- Structured final responses required `display_text` plus `outputs`.
- Generated files were normalized into `artifacts` with `url`, `filename`, and `mimeType`.
- The frontend rendered artifacts separately from the final text answer.

New playbook-flow behavior:

- Runtime step results mostly store a single raw `output` value.
- Structured outputs are flattened to a string too early.
- The result pane currently renders `components` or raw `output`, but not an artifact section.
- The new flow backend schema does not yet persist artifacts/components for task results.

## Critical Safety Rule

This work must not break the new control-flow or data-flow system.

### Hard Invariants

1. `ControlEdge` semantics must not change.
2. `DataBinding` semantics must not change.
3. Router condition evaluation must continue to read the same data it reads today unless updated in the same change.
4. Node-output bindings must remain backward-compatible.
5. `display_text` must be treated as a presentation field, not the only runtime data source.
6. If a result contains both presentation text and structured outputs, downstream resolution must still be able to read the structured outputs.

### Safe Design Principle

Add richer result fields additively.

Do not replace the current output contract with a presentation-only wrapper unless the resolver, persistence, and frontend are updated together.

## Current State Summary

Implemented today:

- New flow runtime can execute steps and persist `output` and `error`.
- Data-binding resolution in `yellowstorm-adk/src/flow_engine/bindings/resolver.py` supports plain strings, structured dict/list outputs, and JSON-string port envelopes.
- Frontend step detail already has an `ArtifactListItem` component.
- Frontend can render structured message `components` when present.

Missing or incomplete:

- New flow runtime does not emit `display_text`.
- New flow runtime does not emit normalized `artifacts` for step results.
- New flow backend schema for task results only stores `output`, `error`, and timestamps.
- `NodeCompleted` handling in playbook-flow stringifies structured objects.
- Current result pane does not render a dedicated artifact section for selected step executions.
- Export helpers do not include artifact-aware rendering.

## Scope

In scope:

- Runtime result contract enrichment for step results.
- Backend persistence and API normalization for enriched task results.
- Frontend result pane rendering updates.
- Regression coverage for control-flow/data-flow safety.

Out of scope for this plan:

- Rewriting binding semantics.
- Rewriting router condition semantics.
- Redesigning canvas data-binding UX.
- Changing old playbook module behavior unless needed as a reference.

## Phase 0: Contract and Safety Audit

### 0.1 Trace all readers of step result output

Affected paths:

- `yellowstorm-adk/src/flow_engine/bindings/resolver.py`
- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`
- `YellowStorm/front/src/modules/playbook/api.ts`
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`

Tasks:

- Enumerate every place that reads step `output` in the new flow path.
- Confirm whether router conditions inspect `output`, `outputs`, or parsed payloads.
- Confirm whether any flow endpoints or stores assume `output` is always a string.

Acceptance criteria:

- We have a written compatibility decision for `output` before code changes start.
- No implementation begins until the safe result contract is chosen.

### 0.2 Decide the new result contract

Recommended contract for new flow steps:

```json
{
  "output": "backward-compatible runtime value",
  "display_text": "user-visible answer",
  "artifacts": [],
  "components": []
}
```

Recommended semantics:

- `output`: preserve current downstream-readable value
- `display_text`: human-readable answer for pane rendering
- `artifacts`: normalized artifact list for files/data/text outputs
- `components`: optional richer rendered parts when available

Compatibility decision options:

1. Keep `output` as the current raw string and add `display_text`/`artifacts` alongside it.
2. Store a structured object in `output` only if all binding/router readers are updated in the same phase.

Preferred option:

- Option 1 for the first implementation slice.

Acceptance criteria:

- One explicit contract is chosen and documented in code comments or tests.

## Phase 1: Runtime Result Enrichment in `flow_engine`

### 1.1 Add structured final response support for new flow steps

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py`
- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- likely new helper module under `yellowstorm-adk/src/flow_engine/nodes/`

Tasks:

- Port the old structured-final-response prompt rules into the new flow engine.
- For steps with multiple semantic output ports, instruct the model to return:
  - `display_text`
  - `outputs[]`
- Keep plain-mode behavior for simple single-text-output steps unless structured mode is required.

Acceptance criteria:

- New flow prompt contract can request `display_text` and `outputs[]`.
- Plain single-output steps still work without regressions.

### 1.2 Add output finalization helpers in the new flow engine

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- possibly new helper file such as `yellowstorm-adk/src/flow_engine/nodes/step_result.py`

Tasks:

- Port the minimal old logic for:
  - parsing structured final responses
  - validating declared output ports
  - building normalized artifacts
- Reuse the same output-port matching rules where possible.
- Preserve current backward-compatible raw output semantics for downstream bindings.

Recommended emitted result payload for NodeCompleted:

```json
{
  "output": "existing downstream-compatible value",
  "display_text": "user-visible final answer",
  "artifacts": [...],
  "components": [...]
}
```

Acceptance criteria:

- A step can emit `display_text` and `artifacts` without changing edge or binding semantics.
- File outputs include filename/url metadata when available.

### 1.3 Preserve binding compatibility

Affected paths:

- `yellowstorm-adk/src/flow_engine/bindings/resolver.py`
- `yellowstorm-adk/src/flow_engine/tests/test_bindings.py`

Tasks:

- Ensure resolver behavior remains valid when enriched result payloads are present.
- If result storage shape changes, update resolver in the same phase.
- Add regression tests for:
  - plain text output
  - structured outputs
  - JSON-string output fallback behavior
  - file/document outputs by selected port

Acceptance criteria:

- Existing binding tests still pass.
- New enriched results do not break selected-port extraction.

## Phase 2: Backend Persistence and API Contract

### 2.1 Extend playbook-flow task result persistence

Affected paths:

- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow-task-result.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/interfaces/playbook-flow-execution.interface.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`

Tasks:

- Add additive fields to persisted task results, such as:
  - `displayText?: string`
  - `artifacts?: []`
  - `components?: []`
  - optional traces later if needed
- Update `handleRunEvent()` so `NodeCompleted` persists enriched fields instead of collapsing everything to a single JSON string.
- Keep `output` available for compatibility.

Acceptance criteria:

- Existing executions still load.
- New executions persist display text and artifacts.
- No migration is required for old documents beyond nullable fields.

### 2.2 Stop premature stringification at the backend boundary

Affected paths:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`

Tasks:

- Only stringify as a fallback for legacy/simple display paths.
- Preserve structured fields separately on the task result record.
- Avoid embedding the entire result object into `output` if that would degrade pane rendering.

Acceptance criteria:

- Backend stores structured result metadata separately.
- `output` remains predictable for existing readers.

### 2.3 Normalize enriched results for the frontend API

Affected paths:

- `YellowStorm/front/src/modules/playbook/api.ts`
- any related compat mapper if needed

Tasks:

- Extend `normalizeTaskResult()` to read new fields.
- Do not stringify enriched fields into `output` when a dedicated frontend field exists.
- Add frontend types for `displayText` and enriched artifacts if missing.

Acceptance criteria:

- Frontend receives `displayText` and `artifacts` directly.
- `output` is no longer the only source for step rendering.

## Phase 3: Frontend Result Pane Rendering

### 3.1 Reintroduce artifact section in the results tab

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`

Tasks:

- Render `selectedStepExecution.artifacts` in the results tab.
- Prefer selected execution artifacts over top-level `step.artifacts` when execution history is being browsed.
- Show file/document actions with the existing `ArtifactListItem`.

Acceptance criteria:

- Generated documents appear as distinct downloadable items.
- Browsing older attempts shows that attempt's artifacts, not only the latest step-level state.

### 3.2 Prefer `displayText` over raw `output`

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`
- `YellowStorm/front/src/modules/playbook/types.ts`

Rendering priority:

1. `components`
2. `displayText`
3. safe formatted `output`
4. empty state

Tasks:

- Add `displayText` to `TaskResult` and `StepExecutionHistoryEntry`.
- When no rich components exist, render `displayText` first.
- Only fall back to raw `output` when no better presentation field exists.

Acceptance criteria:

- The pane shows understandable final text instead of structured JSON when both exist.

### 3.3 Add structured output fallback renderer

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`
- possibly a small helper under `YellowStorm/front/src/modules/playbook/utils/`

Tasks:

- If `output` still arrives as structured JSON or JSON-string envelope, render it more intelligently.
- Detect shapes like:
  - `{ display_text, outputs }`
  - `{ ports: [...] }`
  - `{ outputs: {...} }`
- Show a readable summary instead of dumping raw JSON where possible.

Acceptance criteria:

- Legacy or partial payloads degrade gracefully.

## Phase 4: Export and Download Parity

### 4.1 Update HTML/PDF export rendering

Affected paths:

- `YellowStorm/front/src/modules/playbook/utils/renderStepResultHtml.ts`

Tasks:

- Teach export rendering to use `displayText` when available.
- Render artifact sections in exported HTML/PDF.
- Preserve links or filenames for generated files.

Acceptance criteria:

- Exported step result HTML/PDF matches the on-screen pane more closely.

### 4.2 Support artifact-aware copy behavior

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`

Tasks:

- Ensure clipboard export prefers readable text.
- Avoid copying raw JSON blobs when display text exists.

Acceptance criteria:

- Copy-to-clipboard gives the user-facing answer, not the internal envelope.

## Phase 5: Verification and Regression Protection

### 5.1 Runtime tests

Affected paths:

- `yellowstorm-adk/src/flow_engine/tests/` or nearby new tests

Add tests for:

- structured final response parsing
- display text extraction
- document artifact extraction
- plain single-output compatibility
- binding compatibility with enriched result payloads

### 5.2 Backend tests

Affected paths:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.spec.ts`
- any schema/interface tests as needed

Add tests for:

- `NodeCompleted` persists `displayText`
- `NodeCompleted` persists artifacts
- backend does not destroy `output` compatibility
- old result documents still normalize safely

### 5.3 Frontend tests

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.test.tsx`
- `YellowStorm/front/src/modules/playbook/api.test.ts`
- optional export helper tests

Add tests for:

- pane prefers `displayText`
- pane renders artifacts with filenames/download actions
- pane falls back to raw output only when necessary
- selected historical execution shows historical artifacts

### 5.4 Manual QA checklist

Scenarios:

1. Single text step
2. Multi-text-output step with `display_text`
3. Document generation step with file links
4. Data output step used by downstream binding
5. Router condition step using structured outputs
6. Re-execution and step-history selection
7. Export HTML/PDF from a step with artifacts

Acceptance criteria:

- Result pane quality is restored.
- Data bindings still resolve correctly.
- Router decisions still behave identically.

## Phase 6: Optional Follow-ups

### 6.1 Rich components in new flow runtime

If the new flow runtime should eventually match old conversation-style rendering more closely:

- add collector-backed component extraction for tool runs
- persist components in playbook-flow task results
- render citations/sources/code blocks with parity to old playbook runtime

This is optional and should come after `displayText + artifacts` parity is stable.

### 6.2 Shared result-finalization utility

If both old playbook runtime and new flow runtime keep converging:

- extract the common logic for structured final response parsing and artifact normalization
- avoid drift between `langgraph_engine` and `flow_engine`

## Recommended Delivery Order

1. Phase 0: contract decision and safety audit
2. Phase 1: runtime enrichment with binding-safe semantics
3. Phase 2: backend persistence and API normalization
4. Phase 3: frontend result pane rendering
5. Phase 5: regression coverage and QA
6. Phase 4: export parity
7. Phase 6: optional richer component parity

## Release Gate

This work is complete only when all of the following are true:

- The pane shows a user-facing answer via `displayText` or equivalent.
- Generated documents show as first-class artifacts with links/downloads.
- Downstream data bindings still resolve by selected source port.
- Router/control-flow behavior is unchanged.
- No raw JSON blob is shown to the user when a clearer rendering is available.
