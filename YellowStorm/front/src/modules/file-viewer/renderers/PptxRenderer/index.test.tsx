import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PptxRenderer } from './index';

const ensurePptxAssetsMock = vi.hoisted(() => vi.fn());
const waitForPptxSlidesMock = vi.hoisted(() => vi.fn());
const downloadPptxFileMock = vi.hoisted(() => vi.fn());

vi.mock('./asset-loader', () => ({
  ensurePptxAssets: ensurePptxAssetsMock,
}));

vi.mock('../../utils/pptx', () => ({
  clearPptxHighlights: vi.fn(),
  highlightPptxMatches: vi.fn(() => []),
  waitForPptxSlides: waitForPptxSlidesMock,
  downloadPptxFile: downloadPptxFileMock,
}));

vi.mock('../../store', () => ({
  useFileViewerPendingNavigation: () => null,
}));

describe('PptxRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePptxAssetsMock.mockResolvedValue(undefined);
    waitForPptxSlidesMock.mockImplementation(async (container: HTMLElement) => {
      container.innerHTML = '<div class="slide">Slide 1</div><div class="slide">Slide 2</div>';
      return Array.from(container.querySelectorAll('.slide')).filter((el): el is HTMLElement => el instanceof HTMLElement);
    });

    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      } as unknown as typeof IntersectionObserver,
    );

    const jq = ((container: HTMLElement) => ({
      pptxToHtml: () => {
        container.innerHTML = '<div class="slide">Slide 1</div><div class="slide">Slide 2</div>';
      },
    })) as unknown as ((container: HTMLElement) => { pptxToHtml: () => void }) & { fn?: { pptxToHtml?: () => void } };
    jq.fn = { pptxToHtml: vi.fn() };

    (globalThis as unknown as { jQuery?: unknown }).jQuery = jq as unknown;
    (globalThis as unknown as { $?: unknown }).$ = (globalThis as unknown as { jQuery?: unknown }).jQuery;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads slides and downloads pptx file', async () => {
    render(
      <PptxRenderer
        tab={{ id: 'ppt-1', fileName: 'slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', url: 'https://example.test/slides.pptx' }}
        isActive
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('/ 2')).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: 'pptx.toolbar.download' }));
    expect(downloadPptxFileMock).toHaveBeenCalledWith('https://example.test/slides.pptx', 'slides.pptx');
  });

  it('shows error state when assets fail', async () => {
    ensurePptxAssetsMock.mockRejectedValue(new Error('asset-fail'));

    render(
      <PptxRenderer
        tab={{ id: 'ppt-2', fileName: 'broken.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', url: 'https://example.test/broken.pptx' }}
        isActive
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('pptx.error.title')).toBeInTheDocument();
      expect(screen.getByText('asset-fail')).toBeInTheDocument();
    });
  });
});
