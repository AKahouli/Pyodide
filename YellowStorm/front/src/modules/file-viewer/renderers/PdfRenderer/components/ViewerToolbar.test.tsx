import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ViewerToolbar } from './ViewerToolbar';

const scrollToPreviousPageMock = vi.hoisted(() => vi.fn());
const scrollToNextPageMock = vi.hoisted(() => vi.fn());
const scrollToPageMock = vi.hoisted(() => vi.fn());
const zoomInMock = vi.hoisted(() => vi.fn());
const zoomOutMock = vi.hoisted(() => vi.fn());
const togglePanMock = vi.hoisted(() => vi.fn());
const printPromiseMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const downloadMock = vi.hoisted(() => vi.fn());

vi.mock('@embedpdf/plugin-scroll/react', () => ({
  useScroll: () => ({
    state: { currentPage: 2, totalPages: 10 },
    provides: {
      scrollToPreviousPage: scrollToPreviousPageMock,
      scrollToNextPage: scrollToNextPageMock,
      scrollToPage: scrollToPageMock,
    },
  }),
}));

vi.mock('@embedpdf/plugin-zoom/react', () => ({
  useZoom: () => ({
    state: { currentZoomLevel: 1 },
    provides: { zoomIn: zoomInMock, zoomOut: zoomOutMock },
  }),
}));

vi.mock('@embedpdf/plugin-print/react', () => ({
  usePrint: () => ({
    provides: { print: () => ({ toPromise: printPromiseMock }) },
  }),
}));

vi.mock('@embedpdf/plugin-export/react', () => ({
  useExport: () => ({
    provides: { download: downloadMock },
  }),
}));

vi.mock('@embedpdf/plugin-pan/react', () => ({
  usePan: () => ({
    provides: { togglePan: togglePanMock },
    isPanning: false,
  }),
}));

describe('ViewerToolbar', () => {
  it('handles page, zoom, pan, print, and download actions', async () => {
    render(<ViewerToolbar documentId='doc-1' />);

    await userEvent.click(screen.getByRole('button', { name: 'tooltip.previousPage' }));
    await userEvent.click(screen.getByRole('button', { name: 'tooltip.nextPage' }));
    expect(scrollToPreviousPageMock).toHaveBeenCalled();
    expect(scrollToNextPageMock).toHaveBeenCalled();

    const pageInput = screen.getByRole('spinbutton');
    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, '7');
    const form = pageInput.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(scrollToPageMock).toHaveBeenCalledWith({ pageNumber: 7 });

    await userEvent.click(screen.getByRole('button', { name: 'tooltip.zoomOut' }));
    await userEvent.click(screen.getByRole('button', { name: 'tooltip.zoomIn' }));
    expect(zoomOutMock).toHaveBeenCalled();
    expect(zoomInMock).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'tooltip.handTool' }));
    expect(togglePanMock).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'toolbar.print' }));
    expect(printPromiseMock).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'toolbar.download' }));
    expect(downloadMock).toHaveBeenCalled();
  });
});
