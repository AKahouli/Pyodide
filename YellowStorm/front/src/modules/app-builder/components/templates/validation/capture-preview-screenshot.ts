/**
 * Capture a PNG cover from the NodePod preview iframe once the app is rendered.
 */
export async function capturePreviewScreenshot(iframe: HTMLIFrameElement): Promise<File> {
  const doc = iframe.contentDocument;
  const target =
    doc?.getElementById('root') ??
    doc?.querySelector('[data-testid="app-root"]') ??
    doc?.body ??
    iframe;
  const html2canvas = (await import('html2canvas')).default;
  const canvas = await html2canvas(target, {
    useCORS: true,
    allowTaint: true,
    logging: false,
    scale: Math.min(window.devicePixelRatio || 1, 2),
    windowWidth: iframe.clientWidth,
    windowHeight: iframe.clientHeight,
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Could not encode the preview screenshot.'));
    }, 'image/png');
  });
  return new File([blob], 'template-cover.png', { type: 'image/png' });
}
