import { createRoot, type Root } from 'react-dom/client';
import { ChartPartRenderer } from '@/components/ai-elements/chart-part-renderer';
import { isolateGeneratedPreviewHtml } from '@/components/ai-elements/web-preview';
import { LocalizationProvider } from '@/modules/localization';
import type { ChartComponentData } from '../types';

/**
 * Rasterizes chart and HTML-preview components into PNGs for DOCX export.
 * Word documents cannot host interactive content, so we render each component
 * offscreen (same renderers as the chat UI) and capture it as an image.
 */

export interface CapturedImage {
  dataUrl: string;
  width: number;
  height: number;
}

const CHART_WIDTH = 640;
const PREVIEW_WIDTH = 720;
// Recharts default animation runs ~1.5s; capture before it the series is fully drawn.
const CHART_SETTLE_MS = 1700;
const CAPTURE_SCALE = 2;

async function waitFor(finder: () => Element | null, timeoutMs = 4000): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = finder();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

/** Copy computed colors/fonts onto attributes so a serialized SVG renders standalone. */
function inlineComputedStyles(source: Element, target: Element): void {
  const props = ['fill', 'stroke', 'stroke-width', 'font-family', 'font-size', 'font-weight'] as const;
  const sources = [source, ...source.querySelectorAll('*')];
  const targets = [target, ...target.querySelectorAll('*')];
  sources.forEach((element, index) => {
    const computed = getComputedStyle(element);
    const copy = targets[index] as Element | undefined;
    if (!copy) return;
    for (const prop of props) {
      const value = computed.getPropertyValue(prop);
      if (value && value !== 'none') copy.setAttribute(prop, value);
    }
  });
}

async function svgMarkupToPng(xml: string, width: number, height: number): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width * CAPTURE_SCALE;
        canvas.height = height * CAPTURE_SCALE;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.scale(CAPTURE_SCALE, CAPTURE_SCALE);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        // Tainted canvas (external resources) — caller falls back to text.
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
  });
}

async function serializeToPng(element: Element, width: number, height: number): Promise<string | null> {
  const clone = element.cloneNode(true) as Element;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  inlineComputedStyles(element, clone);
  return svgMarkupToPng(new XMLSerializer().serializeToString(clone), width, height);
}

export async function captureChartPng(chart: ChartComponentData): Promise<CapturedImage | null> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-9999px;top:0;width:${CHART_WIDTH}px;background:#ffffff;`;
  document.body.appendChild(host);
  let root: Root | null = null;
  try {
    root = createRoot(host);
    root.render(
      <LocalizationProvider>
        <ChartPartRenderer {...chart} type='chart' />
      </LocalizationProvider>,
    );
    const svg = await waitFor(() => host.querySelector('svg'));
    if (!svg) return null;
    await new Promise((resolve) => setTimeout(resolve, CHART_SETTLE_MS));
    const height = Math.round(svg.getBoundingClientRect().height) || 320;
    const dataUrl = await serializeToPng(svg, CHART_WIDTH, height);
    return dataUrl ? { dataUrl, width: CHART_WIDTH, height } : null;
  } catch {
    return null;
  } finally {
    root?.unmount();
    host.remove();
  }
}

export async function captureWebPreviewPng(html: string): Promise<CapturedImage | null> {
  if (!html.trim()) return null;
  // Same isolation the chat UI uses for generated previews: CSP meta injected
  // by isolateGeneratedPreviewHtml, plus a sandbox WITHOUT allow-scripts so
  // nothing executes while we measure and serialize the document. The CSP also
  // blocks remote images, which keeps the canvas untainted for toDataURL.
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-9999px;top:0;width:${PREVIEW_WIDTH}px;height:600px;border:0;`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = isolateGeneratedPreviewHtml(html);
    });
    const doc = frame.contentDocument;
    if (!doc?.documentElement) return null;
    // The first load event can fire for the initial about:blank document.
    await waitFor(() => (doc.body?.children.length ? doc.body : null), 1000);
    const height = Math.min(Math.max(doc.documentElement.scrollHeight, 200), 4000);
    const xhtml = new XMLSerializer().serializeToString(doc.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_WIDTH}" height="${height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const dataUrl = await svgMarkupToPng(svg, PREVIEW_WIDTH, height);
    return dataUrl ? { dataUrl, width: PREVIEW_WIDTH, height } : null;
  } catch {
    return null;
  } finally {
    frame.remove();
  }
}
