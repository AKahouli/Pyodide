import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { Node, ReactFlowProps } from '@xyflow/react';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaybookOverviewCanvas } from './PlaybookOverviewCanvas';

const mocks = vi.hoisted(() => ({
  canvasProps: null as (ReactFlowProps & { children?: ReactNode }) | null,
  fitView: vi.fn(),
  layoutCalls: vi.fn(),
}));

vi.mock('@/components/ai-elements/canvas', () => ({
  Canvas: (props: ReactFlowProps & { children?: ReactNode }) => {
    mocks.canvasProps = props;
    return <div data-testid="overview-canvas">{props.children}</div>;
  },
}));

vi.mock('@/components/ai-elements/controls', () => ({ Controls: () => null }));

vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return { ...actual, useReactFlow: () => mocks };
});

vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class MockElk {
    layout(graph: ElkNode) {
      mocks.layoutCalls();
      return Promise.resolve({
        ...graph,
        children: graph.children?.map((node, index) => ({ ...node, x: index * 300, y: 0 })),
      });
    }
  },
}));

describe('PlaybookOverviewCanvas', () => {
  beforeEach(() => {
    mocks.canvasProps = null;
    vi.clearAllMocks();
  });

  it('configures a read-only canvas and opens a node on double-click', async () => {
    const onOpenNode = vi.fn();
    render(
      <PlaybookOverviewCanvas
        nodes={[{
          id: 'step-1',
          type: 'playbookStep',
          position: { x: 0, y: 0 },
          data: { id: 'step-1', title: 'Review', executionOrder: 0, nodeType: 'agent' },
        }]}
        edges={[]}
        resultNodeIds={new Set()}
        executableNodeIds={new Set(['step-1'])}
        executionDisabled={false}
        onOpenNode={onOpenNode}
        onOpenExecution={vi.fn()}
        onExecuteNode={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.canvasProps?.nodes).toHaveLength(1));
    expect(mocks.canvasProps).toMatchObject({
      nodesDraggable: false,
      nodesConnectable: false,
      selectionOnDrag: false,
      deleteKeyCode: null,
    });

    const node = mocks.canvasProps!.nodes![0] as Node;
    act(() => {
      mocks.canvasProps!.onNodeDoubleClick?.({} as ReactMouseEvent, node);
    });
    expect(onOpenNode).toHaveBeenCalledWith('step-1');
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalled());
  });

  it('opens results after a single click but cancels that action on double-click', async () => {
    vi.useFakeTimers();
    const onOpenNode = vi.fn();
    const onOpenExecution = vi.fn();
    const onExecuteNode = vi.fn();
    render(
      <PlaybookOverviewCanvas
        nodes={[{
          id: 'step-1',
          type: 'playbookStep',
          position: { x: 0, y: 0 },
          data: { id: 'step-1', title: 'Review', executionOrder: 0, nodeType: 'agent', assignedAgentId: 'agent-1' },
        }]}
        edges={[]}
        resultNodeIds={new Set(['step-1'])}
        executableNodeIds={new Set(['step-1'])}
        executionDisabled={false}
        onOpenNode={onOpenNode}
        onOpenExecution={onOpenExecution}
        onExecuteNode={onExecuteNode}
      />,
    );

    await act(async () => Promise.resolve());
    const node = mocks.canvasProps!.nodes![0] as Node;
    expect(node.data).toMatchObject({ canExecute: true, executionDisabled: false });
    (node.data as { onExecute?: (nodeId: string) => void }).onExecute?.('step-1');
    expect(onExecuteNode).toHaveBeenCalledWith('step-1');

    act(() => {
      mocks.canvasProps!.onNodeClick?.({} as ReactMouseEvent, node);
      vi.advanceTimersByTime(220);
    });
    expect(onOpenExecution).toHaveBeenCalledWith('step-1');

    act(() => {
      mocks.canvasProps!.onNodeClick?.({} as ReactMouseEvent, node);
      mocks.canvasProps!.onNodeDoubleClick?.({} as ReactMouseEvent, node);
      vi.runOnlyPendingTimers();
    });
    expect(onOpenExecution).toHaveBeenCalledTimes(1);
    expect(onOpenNode).toHaveBeenCalledWith('step-1');
    vi.useRealTimers();
  });

  it('updates execution status without relayout or resetting the viewport', async () => {
    const node: Node = {
      id: 'step-1', type: 'playbookStep', position: { x: 0, y: 0 },
      data: { id: 'step-1', title: 'Review', executionOrder: 0, nodeType: 'agent' },
    };
    const callbacks = {
      resultNodeIds: new Set<string>(), executableNodeIds: new Set<string>(),
      executionDisabled: false, onOpenNode: vi.fn(), onOpenExecution: vi.fn(), onExecuteNode: vi.fn(),
    };
    const { rerender } = render(<PlaybookOverviewCanvas nodes={[node]} edges={[]} {...callbacks} />);
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(1));

    rerender(<PlaybookOverviewCanvas nodes={[{
      ...node, data: { ...node.data, stepStatus: 'running' },
    }]} edges={[]} {...callbacks} />);
    expect(mocks.canvasProps?.nodes?.[0].data.stepStatus).toBe('running');
    expect(mocks.layoutCalls).toHaveBeenCalledTimes(1);
    expect(mocks.fitView).toHaveBeenCalledTimes(1);

    rerender(<PlaybookOverviewCanvas nodes={[node, { ...node, id: 'step-2' }]} edges={[]} {...callbacks} />);
    await waitFor(() => expect(mocks.fitView).toHaveBeenCalledTimes(2));
    expect(mocks.layoutCalls).toHaveBeenCalledTimes(2);
  });
});
