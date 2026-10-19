import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { getGeneratedImageHistory } from '../../api';
import { ImageVersionHistory } from './ImageVersionHistory';

vi.mock('../../api', () => ({ getGeneratedImageHistory: vi.fn() }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string, values?: object) => `${key}${values ? ` ${JSON.stringify(values)}` : ''}` }) }));
const original = 'generated-image:111111111111111111111111';
const edited = 'generated-image:222222222222222222222222';
const versions = [original, edited].map((source, index) => ({ source, fileName: `image-${index}.png`, createdAt: '2026-10-15T12:00:00Z', generated: true }));
const props = () => ({ source: original, alt: 'Original', scope: { conversationId: 'conversation', messageId: 'message' }, open: true,
  onClose: vi.fn(), onSend: vi.fn().mockResolvedValue(undefined), canEdit: true, canReuse: true,
  resolveImage: vi.fn() });

beforeEach(() => {
  vi.restoreAllMocks();
  URL.createObjectURL = vi.fn().mockReturnValue('blob:history');
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['pixels'], { type: 'image/png' }) }));
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1536, height: 1024, close: vi.fn() }));
  vi.mocked(getGeneratedImageHistory).mockImplementation(async (_conversation, _message, _id, selected) => ({ versions, selected: { ...versions[selected === edited ? 1 : 0], url: 'https://storage.example/signed', mimeType: 'image/png' } }));
});

describe('ImageVersionHistory', () => {
  it('loads lazily and never invokes agent tools while browsing', async () => {
    const input = props(); const { rerender } = render(<ImageVersionHistory {...input} open={false} />);
    expect(getGeneratedImageHistory).not.toHaveBeenCalled();
    rerender(<ImageVersionHistory {...input} />);
    expect(await screen.findByRole('img')).toHaveAttribute('src', 'blob:history');
    expect(fetch).toHaveBeenCalledWith('https://storage.example/signed', expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal) }));
    expect(input.onSend).not.toHaveBeenCalled();
  });

  it('selects an exact saved version for editing, preserves aspect and closes on send', async () => {
    const input = props(); render(<ImageVersionHistory {...input} />);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /version.*"index":2\}/ }));
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('alt', 'image-1.png'));
    expect(getGeneratedImageHistory).toHaveBeenLastCalledWith('conversation', 'message', original.split(':')[1], edited, expect.any(AbortSignal));
    fireEvent.click(screen.getByRole('button', { name: 'openui.image.actions.edit' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add a boat' } });
    fireEvent.click(screen.getByRole('button', { name: 'openui.image.actions.submit' }));
    await waitFor(() => expect(input.onSend).toHaveBeenCalledTimes(1));
    expect(input.onSend.mock.calls[0][0]).toContain(edited);
    expect(input.onSend.mock.calls[0][0]).toContain('landscape');
    expect(input.onClose).toHaveBeenCalledTimes(1);
  });

  it('revokes blobs and aborts pending work on close and scope change', async () => {
    const input = props(); const { rerender, unmount } = render(<ImageVersionHistory {...input} />);
    await screen.findByRole('img');
    const signal = vi.mocked(getGeneratedImageHistory).mock.calls[0][4];
    rerender(<ImageVersionHistory {...input} open={false} />);
    expect(signal?.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:history');
    rerender(<ImageVersionHistory {...input} scope={{ conversationId: 'other', messageId: 'other-message' }} />);
    await waitFor(() => expect(getGeneratedImageHistory).toHaveBeenLastCalledWith('other', 'other-message', original.split(':')[1], undefined, expect.any(AbortSignal)));
    unmount();
    expect(vi.mocked(getGeneratedImageHistory).mock.calls.at(-1)?.[4]?.aborted).toBe(true);
  });

  it('reuses and downloads the selected saved version without changing its source', async () => {
    const input = props(); render(<ImageVersionHistory {...input} />);
    await screen.findByRole('img');
    fireEvent.click(screen.getByRole('button', { name: /version.*"index":2\}/ }));
    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('alt', 'image-1.png'));
    expect(screen.getByRole('link', { name: 'openui.image.actions.download' })).toHaveAttribute('href', 'blob:history');
    await userEvent.click(screen.getByRole('button', { name: 'openui.image.actions.reuse' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'openui.image.actions.docx' }));
    fireEvent.click(screen.getByRole('button', { name: 'openui.image.actions.docx' }));
    await waitFor(() => expect(input.onSend).toHaveBeenCalledTimes(1));
    expect(input.onSend.mock.calls[0][0]).toContain(edited);
    expect(input.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows an error and no image/actions when the image response is invalid', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: async () => new Blob(['html'], { type: 'text/html' }) } as Response);
    render(<ImageVersionHistory {...props()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('openui.image.history.error');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'openui.image.actions.edit' })).not.toBeInTheDocument();
  });

  it('disables selected image actions during streaming', async () => {
    render(<ImageVersionHistory {...props()} streaming />);
    await screen.findByRole('img');
    expect(screen.getByRole('button', { name: 'openui.image.actions.edit' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'openui.image.actions.reuse' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'openui.image.actions.download' })).not.toBeInTheDocument();
  });

  it('ignores a late image response after closing the history', async () => {
    let resolveBlob!: (value: Blob) => void;
    vi.mocked(fetch).mockResolvedValue({ ok: true, blob: () => new Promise<Blob>((resolve) => { resolveBlob = resolve; }) } as Response);
    const input = props(); const { rerender } = render(<ImageVersionHistory {...input} />);
    await waitFor(() => expect(resolveBlob).toBeDefined());
    rerender(<ImageVersionHistory {...input} open={false} />);
    resolveBlob(new Blob(['late'], { type: 'image/png' }));
    await waitFor(() => expect(vi.mocked(getGeneratedImageHistory).mock.calls[0][4]?.aborted).toBe(true));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('preserves capability restrictions and does not compare an unrelated inherited peer', async () => {
    render(<ImageVersionHistory {...props()} canEdit={false} canReuse={false} canReuseSlides={false} peers={[{ source: 'unrelated', label: 'Other image' }]} />);
    await screen.findByRole('img');
    for (const action of ['edit', 'reuse', 'compare']) expect(screen.getByRole('button', { name: `openui.image.actions.${action}` })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'openui.image.actions.download' })).toHaveAttribute('href', 'blob:history');
  });
});


