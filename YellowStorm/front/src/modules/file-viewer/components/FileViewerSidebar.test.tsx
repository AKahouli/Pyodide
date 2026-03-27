import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileViewerSidebar } from './FileViewerSidebar';

const switchToFloatingMock = vi.hoisted(() => vi.fn());
const closeViewerMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('../store', () => ({
  useFileViewerTabs: () => [{ id: 't1', fileName: 'notes.txt' }],
  useFileViewerActiveTabId: () => 't1',
  useFileViewerMode: () => 'open',
  useFileViewerDisplayMode: () => 'sidebar',
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ switchToFloating: switchToFloatingMock, closeViewer: closeViewerMock }),
}));

vi.mock('./FileViewerContent', () => ({
  FileViewerContent: () => <div>viewer-content</div>,
}));

describe('FileViewerSidebar', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    }) as typeof requestAnimationFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders in sidebar mode and handles action buttons', async () => {
    render(<FileViewerSidebar />);

    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText('viewer-content')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);

    expect(switchToFloatingMock).toHaveBeenCalledTimes(1);
    expect(closeViewerMock).toHaveBeenCalledTimes(1);
  });

  it('renders left resize handle', () => {
    const { container } = render(<FileViewerSidebar />);
    const handle = container.querySelector('.cursor-ew-resize') as HTMLElement;
    expect(handle).toBeTruthy();
  });
});
