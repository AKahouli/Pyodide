import { PlaybookIntentGraphBindingResolverService } from './playbook-intent-graph-binding-resolver.service';
import type { IntentWorkflowValidationContext, PlaybookIntentWorkflowChange } from './playbook-flow-intent.service';

function makeContext(overrides: Partial<{
  existingTaskIds: string[];
  inputPortsByTaskId: Array<[string, Array<[string, string]>]>;
  outputPortsByTaskId: Array<[string, Array<[string, string]>]>;
  existingBindingTargets: string[];
}> = {}): IntentWorkflowValidationContext {
  return {
    existingTaskIds: new Set(overrides.existingTaskIds || []),
    existingTaskTitles: new Map(),
    existingTaskAgents: new Map(),
    inputPortsByTaskId: new Map((overrides.inputPortsByTaskId || []).map(([key, value]) => [key, new Map(value)])),
    outputPortsByTaskId: new Map((overrides.outputPortsByTaskId || []).map(([key, value]) => [key, new Map(value)])),
    existingBindingTargets: new Set(overrides.existingBindingTargets || []),
  };
}

describe('PlaybookIntentGraphBindingResolverService', () => {
  const service = new PlaybookIntentGraphBindingResolverService();

  it('synthesizes a data binding from a valid ported edge', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['report', 'document']]]],
        inputPortsByTaskId: [['target', [['report', 'document']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'report',
        targetInputPortId: 'report',
      }],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_edge' }),
      expect.objectContaining({ type: 'create_data_binding', sourcePort: 'report', targetPort: 'report' }),
    ]));
  });

  it('resolves scoped iterator child targets and synthesizes bindings against child ports', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext(),
      deletedTaskIds: new Set(),
      changes: [
        {
          type: 'create_node',
          nodeRef: 'source',
          anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
          task: { title: 'Source', description: '', outputPorts: [{ id: 'template_document', artifactKind: 'document' }] },
        },
        {
          type: 'create_node',
          nodeRef: 'loop',
          anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
          task: {
            title: 'Loop',
            description: '',
            inputPorts: [{ id: 'items', artifactKind: 'document' }],
            iteratorBody: {
              steps: [{
                nodeRef: 'child',
                title: 'Child',
                description: '',
                inputPorts: [{ id: 'template', artifactKind: 'document' }],
              }],
              edges: [],
            },
          },
        },
        {
          type: 'create_edge',
          sourceTaskId: null,
          sourceNodeRef: 'source',
          targetTaskId: null,
          targetNodeRef: 'child',
          targetIteratorNodeRef: 'loop',
          sourceOutputPortId: 'template_document',
          targetInputPortId: 'template',
        },
      ],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'create_edge',
        targetIteratorNodeRef: 'loop',
        targetNodeRef: 'child',
        targetInputPortId: 'template',
      }),
      expect.objectContaining({
        type: 'create_data_binding',
        targetIteratorNodeRef: 'loop',
        targetNodeRef: 'child',
        sourcePort: 'template_document',
        targetPort: 'template',
      }),
    ]));
  });

  it('rejects edges with incompatible artifact kinds', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['report', 'image']]]],
        inputPortsByTaskId: [['target', [['payload', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'report',
        targetInputPortId: 'payload',
      }],
    });

    expect(result.changes).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'edge_artifact_mismatch',
        stage: 'binding_resolver',
        severity: 'error',
        repairable: true,
      }),
    ]));
  });

  it('accepts edges between compatible artifact kinds (data to text)', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['artifact_list', 'data']]]],
        inputPortsByTaskId: [['target', [['input_1', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'artifact_list',
        targetInputPortId: 'input_1',
      }],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_edge', sourceOutputPortId: 'artifact_list', targetInputPortId: 'input_1' }),
    ]));
  });

  it('infers an unknown source port when exactly one compatible output exists', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['report', 'document']]]],
        inputPortsByTaskId: [['target', [['report', 'document']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'hallucinated',
        targetInputPortId: 'report',
      }],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_edge', sourceOutputPortId: 'report', targetInputPortId: 'report' }),
      expect.objectContaining({ type: 'create_data_binding', sourcePort: 'report', targetPort: 'report' }),
    ]));
  });

  it('infers a mistyped source port when exactly one compatible output exists', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['output_document', 'document'], ['output_notes', 'text']]]],
        inputPortsByTaskId: [['target', [['input_template', 'document']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'output_1',
        targetInputPortId: 'input_template',
      }],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'create_edge',
        sourceOutputPortId: 'output_document',
        targetInputPortId: 'input_template',
      }),
      expect.objectContaining({
        type: 'create_data_binding',
        sourcePort: 'output_document',
        targetPort: 'input_template',
      }),
    ]));
  });

  it('drops an unknown edge port when compatible fallback is ambiguous', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['report_a', 'document'], ['report_b', 'document']]]],
        inputPortsByTaskId: [['target', [['report', 'document']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'hallucinated',
        targetInputPortId: 'report',
      }],
    });

    expect(result.changes).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'edge_unknown_port', stage: 'binding_resolver', severity: 'warning' }),
    ]));
  });

  it('infers a mistyped target port when exactly one compatible input exists', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['document', 'document']]]],
        inputPortsByTaskId: [['target', [['input_template', 'document'], ['notes', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_edge',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        sourceOutputPortId: 'document',
        targetInputPortId: 'input_1',
      }],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'create_edge',
        sourceOutputPortId: 'document',
        targetInputPortId: 'input_template',
      }),
      expect.objectContaining({
        type: 'create_data_binding',
        sourcePort: 'document',
        targetPort: 'input_template',
      }),
    ]));
  });

  it('dedupes duplicate binding targets and keeps one canonical binding', () => {
    const binding: PlaybookIntentWorkflowChange = {
      type: 'create_data_binding',
      sourceKind: 'node-output',
      sourceTaskId: 'source',
      sourceNodeRef: null,
      sourcePort: 'text',
      targetTaskId: 'target',
      targetNodeRef: null,
      targetPort: 'input',
      iteration: 'current',
    };

    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['text', 'text']]]],
        inputPortsByTaskId: [['target', [['input', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [binding, binding],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toEqual(expect.objectContaining({ type: 'create_data_binding', targetPort: 'input' }));
  });

  it('rejects bindings with incompatible artifact kinds', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['report', 'image']]]],
        inputPortsByTaskId: [['target', [['input', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_data_binding',
        sourceKind: 'node-output',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        sourcePort: 'report',
        targetTaskId: 'target',
        targetNodeRef: null,
        targetPort: 'input',
        iteration: 'current',
      }],
    });

    expect(result.changes).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'binding_artifact_mismatch',
        stage: 'binding_resolver',
        severity: 'error',
        repairable: true,
      }),
    ]));
  });

  it('drops bindings targeting an existing binding target', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['text', 'text']]]],
        inputPortsByTaskId: [['target', [['input', 'text']]]],
        existingBindingTargets: ['target:input'],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_data_binding',
        sourceKind: 'node-output',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        sourcePort: 'text',
        targetTaskId: 'target',
        targetNodeRef: null,
        targetPort: 'input',
        iteration: 'current',
      }],
    });

    expect(result.changes).toEqual([]);
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'existing_binding_target', stage: 'binding_resolver', severity: 'warning' }),
    ]));
  });

  it('keeps valid constant resource bindings', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['target'],
        inputPortsByTaskId: [['target', [['input-context', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_data_binding',
        sourceKind: 'constant',
        targetTaskId: 'target',
        targetNodeRef: null,
        targetPort: 'input-context',
        constantValue: { kind: 'workspace', id: 'workspace-1', workspaceId: 'workspace-1', label: 'Factures', question: '' },
      }],
    });

    expect(result.changes).toEqual([expect.objectContaining({ type: 'create_data_binding', sourceKind: 'constant' })]);
  });

  it('uses ports from newly created node refs', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext(),
      deletedTaskIds: new Set(),
      changes: [
        {
          type: 'create_node',
          nodeRef: 'source_ref',
          anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
          task: { title: 'Source', description: '', outputPorts: [{ id: 'data', artifactKind: 'data' }] },
        },
        {
          type: 'create_node',
          nodeRef: 'target_ref',
          anchor: { mode: 'append', targetTaskId: null, nodeRef: null },
          task: { title: 'Target', description: '', inputPorts: [{ id: 'data', artifactKind: 'data', required: true }] },
        },
        {
          type: 'create_edge',
          sourceTaskId: null,
          sourceNodeRef: 'source_ref',
          targetTaskId: null,
          targetNodeRef: 'target_ref',
          sourceOutputPortId: 'data',
          targetInputPortId: 'data',
        },
      ],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_data_binding', sourceNodeRef: 'source_ref', targetNodeRef: 'target_ref' }),
    ]));
  });

  it('does not infer a missing port when multiple compatible candidates exist', () => {
    const result = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['a', 'text'], ['b', 'text']]]],
        inputPortsByTaskId: [['target', [['input', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [{
        type: 'create_data_binding',
        sourceKind: 'node-output',
        sourceTaskId: 'source',
        sourceNodeRef: null,
        sourcePort: null,
        targetTaskId: 'target',
        targetNodeRef: null,
        targetPort: 'input',
        iteration: 'current',
      }],
    });

    expect(result.changes).toEqual([]);
  });
});
