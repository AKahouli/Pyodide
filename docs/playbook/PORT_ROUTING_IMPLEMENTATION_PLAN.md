# Port Routing Implementation Plan

## Goal

Implement strict port-aware execution in the LangGraph service so that:

1. A downstream task receives only the context bound to each of its input ports.
2. Input ports follow a strict 1-to-1 source rule for upstream task outputs.
3. Tools become port-aware, starting with search and code interpreter, while staying extensible for future tools.
4. When a task has no bound input-port sources, the task still has access to the default playbook workspace context selected by the user.

## Scope

This plan covers backend execution semantics for:

1. Upstream output port to downstream input port routing.
2. Port-aware context resolution before task execution.
3. Port-aware tool scoping.
4. Fallback behavior to default playbook workspace context.
5. Consistency across workflow execution and direct single-step execution.

This plan does not cover frontend UX redesign.

## Current State

The current service already has partial support:

1. `graph_builder.py` resolves edge mappings using `source_output_port_id` and `target_input_port_id`.
2. `graph_builder.py` stores produced artifacts in `artifacts_by_port`.
3. `step_executor.py` and `graph_builder.py` now pass bound document IDs into tool creation.
4. `playbook_tool_factory.py` supports filtered document search using a flat `input_files` list.

Current limitations:

1. Port resolution is rebuilt ad hoc during prompt construction.
2. `artifacts_by_port` stores one artifact per `task_id:port_id`, which is not future-proof.
3. Tool scoping loses port identity because `input_files_by_port` is flattened.
4. No strict backend enforcement exists for 1-to-1 input-port source binding.
5. Fallback to playbook selected workspaces is implicit rather than formalized per task execution.
6. Workflow path and direct step path still rely on duplicated execution preparation logic.

## Functional Requirements

1. Each input port may receive at most one upstream source binding from another task output port.
2. Each input port may also have zero or more bound documents from drag-and-drop.
3. For a given task execution, the service must resolve all effective inputs per input port before building prompt or tools.
4. The downstream task prompt must clearly identify which upstream source or bound documents belong to which input port.
5. Search and code interpreter tools must receive only the sources relevant to the task, with port grouping preserved.
6. If no input-port sources are bound, the task must still be able to use the default playbook workspace context selected at playbook level.
7. The implementation must be extensible so future tools can consume the same resolved port context without custom routing logic.

## Design Principles

1. Port resolution must become a first-class backend concern, not just prompt formatting.
2. Prompt building and tool scoping must consume the same resolved input model.
3. Workflow execution and direct step execution must share the same preparation path.
4. Input-port routing rules must be validated by the backend even if the frontend also constrains them.
5. Fallback workspace access must be explicit and deterministic.

## Target Architecture

### Canonical Runtime Model

Introduce a resolved input model built per task before execution.

Suggested shape:

```python
ResolvedTaskInputs = {
  "task_id": "<task_id>",
  "ports": {
    "<input_port_id>": {
      "input_port": {
        "id": "<input_port_id>",
        "name": "<port_name>",
        "artifact_kind": "<kind>",
        "required": True,
        "description": "<description>",
      },
      "upstream_binding": {
        "source_task_id": "<source_task_id>",
        "source_output_port_id": "<source_output_port_id>",
        "artifact_kind": "<artifact_kind>",
        "artifacts": [],
      } | None,
      "document_bindings": {
        "document_ids": [],
      },
    }
  },
  "fallback_workspace_context": [],
}
```

This object becomes the source of truth for:

1. Prompt generation.
2. Search tool scoping.
3. Code interpreter file staging decisions.
4. Future port-aware tools.

## Phase 1: Enforce Strict 1-to-1 Input Port Routing

### Objective

Ensure each input port can receive at most one upstream output-port source.

### Changes

1. Add a backend validation helper in the LangGraph service that scans `edges` for each target task.
2. Detect whether multiple edges target the same `target_id + target_input_port_id`.
3. Reject execution early with a clear error if multiple upstream task outputs are bound to the same input port.
4. Keep document drag-and-drop bindings separate from upstream task-output bindings. The strict 1-to-1 rule applies to upstream task-output routing first.

### Suggested Location

1. `yellowstorm-adk/src/langgraph_engine/workflow_service.py`
2. Or a new helper module such as `yellowstorm-adk/src/langgraph_engine/port_resolution.py`

### Acceptance Criteria

1. Execution fails with a clear message if one input port receives multiple upstream edges.
2. Execution succeeds when each input port has zero or one upstream source.

## Phase 2: Extract Shared Port Resolution Layer

### Objective

Centralize all port input resolution into one reusable function for both workflow and direct-step execution.

### New Helper

Create a shared helper such as:

```python
resolve_task_inputs(task_id, task_config, state) -> ResolvedTaskInputs
```

### Responsibilities

