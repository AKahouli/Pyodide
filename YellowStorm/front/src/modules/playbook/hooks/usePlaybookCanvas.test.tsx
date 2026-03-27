import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaybookCanvas, tasksToNodes } from './usePlaybookCanvas';
import { makePlaybook, makeTask } from '../test-utils';

const storeFns = vi.hoisted(() => ({
  updateTasks: vi.fn(),
  updateEdges: vi.fn(),
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
    return nodes.filter((n) => !removeIds.has(n.id));
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
    const nodes = tasksToNodes([makeTask({ id: 't1', positionX: 11, positionY: 22 })]);
    expect(nodes[0]).toMatchObject({ id: 't1', type: 'playbookStep', position: { x: 11, y: 22 } });
  });

  it('adds edge on connect and updates store asynchronously', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.onEdgesChange([{ id: 'edge-1', type: 'remove' }] as any);
    });

    act(() => vi.runAllTimers());
    expect(storeFns.updateEdges).toHaveBeenCalledTimes(1);
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

  it('removes node and linked edges and syncs both stores', () => {
    const { result } = renderHook(() => usePlaybookCanvas());

    act(() => {
      result.current.removeNode('task-1');
    });
    act(() => vi.runAllTimers());

    expect(storeFns.updateTasks).toHaveBeenCalled();
    expect(storeFns.updateEdges).toHaveBeenCalled();
  });
});
