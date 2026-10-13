import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { createParser } from '@openuidev/lang-core';
import { Presentation, presentationLibrary } from '@openuidev/thesys';
import { ThemeProvider } from '@openuidev/react-ui';
import { buildExportFilename } from '../../utils/document-export';

export type SlideExportFormat = 'pdf' | 'pptx';
export class SlideExportError extends Error {
  constructor(readonly reason: 'invalid' | 'images' | 'timeout') { super(reason); }
}

const WIDTH = 1920;
const HEIGHT = 1080;

/** Release the export stage even when a browser/library operation never settles. */
export async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let stop!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
  });
  try { return await Promise.race([work, aborted]); }
  finally { signal.removeEventListener('abort', stop); }
}

export async function readImage(response: Response, signal: AbortSignal): Promise<Blob> {
  const limit = 20 * 1024 * 1024;
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/') || Number(response.headers.get('content-length')) > limit || !response.body) {
    await response.body?.cancel();
    throw new SlideExportError('images');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new SlideExportError('images');
      chunks.push(new Uint8Array(value));
    }
    return new Blob(chunks, { type });
  } finally { await reader.cancel(); reader.releaseLock(); }
}

/** The standalone print renderer uses SlideShow(title, subtitle, slides). */
export function printProgram(program: string, title: string, subtitle?: string): string {
  const root = /^\s*root\s*=\s*Presentation\s*\(/.exec(program);
  if (!root) throw new SlideExportError('invalid');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = root[0].length; i < program.length; i++) {
    const char = program[i];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if ('{[('.includes(char)) depth++;
    else if ('}])'.includes(char)) depth--;
    else if (char === ',' && depth === 0) return `root = SlideShow(${JSON.stringify(title)}, ${JSON.stringify(subtitle ?? '')},${program.slice(i + 1)}`;
  }
  throw new SlideExportError('invalid');
}

/** Package the same slide images in either format; PowerPoint contains one image per slide. */
export async function packageSlideImages(images: string[], title: string, format: SlideExportFormat): Promise<Blob> {
  if (format === 'pdf') {
    const { PDFDocument } = await import('pdf-lib');
    const document = await PDFDocument.create();
    document.setTitle(title);
    for (const data of images) {
      const image = await document.embedPng(data);
      document.addPage([960, 540]).drawImage(image, { x: 0, y: 0, width: 960, height: 540 });
    }
    return new Blob([new Uint8Array(await document.save())], { type: 'application/pdf' });
  }
  const { default: PptxGenJS } = await import('pptxgenjs');
  const deck = new PptxGenJS();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = title;
  for (const data of images) deck.addSlide().addImage({ data, x: 0, y: 0, w: 13.333333, h: 7.5 });
  return await deck.write({ outputType: 'blob', compression: true }) as Blob;
}

/** Inline public images explicitly: capture libraries otherwise silently replace failed/CORS images with blanks. */
async function inlineImages(stage: HTMLElement, signal: AbortSignal, fallback?: (url: string, signal: AbortSignal) => Promise<string>): Promise<void> {
  const assets = new Map<string, Promise<string>>();
  const inline = (url: string): Promise<string> => {
    if (!assets.has(url)) assets.set(url, (async () => {
      try {
        const parsed = new URL(url, location.href);
        if (!['http:', 'https:', 'data:', 'blob:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Invalid image URL');
        const response = await fetch(parsed.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        const blob = await readImage(response, signal);
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch {
        signal.throwIfAborted();
        if (fallback && url.startsWith('https://')) {
          try { return await fallback(url, signal); } catch { signal.throwIfAborted(); }
        }
        throw new SlideExportError('images');
      }
    })());
    return assets.get(url)!;
  };
  for (const element of Array.from(stage.querySelectorAll<HTMLElement>('*'))) {
    signal.throwIfAborted();
    if (element instanceof HTMLImageElement && element.src) {
      element.src = await inline(element.currentSrc || element.src);
      element.removeAttribute('srcset');
      await abortable(element.decode(), signal);
    }
    const background = getComputedStyle(element).backgroundImage;
    const matches = [...background.matchAll(/url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g)];
    let embedded = background;
    for (const match of matches) embedded = embedded.replace(match[0], `url("${await inline(match[1] ?? match[2] ?? match[3])}")`);
    if (matches.length) element.style.backgroundImage = embedded;
  }
}

export async function exportSlides(program: string, format: SlideExportFormat, mode: 'light' | 'dark', signal: AbortSignal, fallback?: (url: string, signal: AbortSignal) => Promise<string>): Promise<{ blob: Blob; filename: string }> {
  const parsed = createParser(presentationLibrary.toJSONSchema()).parse(program);
  const props = parsed.root?.type === 'element' && parsed.root.typeName === 'Presentation' ? parsed.root.props : null;
  const slides = props?.slides;
  const metadata = props?.metadata as { title?: unknown; subtitle?: string } | undefined;
  if (!Array.isArray(slides) || slides.length === 0 || slides.length > 50 || typeof metadata?.title !== 'string') throw new SlideExportError('invalid');
  const title = metadata.title;
  const stage = document.createElement('div');
  stage.dataset.slideExport = '';
  stage.setAttribute('aria-hidden', 'true');
  stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${WIDTH}px;pointer-events:none;`;
  document.body.appendChild(stage);
  const root = createRoot(stage);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  try {
    (window as unknown as Record<string, unknown>)['thesys-print-ready'] = 'false';
    flushSync(() => root.render(<ThemeProvider mode={mode} cssSelector='[data-slide-export]'><Presentation response={printProgram(program, title, metadata.subtitle)} preview={false} mode='print' /></ThemeProvider>));
    await abortable(new Promise<void>((resolve, reject) => {
      const check = () => {
        if (deadline.aborted) { reject(deadline.reason); return; }
        if ((window as unknown as Record<string, unknown>)['thesys-print-ready'] === 'true' && stage.querySelectorAll('.c1-print-page').length === slides.length) resolve();
        else requestAnimationFrame(check);
      };
      check();
    }), deadline);
    await abortable(inlineImages(stage, deadline, fallback), deadline);
    const { toPng, getFontEmbedCSS } = await abortable(import('html-to-image'), deadline);
    const pages = Array.from(stage.querySelectorAll<HTMLElement>('.c1-print-page'));
    const fontEmbedCSS = await abortable(getFontEmbedCSS(pages[0], { preferredFontFormat: 'woff2', fetchRequestInit: { signal: deadline, credentials: 'omit', referrerPolicy: 'no-referrer' } }), deadline);
    const images: string[] = [];
    for (const page of pages) {
      deadline.throwIfAborted();
      images.push(await abortable(toPng(page, { width: WIDTH, height: HEIGHT, pixelRatio: 1, fontEmbedCSS, includeQueryParams: true,
        style: { transform: 'none', margin: '0', borderRadius: '0' } }), deadline));
    }
    const blob = await abortable(packageSlideImages(images, metadata.title, format), deadline);
    deadline.throwIfAborted();
    return { blob, filename: buildExportFilename(metadata.title, format) };
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw new SlideExportError('timeout');
    throw error;
  } finally { root.unmount(); stage.remove(); }
}
