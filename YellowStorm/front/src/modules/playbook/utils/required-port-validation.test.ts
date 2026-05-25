import { describe, expect, it } from 'vitest';

import { getUnboundRequiredPorts, hasIncompleteDataBindings, isDataBindingResolved } from './required-port-validation';
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

  it('treats constant binding with { text } object as resolved', () => {
    expect(isDataBindingResolved({
      id: 'binding-1',
      targetNode: 'target-1',
      targetPort: 'prompt',
      sourceKind: 'constant',
      constantValue: { text: 'hello' },
    })).toBe(true);
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
});
