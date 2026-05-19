# Playbook Flow Resource Drop Implementation Plan

## Goal

Allow users to drag `document`, `folder`, and `workspace` resources from the workspace explorer onto a playbook task input port, and make those resources available through the existing playbook dataflow during execution.

The selected playbook workspace remains the run-level default workspace. It should always be sent to the LLM/runtime and used by tools when a tool call does not provide an explicit workspace.

## Current State

- Frontend drops currently add workspace explorer payloads to `task.inputFiles` in `PlaybookNode.tsx`.
- `inputFiles` are persisted in node metadata and displayed in the node UI.
- Runtime dataflow already uses `DataBinding` records.
- Backend serializes `dataBindings` into gRPC `data_bindings`.
- ADK resolves `constant` bindings into `node_inputs[target_port]`.
- Backend already sends `__playbook_workspace_ids` in `input_context`.

## Recommended Contract

Use `DataBinding.sourceKind = "constant"` as the execution contract for dropped resources.

```ts
type PlaybookResourceReference = {
  kind: 'document' | 'folder' | 'workspace';
  id: string;
  name: string;
  workspaceId: string;
  path?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};
```

For a single-resource port:

```ts
{
  id: 'binding-...',
  targetNode: 'task-id',
  targetPort: 'input-port-id',
  sourceKind: 'constant',
  constantValue: {
    kind: 'document',
    id: 'doc-id',
    name: 'contract.pdf',
    workspaceId: 'workspace-id'
  }
}
```

For a multi-resource port:

```ts
{
  id: 'binding-...',
  targetNode: 'task-id',
  targetPort: 'input-port-id',
  sourceKind: 'constant',
  constantValue: [
    { kind: 'document', id: 'doc-id', name: 'contract.pdf', workspaceId: 'workspace-id' },
    { kind: 'folder', id: 'folder-id', name: 'Policies', workspaceId: 'workspace-id' },
    { kind: 'workspace', id: 'workspace-id', name: 'Legal Workspace', workspaceId: 'workspace-id' }
  ]
}
```

## Dataflow

1. User drags a resource from the workspace explorer.
2. Workspace explorer puts a normalized drag payload on `dataTransfer`.
3. User drops the resource on a task input port.
4. Frontend converts the dropped resource into a `constant` `DataBinding` targeting that port.
5. Frontend may update `inputFiles` for display, but `dataBindings` become the source of truth for execution.
6. Backend persists and serializes the binding unchanged.
7. ADK resolves the binding into `node_inputs[target_port]`.
8. Step node prompt/tool context includes the resolved port inputs.
9. Tools use the resource-specific `workspaceId` when present.
10. Tools fall back to the run-level default workspace when the input does not specify one.

## Default Workspace Context

Keep default workspace as execution-level context, not as a per-port binding.

Backend should send both fields in `input_context`:

```ts
input_context: {
  ...inputContext,
  __playbook_workspace_ids: snapshot.workspaces || [],
  __playbook_default_workspace_id: snapshot.workspaces?.[0] || ''
}
```

ADK/tool setup should treat `__playbook_default_workspace_id` as the default tool workspace.

Precedence:

1. Explicit workspace on the dropped resource.
2. Explicit workspace in tool arguments.
3. `__playbook_default_workspace_id`.
4. Fail loudly if a workspace is required and none is available.

## Frontend Changes

Files likely involved:

- `YellowStorm/front/src/modules/playbook/types.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookNode.tsx`
- `YellowStorm/front/src/modules/playbook/store.ts`
- `YellowStorm/front/src/modules/playbook/api.ts`
- `YellowStorm/front/src/modules/playbook/components/PlaybookDataBindingSection.tsx`

Implementation steps:

1. Extend the dropped resource type from `document | workspace` to `document | folder | workspace`.
2. Normalize drag payloads into `PlaybookResourceReference`.
3. Add a store action such as `bindResourceToInputPort(taskId, portId, resource)`.
4. In that action, create or update one `constant` `DataBinding` for the target port.
5. For single-resource ports, replace the prior resource binding.
6. For multi-resource ports, append to an array `constantValue` while de-duplicating by `kind + workspaceId + id`.
7. Keep `inputFiles` updated only for existing UI display, or derive it from data bindings later.
8. Ensure serialization preserves `constantValue` without dropping `folder` resources.

## Backend Changes

Files likely involved:

