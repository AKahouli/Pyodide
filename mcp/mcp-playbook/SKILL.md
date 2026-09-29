---
slug: yellowstorm-playbook
name: YellowStorm Playbook
description: Discover, inspect, generate, modify, optimize, validate, and run YellowStorm Playbooks through the Playbook MCP connector.
license: internal
compatibility: YellowStorm agents with the playbook-mcp connector enabled
metadata:
  connector: playbook-mcp
  schema-version: playbook.mcp.v1
---
# YellowStorm Playbook

Use the Playbook MCP tools whenever the user wants to find, understand, create, change, optimize, validate, run, or diagnose a YellowStorm Playbook.

## Core Rules

- Treat MCP results as the source of truth. Never invent Playbook, task, execution, request, continuation, or operation IDs.
- Talk to the user about Playbooks, tasks, executions, workspaces and files by their names; never show IDs. Any `playbook_id` argument also accepts the Playbook's exact name, and any `task_id` argument the task's exact name (a name two tasks share is not resolved).
- Use only Playbook MCP tools that are available in the current runtime. Connector action selection may intentionally expose only part of the inventory.
- Do not pass tenant, user, agent, conversation, correlation, authorization, or internal request identity as tool arguments. The platform supplies trusted identity outside the model-visible schema.
- Prefer read tools before mutation when the target or current revision is uncertain.
- Never claim that a Playbook was changed, published, or executed unless the corresponding tool returned `ok: true` and data confirming that state.
- Preserve returned `uiTarget` values for the client. Describe the destination or handoff, but do not construct URLs or attempt browser or DOM automation.
- The Playbook canvas owns construction event streaming, preview application, commit/apply/discard, undo, and runtime human-in-the-loop responses.

## Choosing A Workflow

### Find Or Inspect

1. Use `search_playbooks` when the Playbook ID is unknown or the user refers to a Playbook by name.
2. Use `open_playbook_context` for a canonical overview that may include a selected task or execution.
3. Use the narrowest follow-up tool:
   - `get_playbook_summary` for workflow shape and definition revision.
   - `get_task_details` for one task's complete design-time definition.
   - `get_task_dependencies` for incoming/outgoing control flow and data bindings.
   - `validate_playbook` for deterministic validation findings.
4. If search results are ambiguous, ask the user to choose rather than guessing an ID.

### Generate A New Playbook

1. Gather the user's workflow goal and an optional name from the conversation.
2. Call `start_playbook_generation`. It assesses the trusted current conversation turn; do not ask for or invent an internal request ID.
3. If the result needs clarification, ask the returned questions exactly as provided and call `start_playbook_generation` again with the returned `continuation_id` and typed `answers`. Use the same answer shapes documented below for modification. Questions with a `resourceSelector` are answered by the user in the sources card (see Sources below).
4. If the user explicitly asks to skip remaining generation questions, set `skip_clarification` to `true` and include any answers already collected.
5. No draft exists while clarification is pending. Once ready, the tool starts at most one operation-owned draft construction.
6. Treat the ready result as a draft operation, not a published Playbook.
7. Return the canvas handoff from `uiTarget` so the user can open the draft and let the canvas apply the operation.

Do not chain `create_playbook` and construction to emulate generation. Use `create_playbook` only when the user explicitly asks for an empty Playbook and that action is available.

### Modify An Existing Playbook

For a normal conversational change request, use `modify_playbook`:

1. Resolve the Playbook ID, then call `modify_playbook` with `playbook_id` only. The trusted current turn supplies the requested change.
2. If the result needs clarification, ask the returned questions exactly as provided.
3. Submit a follow-up `modify_playbook` call with the returned `continuation_id` and typed `answers`.
4. Each answer must use a returned question ID and one of these shapes:

```json
{"questionId":"q1","choice":"a returned choice"}
```

```json
{"questionId":"q1","text":"the user's answer"}
```

Questions with a `resourceSelector` are answered by the user in the sources card (see Sources below): leave them out of `answers`.

5. If the user explicitly asks to skip remaining questions, set `skip_clarification` to `true` and include any answers already collected.
6. When the result is ready, return its canvas `uiTarget`. The operation is a canvas-owned preview or construction; do not claim that changes are already committed.

