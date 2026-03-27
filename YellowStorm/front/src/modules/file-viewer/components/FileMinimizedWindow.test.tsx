import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileMinimizedWindow } from './FileMinimizedWindow';

const restoreMock = vi.hoisted(() => vi.fn());
const closeViewerMock = vi.hoisted(() => vi.fn());

vi.mock('../store', () => ({
  useFileViewerTabs: () => [
    { id: 't1', fileName: 'one.pdf' },
    { id: 't2', fileName: 'two.pdf' },
  ],
  useFileViewerActiveTabId: () => 't1',
  useFileViewerMinimizedPosition: () => ({ x: 100, y: 200 }),
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setMinimizedPosition: vi.fn(),
      restore: restoreMock,
      closeViewer: closeViewerMock,
    }),
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

describe('FileMinimizedWindow', () => {
  it('renders active file and supports restore/close', async () => {
    render(<FileMinimizedWindow />);

    expect(screen.getByText('one.pdf')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    const buttons = screen.getAllByRole('button');
    await userEvent.click(buttons[0]);
    await userEvent.click(buttons[1]);

    expect(restoreMock).toHaveBeenCalledTimes(1);
    expect(closeViewerMock).toHaveBeenCalledTimes(1);
  });
});