1. Read the task input port definitions.
2. Resolve incoming upstream task-output artifacts from `edges` and `artifacts_by_port`.
3. Resolve bound document inputs from `input_files_by_port`.
4. Attach fallback playbook workspace context when no input-port sources are present.
5. Preserve port identity for all resolved inputs.
6. Return a normalized object usable by prompt builders and tool factories.

### Suggested New Module

`yellowstorm-adk/src/langgraph_engine/port_resolution.py`

### Acceptance Criteria

1. Workflow path uses the helper.
2. Direct-step path uses the helper.
3. No path manually rebuilds port mappings from raw edges in multiple places.

## Phase 3: Upgrade Runtime State Model

### Objective

Make state capable of storing richer artifact data without accidental overwrite.

### Current Problem

`artifacts_by_port` currently behaves as if one `task_id:port_id` key maps to one artifact object.

### Planned Change

Change it to store lists:

```python
artifacts_by_port: Dict[str, List[Dict[str, Any]]]
```

### Why

1. Avoid overwrite if a task emits multiple artifacts for one output port.
2. Support richer future tools.
3. Keep artifact transport generic.

### Files

1. `yellowstorm-adk/src/langgraph_engine/state.py`
2. `yellowstorm-adk/src/langgraph_engine/graph_builder.py`

### Acceptance Criteria

1. Artifacts emitted for a port are appended, not overwritten.
2. Existing single-artifact cases still work.

## Phase 4: Build Prompt Context From Resolved Inputs

### Objective

Make downstream task prompts explicitly focused on mapped inputs.

### Planned Prompt Strategy

Generate prompt sections per input port.

Example shape:

```text
Structured inputs for this task:

Input port: doc_in_convert
Expected type: document
Upstream source: synthese.PDF
Bound documents: 1
Document IDs: 12345

Input port: summary_text
Expected type: text
Upstream source: summarize.output
Content:
...
```

### Rules

1. Text and code artifacts should be injected directly into the prompt.
2. Document and file-like artifacts should be described in the prompt and passed to tools.
3. The prompt should state clearly that the task must focus on the specific mapped inputs.
4. If no input-port sources are present, the prompt should state that the task may use the default playbook workspace context.

### Files

1. `yellowstorm-adk/src/langgraph_engine/graph_builder.py`
2. `yellowstorm-adk/src/langgraph_engine/step_executor.py`

### Acceptance Criteria

1. LLM prompt trace shows per-port input blocks.
2. The downstream prompt references the mapped upstream output and bound documents explicitly.
3. Workflow and direct-step prompts follow the same structure.

## Phase 5: Introduce Port-Aware Tool Scoping

### Objective

Keep tools aware of which resources belong to which input port.

### New Tool Scope Model

Add a normalized tool input scope derived from `ResolvedTaskInputs`, such as:

```python
ToolExecutionScope = {
  "all_document_ids": [],
  "documents_by_port": {
    "<input_port_id>": ["doc1", "doc2"]
  },
  "workspace_context_mode": "fallback_playbook" | "resolved_inputs_only" | "mixed",
}
```

### Search Tool Plan

Replace or extend the flat `input_files` behavior with:

1. Global filtered scope for the task.
2. Port-grouped document scope.
3. Optional future tool entry points for per-port search.

Recommended approach for now:

1. Keep one `perform_filtered_search` entry point for compatibility.
2. Pass it a richer internal scope that includes `documents_by_port`.
3. Update the tool description so the model knows which input port each document group belongs to.
4. Prepare for future explicit tools such as `perform_filtered_search_for_port`.

### Code Interpreter Plan

Code interpreter should receive a port-aware execution manifest, not just generic workspace context.

For now, define a staging plan:

1. Build a list of accessible files from resolved port inputs.
2. Tag each staged file with source port metadata.
3. Make the prompt explain which port each file came from.
4. Keep fallback workspace files available only when there are no bound port sources, or when the product intentionally allows mixed access.

### Files

1. `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`
2. Any code interpreter integration layer currently staging workspace files or sandbox context

### Acceptance Criteria

1. Search tool only sees the task’s allowed docs.
2. Search tool preserves knowledge of which docs belong to which input port.
3. Code interpreter receives the correct per-port files or references.
4. Future tools can consume the same resolved tool scope model without custom graph logic.

## Phase 6: Formalize Fallback to Default Playbook Workspace

### Objective

When a task has no port-bound sources, allow it to operate on the playbook selected workspace context.

### Behavior Rule

Use this precedence model:

1. If the task has any resolved upstream port inputs or any bound input-port documents, use those as primary sources.
2. If the task has no resolved port sources at all, fall back to the playbook-level selected workspace context.
3. If needed later, support a mixed mode behind an explicit product rule, but do not make that default in the first implementation.

### Why

This avoids uncontrolled leakage of irrelevant workspace content when a task already has specific inputs.

### Files

1. `yellowstorm-adk/src/langgraph_engine/graph_builder.py`
2. `yellowstorm-adk/src/langgraph_engine/step_executor.py`
3. `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`

