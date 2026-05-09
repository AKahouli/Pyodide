import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybookIteratorContainerNode } from './PlaybookIteratorContainerNode';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'iterator.childCount' && params?.count === 1) return '1 child step';
    return key;
  } }),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@xyflow/react', () => ({
  Handle: ({ id, type, 'aria-label': ariaLabel }: { id: string; type: string; 'aria-label'?: string }) => (
    <span data-testid={`handle-${type}-${id}`} aria-label={ariaLabel} />
  ),
  Position: { Left: 'left', Right: 'right' },
}));

describe('PlaybookIteratorContainerNode', () => {
  it('renders the iterator results output handle', () => {
    const props = {
      id: 'iterator-1',
      selected: false,
      data: {
        title: 'Iterator',
        description: 'Loop items',
        inputPorts: [{ id: 'items', name: 'Items', artifactKind: 'data', required: false }],
        outputPorts: [{ id: 'results', name: 'Results', artifactKind: 'data' }],
        iteratorConfig: { mode: 'item' },
        childTaskIds: [],
      },
      dragging: false,
      zIndex: 1,
      isConnectable: true,
    } as any;

    render(
      <PlaybookIteratorContainerNode {...props} />,
    );

    expect(screen.getByTestId('handle-target-items')).toBeInTheDocument();
    expect(screen.getByTestId('handle-source-results')).toBeInTheDocument();
    expect(screen.getAllByText('Results').length).toBeGreaterThan(0);
    expect(screen.getByText('nodeEditor.iteratorOutputPortHint')).toBeInTheDocument();
  });
});
