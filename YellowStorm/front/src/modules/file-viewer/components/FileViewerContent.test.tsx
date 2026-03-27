import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MouseEvent, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FileViewerContent } from './FileViewerContent';

const setActiveTabMock = vi.hoisted(() => vi.fn());
const closeTabMock = vi.hoisted(() => vi.fn());

const tabsState = vi.hoisted(() => [
  {
    id: 't1',
    fileName: 'a.pdf',
    mimeType: 'application/pdf',
    url: 'https://example.test/a.pdf',
    isLoading: false,
  },
  {
    id: 't2',
    fileName: 'b.unknown',
    mimeType: 'application/x-unknown',
    url: 'https://example.test/b.unknown',
    isLoading: false,
  },
]);

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick }: { children: ReactNode; onClick?: (e: MouseEvent) => void }) => (
    <button tabIndex={0} onClick={onClick}>
      {children}
    </button>
  ),
}));

vi.mock('../store', () => ({
  useFileViewerTabs: () => tabsState,
  useFileViewerActiveTabId: () => 't1',
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ setActiveTab: setActiveTabMock, closeTab: closeTabMock }),
}));

vi.mock('../renderers', () => ({
  getRenderer: (mimeType: string) => {
    if (mimeType === 'application/pdf') {
      return ({ tab }: { tab: { fileName: string } }) => <div>renderer-{tab.fileName}</div>;
    }
    return null;
  },
}));

vi.mock('../renderers/UnsupportedRenderer', () => ({
  UnsupportedRenderer: ({ tab }: { tab: { fileName: string } }) => <div>unsupported-{tab.fileName}</div>,
}));

describe('FileViewerContent', () => {
  it('renders active renderer and closes tab from tab bar', async () => {
    render(<FileViewerContent />);

    expect(screen.getByText('renderer-a.pdf')).toBeInTheDocument();
    expect(screen.getByText('unsupported-b.unknown')).toBeInTheDocument();

    const closeButtons = screen.getAllByRole('button');
    await userEvent.click(closeButtons[1]);
    expect(closeTabMock).toHaveBeenCalledWith('t1');
  });
});
