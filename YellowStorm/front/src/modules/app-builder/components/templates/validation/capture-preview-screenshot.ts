import { COVER_CARD_ASPECT } from '../cover/cover-focus';

/** Desktop viewport used for template covers — matches the 16:10 card. */
export const TEMPLATE_COVER_VIEWPORT = { width: 1280, height: 800 } as const;

export interface CoverCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * Largest 16:10 window inside a screenshot, anchored at the top so headers
 * and heroes stay visible instead of the empty middle of a tall page.
 */
export function cropCoverCanvasRect(
  sourceWidth: number,
  sourceHeight: number,
  aspect = COVER_CARD_ASPECT,
): CoverCropRect {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }
  const srcAspect = sourceWidth / sourceHeight;
  if (srcAspect > aspect) {
    const sw = Math.round(sourceHeight * aspect);
    return { sx: Math.round((sourceWidth - sw) / 2), sy: 0, sw, sh: sourceHeight };
  }
  if (srcAspect < aspect) {
    const sh = Math.round(sourceWidth / aspect);
    return { sx: 0, sy: 0, sw: sourceWidth, sh };
  }
  return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
}

function hideClonedScrollbars(clonedDoc: Document): void {
  const style = clonedDoc.createElement('style');
  style.textContent = `
    html, body { overflow: hidden !important; }
    html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; }
    * { scrollbar-width: none !important; }
  `;
  clonedDoc.head.appendChild(style);
}

function settleFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function captureTarget(doc: Document): HTMLElement {
  return (
    doc.body ??
    doc.getElementById('root') ??
    (doc.documentElement as HTMLElement)
  );
}

async function withCoverViewport<T>(
  iframe: HTMLIFrameElement,
  run: () => Promise<T>,
): Promise<T> {
  const previousWidth = iframe.style.width;
  const previousHeight = iframe.style.height;
  iframe.style.width = `${TEMPLATE_COVER_VIEWPORT.width}px`;
  iframe.style.height = `${TEMPLATE_COVER_VIEWPORT.height}px`;
  await settleFrames();
  try {
    return await run();
  } finally {
    iframe.style.width = previousWidth;
    iframe.style.height = previousHeight;
  }
}

function cropCanvasToCover(source: HTMLCanvasElement): HTMLCanvasElement {
  const { sx, sy, sw, sh } = cropCoverCanvasRect(source.width, source.height);
  if (sx === 0 && sy === 0 && sw === source.width && sh === source.height) {
    return source;
  }
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (!ctx) {
    throw new Error('Could not crop the preview screenshot.');
  }
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

/**
 * Capture a PNG cover from the NodePod preview iframe once the app is rendered.
 * Frames the visible desktop viewport (16:10), not the full document height.
 */
export async function capturePreviewScreenshot(iframe: HTMLIFrameElement): Promise<File> {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    throw new Error('Preview document is not available.');
  }

  return withCoverViewport(iframe, async () => {
    const target = captureTarget(doc);
    const { width, height } = TEMPLATE_COVER_VIEWPORT;
    win.scrollTo(0, 0);

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(target, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      backgroundColor: '#ffffff',
      scale: 1,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      onclone: hideClonedScrollbars,
    });

    const cropped = cropCanvasToCover(canvas);
    const blob = await new Promise<Blob>((resolve, reject) => {
      cropped.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('Could not encode the preview screenshot.'));
      }, 'image/png');
    });
    return new File([blob], 'template-cover.png', { type: 'image/png' });
  });
}
