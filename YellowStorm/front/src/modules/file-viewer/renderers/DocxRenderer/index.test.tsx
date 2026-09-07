import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocxRenderer } from './index';

const renderAsyncMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const refreshTabUrlMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock('docx-preview', () => ({ renderAsync: renderAsyncMock }));

vi.mock('../../store', () => ({
  useFileViewerStore: (selector: (state: { refreshTabUrl: typeof refreshTabUrlMock }) => unknown) => selector({ refreshTabUrl: refreshTabUrlMock }),
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));

const tab = {
  id: 'doc1',
  fileName: 'test.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  url: 'https://example.test/doc.docx',
};

describe('DocxRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    renderAsyncMock.mockResolvedValue(undefined);
    refreshTabUrlMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    }));
  });

  it('renders null and does not fetch when inactive', () => {
    const { container } = render(<DocxRenderer tab={tab} isActive={false} />);

    expect(container.firstChild).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches and renders the document locally', async () => {
    const onReady = vi.fn();
    render(<DocxRenderer tab={tab} isActive onReady={onReady} />);

    expect(screen.getByText('docx.loading')).toBeInTheDocument();
    await waitFor(() => expect(renderAsyncMock).toHaveBeenCalled());

    expect(fetch).toHaveBeenCalledWith(tab.url, { signal: expect.any(AbortSignal) });
    expect(renderAsyncMock).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.any(HTMLDivElement),
      expect.any(HTMLDivElement),
      expect.objectContaining({
        className: 'docx-preview',
        ignoreWidth: true,
        renderAltChunks: false,
        useBase64URL: true,
      }),
    );
    expect(onReady).toHaveBeenCalledOnce();
    expect(screen.queryByText('docx.loading')).not.toBeInTheDocument();
  });

  it('shows an error and retries a failed request', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DocxRenderer tab={tab} isActive />);

    expect(await screen.findByText('docx.error.title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'actions.retry' }));

    await waitFor(() => expect(renderAsyncMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshTabUrlMock).toHaveBeenCalledWith(tab.id);
  });

  it('removes unsafe active content before committing rendered markup', async () => {
    renderAsyncMock.mockImplementationOnce(async (_buffer, container: HTMLElement) => {
      container.innerHTML = '<script>window.hacked = true</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">unsafe</a><a href="https://example.test">safe</a>';
    });
    const { container } = render(<DocxRenderer tab={tab} isActive />);

    await waitFor(() => expect(screen.getByText('safe')).toBeInTheDocument());

    expect(container.querySelector('script, iframe')).toBeNull();
    expect(screen.getByText('unsafe')).not.toHaveAttribute('href');
    expect(screen.getByText('safe')).toHaveAttribute('href', 'https://example.test');
  });

  it('downloads the original document', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<DocxRenderer tab={tab} isActive />);

    fireEvent.click(screen.getByRole('button', { name: 'docx.toolbar.download' }));

    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
  });
});
