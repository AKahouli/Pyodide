import type { CitationBBox } from '@/components/ai-elements/ai-message-content';
import { createPdfiumEngine } from '@embedpdf/engines/pdfium-direct-engine';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';
import { PdfErrorCode, type PdfTask } from '@embedpdf/models';

async function waitForPdf<T>(task: PdfTask<T>, signal?: AbortSignal): Promise<T> {
  const cancel = () => task.abort({ code: PdfErrorCode.Cancelled, message: 'Image loading cancelled' });
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) cancel();
    return await task.toPromise();
  } finally { signal?.removeEventListener('abort', cancel); }
}

/** Rasterize the cited region with the same installed PDF engine as the document viewer. */
export async function renderPdfImage(url: string, pageNumber: number, bbox?: CitationBBox, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const engine = await createPdfiumEngine(wasmUrl, { fontFallback: null });
  try {
    signal?.throwIfAborted();
    const document = await waitForPdf(engine.openDocumentUrl({ id: crypto.randomUUID(), url }), signal);
    const page = document.pages[pageNumber - 1];
    if (!page || !Number.isInteger(pageNumber)) throw new Error('Invalid document image page');
    const { width, height } = page.size;
    let rect = { origin: { x: 0, y: 0 }, size: { width, height } };
    if (bbox) {
      if (!bbox.every(Number.isFinite) || bbox[0] < 0 || bbox[1] < 0 || bbox[2] <= 0 || bbox[3] <= 0) throw new Error('Invalid document image region');
      const normalized = bbox.every((value) => value <= 1);
      const x = bbox[0] * (normalized ? width : 1);
      const y = bbox[1] * (normalized ? height : 1);
      rect = { origin: { x, y }, size: {
        width: Math.min(bbox[2] * (normalized ? width : 1), width - x),
        height: Math.min(bbox[3] * (normalized ? height : 1), height - y),
      } };
      if (rect.size.width <= 0 || rect.size.height <= 0) throw new Error('Document image region outside page');
    }
    return await waitForPdf(engine.renderPageRect(document, page, rect, {
      scaleFactor: Math.min(2, 1600 / Math.max(rect.size.width, rect.size.height)), dpr: 1, imageType: 'image/png',
    }), signal);
  } finally {
    try { await engine.closeAllDocuments().toPromise(); } finally { await engine.destroy().toPromise(); }
  }
}
