import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DynamicReasoningRuntimeNode } from './DynamicReasoningRuntimeNode';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div role="tooltip">{children}</div>,
}));

vi.mock('../PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status, size }: { status: string; size: string }) => (
    <span data-testid="status-badge">{`${status}:${size}`}</span>
  ),
}));

describe('DynamicReasoningRuntimeNode', () => {
  it('renders the planner title with the shared task status badge', () => {
    render(
      <DynamicReasoningRuntimeNode
        {...({ data: { title: 'Calculate risk metrics', status: 'completed' }, selected: false } as any)}
      />,
    );

    const titles = screen.getAllByText('Calculate risk metrics');
    expect(titles).toHaveLength(2);
    expect(titles[0]).toHaveClass('text-[11px]');
    expect(titles[0]).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Calculate risk metrics');
    expect(screen.getByTestId('status-badge')).toHaveTextContent('completed:xs');
  });
});
