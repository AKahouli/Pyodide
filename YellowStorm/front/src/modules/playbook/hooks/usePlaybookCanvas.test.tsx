import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybookCanvas } from './usePlaybookCanvas';
import { tasksToNodes } from './helpers/node-serializer';
import { makePlaybook, makeTask } from '../test-utils';

const storeFns = vi.hoisted(() => ({
  updateTasks: vi.fn(),
  updateEdges: vi.fn(),
  updateControlEdges: vi.fn(),
  updateDataBindings: vi.fn(),
  captureSnapshot: vi.fn(),
  selectStep: vi.fn(),
  canvasSyncVersion: 0,
}));

const triggerActionsFns = vi.hoisted(() => ({
  onDelete: vi.fn().mockResolvedValue(undefined),
  onToggleEnabled: vi.fn().mockResolvedValue(undefined),
  onEdit: vi.fn(),
}));

const currentPlaybookState = vi.hoisted(() => ({
  value: null as any,
}));

vi.mock('../store', () => ({
  useCurrentPlaybook: () => currentPlaybookState.value,
  usePlaybookStore: (selector: (s: typeof storeFns) => unknown) => selector(storeFns),
}));

vi.mock('@xyflow/react', () => ({
  addEdge: (edge: any, edges: any[]) => [...edges, edge],
  applyNodeChanges: (changes: any[], nodes: any[]) => {
    const removeIds = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
    return nodes
      .filter((n) => !removeIds.has(n.id))
      .map((node) => {
        const selectChange = changes.find((c) => c.type === 'select' && c.id === node.id);
        return selectChange ? { ...node, selected: selectChange.selected } : node;
      });
  },
  applyEdgeChanges: (changes: any[], edges: any[]) => {
    const removeIds = new Set(changes.filter((c) => c.type === 'remove').map((c) => c.id));
    return edges.filter((e) => !removeIds.has(e.id));
  },
}));

