import type { BrowserRuntimeHost } from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import { waitUntilPreviewReachable } from '@/modules/conversation-v2/runtime/PreviewController';

const CAPTURE_READY_TIMEOUT_MS = 45_000;
const INSPECT_POLL_MS = 500;
const PAINT_SETTLE_MS = 400;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Validation cancelled.'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new Error('Validation cancelled.'));
      },
      { once: true },
    );
  });
}

function waitForIframeLoad(iframe: HTMLIFrameElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = iframe.contentDocument;
    if (doc?.readyState === 'complete' && doc.body) {
      resolve();
      return;
    }
    const onAbort = () => {
      iframe.removeEventListener('load', onLoad);
      reject(new Error('Validation cancelled.'));
    };
    const onLoad = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    iframe.addEventListener('load', onLoad, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function isInspectablePreview(
  inspect: Awaited<ReturnType<BrowserRuntimeHost['inspectLivePreview']>>,
): boolean {
  return (
    inspect.domSummary.length > 0 &&
    inspect.visibleText.trim().length > 0 &&
    inspect.runtimeErrors.length === 0
  );
}

/** Same-origin iframe DOM already has something to screenshot. */
function iframeLooksCaptureReady(iframe: HTMLIFrameElement): boolean {
  try {
    const doc = iframe.contentDocument;
    if (!doc?.body) return false;
    if (doc.readyState !== 'complete' && doc.readyState !== 'interactive') return false;
    const text = (doc.body.innerText || '').trim();
    if (text.length > 0) return true;
    return doc.body.querySelectorAll('img, svg, canvas, video, iframe').length > 0
      || doc.body.children.length > 0;
  } catch {
    return false;
  }
}

function iframeAlreadyShowsPreview(iframe: HTMLIFrameElement, previewUrl: string): boolean {
  if (!iframe.src || iframe.src === 'about:blank') return false;
  try {
    return iframe.src === previewUrl || iframeLooksCaptureReady(iframe);
  } catch {
    return false;
  }
}

/**
 * Wait until the live preview is ready for screenshot capture.
 * Prefer the already-mounted iframe DOM when the admin is already looking at
 * it — avoid a full refresh/inspect loop that reloads the preview.
 */
export async function waitForPreviewCaptureReady(
  host: BrowserRuntimeHost,
  iframe: HTMLIFrameElement,
  signal: AbortSignal,
): Promise<void> {
  const url = host.state.previewUrl;
  if (!url) {
    throw new Error('Preview URL is not available.');
  }

  const alreadyVisible = iframeAlreadyShowsPreview(iframe, url);

  if (!alreadyVisible) {
    await host.refreshPreview();
    if (signal.aborted) throw new Error('Validation cancelled.');

    const sw = await waitUntilPreviewReachable(url, () => signal.aborted, 120);
    if (!sw.ok) {
      throw new Error(
        sw.bodyHint === 'nodepod-sw-disconnected' || sw.bodyHint === 'nodepod-sw-initializing'
          ? 'The template preview is still connecting. Hard-refresh the page (Ctrl+Shift+R) and try again.'
          : `Preview stayed unreachable (HTTP ${sw.lastStatus ?? '503'}).`,
      );
    }
  }

  host.attachPreviewIframe(iframe);
  if (!iframeLooksCaptureReady(iframe)) {
    await waitForIframeLoad(iframe, signal);
  }

  if (iframeLooksCaptureReady(iframe)) {
    await sleep(PAINT_SETTLE_MS, signal);
    return;
  }

  const deadline = Date.now() + CAPTURE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Validation cancelled.');
    if (host.state.status === 'error') {
      throw new Error(host.state.error || 'Template preview failed.');
    }

    if (iframeLooksCaptureReady(iframe)) {
      await sleep(PAINT_SETTLE_MS, signal);
      return;
    }

    try {
      const inspect = await host.inspectLivePreview();
      if (isInspectablePreview(inspect)) {
        await sleep(PAINT_SETTLE_MS, signal);
        return;
      }
    } catch {
      // Local preview can be visually ready before pod inspect succeeds.
    }

    await sleep(INSPECT_POLL_MS, signal);
  }

  throw new Error('The template preview did not render in time for capture.');
}
