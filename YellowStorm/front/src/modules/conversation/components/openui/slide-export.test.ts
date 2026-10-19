import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { unzipSync, strFromU8 } from 'fflate';
import { abortable, exportSlides, inlineImages, packageSlideImages, printProgram, readImage, resolveGeneratedSlideImages } from './slide-export';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=';

describe('slide file packaging', () => {
  it('reuses bounded embedded raster backgrounds without a CSP-blocked data URL fetch', async () => {
    const stage = document.createElement('div');
    const background = document.createElement('div');
    background.style.backgroundImage = `url("${PNG}")`;
    stage.append(background);
    const fetcher = vi.fn().mockRejectedValue(new TypeError('CSP blocks data fetch'));
    vi.stubGlobal('fetch', fetcher);
    try {
      await inlineImages(stage, new AbortController().signal);
      expect(background.style.backgroundImage).toContain(PNG);
      expect(fetcher).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('resolves repeated stable generated sources once before print and rejects missing authorization', async () => {
    const source = 'generated-image:0123456789abcdef01234567';
    const program = `root = Presentation({title: "Generated"}, [s])\ns = Slide("s", Image("AI image", "${source}"))\nother = "${source}"`;
    const resolve = vi.fn().mockResolvedValue(PNG);
    const signal = new AbortController().signal;
    const result = await resolveGeneratedSlideImages(program, signal, resolve);
    expect(result).not.toContain(source);
    expect(result.match(/data:image\/png/g)).toHaveLength(2);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(source, signal);
    await expect(resolveGeneratedSlideImages(program, signal)).rejects.toMatchObject({ reason: 'images' });
  });
  it('removes its hidden rendering stage when cancelled before print readiness', async () => {
    const controller = new AbortController();
    const result = exportSlides('root = Presentation({title: "Japan"}, [s1])\ns1 = Slide("s1", MinimalTitle("Japan"))', 'pdf', 'light', controller.signal);
    expect(document.querySelector('[data-slide-export]')).not.toBeNull();
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(document.querySelector('[data-slide-export]')).toBeNull();
  });
  it('adapts artifact metadata without corrupting quoted braces or commas', () => {
    expect(printProgram('root = Presentation({title: "Japan }, trip", subtitle: "Guide"}, [s1])\ns1 = Slide("s1", MinimalTitle("Japan"))', 'Japan }, trip', 'Guide')).toBe('root = SlideShow("Japan }, trip", "Guide", [s1])\ns1 = Slide("s1", MinimalTitle("Japan"))');
  });

  it('cancels an operation that never settles', async () => {
    const controller = new AbortController();
    const result = abortable(new Promise(() => {}), controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cancels an oversized image stream before buffering more chunks', async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
    await expect(readImage(new Response(body, { headers: { 'content-type': 'image/png' } }), new AbortController().signal)).rejects.toMatchObject({ reason: 'images' });
    expect(cancelled).toBe(true);
  });

  it('creates one landscape PDF page per slide image with deck metadata', async () => {
    const blob = await packageSlideImages([PNG, PNG], 'Japan slides', 'pdf');
    const pdf = await PDFDocument.load(await blob.arrayBuffer());
    expect(blob.type).toBe('application/pdf');
    expect(pdf.getTitle()).toBe('Japan slides');
    expect(pdf.getPageCount()).toBe(2);
    for (const page of pdf.getPages()) expect(page.getSize()).toEqual({ width: 960, height: 540 });
  });

  it('creates a wide PPTX with one full-slide picture and no editable text on each slide', async () => {
    const blob = await packageSlideImages([PNG, PNG], 'Japan slides', 'pptx');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(strFromU8(files['ppt/presentation.xml'])).toMatch(/cx="12192000" cy="6858000"/);
    for (const name of ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']) {
      const slide = strFromU8(files[name]);
      expect(slide.match(/<p:pic>/g)).toHaveLength(1);
      expect(slide).not.toContain('<a:t>');
      expect(slide).toContain('<a:off x="0" y="0"/>');
    }
  });
});
