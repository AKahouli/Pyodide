import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DynamicReasoningRuntimeContainerNode } from './DynamicReasoningRuntimeContainerNode';

vi.mock('@xyflow/react', () => ({
  Handle: ({ id }: { id: string }) => <span data-testid={`handle-${id}`} />,
  Position: { Top: 'top' },
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, values?: { count?: number }) => values?.count === undefined ? key : `${key}:${values.count}`,
  }),
}));

vi.mock('../PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

describe('DynamicReasoningRuntimeContainerNode', () => {
  it('renders an accessible collapsed summary and toggles it', () => {
    const onToggle = vi.fn();
    render(
      <DynamicReasoningRuntimeContainerNode
        {...({
          data: {
            title: 'Investment Analysis',
            status: 'completed',
            generatedCount: 3,
            expanded: false,
            planning: false,
            onToggle,
          },
        } as any)}
      />,
    );

    const button = screen.getByRole('button', { name: /executionFocus.container.expand: Investment Analysis/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('executionFocus.container.generatedCount:3')).toBeInTheDocument();
    expect(screen.getByTestId('handle-dynamic-reasoning-container-target')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows the assessing message for an expanded planning attempt', () => {
    render(
      <DynamicReasoningRuntimeContainerNode
        {...({
          data: {
            title: 'Investment Analysis',
            status: 'pending',
            generatedCount: 0,
            expanded: true,
            planning: true,
          },
        } as any)}
      />,
    );

    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('executionFocus.assessing')).toBeInTheDocument();
  });
});
