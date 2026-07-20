import { describe, expect, it } from 'vitest';

import {
  getUnboundRequiredPorts,
  getUnboundRequiredPortsForTaskIds,
  getPlaybookValidationIssues,
  hasIncompleteDataBindings,
  isDataBindingResolved,
} from './required-port-validation';
import { makeTask } from '../test-utils';

describe('required-port-validation', () => {
  it('treats node-output bindings without a source node and port as incomplete', () => {
    expect(isDataBindingResolved({
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'node-output',
    })).toBe(false);
  });

  it('flags incomplete bindings even for optional ports', () => {
    expect(hasIncompleteDataBindings([
      {
        id: 'binding-1',
        targetNode: 'target-1',
        targetPort: 'prompt',
        sourceKind: 'node-output',
      },
    ])).toBe(true);
  });

  it('treats whitespace-only trigger paths as incomplete', () => {
    expect(isDataBindingResolved({
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'trigger',
      triggerPath: '   ',
    })).toBe(false);
  });

  it('keeps required ports unresolved until their binding is complete', () => {
    const tasks = [makeTask({
      id: 'target-1',
      inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }],
    })];

    expect(getUnboundRequiredPorts(tasks, [{
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'node-output',
    }])).toEqual([
      { taskId: 'target-1', portId: 'prompt', portName: 'Prompt' },
    ]);
  });

  it('does not treat an edge-only connection as a valid required port binding', () => {
    const tasks = [
      makeTask({
        id: 'source-1',
        outputPorts: [{ id: 'analysis_results', name: 'Analysis Results', artifactKind: 'data' }],
      }),
      makeTask({
        id: 'target-1',
        inputPorts: [{ id: 'input-context', name: 'Context', artifactKind: 'text', required: true }],
      }),
    ];

    expect(getUnboundRequiredPortsForTaskIds(tasks, [], new Set(['target-1']))).toEqual([
      { taskId: 'target-1', portId: 'input-context', portName: 'Context' },
    ]);
  });

  it('checks only changed task ids when validating intent-created required ports', () => {
    const tasks = [
      makeTask({
        id: 'existing-unbound',
        inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: true }],
      }),
      makeTask({
        id: 'changed-bound',
        inputPorts: [{ id: 'source', name: 'Source', artifactKind: 'text', required: true }],
      }),
    ];

    expect(getUnboundRequiredPortsForTaskIds(tasks, [{
      id: 'binding-1',
      targetNode: 'changed-bound',
      targetPort: 'source',
      sourceKind: 'node-output',
      sourceNode: 'source-1',
      sourcePort: 'source',
    }], new Set(['changed-bound']))).toEqual([]);
  });

  it('treats constant binding with { text } object as resolved', () => {
    expect(isDataBindingResolved({
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'constant',
      constantValue: { text: 'hello' },
    })).toBe(true);
  });

  it('treats selected resource constant binding as a valid required port binding', () => {
    const tasks = [makeTask({
      id: 'target-1',
      inputPorts: [{ id: 'source_document', name: 'Source document', artifactKind: 'document', required: true }],
    })];

    expect(getUnboundRequiredPortsForTaskIds(tasks, [{
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'source_document',
      sourceKind: 'constant',
      constantValue: {
        kind: 'document',
        id: 'doc-1',
        documentId: 'doc-1',
        workspaceId: 'workspace-1',
        path: '/Finance/invoice.xlsx',
      },
    }], new Set(['target-1']))).toEqual([]);
  });

  it('treats constant binding with empty text object as unresolved', () => {
    expect(isDataBindingResolved({
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'constant',
      constantValue: { text: '' },
    })).toBe(false);
  });

  it('treats constant binding with whitespace-only text object as unresolved', () => {
    expect(isDataBindingResolved({
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'constant',
      constantValue: { text: '   ' },
    })).toBe(false);
  });

  it('describes the affected task and required port', () => {
    const tasks = [makeTask({
      id: 'target-1',
      title: 'Prepare report',
      inputPorts: [{ id: 'context', name: 'Report context', artifactKind: 'text', required: true }],
    })];

    expect(getPlaybookValidationIssues(tasks, [])).toEqual([{
      id: 'required:target-1:context',
      taskId: 'target-1',
      taskName: 'Prepare report',
      portId: 'context',
      portName: 'Report context',
      artifactKind: 'text',
      reason: 'missing_required_binding',
    }]);
  });

  it('reports an incomplete binding once with a specific resolution reason', () => {
    const tasks = [makeTask({
      id: 'target-1',
      title: 'Prepare report',
      inputPorts: [{ id: 'context', name: 'Report context', artifactKind: 'text', required: true }],
    })];

    expect(getPlaybookValidationIssues(tasks, [{
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'context',
      sourceKind: 'constant',
      constantValue: { text: '' },
    }])).toEqual([expect.objectContaining({
      id: 'binding:binding-1',
      taskId: 'target-1',
      portId: 'context',
      reason: 'missing_constant_value',
    })]);
  });
});
