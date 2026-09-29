import type { BrowserRuntimeHost } from '@/modules/conversation-v2/runtime/BrowserRuntimeHost';
import { waitUntilPreviewReachable } from '@/modules/conversation-v2/runtime/PreviewController';

const CAPTURE_READY_TIMEOUT_MS = 120_000;
const INSPECT_POLL_MS = 1_000;
const PAINT_SETTLE_MS = 800;

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

/**
 * Wait until the Nodepod SW route and the live app DOM are ready for screenshot capture.
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

  await host.refreshPreview();
  if (signal.aborted) throw new Error('Validation cancelled.');

  const sw = await waitUntilPreviewReachable(url, () => signal.aborted, 120);
  if (!sw.ok) {
    throw new Error(
      sw.bodyHint === 'nodepod-sw-disconnected' || sw.bodyHint === 'nodepod-sw-initializing'
        ? 'NodePod preview is still connecting. Hard-refresh the page (Ctrl+Shift+R) and try again.'
        : `Preview stayed unreachable (HTTP ${sw.lastStatus ?? '503'}).`,
    );
  }

  host.attachPreviewIframe(iframe);
  await waitForIframeLoad(iframe, signal);

  const deadline = Date.now() + CAPTURE_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (signal.aborted) throw new Error('Validation cancelled.');
    if (host.state.status === 'error') {
      throw new Error(host.state.error || 'NodePod preview failed.');
    }

    const inspect = await host.inspectLivePreview();
    if (isInspectablePreview(inspect)) {
      await sleep(PAINT_SETTLE_MS, signal);
      return;
    }

    await sleep(INSPECT_POLL_MS, signal);
  }

  throw new Error('The template preview did not render in time for capture.');
}
