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
    const changes = service.resolveWorkflowChanges({
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

    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_edge' }),
      expect.objectContaining({ type: 'create_data_binding', sourcePort: 'report', targetPort: 'report' }),
    ]));
  });

  it('keeps mismatched visual edges without synthesizing unsafe bindings', () => {
    const changes = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['report', 'document']]]],
        inputPortsByTaskId: [['target', [['payload', 'data']]]],
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

    expect(changes).toEqual([expect.objectContaining({
      type: 'create_edge',
      sourceOutputPortId: 'report',
      targetInputPortId: 'payload',
    })]);
  });

  it('drops edges that reference unknown ports on known tasks', () => {
    const changes = service.resolveWorkflowChanges({
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

    expect(changes).toEqual([]);
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

    const changes = service.resolveWorkflowChanges({
      context: makeContext({
        existingTaskIds: ['source', 'target'],
        outputPortsByTaskId: [['source', [['text', 'text']]]],
        inputPortsByTaskId: [['target', [['input', 'text']]]],
      }),
      deletedTaskIds: new Set(),
      changes: [binding, binding],
    });

    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual(expect.objectContaining({ type: 'create_data_binding', targetPort: 'input' }));
  });

  it('drops bindings targeting an existing binding target', () => {
    const changes = service.resolveWorkflowChanges({
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

    expect(changes).toEqual([]);
  });

  it('keeps valid constant resource bindings', () => {
    const changes = service.resolveWorkflowChanges({
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

    expect(changes).toEqual([expect.objectContaining({ type: 'create_data_binding', sourceKind: 'constant' })]);
  });

  it('uses ports from newly created node refs', () => {
    const changes = service.resolveWorkflowChanges({
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

    expect(changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'create_data_binding', sourceNodeRef: 'source_ref', targetNodeRef: 'target_ref' }),
    ]));
  });

  it('does not infer a missing port when multiple compatible candidates exist', () => {
    const changes = service.resolveWorkflowChanges({
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

    expect(changes).toEqual([]);
  });
});
