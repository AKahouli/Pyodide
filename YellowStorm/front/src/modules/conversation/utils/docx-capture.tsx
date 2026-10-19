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

/** Host-validated captured markup never enters the application DOM. No scripts,
 * network or generated-code replay are permitted in this temporary document. */
export async function captureSavedHtmlPng(capture: { html: string; width: number; height: number }): Promise<CapturedImage | null> {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = `position:fixed;left:-9999px;top:0;width:${capture.width}px;height:${capture.height}px;border:0;`;
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTML snapshot load timed out')), 8000);
      frame.onload = () => { if (frame.contentDocument?.getElementById('ys-export-capture')) { clearTimeout(timer); resolve(); } };
    });
    document.body.appendChild(frame);
    frame.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"></head><body style="margin:0"><div id="ys-export-capture">${capture.html}</div></body></html>`;
    await loaded;
    const body = frame.contentDocument?.body;
    if (!body) return null;
    const xhtml = new XMLSerializer().serializeToString(body);
    const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${capture.width}" height="${capture.height}"><foreignObject width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const dataUrl = await svgMarkupToPng(markup, capture.width, capture.height);
    if (!dataUrl) throw new Error('HTML snapshot rendering failed');
    return { dataUrl, width: capture.width, height: capture.height };
  } finally { frame.remove(); }
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

/** Render saved, already-filtered OpenUI data with the stock chart, independent
 * of the virtualized chat DOM and any unsubmitted exploration controls. */
export async function captureOpenUiChartPng(name: string, props: Record<string, unknown>): Promise<CapturedImage | null> {
  const [{ chatLibrary, reportLibrary }, { ThemeProvider }, { OPENUI_COMPACT_THEME }] = await Promise.all([
    import('@openuidev/thesys'), import('@openuidev/react-ui'), import('../components/openui/theme'),
    import('@openuidev/react-ui/styles/index.css'), import('@openuidev/thesys/styles.css'),
  ]);
  const definition = (name.endsWith('V2') ? reportLibrary : chatLibrary).components[name];
  if (!definition) return null;
  const Chart = definition.component;
  const host = document.createElement('div');
  const scope = `export-chart-${crypto.randomUUID()}`;
  host.id = scope;
  host.style.cssText = `position:fixed;left:-9999px;top:0;width:${CHART_WIDTH}px;background:#ffffff;color:#172033;`;
  document.body.appendChild(host);
  let root: Root | null = null;
  try {
    root = createRoot(host);
    root.render(<ThemeProvider mode='light' lightTheme={OPENUI_COMPACT_THEME} cssSelector={`#${scope}`}>
      <Chart props={{ ...props, heading: undefined, description: undefined }} renderNode={() => null} />
    </ThemeProvider>);
    const svg = await waitFor(() => {
      const candidate = host.querySelector('.c1-chart-wrapper svg, .c1-report-chart svg');
      return candidate && candidate.getBoundingClientRect().height > 50 ? candidate : null;
    });
    if (!svg) return null;
    await document.fonts?.ready;
    // Legends are HTML siblings of the SVG. Capture the native wrapper, not
    // just the SVG, so series labels and colors remain in every export.
    const wrapper = host.querySelector<HTMLElement>('.c1-chart-wrapper, .c1-report-chart');
    if (!wrapper) return null;
    const { toPng } = await import('html-to-image');
    const height = Math.ceil(wrapper.getBoundingClientRect().height);
    const dataUrl = await toPng(wrapper, { backgroundColor: '#ffffff', pixelRatio: CAPTURE_SCALE, width: CHART_WIDTH, height });
    return { dataUrl, width: CHART_WIDTH, height };
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

/** Capture only registered resource-free SVG primitives, never raw generated markup. */
export async function captureOpenUiSvgPng(props: Record<string, unknown>): Promise<CapturedImage | null> {
  const { renderSvgNode } = await import('../components/openui/svg');
  const node = renderSvgNode({ type: 'element', typeName: 'Svg', props });
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-9999px;top:0;width:${CHART_WIDTH}px;background:#fff;color:#172033;--foreground:#172033;--muted-foreground:#526078;--primary:#d97550;--accent-foreground:#172033;--destructive:#b91c1c;--chart-1:#d97550;--chart-2:#2563eb;--chart-3:#15803d;--chart-4:#7c3aed;--chart-5:#b45309;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    root.render(<>{node}</>);
    const svg = await waitFor(() => host.querySelector('svg'));
    if (!svg) return null;
    await document.fonts?.ready;
    const bounds = svg.getBoundingClientRect();
    const width = Math.ceil(bounds.width); const height = Math.ceil(bounds.height);
    if (!width || !height || width > 2400 || height > 2400) throw new Error('Invalid SVG export dimensions');
    const dataUrl = await serializeToPng(svg, width, height);
    return dataUrl ? { dataUrl, width, height } : null;
  } finally { root.unmount(); host.remove(); }
}
