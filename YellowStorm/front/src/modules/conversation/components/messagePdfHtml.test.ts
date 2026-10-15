import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMessagePdfDocument, printHtmlDocument } from './messagePdfHtml';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
function printFrame(decode: () => Promise<void>) {
  const frame = { style: {}, remove: vi.fn(), contentDocument: { open: vi.fn(), write: vi.fn(), close: vi.fn(), images: [{ decode }] }, contentWindow: { print: vi.fn(), focus: vi.fn() } };
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'iframe' ? frame : create(tag)) as typeof document.createElement);
  vi.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
  return frame;
}
describe('PDF image preparation', () => {
  it('decodes embedded images before printing and constrains their proportions', async () => {
    let finish!: () => void;
    const frame = printFrame(() => new Promise<void>((resolve) => { finish = resolve; }));
    const html = buildMessagePdfDocument('Images', '<img src="data:image/png;base64,AA==" alt="Chart">');
    expect(html).toContain('max-width: 100%'); expect(html).toContain('height: auto');
    expect(html).toContain('p:has(> img) { break-after: avoid; }');
    const pending = printHtmlDocument(html);
    expect(frame.contentWindow.print).not.toHaveBeenCalled();
    finish(); await pending;
    expect(frame.contentWindow.print).toHaveBeenCalledTimes(1);
  });
  it('removes failed image frames and does not print after cancellation', async () => {
    let finish!: () => void;
    const frame = printFrame(() => new Promise<void>((resolve) => { finish = resolve; }));
    const controller = new AbortController();
    const pending = printHtmlDocument('<img src="data:image/png;base64,AA==">', controller.signal);
    controller.abort(); finish();
    await expect(pending).rejects.toThrow();
    expect(frame.contentWindow.print).not.toHaveBeenCalled(); expect(frame.remove).toHaveBeenCalledOnce();
  });
});
