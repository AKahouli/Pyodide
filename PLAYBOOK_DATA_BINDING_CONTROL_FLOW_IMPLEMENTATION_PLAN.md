# Playbook Data Binding and Control Flow Implementation Plan

## Goal

Make playbook execution work end-to-end with explicit port-based data flow, structured prompt contracts, artifact outputs, deterministic routing, and safe router-controlled loops.

The target user experience is:

- Users create nodes with input and output ports.
- Users connect output ports to input ports on the canvas.
- The system automatically creates data bindings for those port links.
- The system creates or maintains control flow separately from data flow.
- Runtime prompts receive only the resolved inputs for the target node.
- Node outputs are materialized per output port.
- Routers evaluate structured conditions and route deterministically.
- Loops are allowed only through bounded router cycles.

## Current State Summary

Implemented:

- `DataBinding` schema exists in `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts`.
- Frontend `DataBinding` type exists in `YellowStorm/front/src/modules/playbook/types.ts`.
- Data bindings are persisted through `updatePlaybook` and sent to runtime through gRPC.
- ADK resolver exists in `yellowstorm-adk/src/flow_engine/bindings/resolver.py`.
- Runtime builder calls `resolve_node_inputs()` before node execution.
- Prompt builder renders `Resolved Inputs` and `Output Contract`.
- Router-controlled cycle support exists partially in frontend and ADK guards.

Missing or incomplete:

- Port-to-port canvas links do not create `DataBinding` records.
- Data bindings are not rendered as a visual data layer.
- Node outputs are stored as one text string, not per output port.
- Document/data artifacts are not materialized by the current flow runtime.
- Router conditions are LLM label selection, not deterministic condition rules.
- Backend validation has stubs for type matching, cycle terminal checks, and iterator DAG checks.
- AI-generated/designed flows drop data bindings.
- Multiple port links between the same two nodes are stored as multiple execution edges.

## Core Design Rules

1. **Ports carry data.**
2. **Control edges carry execution order.**
3. **Router edges carry decisions.**
4. **Input port IDs are prompt input keys.**
5. **Output port IDs are output contract keys.**
6. **Display labels may be human-friendly; runtime port IDs must be stable and machine-safe.**
7. **A port-to-port link creates a data binding; it should not require manual binding entry.**
8. **A node-to-node execution dependency should be represented once, even when multiple data bindings exist between the same nodes.**

## Example Target Behavior

Flow:

```text
A -> B -> C -> Router
Router(valid) -> END
Router(invalid) -> A
```

Node A:

- Prompt: generate a summary about AI and find the most known AI leaders in America.
- Outputs:
  - `summary` (`text`)
  - `aiLeaders` (`data`)

Node B:

- Prompt: generate an Excel report.
- Inputs:
  - `aiLeaders` (`data`)
- Outputs:
  - `leaderSheet` (`document`)

Node C:

- Prompt: evaluate the Excel report.
- Inputs:
  - `leaderSheet` (`document`)
- Outputs:
  - `result` (`data`), with shape `{ "verdict": "valid" | "invalid", "issues": [] }`

Router:

- `valid` route when `C.result.verdict == "valid"`.
- `invalid` route when `C.result.verdict == "invalid"`.
- `invalid` loops back to A.
- Max iterations must be configured.

Automatic data bindings:

```json
[
  {
    "sourceKind": "node-output",
    "sourceNode": "A",
    "sourcePort": "aiLeaders",
    "targetNode": "B",
    "targetPort": "aiLeaders",
    "iteration": "current"
  },
  {
    "sourceKind": "node-output",
    "sourceNode": "B",
    "sourcePort": "leaderSheet",
    "targetNode": "C",
    "targetPort": "leaderSheet",
    "iteration": "current"
  }
]
```

Optional feedback binding for retries:

```json
{
  "sourceKind": "node-output",
  "sourceNode": "C",
  "sourcePort": "result",
  "targetNode": "A",
  "targetPort": "evaluationFeedback",
  "iteration": "current"
}
```

## Phase 1: Define Contracts

### 1.1 Port Contract

