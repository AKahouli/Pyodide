import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookIteratorContainerNode } from './PlaybookIteratorContainerNode';
import { NodeDataActionsContext } from './PlaybookNode';

const storeState = vi.hoisted(() => ({
  currentPlaybook: {
    id: 'playbook-1',
    tasks: [],
  },
} as any));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => {
    if (key === 'iterator.childCount') {
      return `${vars?.count ?? 0} child step`;
    }
    return key;
  } }),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => <span data-testid={`handle-${id}`} />,
  Position: { Left: 'left', Right: 'right' },
  useUpdateNodeInternals: () => vi.fn(),
}));

vi.mock('../store', () => ({
  usePlaybookStore: (selector: any) => selector(storeState),
}));

describe('PlaybookIteratorContainerNode', () => {
  beforeEach(() => {
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [],
    };
  });

  it('shows a resize handle when selected and reports expanded dimensions', () => {
    const setIteratorNodeSize = vi.fn();
    const resizeIteratorNode = vi.fn();

    render(
      <NodeDataActionsContext.Provider value={{ updateNodeData: vi.fn(), setIteratorNodeSize, resizeIteratorNode }}>
        <PlaybookIteratorContainerNode
          {...({
            id: 'iterator-1',
            selected: true,
            data: {
              id: 'iterator-1',
              title: 'Iterator',
              description: 'Arrange child steps',
              width: 400,
              height: 300,
              iteratorConfig: { source: 'items', mode: 'item' },
              inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
              outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
              childTaskIds: ['child-1'],
            },
          } as any)}
        />
      </NodeDataActionsContext.Provider>,
    );

    const handle = screen.getByRole('presentation');
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 140, clientY: 150, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 140, clientY: 150, pointerId: 1 });

    expect(setIteratorNodeSize).toHaveBeenCalledWith('iterator-1', { width: 440, height: 350 });
    expect(resizeIteratorNode).toHaveBeenCalledWith('iterator-1', { width: 440, height: 350 });
    expect(resizeIteratorNode).toHaveBeenCalledTimes(1);
  });

  it('shows a discoverable repack button and triggers the action', () => {
    const repackIteratorChildren = vi.fn();

    render(
      <NodeDataActionsContext.Provider value={{ updateNodeData: vi.fn(), repackIteratorChildren }}>
        <PlaybookIteratorContainerNode
          {...({
            id: 'iterator-1',
            selected: false,
            data: {
              id: 'iterator-1',
              title: 'Iterator',
              description: 'Arrange child steps',
              iteratorConfig: { source: 'items', mode: 'item' },
              inputPorts: [],
              outputPorts: [],
              childTaskIds: ['child-1'],
            },
          } as any)}
        />
      </NodeDataActionsContext.Provider>,
    );

    const repackButton = screen.getByRole('button', { name: 'iterator.repackChildren' });
    fireEvent.click(repackButton);
    expect(repackButton).toHaveTextContent('iterator.repackChildren');
    expect(repackIteratorChildren).toHaveBeenCalledWith('iterator-1');
  });

  it('renders visible labels and handles for multiple input ports from the latest store task', () => {
    storeState.currentPlaybook = {
      id: 'playbook-1',
      tasks: [
        {
          id: 'iterator-1',
          inputPorts: [
            { id: 'items', name: 'Items', artifactKind: 'data', required: false, role: 'collection' },
            { id: 'template', name: 'Template', artifactKind: 'document', required: false, role: 'context' },
          ],
          outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
        },
      ],
    };

    render(
      <NodeDataActionsContext.Provider value={{ updateNodeData: vi.fn() }}>
        <PlaybookIteratorContainerNode
          {...({
            id: 'iterator-1',
            selected: false,
            data: {
              id: 'iterator-1',
              title: 'Iterator',
              description: 'Arrange child steps',
              iteratorConfig: { source: 'items', mode: 'item' },
              inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false, role: 'collection' }],
              outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
              childTaskIds: [],
            },
          } as any)}
        />
      </NodeDataActionsContext.Provider>,
    );

    expect(screen.getByTestId('handle-items')).toBeInTheDocument();
    expect(screen.getByTestId('handle-template')).toBeInTheDocument();
    expect(screen.getByText('Items')).toBeInTheDocument();
    expect(screen.getByText('Template')).toBeInTheDocument();
  });
});