### Acceptance Criteria

1. Tasks with no bound sources still have usable tools.
2. Tasks with bound port sources do not silently broaden to all workspace content unless explicitly intended.

## Phase 7: Unify Preparation Path Across Execution Modes

### Objective

Remove logic drift between:

1. Full playbook workflow execution
2. Single-step direct execution
3. Single-step HITL execution

### Planned Shared Helpers

Create shared helpers such as:

1. `resolve_task_inputs(...)`
2. `build_task_prompt(...)`
3. `build_tool_scope(...)`

### Result

1. `graph_builder.py` uses these helpers.
2. `step_executor.py` uses these helpers.
3. Future tools only integrate once.

### Acceptance Criteria

1. Same task configuration produces the same effective prompt and tool scope across all execution modes.
2. No duplicated port-resolution code remains in separate files.

## Phase 8: Backend Validation and Error Model

### Objective

Fail early and clearly on invalid routing.

### Validation Rules

1. One upstream edge maximum per input port.
2. Input port artifact kind must match upstream output artifact kind.
3. Required input ports must have either an upstream source or bound documents before execution, if strict requirement enforcement is enabled.
4. Unknown source output port IDs must fail.
5. Unknown target input port IDs must fail.

### Error Style

Raise execution errors with task and port identifiers included.

Example:

```text
Task 'Synthèse' input port 'doc_in_convert' has multiple upstream sources.
Task 'Synthèse' input port 'doc_in_convert' expects artifact kind 'document' but received 'text'.
```

### Acceptance Criteria

1. Invalid graphs fail before LLM execution.
2. Error messages are actionable from frontend execution logs.

## Phase 9: Testing Plan

### Unit Tests

1. Resolve no inputs and fallback to playbook workspace context.
2. Resolve one upstream output port to one input port.
3. Resolve one input port with bound documents only.
4. Resolve mixed text and document inputs on different ports.
5. Reject two upstream edges targeting the same input port.
6. Reject artifact-kind mismatch.
7. Preserve multiple artifacts on one output port if emitted.
8. Build identical tool scopes in workflow and direct-step execution.

### Integration Tests

1. Workflow path with one upstream text output routed into one downstream text input.
2. Workflow path with one upstream document output routed into one downstream document input.
3. Single-step direct execution with bound document port and filtered search tool.
4. Single-step HITL execution with the same bound document port.
5. Fallback execution when no port bindings exist but playbook workspace is selected.
6. Prompt trace contains structured per-port sections.
7. Tool creation logs show port-aware scope.

### Manual Verification

1. Connect one output port to one downstream input port and inspect LLM prompt trace.
2. Drop a document on an input port and confirm only that task sees it.
3. Run a task with no bindings and confirm it can still search the selected workspace.
4. Try connecting two sources to one input port and verify execution fails clearly.

## File-Level Implementation Checklist

### New files

1. `yellowstorm-adk/src/langgraph_engine/port_resolution.py`
2. Optional: `yellowstorm-adk/tests/langgraph_engine/test_port_resolution.py`

### Files to update

1. `yellowstorm-adk/src/langgraph_engine/state.py`
2. `yellowstorm-adk/src/langgraph_engine/graph_builder.py`
3. `yellowstorm-adk/src/langgraph_engine/step_executor.py`
4. `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`
5. `yellowstorm-adk/src/langgraph_engine/workflow_service.py`
6. Relevant tests for gRPC request handling if task config schema assertions exist

## Delivery Sequence

1. Add strict validation for one-upstream-source-per-input-port.
2. Add shared `resolve_task_inputs` helper.
3. Upgrade `artifacts_by_port` to support list values.
4. Refactor prompt construction to consume resolved inputs.
5. Refactor tool creation to consume a port-aware tool scope.
6. Implement explicit fallback workspace behavior.
7. Unify workflow and direct-step preparation paths.
8. Add tests.
9. Verify via prompt trace and execution logs.

## Open Decisions

1. Whether bound documents on an input port should coexist with one upstream source on that same input port in phase 1.
2. Whether code interpreter should receive only resolved port files or also fallback workspace files in mixed mode.
3. Whether future tools should expose one generic port-aware interface or generate one logical tool per port.

## Recommended Decisions

1. Allow one upstream source per input port and allow bound documents on the same port only if they share the same semantic role.
2. In phase 1, if any explicit port-bound sources exist, prefer them and do not broaden access to all fallback workspace files.
3. Keep tool registration generic and data-driven so future tools can read the same `ToolExecutionScope`.

## Definition of Done

The implementation is done when:

1. A downstream task receives structured context derived from the exact mapped upstream output port.
2. The prompt trace explicitly shows per-port inputs.
3. Search and code interpreter operate on the correct scoped resources.
4. Default playbook workspace context is available only when no explicit port-bound sources exist.
5. All execution modes share the same port-resolution logic.
6. Invalid port routing fails early with clear backend errors.