- `YellowStorm/back/src/modules/playbook-flow/schemas/playbook-flow.schema.ts`
- `YellowStorm/back/src/modules/playbook-flow/dto/playbook-flow-data-binding.dto.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-execution.service.ts`
- `YellowStorm/back/src/modules/playbook-flow/services/playbook-flow-validator.service.ts`

Implementation steps:

1. Keep using existing `DataBinding.constantValue` for dropped resources.
2. Add validation for resource references if the validator already validates binding shape.
3. Validate resource kinds are only `document`, `folder`, or `workspace`.
4. Validate target port exists on the target node.
5. Add `__playbook_default_workspace_id` to `input_context` next to `__playbook_workspace_ids`.
6. Preserve existing `toGrpcValue()` and `toGrpcStruct()` conversions.

## ADK Changes

Files likely involved:

- `yellowstorm-adk/src/flow_engine/bindings/resolver.py`
- `yellowstorm-adk/src/flow_engine/nodes/step.py`
- `yellowstorm-adk/src/flow_engine/nodes/step_tools.py`
- `yellowstorm-adk/src/langgraph_engine/playbook_tool_factory.py`

Implementation steps:

1. No resolver change should be required for `constant` bindings.
2. Ensure step prompt construction includes resolved `node_inputs` clearly enough for the LLM.
3. Ensure tool factory or tool execution context receives `default_workspace_id` from `state["inputs"]`.
4. Update tools to use explicit resource workspace first, then default workspace.
5. Log a warning before rejecting or ignoring malformed resource references.

## Validation Rules

Minimum validation:

- `kind` must be `document`, `folder`, or `workspace`.
- `id`, `name`, and `workspaceId` must be non-empty strings.
- For `kind = "workspace"`, `workspaceId` should equal `id` unless there is a known reason not to enforce it.
- Dropping onto a missing target node or missing target port is invalid.
- Duplicate resources on the same port should be ignored or replaced deterministically.

Optional validation if existing services are available:

- User has access to the workspace.
- Document/folder exists in that workspace.
- Target port `artifactKind` accepts the dropped resource kind.

## Testing Plan

Frontend:

- Store test: dropping a document creates a `constant` binding.
- Store test: dropping a folder creates a `constant` binding.
- Store test: dropping a workspace creates a `constant` binding.
- Store test: dropping multiple resources on a multi-resource port appends and de-duplicates.
- API serialization test: `constantValue` survives save payload mapping.

Backend:

- Execution serialization test: resource binding is serialized into gRPC `data_bindings.constant_value`.
- Execution serialization test: `__playbook_default_workspace_id` is included in `input_context`.
- Validator test: invalid resource kind is rejected if validation is added.

ADK:

- Resolver test: `constant` resource binding resolves to `node_inputs[target_port]`.
- Step/tool test: default workspace is available when no explicit workspace is provided.
- Tool test: explicit dropped-resource workspace wins over default workspace.

Browser QA:

- Drag document onto input port and verify binding appears.
- Drag folder onto input port and verify binding appears.
- Drag workspace onto input port and verify binding appears.
- Save, reload, and verify bindings remain.
- Execute a flow and verify the runtime receives port inputs plus default workspace.

## Migration Notes

Existing `task.inputFiles` metadata can remain for backward compatibility and display. New execution behavior should rely on `dataBindings`.

If existing saved playbooks only have `inputFiles`, consider a lightweight migration when loading the playbook in the frontend:

1. For each `inputFile` with `portId`, synthesize a `constant` binding if one does not already exist.
2. Do not delete `inputFiles` in the first implementation.
3. Once all UI reads from bindings, remove or stop writing `inputFiles` in a separate cleanup.

## Open Decisions

1. Should every input port accept multiple resources, or should this be controlled by port metadata?
2. Should `folder` resources resolve to a folder reference only, or should execution expand them into documents before prompting the LLM?
3. Should workspace drops mean “use this workspace as a resource input” or “change the playbook default workspace”? Recommended: resource input only.
4. Should resource access validation happen on save, on execution, or both? Recommended: save for shape, execution for access/existence.

## Recommended First Implementation Slice

1. Frontend: create `constant` bindings for dropped `document`, `folder`, and `workspace` resources.
2. Backend: add `__playbook_default_workspace_id` to `input_context`.
3. ADK: make tool context read `__playbook_default_workspace_id`.
4. Tests: cover binding serialization and ADK constant resolution.

This slice keeps the behavior small, uses existing dataflow primitives, and avoids introducing a second resource-input contract.
