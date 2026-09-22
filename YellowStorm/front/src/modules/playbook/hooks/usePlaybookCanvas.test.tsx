import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybookCanvas } from './usePlaybookCanvas';
import { tasksToNodes } from './helpers/node-serializer';
import { makeEdge, makePlaybook, makeTask } from '../test-utils';

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
  usePlaybookStore: Object.assign(
    (selector: (s: typeof storeFns) => unknown) => selector(storeFns),
    { getState: () => ({ currentPlaybook: currentPlaybookState.value }) },
  ),
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
  useReactFlow: () => ({
    screenToFlowPosition: (pos: { x: number; y: number }) => pos,
  }),
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

  it('stores trigger connections as data bindings without persisting control edges', () => {
    currentPlaybookState.value = makePlaybook({
      edges: [],
      dataBindings: [],
      tasks: [
        makeTask({
          id: 'task-1',
          inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'data', required: false }],
        }),
      ],
    });
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

    expect(storeFns.updateEdges).not.toHaveBeenCalled();
    expect(storeFns.updateDataBindings).toHaveBeenLastCalledWith([
      {
        id: 'db-trigger-mail_data-task-1-default',
        targetNode: 'task-1',
        targetPort: 'default',
        sourceKind: 'trigger',
        triggerPath: 'mail_data',
      },
    ]);
    expect(storeFns.updateControlEdges).not.toHaveBeenCalled();
  });

  it('ignores generic edge remove events so double-click stays the only edge delete path', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onEdgesChange([{ id: 'edge-1', type: 'remove' }] as any);
    });

    act(() => vi.runAllTimers());
    expect(storeFns.updateEdges).not.toHaveBeenCalled();
    expect(storeFns.updateControlEdges).not.toHaveBeenCalled();
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

  it('stores multiple port-to-port bindings and matching control edges', () => {
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
      dataBindings: [],
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

    expect(storeFns.updateEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-task-1-out-1-task-2-in-1',
        sourceId: 'task-1',
        targetId: 'task-2',
        sourceOutputPortId: 'out-1',
        targetInputPortId: 'in-1',
      },
      {
        id: 'e-task-1-out-2-task-2-in-2',
        sourceId: 'task-1',
        targetId: 'task-2',
        sourceOutputPortId: 'out-2',
        targetInputPortId: 'in-2',
      },
    ]);
    expect(storeFns.updateDataBindings).toHaveBeenLastCalledWith([
      {
        id: 'db-task-1-out-1-task-2-in-1',
        targetNode: 'task-2',
        targetPort: 'in-1',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'out-1',
        iteration: 'current',
      },
      {
        id: 'db-task-1-out-2-task-2-in-2',
        targetNode: 'task-2',
        targetPort: 'in-2',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'out-2',
        iteration: 'current',
      },
    ]);
    expect(storeFns.updateControlEdges).not.toHaveBeenCalled();
  });

  it('stores iterator result bindings and matching control edges', () => {
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
      dataBindings: [],
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

    expect(storeFns.updateEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-iterator-1-results-task-2-metrics',
        sourceId: 'iterator-1',
        targetId: 'task-2',
        sourceOutputPortId: 'results',
        targetInputPortId: 'metrics',
      },
    ]);
    expect(storeFns.updateDataBindings).toHaveBeenLastCalledWith([
      {
        id: 'db-iterator-1-results-task-2-metrics',
        targetNode: 'task-2',
        targetPort: 'metrics',
        sourceKind: 'node-output',
        sourceNode: 'iterator-1',
        sourcePort: 'results',
        iteration: 'current',
      },
    ]);
    expect(storeFns.updateControlEdges).not.toHaveBeenCalled();
  });

  it('creates a compatible input port and binding when dropping on a node body', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'task-1',
          executionOrder: 0,
          outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'text' }],
        }),
        makeTask({
          id: 'task-2',
          executionOrder: 1,
          inputPorts: [],
        }),
      ],
      edges: [],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    const originalElementsFromPoint = (document as Document & { elementsFromPoint?: typeof document.elementsFromPoint }).elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [
        {
          classList: { contains: (value: string) => value === 'react-flow__node' },
          getAttribute: (name: string) => (name === 'data-id' ? 'task-2' : null),
          closest: () => null,
        } as any,
      ]),
    });

    act(() => {
      result.current.setNodes([
        {
          id: 'task-1',
          type: 'playbookStep',
          position: { x: 20, y: 20 },
          width: 160,
          height: 100,
          data: makeTask({
            id: 'task-1',
            executionOrder: 0,
            outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'text' }],
          }),
        } as any,
        {
          id: 'task-2',
          type: 'playbookStep',
          position: { x: 240, y: 20 },
          width: 160,
          height: 100,
          data: makeTask({
            id: 'task-2',
            executionOrder: 1,
            inputPorts: [],
          }),
        } as any,
      ]);
      result.current.onConnectStart(
        {} as any,
        { nodeId: 'task-1', handleId: 'draft', handleType: 'source' } as any,
      );
      result.current.onConnectEnd({ clientX: 260, clientY: 40 } as any, null as any);
    });

    act(() => vi.runAllTimers());

    const targetNode = result.current.nodes.find((node) => node.id === 'task-2');
    const createdPort = (targetNode?.data as any)?.inputPorts?.[0];

    expect(createdPort).toMatchObject({
      name: 'Draft',
      artifactKind: 'text',
      required: false,
    });
    expect(storeFns.updateDataBindings).toHaveBeenLastCalledWith([
      {
        id: `db-task-1-draft-task-2-${createdPort.id}`,
        targetNode: 'task-2',
        targetPort: createdPort.id,
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'draft',
        iteration: 'current',
      },
    ]);
    expect(storeFns.updateEdges).toHaveBeenLastCalledWith([
      {
        id: `e-task-1-draft-task-2-${createdPort.id}`,
        sourceId: 'task-1',
        targetId: 'task-2',
        sourceOutputPortId: 'draft',
        targetInputPortId: createdPort.id,
      },
    ]);

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('replaces the existing binding when reconnecting the same target port', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'task-1',
          executionOrder: 0,
          outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'text' }],
        }),
        makeTask({
          id: 'task-2',
          executionOrder: 1,
          outputPorts: [{ id: 'final', name: 'Final', artifactKind: 'text' }],
        }),
        makeTask({
          id: 'task-3',
          executionOrder: 2,
          inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }],
        }),
      ],
      edges: [{
        id: 'e-task-1-draft-task-3-prompt',
        sourceId: 'task-1',
        targetId: 'task-3',
        sourceOutputPortId: 'draft',
        targetInputPortId: 'prompt',
      }],
      dataBindings: [{
        id: 'db-task-1-draft-task-3-prompt',
        targetNode: 'task-3',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'draft',
        iteration: 'current',
      }],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onConnect({
        source: 'task-2',
        target: 'task-3',
        sourceHandle: 'final',
        targetHandle: 'prompt',
      } as any);
    });

    act(() => vi.runAllTimers());

    expect(storeFns.updateEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-task-2-final-task-3-prompt',
        sourceId: 'task-2',
        targetId: 'task-3',
        sourceOutputPortId: 'final',
        targetInputPortId: 'prompt',
      },
    ]);
    expect(storeFns.updateDataBindings).toHaveBeenLastCalledWith([
      {
        id: 'db-task-2-final-task-3-prompt',
        targetNode: 'task-3',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'task-2',
        sourcePort: 'final',
        iteration: 'current',
      },
    ]);
  });

  it('preserves conditional control edges while adding a sequential edge for a new data binding source', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'router-1',
          nodeType: 'router',
          outputPorts: [{ id: 'approved', name: 'Approved', artifactKind: 'text' }],
        }),
        makeTask({
          id: 'task-1',
          executionOrder: 0,
          outputPorts: [{ id: 'draft', name: 'Draft', artifactKind: 'text' }],
        }),
        makeTask({
          id: 'task-3',
          executionOrder: 2,
          inputPorts: [{ id: 'prompt', name: 'Prompt', artifactKind: 'text', required: false }],
        }),
      ],
      edges: [{
        id: 'e-router-1-approved-task-3-prompt',
        sourceId: 'router-1',
        targetId: 'task-3',
        sourceOutputPortId: 'approved',
        targetInputPortId: 'prompt',
      }],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onConnect({
        source: 'task-1',
        target: 'task-3',
        sourceHandle: 'draft',
        targetHandle: 'prompt',
      } as any);
    });

    act(() => vi.runAllTimers());

    expect(storeFns.updateEdges).toHaveBeenLastCalledWith([
      {
        id: 'e-router-1-approved-task-3-prompt',
        sourceId: 'router-1',
        targetId: 'task-3',
        sourceOutputPortId: 'approved',
        targetInputPortId: 'prompt',
      },
      {
        id: 'e-task-1-draft-task-3-prompt',
        sourceId: 'task-1',
        targetId: 'task-3',
        sourceOutputPortId: 'draft',
        targetInputPortId: 'prompt',
      },
    ]);
    expect(storeFns.updateDataBindings).toHaveBeenLastCalledWith([
      {
        id: 'db-task-1-draft-task-3-prompt',
        targetNode: 'task-3',
        targetPort: 'prompt',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'draft',
        iteration: 'current',
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
    expect(storeFns.updateEdges).toHaveBeenCalled();
    expect(storeFns.updateControlEdges).not.toHaveBeenCalled();
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

  it('assigns a dragged task to an iterator when dropped inside the container', () => {
    const iteratorTask = makeTask({
      id: 'iterator-1',
      taskType: 'iterator',
      positionX: 100,
      positionY: 100,
      iteratorLayout: { width: 600, height: 360 },
    });
    const childTask = makeTask({
      id: 'child-1',
      positionX: -200,
      positionY: 220,
      containerConfig: { parentIteratorId: null },
    });
    currentPlaybookState.value = makePlaybook({ tasks: [iteratorTask, childTask], edges: [] });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.setNodes([
        {
          id: 'iterator-1',
          type: 'playbookIteratorContainer',
          position: { x: 100, y: 100 },
          style: { width: 600, height: 360 },
          data: iteratorTask,
        } as any,
        {
          id: 'child-1',
          type: 'playbookStep',
          position: { x: -200, y: 220 },
          width: 384,
          height: 240,
          data: childTask,
        } as any,
      ]);
    });

    act(() => {
      result.current.onNodeDragStop({ clientX: 240, clientY: 220 } as any, {
        id: 'child-1',
        type: 'playbookStep',
        position: { x: -200, y: 220 },
        width: 384,
        height: 240,
        data: childTask,
      } as any, []);
    });

    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-1',
          positionX: -200,
          positionY: 220,
          containerConfig: { parentIteratorId: 'iterator-1' },
        }),
      ]),
    );
  });

  it('auto-creates a compatible input port when dropping a router output onto a node body', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'router-1',
          nodeType: 'router',
          outputPorts: [{ id: 'approved', name: 'Approved', artifactKind: 'data' }],
        }),
        makeTask({
          id: 'task-2',
          executionOrder: 1,
          inputPorts: [],
        }),
      ],
      edges: [],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    const originalElementsFromPoint = (document as Document & { elementsFromPoint?: typeof document.elementsFromPoint }).elementsFromPoint;
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [
        {
          classList: { contains: (value: string) => value === 'react-flow__node' },
          getAttribute: (name: string) => (name === 'data-id' ? 'task-2' : null),
          closest: () => null,
        } as any,
      ]),
    });

    act(() => {
      result.current.setNodes([
        {
          id: 'router-1',
          type: 'playbookRouter',
          position: { x: 20, y: 20 },
          width: 160,
          height: 100,
          data: makeTask({
            id: 'router-1',
            nodeType: 'router',
            outputPorts: [{ id: 'approved', name: 'Approved', artifactKind: 'data' }],
          }),
        } as any,
        {
          id: 'task-2',
          type: 'playbookStep',
          position: { x: 240, y: 20 },
          width: 160,
          height: 100,
          data: makeTask({
            id: 'task-2',
            executionOrder: 1,
            inputPorts: [],
          }),
        } as any,
      ]);
      result.current.onConnectStart(
        {} as any,
        { nodeId: 'router-1', handleId: 'approved', handleType: 'source' } as any,
      );
      result.current.onConnectEnd({ clientX: 260, clientY: 40 } as any, null as any);
    });

    act(() => vi.runAllTimers());

    const updatedTasks = storeFns.updateTasks.mock.calls.at(-1)?.[0] as Array<any> | undefined;
    const updatedTargetTask = updatedTasks?.find((task) => task.id === 'task-2');
    const createdPort = updatedTargetTask?.inputPorts?.[0];

    expect(createdPort).toMatchObject({
      name: 'Approved',
      artifactKind: 'data',
      required: false,
    });
    expect(storeFns.updateDataBindings).not.toHaveBeenCalled();
    expect(storeFns.updateEdges).toHaveBeenLastCalledWith([
      {
        id: `e-router-1-approved-task-2-${createdPort.id}`,
        sourceId: 'router-1',
        targetId: 'task-2',
        sourceOutputPortId: 'approved',
        targetInputPortId: createdPort.id,
      },
    ]);

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: originalElementsFromPoint,
    });
  });

  it('updates node data from canonical tasks instead of malformed canvas nodes', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [makeTask({ id: 'task-1', title: 'Original title' })],
      edges: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      (result.current.nodes as any[]).push({
        id: undefined,
        type: 'playbookStep',
        position: { x: 100, y: 100 },
        data: { title: 'Malformed transient node' },
      });
      result.current.updateNodeData('task-1', { title: 'Updated title' });
    });

    expect(storeFns.updateTasks).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'task-1', title: 'Updated title' }),
    ]);
    expect(storeFns.updateTasks).not.toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: undefined })]),
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
      position: { x: 637, y: 72 },
    });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-2',
          positionX: 737,
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
      position: { x: 32, y: 533 },
    });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'child-3',
          positionX: 132,
          positionY: 653,
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
    expect(childNode2).toMatchObject({ position: { x: 637, y: 72 } });
    expect(childNode3).toMatchObject({ position: { x: 32, y: 533 } });
    expect(storeFns.updateTasks).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'child-1', positionX: 132, positionY: 192 }),
        expect.objectContaining({ id: 'child-2', positionX: 737, positionY: 192 }),
        expect.objectContaining({ id: 'child-3', positionX: 132, positionY: 653 }),
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

  it('renders two connected top-level iterators as separate container nodes', () => {
    const nodes = tasksToNodes([
      makeTask({
        id: 'iterator-1',
        taskType: 'iterator',
        nodeType: 'iterator',
        title: 'Loop companies',
        positionX: 50,
        positionY: 60,
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
        iteratorConfig: { source: '{{items}}', mode: 'item', batchSize: 10, itemVariable: 'item', outputVariable: 'items', errorStrategy: 'stop' },
      }),
      makeTask({
        id: 'iterator-2',
        taskType: 'iterator',
        nodeType: 'iterator',
        title: 'Loop leads',
        positionX: 570,
        positionY: 60,
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
        iteratorConfig: { source: '{{items}}', mode: 'item', batchSize: 10, itemVariable: 'item', outputVariable: 'processed_items', errorStrategy: 'stop' },
      }),
    ], false);

    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ id: 'iterator-1', type: 'playbookIteratorContainer' });
    expect(nodes[1]).toMatchObject({ id: 'iterator-2', type: 'playbookIteratorContainer' });
  });
});