Affected paths:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/proto/playbook-flow.proto`
- `yellowstorm-adk/grpc/proto/playbook-flow.proto`

Define port fields:

- `id`: stable runtime key, camelCase or snake_case, no spaces.
- `label`: user-visible display name.
- `type`: `text`, `data`, `document`, or other supported artifact kind.
- `required`: true/false for input ports.
- Optional `schema`: JSON schema for `data` ports.
- Optional `mimeTypes`: accepted/generated MIME types for document ports.

Acceptance criteria:

- Frontend displays labels but persists and binds IDs.
- Backend validates IDs and rejects invalid or duplicate IDs per node.
- Runtime prompt uses port IDs as keys.

### 1.2 Data Binding Contract

Affected paths:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts`
- `yellowstorm-adk/src/flow_engine/bindings/__init__.py`
- `yellowstorm-adk/src/flow_engine/bindings/resolver.py`

Contract:

```ts
interface DataBinding {
  id: string;
  targetNode: string;
  targetPort: string;
  sourceKind: 'node-output' | 'trigger' | 'state' | 'constant' | 'expression';
  sourceNode?: string;
  sourcePort?: string;
  iteration?: 'current' | 'previous' | string;
  triggerPath?: string;
  statePath?: string;
  constantValue?: unknown;
  expression?: string;
}
```

Rules:

- `node-output` bindings require `sourceNode`, `sourcePort`, `targetNode`, and `targetPort`.
- A required input port must have exactly one binding.
- Optional input ports may have zero or one binding unless explicitly declared as multi-input later.
- Binding source and target artifact kinds must be compatible.
- Missing source values must be logged and surfaced in execution diagnostics.

Acceptance criteria:

- Invalid bindings are rejected at save time by backend validation.
- Runtime emits a clear warning or error for unresolved required inputs.

### 1.3 Prompt Construction Contract

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py`
- `yellowstorm-adk/src/flow_engine/nodes/step.py`

Prompt invariant:

- `Resolved Inputs` contains only values resolved for the current node's input ports.
- Keys in `Resolved Inputs` are target input port IDs.
- `Output Contract` contains all output ports and required response shape.
- The model must be instructed to return data keyed by output port IDs.

Example prompt sections:

```text
Resolved Inputs:
{
  "aiLeaders": [...]
}

