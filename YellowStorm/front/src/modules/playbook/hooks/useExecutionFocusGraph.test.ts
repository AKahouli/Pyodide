import { describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { PlaybookExecution } from '../types';
import { buildExecutionRuntimeGraph } from './useExecutionFocusGraph';

function makeExecution(status: 'planning' | 'running' | 'completed' | 'failed' = 'running'): PlaybookExecution {
  return {
    id: 'execution-1',
    playbookId: 'playbook-1',
    executedBy: 'user-1',
    executionNumber: 1,
    status: 'running',
    executionTrigger: 'manual',
    taskResults: [{
      taskId: 'parent::dynamic-reasoning::subgraph-1::risk-metrics',
      nodeTitle: 'runtime-id',
      agentName: '',
      order: 1,
      status: 'completed',
      output: 'risk analysis',
      error: null,
      durationMs: 100,
      startedAt: null,
      completedAt: null,
    }],
    threadId: null,
    interruptPayload: null,
    waitingForHumanInput: false,
    currentInterruptId: null,
    currentInterruptTaskId: null,
    hitlHistory: [],
    error: null,
    durationMs: null,
    startedAt: null,
    completedAt: null,
    singleStepTaskId: 'parent',
    playbookSnapshot: null,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    createdAt: '2026-08-07T00:00:00.000Z',
    updatedAt: '2026-08-07T00:00:00.000Z',
    dynamicReasoningAttempts: [{
      executionId: 'execution-1',
      parentTaskId: 'parent',
      parentIteration: 0,
      attempt: 0,
      subgraphId: 'subgraph-1',
      status,
      revisions: [],
      acceptedPlan: status === 'planning' ? undefined : {
        schemaVersion: '1',
        nodes: [
          { id: 'collect-data', title: 'Collect Market Data', instruction: 'Collect prices', dependsOn: [] },
          { id: 'risk-metrics', title: 'Calculate Risk Metrics', instruction: 'Calculate metrics', dependsOn: ['collect-data'] },
        ],
        synthesis: { id: 'synthesis', title: 'Synthesize Recommendation', instruction: 'Synthesize', dependsOn: ['risk-metrics'], kind: 'synthesis' },
      },
    }],
  };
}

const parent: Node = {
  id: 'parent',
  type: 'playbookStep',
  position: { x: 120, y: 80 },
  measured: { width: 384, height: 240 },
  draggable: true,
  data: { title: 'Investment Analysis' },
};

const containerId = 'dynamic-reasoning-container:execution-1:parent:0:0';

describe('buildExecutionRuntimeGraph', () => {
  it('projects an active subgraph as an expanded container below its parent', () => {
    const graph = buildExecutionRuntimeGraph(makeExecution(), [parent]);
    const container = graph.inlineNodes[0];
    const children = graph.inlineNodes.slice(1);

    expect(container).toEqual(expect.objectContaining({
      id: containerId,
      type: 'dynamicReasoningRuntimeContainer',
      position: { x: -160, y: 384 },
      draggable: false,
      connectable: false,
      deletable: false,
      data: expect.objectContaining({ expanded: true, generatedCount: 3, status: 'running' }),
    }));
    expect(children).toHaveLength(3);
    expect(children).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'parent::dynamic-reasoning::subgraph-1::collect-data',
        parentId: containerId,
        position: { x: 24, y: 88 },
        data: expect.objectContaining({ title: 'Collect Market Data', status: 'pending' }),
      }),
      expect.objectContaining({
        id: 'parent::dynamic-reasoning::subgraph-1::risk-metrics',
        parentId: containerId,
        position: { x: 344, y: 88 },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    ]));
    expect(graph.inlineCanvasNodes[0]).toEqual(expect.objectContaining({
      position: { x: 120, y: 80 },
      draggable: true,
      data: expect.objectContaining({ dynamicReasoningRuntimeSourceHandleId: 'dynamic-reasoning-runtime' }),
    }));
    expect(graph.inlineEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'parent',
        target: containerId,
        sourceHandle: 'dynamic-reasoning-runtime',
        targetHandle: 'dynamic-reasoning-container-target',
      }),
      expect.objectContaining({
        source: 'parent::dynamic-reasoning::subgraph-1::collect-data',
        target: 'parent::dynamic-reasoning::subgraph-1::risk-metrics',
      }),
    ]));
    expect(parent.position).toEqual({ x: 120, y: 80 });
  });

  it('defaults terminal attempts to a collapsed header and supports a local expansion override', () => {
    const execution = makeExecution('completed');
    const collapsed = buildExecutionRuntimeGraph(execution, [parent]);
    const onToggleContainer = vi.fn();
    const expanded = buildExecutionRuntimeGraph(execution, [parent], [], {
      expandedByContainerId: { [containerId]: true },
      onToggleContainer,
    });

    expect(collapsed.inlineNodes).toHaveLength(1);
    expect(collapsed.inlineNodes[0]).toEqual(expect.objectContaining({
      height: 64,
      data: expect.objectContaining({ expanded: false }),
    }));
    expect(collapsed.inlineEdges).toHaveLength(1);
    expect(expanded.inlineNodes).toHaveLength(4);
    (expanded.inlineNodes[0].data as { onToggle: () => void }).onToggle();
    expect(onToggleContainer).toHaveBeenCalledWith(containerId, false);
  });

  it('shows an expanded assessing container while planning without generated children', () => {
    const graph = buildExecutionRuntimeGraph(makeExecution('planning'), [parent]);

    expect(graph.inlineNodes).toHaveLength(1);
    expect(graph.inlineNodes[0]).toEqual(expect.objectContaining({
      height: 120,
      data: expect.objectContaining({ expanded: true, planning: true, generatedCount: 0 }),
    }));
    expect(graph.inlineEdges).toHaveLength(1);
  });

  it('does not project direct decisions or attempts without a persisted parent', () => {
    const execution = makeExecution();
    execution.dynamicReasoningAttempts![0] = {
      executionId: 'execution-1',
      parentTaskId: 'missing-parent',
      parentIteration: 0,
      attempt: 0,
      status: 'direct',
      revisions: [],
    };

    const graph = buildExecutionRuntimeGraph(execution, []);

    expect(graph.inlineNodes).toEqual([]);
    expect(graph.inlineEdges).toEqual([]);
    expect(graph.focusNodes).toEqual([]);
  });

  it('places a root-level container below the enclosing iterator', () => {
    const execution = makeExecution();
    execution.dynamicReasoningAttempts![0].parentTaskId = 'iterator-child';
    const iterator: Node = {
      id: 'iterator',
      type: 'playbookIteratorContainer',
      position: { x: 100, y: 200 },
      measured: { width: 900, height: 600 },
      data: {},
    };
    const child: Node = {
      id: 'iterator-child',
      type: 'playbookStep',
      position: { x: 40, y: 60 },
      parentId: 'iterator',
      measured: { width: 420, height: 240 },
      data: { title: 'Iterator Task' },
    };

    const graph = buildExecutionRuntimeGraph(execution, [iterator, child]);
    const container = graph.inlineNodes[0];

    expect(container.parentId).toBeUndefined();
    expect(container.position.y).toBe(864);
    expect(graph.inlineCanvasNodes.find((node) => node.id === 'iterator')?.position).toEqual({ x: 100, y: 200 });
  });

  it('shifts only colliding static closures vertically and preserves nested relative positions', () => {
    const collider: Node = {
      id: 'collider',
      position: { x: 0, y: 420 },
      measured: { width: 900, height: 400 },
      data: {},
    };
    const nested: Node = {
      id: 'nested',
      parentId: 'collider',
      position: { x: 40, y: 80 },
      measured: { width: 384, height: 240 },
      data: {},
    };
    const downstream: Node = {
      id: 'downstream',
      position: { x: 1040, y: 420 },
      measured: { width: 384, height: 240 },
      data: {},
    };
    const edges: Edge[] = [
      { id: 'collider-nested', source: 'collider', target: 'nested' },
      { id: 'nested-downstream', source: 'nested', target: 'downstream' },
    ];

    const graph = buildExecutionRuntimeGraph(makeExecution(), [parent, collider, nested, downstream], edges);
    const projectedCollider = graph.inlineCanvasNodes.find((node) => node.id === 'collider')!;
    const projectedNested = graph.inlineCanvasNodes.find((node) => node.id === 'nested')!;
    const projectedDownstream = graph.inlineCanvasNodes.find((node) => node.id === 'downstream')!;
    const delta = projectedCollider.position.y - collider.position.y;

    expect(delta).toBeGreaterThan(0);
    expect(projectedNested.position).toEqual(nested.position);
    expect(projectedDownstream.position.y - downstream.position.y).toBe(delta);
  });

  it('stacks nearby runtime containers without overlap and remains input-order deterministic', () => {
    const execution = makeExecution();
    const firstAttempt = execution.dynamicReasoningAttempts![0];
    const secondAttempt = {
      ...structuredClone(firstAttempt),
      parentTaskId: 'second-parent',
      subgraphId: 'subgraph-2',
    };
    const secondParent: Node = {
      id: 'second-parent',
      position: { x: 120, y: 80 },
      measured: { width: 384, height: 240 },
      data: { title: 'Second' },
    };

    execution.dynamicReasoningAttempts = [secondAttempt, firstAttempt];
    const forward = buildExecutionRuntimeGraph(execution, [parent, secondParent]);
    execution.dynamicReasoningAttempts = [firstAttempt, secondAttempt];
    const reversed = buildExecutionRuntimeGraph(execution, [parent, secondParent]);
    const forwardContainers = forward.inlineNodes.filter((node) => node.type === 'dynamicReasoningRuntimeContainer');

    expect(forwardContainers).toHaveLength(2);
    expect(forwardContainers[1].position.y).toBeGreaterThan(
      forwardContainers[0].position.y + (forwardContainers[0].height ?? 0),
    );
    expect(forward.inlineNodes.map(({ id, position }) => ({ id, position })))
      .toEqual(reversed.inlineNodes.map(({ id, position }) => ({ id, position })));
  });
});
