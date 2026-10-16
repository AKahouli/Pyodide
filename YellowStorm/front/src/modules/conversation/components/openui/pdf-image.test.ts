import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import { renderPdfImage } from './pdf-image';

vi.mock('@embedpdf/engines/pdfium-direct-engine', () => ({ createPdfiumEngine: vi.fn() }));
const toTask = <T,>(value: T) => ({ toPromise: async () => value });
const page = { size: { width: 600, height: 800 } };
const document = { pages: [page] };
const blob = new Blob(['png'], { type: 'image/png' });
const engine = {
  openDocumentUrl: vi.fn(() => toTask(document)), renderPageRect: vi.fn(() => toTask(blob)),
  closeAllDocuments: vi.fn(() => toTask(true)), destroy: vi.fn(() => toTask(true)),
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createPdfiumEngine).mockResolvedValue(engine as unknown as Awaited<ReturnType<typeof createPdfiumEngine>>);
});

describe('PDF image rendering', () => {
  it('renders normalized citation bounds at bounded resolution and releases the engine', async () => {
    expect(await renderPdfImage('https://storage.example/source.pdf', 1, [0.1, 0.25, 0.8, 0.5])).toBe(blob);
    expect(engine.renderPageRect).toHaveBeenCalledWith(document, page,
      { origin: { x: 60, y: 200 }, size: { width: 480, height: 400 } },
      { scaleFactor: 2, dpr: 1, imageType: 'image/png' });
    expect(engine.closeAllDocuments).toHaveBeenCalledTimes(1);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid pages and regions while still releasing the engine', async () => {
    await expect(renderPdfImage('https://storage.example/source.pdf', 2)).rejects.toThrow('Invalid document image page');
    await expect(renderPdfImage('https://storage.example/source.pdf', 1, [700, 0, 100, 100])).rejects.toThrow('outside page');
    expect(engine.renderPageRect).not.toHaveBeenCalled();
    expect(engine.destroy).toHaveBeenCalledTimes(2);
  });

  it('does not allocate an engine for an already cancelled image request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(renderPdfImage('https://storage.example/source.pdf', 1, undefined, controller.signal)).rejects.toThrow();
    expect(createPdfiumEngine).not.toHaveBeenCalled();
  });

  it('cancels a pending PDF task and releases its engine on scope teardown', async () => {
    let rejectTask!: (reason: unknown) => void;
    const task = { toPromise: () => new Promise((_, reject) => { rejectTask = reject; }), abort: vi.fn((reason: unknown) => rejectTask(reason)) };
    engine.openDocumentUrl.mockReturnValueOnce(task as ReturnType<typeof engine.openDocumentUrl>);
    const controller = new AbortController();
    const request = renderPdfImage('https://storage.example/source.pdf', 1, undefined, controller.signal);
    const outcome = request.catch((error: unknown) => error);
    await Promise.resolve(); await Promise.resolve();
    controller.abort(); await outcome;
    expect(task.abort).toHaveBeenCalledTimes(1);
    expect(engine.destroy).toHaveBeenCalledTimes(1);
    expect(engine.renderPageRect).not.toHaveBeenCalled();
  });
});
