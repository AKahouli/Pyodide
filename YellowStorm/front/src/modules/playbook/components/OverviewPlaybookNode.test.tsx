import type { ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { OverviewNode } from '../utils/overview-canvas';
import { OverviewPlaybookNode } from './OverviewPlaybookNode';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}));

vi.mock('@/modules/agent/store', () => ({
  useAgentStore: (selector: (state: { getAgentById: () => null }) => unknown) => selector({ getAgentById: () => null }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string, params?: Record<string, string | number>) => params?.title?.toString() ?? key,
  }),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <div data-testid="tooltip-content">{children}</div>,
}));

vi.mock('./PlaybookStatusBadge', () => ({
  PlaybookStatusBadge: ({ status }: { status: string }) => <div data-testid="status-badge">{status}</div>,
}));

function nodeProps(overrides: Partial<OverviewNode['data']> = {}): NodeProps<OverviewNode> {
  return {
    id: 'step-1',
    type: 'playbookOverview',
    data: {
      title: 'Short title',
      kind: 'agent',
      executionOrder: 0,
      assignedAgentId: 'agent-1',
      stepStatus: 'completed',
      isConfigured: true,
      isEnabled: true,
      canExecute: true,
      executionDisabled: false,
      ...overrides,
    },
    selected: false,
    dragging: false,
    draggable: false,
    selectable: true,
    deletable: false,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 0,
  } as NodeProps<OverviewNode>;
}

describe('OverviewPlaybookNode', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 30 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 120 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get() { return (this.textContent?.length ?? 0) > 30 ? 45 : 20; },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 100 });
  });

  it('positions status separately and executes without triggering the card click', () => {
    const onExecute = vi.fn();
    const onCardClick = vi.fn();
    render(<div onClick={onCardClick}><OverviewPlaybookNode {...nodeProps({ onExecute })} /></div>);

    expect(screen.getByTestId('status-badge').parentElement).toHaveClass('absolute', 'right-2', 'top-1.5');
    expect(screen.getByText('1')).toHaveClass('left-2', 'top-1.5', 'bg-emerald-500', 'text-white', 'h-6', 'min-w-6');
    fireEvent.click(screen.getByRole('button', { name: 'node.executeStep' }));
    expect(onExecute).toHaveBeenCalledWith('step-1');
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('shows the complete title tooltip only when the two-line title overflows', () => {
    const longTitle = 'A title long enough to overflow the available two-line node title area';
    const { rerender } = render(<OverviewPlaybookNode {...nodeProps({ title: longTitle })} />);
    fireEvent.pointerEnter(screen.getAllByText(longTitle)[0]!);
    expect(screen.getAllByTestId('tooltip-content').some((element) => element.textContent === longTitle)).toBe(true);

    rerender(<OverviewPlaybookNode {...nodeProps({ title: 'Short title' })} />);
    expect(screen.queryAllByTestId('tooltip-content').some((element) => element.textContent === longTitle)).toBe(false);
  });

  it('hides play for unsupported nodes and disables it when execution is unavailable', () => {
    const { rerender } = render(<OverviewPlaybookNode {...nodeProps({ kind: 'router', canExecute: false })} />);
    expect(screen.queryByRole('button', { name: 'node.executeStep' })).not.toBeInTheDocument();

    rerender(<OverviewPlaybookNode {...nodeProps({ executionDisabled: true })} />);
    expect(screen.getByRole('button', { name: 'node.executeStep' })).toBeDisabled();
  });
});
