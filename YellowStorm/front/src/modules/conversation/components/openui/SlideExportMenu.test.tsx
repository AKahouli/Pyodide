import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '../../utils/docx-export';
import { showError } from '@/lib/notifications';
import { exportSlides, SlideExportError } from './slide-export';
import { SlideExportMenu } from './SlideExportMenu';
import { fetchSlideExportImage } from '../../api';

vi.mock('../../utils/docx-export', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../api', () => ({ fetchSlideExportImage: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('./slide-export', async (original) => ({ ...await original<typeof import('./slide-export')>(), exportSlides: vi.fn() }));

const program = 'root = Presentation({title: "Japan"}, [])';
beforeEach(() => vi.clearAllMocks());
async function choosePdf() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'openui.slides.export.label' }), { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'openui.slides.export.pdf' }));
}

describe('slide export menu', () => {
  it('binds the server fallback to this conversation and answer', async () => {
    vi.mocked(fetchSlideExportImage).mockResolvedValue('data:image/png;base64,image');
    vi.mocked(exportSlides).mockImplementation(async (_program, _format, _mode, signal, fallback) => {
      await fallback!('https://photos.example/japan.png', signal);
      return { blob: new Blob(), filename: 'Japan.pdf' };
    });
    render(<SlideExportMenu program={program} isStreaming={false} citationScope={{ conversationId: 'c', messageId: 'm' }} />);
    await choosePdf();
    await waitFor(() => expect(fetchSlideExportImage).toHaveBeenCalledWith('c', 'm', 'https://photos.example/japan.png', expect.any(AbortSignal)));
  });
  it('downloads the selected format and prevents exports during streaming', async () => {
    const blob = new Blob(['pdf']);
    vi.mocked(exportSlides).mockResolvedValue({ blob, filename: 'Japan.pdf' });
    const view = render(<SlideExportMenu program={program} isStreaming />);
    expect(screen.getByRole('button')).toBeDisabled();
    view.rerender(<SlideExportMenu program={program} isStreaming={false} />);
    await choosePdf();
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'Japan.pdf'));
    expect(exportSlides).toHaveBeenCalledWith(program, 'pdf', expect.any(String), expect.any(AbortSignal), undefined);
  });

  it('shows an image-specific error instead of downloading a partial deck', async () => {
    vi.mocked(exportSlides).mockRejectedValue(new SlideExportError('images'));
    render(<SlideExportMenu program={program} isStreaming={false} />);
    await choosePdf();
    await waitFor(() => expect(showError).toHaveBeenCalledWith('openui.slides.export.images'));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('cancels when the preview closes and does not download a late result', async () => {
    let finish!: (value: { blob: Blob; filename: string }) => void;
    vi.mocked(exportSlides).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<SlideExportMenu program={program} isStreaming={false} />);
    await choosePdf();
    const signal = vi.mocked(exportSlides).mock.calls[0][3];
    view.unmount();
    expect(signal.aborted).toBe(true);
    finish({ blob: new Blob(), filename: 'Japan.pdf' });
    await Promise.resolve();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