describe('usePlaybookCanvas shared creation commits', () => {
  const TITLES = { blankStep: 'Step', router: 'Router', humanApproval: 'Approval' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    currentPlaybookState.value = makePlaybook();
  });

  it('createConnectedTask adds task, edge and binding in one snapshot', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'task-1', executionOrder: 0, inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }], outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }] }),
      ],
      edges: [],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());
    act(() => vi.runAllTimers());

    let createdId = '';
    act(() => {
      const created = result.current.createConnectedTask(
        { kind: 'blank' },
        {
          position: { x: 100, y: 100 },
          titles: TITLES,
          source: { nodeId: 'task-1', sourcePortId: 'default' },
        },
      );
      createdId = created?.id ?? '';
    });
    act(() => vi.runAllTimers());

    expect(createdId).not.toBe('');
    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0]).toMatchObject({ source: 'task-1', target: createdId });
    expect(storeFns.captureSnapshot).toHaveBeenCalledTimes(1);
    expect(storeFns.updateTasks).toHaveBeenCalledTimes(1);
    expect(storeFns.updateEdges).toHaveBeenCalledTimes(1);
    expect(storeFns.updateDataBindings).toHaveBeenCalledTimes(1);
    expect(storeFns.updateDataBindings.mock.calls[0][0]).toMatchObject([
      expect.objectContaining({ sourceNode: 'task-1', targetNode: createdId, sourceKind: 'node-output' }),
    ]);
    expect(storeFns.selectStep).toHaveBeenCalledWith(createdId);
  });

  it('createConnectedTask from the mail trigger creates a binding without a control edge', () => {
    currentPlaybookState.value = makePlaybook({
      automatedTriggerType: 'mail',
      tasks: [],
      edges: [],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());
    act(() => vi.runAllTimers());

    let createdId = '';
    act(() => {
      const created = result.current.createConnectedTask(
        { kind: 'blank' },
        {
          position: { x: 0, y: 0 },
          titles: TITLES,
          source: { nodeId: '__trigger__', sourcePortId: 'mail_data' },
        },
      );
      createdId = created?.id ?? '';
    });
    act(() => vi.runAllTimers());

    expect(createdId).not.toBe('');
    expect(result.current.edges).toHaveLength(0);
    expect(storeFns.updateEdges).not.toHaveBeenCalled();
    expect(storeFns.updateDataBindings.mock.calls[0][0]).toMatchObject([
      expect.objectContaining({ sourceKind: 'trigger', triggerPath: 'mail_data', targetNode: createdId }),
    ]);
  });

  it('insertTaskOnEdge rewires the edge and splits its binding atomically', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'task-1', executionOrder: 0, outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }] }),
        makeTask({ id: 'task-2', executionOrder: 1, inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }] }),
      ],
      edges: [makeEdge({ id: 'edge-1', sourceId: 'task-1', targetId: 'task-2', sourceOutputPortId: 'default', targetInputPortId: 'default' })],
      dataBindings: [{
        id: 'db-1',
        targetNode: 'task-2',
        targetPort: 'default',
        sourceKind: 'node-output',
        sourceNode: 'task-1',
        sourcePort: 'default',
        iteration: 'current',
      }],
    });

    const { result } = renderHook(() => usePlaybookCanvas());
    act(() => vi.runAllTimers());

    let createdId = '';
    act(() => {
      const created = result.current.insertTaskOnEdge('edge-1', { kind: 'blank' }, { titles: TITLES });
      createdId = created?.id ?? '';
    });
    act(() => vi.runAllTimers());

    expect(createdId).not.toBe('');
    expect(result.current.nodes).toHaveLength(3);
    expect(result.current.edges).toHaveLength(2);
    expect(result.current.edges.some((edge) => edge.id === 'edge-1')).toBe(false);
    expect(result.current.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'task-1', target: createdId }),
      expect.objectContaining({ source: createdId, target: 'task-2' }),
    ]));
    expect(storeFns.captureSnapshot).toHaveBeenCalledTimes(1);
    expect(storeFns.updateTasks).toHaveBeenCalledTimes(1);
    const nextBindings = storeFns.updateDataBindings.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(nextBindings).toHaveLength(2);
    expect(nextBindings.some((b) => b.sourceNode === 'task-1' && b.targetNode === createdId)).toBe(true);
    expect(nextBindings.some((b) => b.sourceNode === createdId && b.targetNode === 'task-2')).toBe(true);
  });

  it('insertTaskOnEdge rejects a template that cannot bridge the edge', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'task-1', executionOrder: 0, outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }] }),
        makeTask({ id: 'task-2', executionOrder: 1, inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }] }),
      ],
      edges: [makeEdge({ id: 'edge-1', sourceId: 'task-1', targetId: 'task-2', sourceOutputPortId: 'default', targetInputPortId: 'default' })],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());
    act(() => vi.runAllTimers());

    const documentOnlyTemplate = {
      id: 'tpl',
      key: 'tpl-key',
      nodeType: 'agent' as const,
      title: 'Summarize',
      description: '',
      icon: 'FileText',
      color: '#3b82f6',
      category: 'content' as const,
      inputPorts: [{ id: 'in', name: 'Doc', artifactKind: 'document' as const, required: true }],
      outputPorts: [{ id: 'out', name: 'Summary', artifactKind: 'text' as const }],
      promptTemplate: '',
      recommendedAgentTypeSlug: null,
      requiredToolNames: [],
    };

    let created: unknown = 'unset';
    act(() => {
      created = result.current.insertTaskOnEdge('edge-1', { kind: 'template', template: documentOnlyTemplate }, { titles: TITLES });
    });
    act(() => vi.runAllTimers());

    expect(created).toBeNull();
    expect(storeFns.updateTasks).not.toHaveBeenCalled();
    expect(storeFns.updateEdges).not.toHaveBeenCalled();
    expect(result.current.edges).toHaveLength(1);
  });
});

