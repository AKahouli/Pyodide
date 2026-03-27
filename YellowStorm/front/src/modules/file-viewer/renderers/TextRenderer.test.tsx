import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TextRenderer } from './TextRenderer';

const closeTabMock = vi.hoisted(() => vi.fn());
const refreshTabUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const codeToHtmlMock = vi.hoisted(() => vi.fn(async () => '<pre><code>highlighted</code></pre>'));

vi.mock('../store', () => ({
  useFileViewerStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ closeTab: closeTabMock, refreshTabUrl: refreshTabUrlMock }),
}));

vi.mock('shiki', () => ({
  codeToHtml: codeToHtmlMock,
}));

describe('TextRenderer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads highlighted text and copies raw content', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => 'const a = 1;' })) as unknown as typeof fetch);

    render(<TextRenderer tab={{ id: 't1', fileName: 'a.ts', mimeType: 'text/typescript', url: 'https://example.test/a.ts' }} isActive />);

    await waitFor(() => {
      expect(codeToHtmlMock).toHaveBeenCalled();
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button'));
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
  });

  it('shows error state and retries refresh', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch);

    render(<TextRenderer tab={{ id: 't2', fileName: 'missing.txt', mimeType: 'text/plain', url: 'https://example.test/missing.txt' }} isActive />);

    await waitFor(() => {
      expect(screen.getByText('text.error.title')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'actions.retry' }));
    expect(refreshTabUrlMock).toHaveBeenCalledWith('t2');

    await userEvent.click(screen.getByRole('button', { name: 'actions.closeTab' }));
    expect(closeTabMock).toHaveBeenCalledWith('t2');
  });
});