Output Contract:
{
  "leaderSheet": {
    "artifactKind": "document",
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
}
```

Acceptance criteria:

- Prompt tests verify input keys match target input ports.
- Prompt tests verify output contract keys match output ports.

## Phase 2: Frontend Canvas UX

### 2.1 Separate Data Links From Control Edges

Affected paths:

- `YellowStorm/front/src/modules/playbook/hooks/usePlaybookCanvas.ts`
- `YellowStorm/front/src/modules/playbook/hooks/helpers/control-edge-serializer.ts`
- `YellowStorm/front/src/modules/playbook/hooks/helpers/data-binding-serializer.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`

Change behavior:

- Dragging node body to node body creates a control edge.
- Dragging router output label to a node creates a conditional control edge.
- Dragging an output port to an input port creates a data binding.
- If no execution path exists between source and target, the UI may offer to also create a control edge.
- Multiple data bindings between the same two nodes must not create duplicate sequential control edges.

Acceptance criteria:

- `A.aiLeaders -> B.aiLeaders` creates one `DataBinding`.
- Two links `A.x -> B.x` and `A.y -> B.y` create two data bindings and at most one control edge.
- Data bindings persist through save, refresh, undo, redo, and delete.

### 2.2 Data Binding Visual Layer

Affected paths:

- `YellowStorm/front/src/modules/playbook/hooks/helpers/data-binding-serializer.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookCanvasPage.tsx`

Implement:

- Render data bindings as a dashed or colored overlay distinct from control edges.
- Show source port, target port, artifact type, and iteration on hover.
- Add toolbar toggle: show/hide data bindings.
- Add warning styling for type mismatch or missing port.

Acceptance criteria:

- Users can visually distinguish execution order from data flow.
- Data binding overlay reflects persisted `playbook.dataBindings`.

### 2.3 Binding Inspector UI

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/PlaybookDataBindingSection.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookNodeEditor.tsx`

Change behavior:

- Pass `targetNodeId` when rendering the section in the node editor.
- Replace free-text fields with node and port selectors.
- Show bindings grouped by target input port.
- Keep manual binding creation as advanced/fallback only.
- For each input port, show source node, source port, artifact kind, and iteration.

Acceptance criteria:

- Node B editor shows `aiLeaders` input bound from `A.aiLeaders`.
- Users can remove or retarget a binding safely.

### 2.4 Trigger Bindings

Affected paths:

- `YellowStorm/front/src/modules/playbook/hooks/usePlaybookCanvas.ts`
- `YellowStorm/front/src/modules/playbook/hooks/helpers/node-serializer.ts`

Implement:

- Trigger output ports should create `sourceKind: 'trigger'` bindings, not normal task edges.
- Use stable trigger paths for mail/schedule/manual payloads.

Acceptance criteria:

- `trigger.mailData -> A.email` resolves from `state.inputs` at runtime.

## Phase 3: Backend Validation and Persistence

### 3.1 Complete Data Binding Validation

Affected paths:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-validator.service.ts`

Implement:

- Validate source node exists for `node-output` bindings.
- Validate target node exists for all bindings.
- Validate source output port exists.
- Validate target input port exists.
- Validate artifact type compatibility.
- Validate no duplicate binding for single-value target ports.
- Validate required input ports are bound.
- Validate `previous` iteration usage only inside bounded router cycles or iterator contexts.

Acceptance criteria:

- Save rejects invalid source/target ports.
- Save rejects data-to-document mismatches unless an explicit converter is defined.
- Validation errors identify binding ID and affected node/port.

### 3.2 Complete Control Flow Validation

Affected paths:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-validator.service.ts`

Implement currently stubbed rules:

- `checkRouterTerminalRoute()`
- `checkCycleRouterPresence()`
- `checkIteratorContainerDag()`

Rules:

- Cycles are allowed only through routers with `maxIterations > 0`.
- Every loop router must have a terminal route.
- Router output labels must have matching conditional edges.
- Conditional edges must only start from routers.
- Every router cycle must have at least one route that leaves the cycle.

Acceptance criteria:

- Backend rejects unbounded loops.
- Backend accepts `A -> B -> C -> Router -> A` only when Router has a terminal route and max iterations.

### 3.3 Preserve Bindings Across Design Updates

Affected paths:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-design-mapper.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-design.service.ts`

Implement:

- Map generated gRPC data binding output when available.
- Preserve existing data bindings during design rewrite when source/target nodes and ports still exist.
- Drop invalid bindings loudly with WARN logs and design message summary.

Acceptance criteria:

- AI design updates do not silently wipe bindings.
- Generated flows can include initial data bindings.

## Phase 4: Runtime Structured Outputs

### 4.1 Materialize Per-Port Outputs

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `yellowstorm-adk/src/flow_engine/nodes/step_prompt.py`
- `yellowstorm-adk/src/flow_engine/runtime/ports.py`

Current issue:

```python
result_payload = {
    "node_id": node_id,
    "iteration": iteration,
    "output": full_output,
}
```

Target structure:

```json
{
  "node_id": "A",
  "iteration": 0,
  "outputs": {
    "summary": {
      "artifactKind": "text",
      "content": "..."
    },
    "aiLeaders": {
      "artifactKind": "data",
      "content": [
        { "name": "...", "company": "..." }
      ]
    }
  }
}
```

Resolver compatibility:

- First look in `outputs[sourcePort].content`.
- Then fall back to legacy `output[sourcePort]`.
- Then fall back to legacy `output` when `sourcePort` is `output` or `default`.

Acceptance criteria:

- `A.aiLeaders -> B.aiLeaders` resolves the `aiLeaders` port content, not raw full text.
- Existing flows using `output` continue to work during migration.

### 4.2 Parse and Validate Model Output

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `yellowstorm-adk/src/flow_engine/runtime/ports.py`

Implement:

- Require structured JSON when node has multiple output ports or non-text outputs.
- Validate returned output port IDs against declared output ports.
- Log missing, extra, or invalid output ports.
- For required output ports, fail node or emit structured validation error.

Acceptance criteria:

- Node A cannot silently return prose when `summary` and `aiLeaders` are required output ports.
- Output parsing errors appear in execution trace.

### 4.3 Artifact and Document Output Support

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `yellowstorm-adk/src/flow_engine/runtime/ports.py`
- Backend execution event handling in `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`

Implement:

- Artifact object model for `text`, `data`, and `document`.
- Storage flow for generated documents.
- Excel generation path for document output ports.
- Event payload support for generated artifacts.

Acceptance criteria:

- Node B can produce a real Excel artifact on `leaderSheet`.
- Node C can receive `leaderSheet` as a document input.

## Phase 5: Deterministic Router Conditions

### 5.1 Router Condition Model

Affected paths:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/proto/playbook-flow.proto`
- `yellowstorm-adk/grpc/proto/playbook-flow.proto`
- `yellowstorm-adk/src/flow_engine/nodes/router.py`

Extend router config:

```ts
interface RouterCondition {
  label: string;
  sourceNode?: string;
  sourcePort?: string;
  path?: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'exists' | 'gt' | 'gte' | 'lt' | 'lte';
  value?: unknown;
}

interface RouterConfig {
  outputLabels: string[];
  maxIterations: number;
  conditions?: RouterCondition[];
  defaultLabel?: string;
}
```

Example:

```json
{
  "outputLabels": ["invalid", "valid"],
  "defaultLabel": "invalid",
  "maxIterations": 3,
  "conditions": [
    {
      "label": "valid",
      "sourceNode": "C",
      "sourcePort": "result",
      "path": "verdict",
      "operator": "equals",
      "value": "valid"
    }
  ]
}
```

Acceptance criteria:

- Router can route without an LLM call when conditions exist.
- LLM router remains available as an explicit mode if needed.

### 5.2 Router UI

Affected paths:

- `YellowStorm/front/src/modules/playbook/components/PlaybookRouterConfigSection.tsx`
- `YellowStorm/front/src/modules/playbook/components/RouterNode.tsx`

Implement:

- Condition builder UI.
- Source node/port picker.
- Path field for data outputs.
- Operator selector.
- Default route selector.
- Max iteration setting with required terminal route warning.

Acceptance criteria:

- User can express `C.result.verdict == valid -> valid` from UI.

## Phase 6: Execution Diagnostics and Observability

### 6.1 Resolved Input Trace

Affected paths:

- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `yellowstorm-adk/src/flow_engine/runtime/events.py`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`
- `YellowStorm/front/src/modules/playbook/components/ExecutionStepDetail.tsx`

Emit per node:

- binding ID
- source node/port
- target port
- resolved value summary
- missing/invalid status

Acceptance criteria:

- Execution detail shows exactly what B received from A.
- Missing binding values are visible without backend logs.

### 6.2 Output Port Trace

Emit per node:

- output port ID
- artifact kind
- content preview or artifact metadata
- validation status

Acceptance criteria:

- Execution detail shows A produced `summary` and `aiLeaders` separately.

### 6.3 Router Decision Trace

Emit per router:

- selected label
- condition that matched
- compared source value
- fallback/default if used
- max-iteration terminal override if used

Acceptance criteria:

- Execution detail explains why the router looped or terminated.

## Phase 7: Migration and Backward Compatibility

### 7.1 Existing Edge Migration

Affected paths:

- `YellowStorm/front/src/modules/playbook/api.compat.ts`
- `YellowStorm/front/src/modules/playbook/api.ts`
- optional backend migration script/service

Migration rules:

- Existing `edges` continue as control edges.
- If an existing edge has non-default port handles, create equivalent `DataBinding` during migration or normalization.
- Preserve legacy `sourceOutputPortId` and `targetInputPortId` during compatibility period.

Acceptance criteria:

- Existing port-linked playbooks gain bindings without manual recreation.

### 7.2 Legacy Output Compatibility

Runtime resolver should support both:

```json
{ "output": "legacy text" }
```

and:

```json
{ "outputs": { "portId": { "content": "..." } } }
```

Acceptance criteria:

- Old executions and old flows do not break immediately.

## Phase 8: Tests

### Frontend Tests

Add or update:

- `YellowStorm/front/src/modules/playbook/hooks/usePlaybookCanvas.test.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookDataBindingSection.test.tsx`
- `YellowStorm/front/src/modules/playbook/components/PlaybookRouterConfigSection.test.tsx`

Test cases:

- Port link creates data binding.
- Multiple port links create multiple data bindings and one control edge.
- Router label link creates conditional control edge only.
- Trigger port link creates trigger binding.
- Binding inspector scopes to selected node.
- Invalid artifact kind link shows warning.

### Backend Tests

Add or update:

- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-validator.service.spec.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-design-mapper.spec.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.spec.ts`

Test cases:

- Required port with no binding rejects.
- Unknown source/target ports reject.
- Type mismatch rejects.
- Router cycle without terminal route rejects.
- Design rewrite preserves valid bindings and warns on drops.
- gRPC payload maps data bindings correctly.

### ADK Tests

Add or update:

- `yellowstorm-adk/src/flow_engine/tests/test_bindings.py`
- `yellowstorm-adk/src/flow_engine/tests/test_step.py`
- `yellowstorm-adk/src/flow_engine/tests/test_conditional.py`
- `yellowstorm-adk/src/flow_engine/tests/test_integration.py`

Test cases:

- Resolver reads `outputs[portId].content`.
- Resolver supports legacy `output` fallback.
- Step prompt includes resolved input ports.
- Step validates structured multi-port output.
- Router condition routes deterministically.
- Loop terminates at valid route.
- Loop stops at max iterations.

## Phase 9: Rollout Plan

### Milestone 1: Safe Binding Persistence

- Auto-create data bindings from port links.
- Preserve current execution behavior.
- Add backend validation for binding endpoints.

Risk:

- Existing flows may have port edges that were intended only as visual execution links.

Mitigation:

- Migrate only non-router output-to-input port links.
- Keep control edge generation explicit or ask user when ambiguous.

### Milestone 2: Structured Inputs and Prompt Contract

- Prompt receives resolved input ports only.
- Binding diagnostics show resolved inputs.
- Frontend binding inspector is usable.

Risk:

- Nodes that relied on implicit trigger/global context may lose context.

Mitigation:

- Auto-create trigger bindings for entry nodes where appropriate.
- Show explicit `Trigger Context` separately.

### Milestone 3: Structured Outputs

- Runtime materializes per-port outputs.
- Resolver reads per-port outputs.
- Legacy output fallback remains.

Risk:

- LLM may produce malformed JSON.

Mitigation:

- Add retry/repair once for structured output parsing.
- Emit clear node failure diagnostics.

### Milestone 4: Artifacts and Documents

- Add document artifact support.
- Support Excel output generation.

Risk:

- Storage and security concerns for generated files.

Mitigation:

- Store artifacts through existing controlled storage paths.
- Include owner/workspace metadata and audit events.

### Milestone 5: Deterministic Routing

- Add router condition schema and UI.
- Keep LLM router as optional fallback mode.

Risk:

- Existing router labels may not have conditions.

Mitigation:

- Treat no-conditions routers as legacy LLM routers.

## Open Decisions

1. Should port-to-port links automatically create a control edge, or should data and execution links be fully separate gestures?
2. Should every input port accept only one binding initially, or do we need multi-source fan-in now?
3. Should structured output parsing fail hard or allow fallback to raw text for optional output ports?
4. Should Excel generation be handled by the LLM/tool layer, a deterministic backend utility, or both?
5. Should router conditions live on router config only, or on conditional edges?
6. Should generated AI designs create bindings directly, or should frontend/backend infer bindings from port-compatible edges?

## Definition of Done

The feature is complete when this scenario works without manual JSON editing:

1. User creates A, B, C, and Router.
2. User defines A outputs `summary` and `aiLeaders`.
3. User defines B input `aiLeaders` and output `leaderSheet`.
4. User defines C input `leaderSheet` and output `result`.
5. User connects A.aiLeaders to B.aiLeaders.
6. User connects B.leaderSheet to C.leaderSheet.
7. User configures Router condition `C.result.verdict == valid`.
8. User connects Router.valid to END and Router.invalid to A.
9. Execution runs A, B, C, Router.
10. B receives only `aiLeaders` as resolved input.
11. C receives only `leaderSheet` as resolved input.
12. Router reads C's structured result and routes deterministically.
13. Invalid result loops back to A until valid or max iterations.
14. Execution detail shows resolved bindings, produced port outputs, router decisions, and artifacts.