describe('usePlaybookCanvas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    currentPlaybookState.value = makePlaybook();
  });

  it('maps tasks to react-flow nodes', () => {
    const nodes = tasksToNodes([makeTask({ id: 't1', positionX: 11, positionY: 22 })], true);
    expect(nodes[0]).toMatchObject({ id: '__trigger__', type: 'playbookTrigger', draggable: true });
    expect(nodes[1]).toMatchObject({ id: 't1', type: 'playbookStep', position: { x: 11, y: 22 } });
  });

  it('does not inject a trigger node when mail trigger is not active', () => {
    const nodes = tasksToNodes([makeTask({ id: 't1', positionX: 11, positionY: 22 })], false);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ id: 't1', type: 'playbookStep' });
  });

  it('projects iterator tasks as container nodes and child tasks as scoped steps', () => {
    const nodes = tasksToNodes([
      makeTask({
        id: 'iterator-1',
        taskType: 'iterator',
        title: 'Loop documents',
        positionX: 50,
        positionY: 60,
      }),
      makeTask({
        id: 'child-1',
        title: 'Extract facts',
        positionX: 120,
        positionY: 140,
        containerConfig: { parentIteratorId: 'iterator-1' },
      }),
    ], false);

    expect(nodes[0]).toMatchObject({ id: 'iterator-1', type: 'playbookIteratorContainer' });
    expect(nodes[0]).toMatchObject({ style: { width: 486, height: 352 } });
    expect(nodes[1]).toMatchObject({
      id: 'child-1',
      type: 'playbookStep',
      parentId: 'iterator-1',
      extent: 'parent',
      position: { x: 70, y: 80 },
    });
  });

  it('keeps iterator container anchored to its persisted position', () => {
    const nodes = tasksToNodes([
      makeTask({
        id: 'iterator-1',
        taskType: 'iterator',
        positionX: 50,
        positionY: 60,
      }),
      makeTask({
        id: 'child-1',
        positionX: 140,
        positionY: 220,
        containerConfig: { parentIteratorId: 'iterator-1' },
      }),
    ], false);

    expect(nodes[0]).toMatchObject({
      id: 'iterator-1',
      position: { x: 50, y: 60 },
    });
  });

  it('respects persisted iterator layout when it is larger than auto-computed bounds', () => {
    const nodes = tasksToNodes([
      makeTask({
        id: 'iterator-1',
        taskType: 'iterator',
        positionX: 50,
        positionY: 60,
        iteratorLayout: { width: 700, height: 540 },
      }),
      makeTask({
        id: 'child-1',
        positionX: 140,
        positionY: 220,
        containerConfig: { parentIteratorId: 'iterator-1' },
      }),
    ], false);

    expect(nodes[0]).toMatchObject({
      id: 'iterator-1',
      style: { width: 700, height: 540 },
      data: expect.objectContaining({
        iteratorLayout: { width: 700, height: 540 },
      }),
    });
  });

  it('persists edges from the synthetic trigger source', () => {
    currentPlaybookState.value = makePlaybook({ edges: [] });
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onConnect({
        source: '__trigger__',
        target: 'task-1',
        sourceHandle: 'mail_data',
        targetHandle: 'default',
      } as any);
    });

    act(() => vi.runAllTimers());

    expect(storeFns.updateControlEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-__trigger__-mail_data-task-1-default',
        kind: 'sequential',
        source: '__trigger__',
        target: 'task-1',
      },
    ]);
  });

  it('adds edge on connect and updates store asynchronously', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onEdgesChange([{ id: 'edge-1', type: 'remove' }] as any);
    });

    act(() => vi.runAllTimers());
    expect(storeFns.updateControlEdges).toHaveBeenCalledTimes(1);
  });

  it('syncs node positions to store on node drag stop', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.setNodes([
        {
          id: 'task-1',
          type: 'playbookStep',
          position: { x: 123, y: 456 },
          data: makeTask({ id: 'task-1' }),
        } as any,
      ]);
      result.current.onNodeDragStop({} as any, {} as any, [] as any);
    });

    expect(storeFns.updateTasks).toHaveBeenCalled();
  });

  it('persists parented child positions as absolute coordinates on drag stop', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'iterator-1', taskType: 'iterator', positionX: 50, positionY: 60 }),
        makeTask({
          id: 'child-1',
          positionX: 120,
          positionY: 140,
          containerConfig: { parentIteratorId: 'iterator-1' },
        }),
      ],
      edges: [],
    });
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.setNodes([
        {
          id: 'iterator-1',
          type: 'playbookIteratorContainer',
          position: { x: 50, y: 60 },
          data: makeTask({ id: 'iterator-1', taskType: 'iterator', positionX: 50, positionY: 60 }),
        } as any,
        {
          id: 'child-1',
          type: 'playbookStep',
          parentId: 'iterator-1',
          extent: 'parent',
          position: { x: 70, y: 80 },
          data: makeTask({ id: 'child-1', positionX: 120, positionY: 140, containerConfig: { parentIteratorId: 'iterator-1' } }),
        } as any,
      ]);
      result.current.onNodeDragStop({} as any, { id: 'child-1' } as any, [] as any);
    });

    expect(storeFns.updateTasks).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-1',
          positionX: 120,
          positionY: 140,
          containerConfig: { parentIteratorId: 'iterator-1' },
        }),
      ]),
    );
  });

  it('syncs react-flow selection changes back to the store', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onNodesChange([{ id: 'task-1', type: 'select', selected: true }] as any);
    });

    expect(storeFns.selectStep).toHaveBeenCalledWith('task-1');
  });

  it('allows multiple port-to-port edges between the same two nodes', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'task-1',
          executionOrder: 0,
          outputPorts: [
            { id: 'out-1', name: 'Out 1', artifactKind: 'document' },
            { id: 'out-2', name: 'Out 2', artifactKind: 'document' },
          ],
        }),
        makeTask({
          id: 'task-2',
          executionOrder: 1,
          inputPorts: [
            { id: 'in-1', name: 'In 1', artifactKind: 'document', required: false },
            { id: 'in-2', name: 'In 2', artifactKind: 'document', required: false },
          ],
        }),
      ],
      edges: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onConnect({
        source: 'task-1',
        target: 'task-2',
        sourceHandle: 'out-1',
        targetHandle: 'in-1',
      } as any);
      result.current.onConnect({
        source: 'task-1',
        target: 'task-2',
        sourceHandle: 'out-2',
        targetHandle: 'in-2',
      } as any);
    });

    act(() => vi.runAllTimers());

    expect(storeFns.updateControlEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-task-1-out-1-task-2-in-1',
        kind: 'sequential',
        source: 'task-1',
        target: 'task-2',
      },
      {
        id: 'e-task-1-out-2-task-2-in-2',
        kind: 'sequential',
        source: 'task-1',
        target: 'task-2',
      },
    ]);
  });

  it('persists iterator results port connections for downstream data inputs', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'iterator-1',
          taskType: 'iterator',
          outputPorts: [
            { id: 'results', name: 'Results', artifactKind: 'data' },
          ],
        }),
        makeTask({
          id: 'task-2',
          executionOrder: 1,
          inputPorts: [
            { id: 'metrics', name: 'Metrics', artifactKind: 'data', required: false },
          ],
        }),
      ],
      edges: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onConnect({
        source: 'iterator-1',
        target: 'task-2',
        sourceHandle: 'results',
        targetHandle: 'metrics',
      } as any);
    });

    act(() => vi.runAllTimers());

    expect(storeFns.updateControlEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-iterator-1-results-task-2-metrics',
        kind: 'sequential',
        source: 'iterator-1',
        target: 'task-2',
      },
    ]);
  });

  it('removes node and linked edges and syncs both stores', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.removeNode('task-1');
    });
    act(() => vi.runAllTimers());

    expect(storeFns.updateTasks).toHaveBeenCalled();
    expect(storeFns.updateControlEdges).toHaveBeenCalled();
  });

  it('delegates trigger node deletion to triggerActions.onDelete', () => {
    const playbook = makePlaybook({ automatedTriggerType: 'mail' });
    currentPlaybookState.value = playbook;
    const { result } = renderHook(() => usePlaybookCanvas(triggerActionsFns));

    act(() => {
      result.current.removeNode('__trigger__');
    });

    expect(triggerActionsFns.onDelete).toHaveBeenCalledWith('playbook-1');
    expect(storeFns.updateTasks).not.toHaveBeenCalled();
  });

  it('allows selecting the trigger node', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onNodesChange([{ id: '__trigger__', type: 'select', selected: true }] as any);
    });

    expect(storeFns.selectStep).toHaveBeenCalledWith('__trigger__');
  });

  it('assigns a task to an iterator and moves it inside the container', () => {
    const iteratorTask = makeTask({
      id: 'iterator-1',
      taskType: 'iterator',
      positionX: 50,
      positionY: 60,
    });
    const childTask = makeTask({
      id: 'child-1',
      positionX: 320,
      positionY: 180,
      containerConfig: { parentIteratorId: null },
    });
    currentPlaybookState.value = makePlaybook({ tasks: [iteratorTask, childTask], edges: [] });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.updateNodeData('child-1', {
        containerConfig: { parentIteratorId: 'iterator-1' },
      });
    });

    const updatedChildNode = result.current.nodes.find((node) => node.id === 'child-1');
    expect(updatedChildNode).toMatchObject({
      parentId: 'iterator-1',
      extent: 'parent',
      position: { x: 32, y: 72 },
    });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-1',
          positionX: 82,
          positionY: 132,
          containerConfig: { parentIteratorId: 'iterator-1' },
        }),
      ]),
    );
  });

  it('stacks a newly assigned task after existing iterator children', () => {
    const iteratorTask = makeTask({
      id: 'iterator-1',
      taskType: 'iterator',
      positionX: 100,
      positionY: 120,
    });
    const existingChildTask = makeTask({
      id: 'child-1',
      positionX: 132,
      positionY: 192,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    const newChildTask = makeTask({
      id: 'child-2',
      positionX: 420,
      positionY: 260,
      containerConfig: { parentIteratorId: null },
    });
    currentPlaybookState.value = makePlaybook({
      tasks: [iteratorTask, existingChildTask, newChildTask],
      edges: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.updateNodeData('child-2', {
        containerConfig: { parentIteratorId: 'iterator-1' },
      });
    });

    const updatedChildNode = result.current.nodes.find((node) => node.id === 'child-2');
    expect(updatedChildNode).toMatchObject({
      parentId: 'iterator-1',
      extent: 'parent',
      position: { x: 608, y: 72 },
    });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-2',
          positionX: 708,
          positionY: 192,
          containerConfig: { parentIteratorId: 'iterator-1' },
        }),
      ]),
    );
  });

  it('wraps newly assigned iterator children onto the next row after two siblings', () => {
    const iteratorTask = makeTask({
      id: 'iterator-1',
      taskType: 'iterator',
      positionX: 100,
      positionY: 120,
    });
    const existingChildTask1 = makeTask({
      id: 'child-1',
      positionX: 132,
      positionY: 192,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    const existingChildTask2 = makeTask({
      id: 'child-2',
      positionX: 564,
      positionY: 192,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    const newChildTask = makeTask({
      id: 'child-3',
      positionX: 420,
      positionY: 260,
      containerConfig: { parentIteratorId: null },
    });
    currentPlaybookState.value = makePlaybook({
      tasks: [iteratorTask, existingChildTask1, existingChildTask2, newChildTask],
      edges: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.updateNodeData('child-3', {
        containerConfig: { parentIteratorId: 'iterator-1' },
      });
    });

    const updatedChildNode = result.current.nodes.find((node) => node.id === 'child-3');
    expect(updatedChildNode).toMatchObject({
      parentId: 'iterator-1',
      extent: 'parent',
      position: { x: 32, y: 504 },
    });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-3',
          positionX: 132,
          positionY: 624,
          containerConfig: { parentIteratorId: 'iterator-1' },
        }),
      ]),
    );
  });

  it('repackages iterator children into a compact grid on demand', () => {
    const iteratorTask = makeTask({
      id: 'iterator-1',
      taskType: 'iterator',
      positionX: 100,
      positionY: 120,
    });
    const childTask1 = makeTask({
      id: 'child-1',
      executionOrder: 1,
      positionX: 900,
      positionY: 600,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    const childTask2 = makeTask({
      id: 'child-2',
      executionOrder: 2,
      positionX: 1200,
      positionY: 620,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    const childTask3 = makeTask({
      id: 'child-3',
      executionOrder: 3,
      positionX: 1500,
      positionY: 640,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    currentPlaybookState.value = makePlaybook({
      tasks: [iteratorTask, childTask1, childTask2, childTask3],
      edges: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.repackIteratorChildren('iterator-1');
    });

    const childNode1 = result.current.nodes.find((node) => node.id === 'child-1');
    const childNode2 = result.current.nodes.find((node) => node.id === 'child-2');
    const childNode3 = result.current.nodes.find((node) => node.id === 'child-3');

    expect(childNode1).toMatchObject({ position: { x: 32, y: 72 } });
    expect(childNode2).toMatchObject({ position: { x: 608, y: 72 } });
    expect(childNode3).toMatchObject({ position: { x: 32, y: 504 } });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'child-1', positionX: 132, positionY: 192 }),
        expect.objectContaining({ id: 'child-2', positionX: 708, positionY: 192 }),
        expect.objectContaining({ id: 'child-3', positionX: 132, positionY: 624 }),
      ]),
    );
  });

  it('unassigns a task from an iterator without losing its absolute position', () => {
    const iteratorTask = makeTask({
      id: 'iterator-1',
      taskType: 'iterator',
      positionX: 50,
      positionY: 60,
    });
    const childTask = makeTask({
      id: 'child-1',
      positionX: 82,
      positionY: 132,
      containerConfig: { parentIteratorId: 'iterator-1' },
    });
    currentPlaybookState.value = makePlaybook({ tasks: [iteratorTask, childTask], edges: [] });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.updateNodeData('child-1', {
        containerConfig: { parentIteratorId: null },
      });
    });

    const updatedChildNode = result.current.nodes.find((node) => node.id === 'child-1');
    expect(updatedChildNode).toMatchObject({
      id: 'child-1',
      parentId: undefined,
      extent: undefined,
      position: { x: 82, y: 132 },
    });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-1',
          positionX: 82,
          positionY: 132,
          containerConfig: { parentIteratorId: null },
        }),
      ]),
    );
  });
});
