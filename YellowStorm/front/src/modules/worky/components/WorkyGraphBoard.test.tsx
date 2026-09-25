import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkyGraphBoard } from './WorkyGraphBoard';

const { task } = vi.hoisted(() => ({ task: { id: 'task-1', title: 'Review request', lane: 'ready', dependsOnStepIds: [] } }));

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../store', () => ({
  useWorkyBoard: () => ({ ready: [task] }),
  useWorkyBoardLoading: () => false,
  useWorkyBoardError: () => null,
}));
vi.mock('../agents/useStreamAgents', () => ({ useStreamAgents: () => ({ agents: [] }) }));
vi.mock('@/modules/playbook/utils/compact-canvas-layout', () => ({
  layoutCompactCanvasNodes: (nodes: unknown[], edges: unknown[]) => ({ nodes, edges }),
}));
vi.mock('@/components/ai-elements/controls', () => ({ Controls: () => null }));
vi.mock('@xyflow/react', () => ({
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: ({ nodes, onNodeClick }: { nodes: { id: string; data: { title: string } }[]; onNodeClick: (event: unknown, node: { id: string }) => void }) => (
    <div>{nodes.map((node) => <button key={node.id} onClick={() => onNodeClick(null, node)}>{node.data.title}</button>)}</div>
  ),
  Background: () => null,
  MiniMap: () => null,
  useOnViewportChange: () => null,
  useReactFlow: () => ({ getViewport: () => ({ x: 0, y: 0, zoom: 1 }), setViewport: vi.fn(), fitView: vi.fn(), screenToFlowPosition: vi.fn() }),
  MarkerType: { ArrowClosed: 'arrowclosed' },
}));

describe('WorkyGraphBoard', () => {
  it.each([false, true])('opens task details directly from a node (fullscreen: %s)', (initialFullscreen) => {
    const onTaskClick = vi.fn();
    const onExitFullscreen = vi.fn();
    render(<WorkyGraphBoard initialFullscreen={initialFullscreen} onExitFullscreen={onExitFullscreen} onTaskClick={onTaskClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Review request' }));

    expect(onTaskClick).toHaveBeenCalledWith(task);
    expect(onExitFullscreen).toHaveBeenCalledTimes(initialFullscreen ? 1 : 0);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
