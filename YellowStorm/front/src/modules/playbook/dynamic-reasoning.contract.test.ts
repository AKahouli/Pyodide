import { describe, expect, it } from 'vitest';
import type { Node } from '@xyflow/react';
import { mapFlowNodeToPlaybookTask, taskToFlowNode } from './api.compat';
import { nodesToTasks } from './hooks/helpers/node-serializer';

describe('Dynamic Reasoning contracts', () => {
  it('round-trips the first-class node configuration', () => {
    const task = mapFlowNodeToPlaybookTask({ id: 'step', kind: 'step', dynamicReasoning: { enabled: true } }, 0);
    expect(task.dynamicReasoning).toEqual({ enabled: true });
    expect(taskToFlowNode(task).dynamicReasoning).toEqual({ enabled: true });
  });

  it('never serializes runtime generated nodes', () => {
    const runtimeNode = { id: 'parent::dynamic-reasoning::graph::work', type: 'playbookRuntimeStep', position: { x: 0, y: 0 }, data: {} } as Node;
    expect(nodesToTasks([runtimeNode])).toEqual([]);
  });
});