Use `assess_playbook_request`, `continue_playbook_clarification`, and `start_playbook_construction` only when the runtime has supplied the trusted request or continuation IDs required by that flow. Start at most one construction for a request.

### Sources

Workspaces and files are the user's decision, and the user picks them:

- A clarification question with a `resourceSelector` asks for a source (`workspace_or_document`) or a destination (`destination_workspace`). The result then carries a `playbook.sources` `uiTarget`: the conversation shows a card where the user chooses from a searchable list of all their workspaces and files, or skips the question so the Playbook asks for it when it runs.
- Never search workspaces or documents for these questions and never ask the user for names or IDs. Ask only the other questions with `present_choices`, and say the sources are chosen in the card.
- When the user says they chose or skipped, call the same tool with the `continuation_id` and the other answers: the picks are joined automatically, and a chosen workspace becomes a fixed input of the tasks that read it.
- If the result says a source is still missing, ask the user to choose it in the card or to skip it.

### Optimize

- Use `analyze_task_optimization` for one task and `analyze_workflow_optimization` for the full workflow. These calls do not mutate the Playbook.
- Use only returned evidence and recommendations; do not present assumptions as measured execution evidence.
- Start an optimization or Advisor remediation construction only when the user requests the change and the relevant construction tool is available.
- Advisor remediation is a staged canvas preview. The user must Apply or Discard it in the canvas.
- Pass the canonical `data.definitionRevision` returned by Playbook context as the `expected_definition_revision` tool argument. On a revision conflict, refresh context instead of retrying with a guessed revision.

### Execute Or Diagnose

- Start, re-execute or run from a step only when the user asks in this conversation, or confirms after you named the Playbook and its inputs. Before `start_playbook_execution`, resolve the exact Playbook and summarize what will run.
- Stop a running execution with `cancel_playbook_execution` when the user asks. Ask before `delete_playbook_execution`.
- Reuse a runtime-provided idempotency key when one is available. Never invent a new key to retry an uncertain start result.
- Use `list_recent_executions` for cross-Playbook discovery and `list_playbook_executions` for one Playbook.
- Use `get_playbook_execution` for current status and outputs, and `get_execution_diagnostics` for deterministic redacted diagnostics.
- Treat pending runtime HITL as status-only. Direct the user to the existing Playbook runtime HITL panel; never attempt to answer, approve, reject, disable a blocker, or resume HITL through this connector.
- `trace_replay_playbook_execution` is non-mutating. Re-execution, run-from-step, cancellation, and deletion create or change execution state and require clear user intent plus host confirmation where configured.

## Construction Operations

- Use `get_playbook_construction` to inspect status when a tool has returned an operation ID.
- Use `cancel_playbook_construction` only for an active operation the user wants stopped.
- Use `revert_playbook_construction` only for the exact committed operation the user wants undone. A later definition revision can make revert invalid; report that conflict instead of working around it.
- Do not consume `/construction-events` from the model. The authenticated canvas owns the durable construction stream.

## Result Handling

Successful tool dispatches and wrapped backend failures return the `playbook.mcp.v1` envelope:

- On `ok: true`, use `data` for the result and `meta` for correlation and handoff information.
- On `ok: false`, explain the provided error without exposing credentials or hidden context.
- Retry only when `error.retryable` is true and a retry is safe. Do not automatically retry mutations after an uncertain timeout or dependency failure.
- For `conflict`, refresh canonical context or revision before proposing another mutation.
- For `authorization` or `not_found`, do not infer that the object exists outside the user's permissions.
- Include the correlation ID when reporting a failure that may require support investigation.
- MCP argument validation and other tool-boundary failures can occur before an envelope is produced. Correct the arguments from the tool schema or ask the user for missing information; do not treat those failures as successful Playbook results.

## Response Style

- Answer with the result relevant to the user's goal, not a dump of the entire tool payload.
- Clearly distinguish canonical facts, validation findings, optimization recommendations, draft operations, and committed state.
- When a `uiTarget` is returned, offer the semantic handoff in the response and let the YellowStorm client resolve it.
