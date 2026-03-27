import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FileWindowTitleBar } from './FileWindowTitleBar';

const minimizeMock = vi.hoisted(() => vi.fn());
const closeViewerMock = vi.hoisted(() => vi.fn());
const switchToSidebarMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../store', () => ({
  useFileViewerTabs: () => [{ id: 't1', fileName: 'report.pdf' }],
  useFileViewerActiveTabId: () => 't1',
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      position: { x: 10, y: 10 },
      setPosition: vi.fn(),
      minimize: minimizeMock,
      closeViewer: closeViewerMock,
      switchToSidebar: switchToSidebarMock,
    }),
}));

vi.mock('@/modules/conversation/store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ currentConversationId: 'conv-1' }),
}));

vi.mock('../hooks', () => ({
  useDraggable: () => ({
    dragHandleProps: {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      style: { cursor: 'grab' },
    },
  }),
}));

describe('FileWindowTitleBar', () => {
  it('renders title and triggers window actions', async () => {
    render(<FileWindowTitleBar />);

    expect(screen.getByText('report.pdf')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);
    await userEvent.click(buttons[2]);

    expect(switchToSidebarMock).toHaveBeenCalledTimes(1);
    expect(minimizeMock).toHaveBeenCalledTimes(1);
    expect(closeViewerMock).toHaveBeenCalledTimes(1);
  });
});