describe('usePlaybookCanvas commits under StrictMode double-invocation', () => {
  const TITLES = { blankStep: 'Step', router: 'Router', humanApproval: 'Approval' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({ id: 'task-1', executionOrder: 0, outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }] }),
        makeTask({ id: 'task-2', executionOrder: 1, inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }] }),
      ],
      edges: [makeEdge({ id: 'edge-1', sourceId: 'task-1', targetId: 'task-2', sourceOutputPortId: 'default', targetInputPortId: 'default' })],
      dataBindings: [],
    });
  });

  it('insertTaskOnEdge keeps each replacement edge exactly once', () => {
    const { result } = renderHook(() => usePlaybookCanvas(), { wrapper: StrictMode });
    act(() => vi.runAllTimers());

    act(() => {
      result.current.insertTaskOnEdge('edge-1', { kind: 'blank' }, { titles: TITLES });
    });
    act(() => vi.runAllTimers());

    expect(result.current.edges).toHaveLength(2);
    const persistedEdges = storeFns.updateEdges.mock.calls[0][0];
    expect(persistedEdges).toHaveLength(2);
    const ids = persistedEdges.map((edge: { id: string }) => edge.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('createConnectedTask keeps a single new edge and task', () => {
    const { result } = renderHook(() => usePlaybookCanvas(), { wrapper: StrictMode });
    act(() => vi.runAllTimers());

    act(() => {
      result.current.createConnectedTask(
        { kind: 'blank' },
        { position: { x: 0, y: 0 }, titles: TITLES, source: { nodeId: 'task-1', sourcePortId: 'default' } },
      );
    });
    act(() => vi.runAllTimers());

    expect(result.current.nodes).toHaveLength(3);
    expect(result.current.edges).toHaveLength(2);
    const persistedEdges = storeFns.updateEdges.mock.calls[0][0];
    expect(persistedEdges).toHaveLength(2);
    const persistedTasks = storeFns.updateTasks.mock.calls[0][0];
    expect(persistedTasks).toHaveLength(3);
  });
});

describe('usePlaybookCanvas flush-then-create sequencing', () => {
  const TITLES = { blankStep: 'Step', router: 'Router', humanApproval: 'Approval' };

  it('persists same-tick inspector edits together with the newly created step', () => {
    currentPlaybookState.value = makePlaybook({
      tasks: [
        makeTask({
          id: 'task-1',
          executionOrder: 0,
          inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
          outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
        }),
      ],
      edges: [],
      dataBindings: [],
    });

    const { result } = renderHook(() => usePlaybookCanvas());
    act(() => vi.runAllTimers());

    // Same-tick sequence the picker uses: flush the open draft, then commit creation.
    act(() => {
      result.current.updateNodeData('task-1', { title: 'Edited title' });
    });
    act(() => {
      result.current.createConnectedTask(
        { kind: 'blank' },
        { position: { x: 0, y: 0 }, titles: TITLES, source: { nodeId: 'task-1', sourcePortId: 'default' } },
      );
    });
    act(() => vi.runAllTimers());

    const calls = storeFns.updateTasks.mock.calls as Array<[Array<{ id: string; title?: string }>]>;;
    const lastPayload = calls[calls.length - 1][0];
    expect(lastPayload).toHaveLength(2);
    expect(lastPayload.find((task) => task.id === 'task-1')?.title).toBe('Edited title');
    expect(lastPayload.find((task) => task.id !== 'task-1')).toBeTruthy();
  });
});
