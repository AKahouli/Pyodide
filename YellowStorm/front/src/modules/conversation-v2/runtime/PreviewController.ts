const LOG = '[PreviewController]';
export const PREVIEW_PORTS = [5173, 3000, 8080] as const;

function log(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function extractNodepodPortFromPreviewUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const parsePort = (value: string): number | null => {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  };
  try {
    const parsed = new URL(url, window.location.href);
    const virtualMatch = parsed.pathname.match(/\/__virtual__\/[^/]+\/(\d+)(?:\/|$)/i);
    if (virtualMatch) return parsePort(virtualMatch[1]);
    if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && parsed.port) {
      return parsePort(parsed.port);
    }
    if (parsed.port) return parsePort(parsed.port);
  } catch {
    const virtualMatch = url.match(/\/__virtual__\/[^/]+\/(\d+)(?:\/|$)/i);
    if (virtualMatch) return parsePort(virtualMatch[1]);
    const localMatch = url.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i);
    if (localMatch) return parsePort(localMatch[1]);
  }
  return null;
}

export function extractPortFromDevServerOutput(text: string): number | null {
  const cleaned = stripAnsi(text);
  const match = cleaned.match(/Local:\s+https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)/i);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

export function resolvePreviewPort(args: {
  previewUrl?: string | null;
  reportedPort?: number | null;
  stdoutText?: string | null;
}): number | null {
  return (
    extractNodepodPortFromPreviewUrl(args.previewUrl) ??
    extractPortFromDevServerOutput(args.stdoutText ?? '') ??
    args.reportedPort ??
    null
  );
}

export function looksLikeDevServerReady(text: string): boolean {
  return /ready in /i.test(text) || /Local:\s+https?:\/\//i.test(text) || /VITE\s+v?\d/i.test(text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PodLike = { proxy: { handleRequest: (...args: any[]) => Promise<{ statusCode?: number; statusMessage?: string }> }; instanceId: string; port: (p: number) => string | null };

export async function waitUntilDirectServerReady(
  pod: PodLike,
  port: number,
  isStale: () => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isStale()) return false;
    try {
      const res = await pod.proxy.handleRequest(pod.instanceId, port, 'GET', '/', { accept: 'text/html,*/*' });
      log('direct-probe', { attempt, statusCode: res.statusCode, statusMessage: res.statusMessage });
      if (res.statusCode && res.statusCode !== 503) return true;
    } catch (err) {
      log('direct-probe:error', { attempt, error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return false;
}

export async function waitUntilPreviewReachable(
  url: string,
  isStale: () => boolean,
  maxAttempts = 60,
): Promise<{ ok: boolean; lastStatus: number | null; bodyHint: string | null }> {
  let lastStatus: number | null = null;
  let bodyHint: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (isStale()) return { ok: false, lastStatus, bodyHint };
    try {
      const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      lastStatus = res.status;
      if (res.status !== 503) return { ok: true, lastStatus, bodyHint };
      try {
        const text = await res.text();
        bodyHint = text.includes('Powered by Nodepod')
          ? text.includes('still initializing')
            ? 'nodepod-sw-initializing'
            : text.includes('no longer connected')
              ? 'nodepod-sw-disconnected'
              : 'nodepod-sw-503'
          : 'non-nodepod-503';
      } catch {
        bodyHint = '503-body-unreadable';
      }
      log('sw-probe', { attempt, lastStatus, bodyHint });
    } catch {
      // Transient network / SW race — retry.
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return { ok: false, lastStatus, bodyHint };
}

export class PreviewController {
  private _previewUrl: string | null = null;
  private _port: number | null = null;

  get previewUrl(): string | null {
    return this._previewUrl;
  }

  get port(): number | null {
    return this._port;
  }

  setPreview(url: string, port: number): void {
    this._previewUrl = url;
    this._port = port;
  }

  reset(): void {
    this._previewUrl = null;
    this._port = null;
  }

  async probeAndPromote(
    pod: PodLike,
    url: string,
    port: number,
    isStale: () => boolean,
  ): Promise<{ ok: boolean; error?: string }> {
    const probePort = resolvePreviewPort({ previewUrl: url, reportedPort: port }) ?? port;
    log('probe:start', { url, port: probePort });

    const directOk = await waitUntilDirectServerReady(pod, probePort, isStale);
    if (isStale()) return { ok: false };
    if (!directOk) {
      return { ok: false, error: 'Dev server started but did not answer HTTP requests inside Nodepod.' };
    }

    const sw = await waitUntilPreviewReachable(url, isStale);
    if (isStale()) return { ok: false };
    log('probe:sw', sw);

    if (!sw.ok) {
      const isSwTransient = sw.bodyHint === 'nodepod-sw-initializing' || sw.bodyHint === 'nodepod-sw-disconnected';
      if (isSwTransient) {
        log('probe:sw-retry', { bodyHint: sw.bodyHint });
        await new Promise((r) => window.setTimeout(r, 1_000));
        const sw2 = await waitUntilPreviewReachable(url, isStale, 40);
        if (isStale()) return { ok: false };
        if (!sw2.ok) {
          const msg =
            sw2.bodyHint === 'nodepod-sw-initializing' || sw2.bodyHint === 'nodepod-sw-disconnected'
              ? 'Nodepod service worker cannot reach this preview (503). Hard-refresh the page (Ctrl+Shift+R) so /__sw__.js reconnects.'
              : `Preview URL stayed unreachable (HTTP ${sw2.lastStatus ?? '???'}).`;
          return { ok: false, error: msg };
        }
      } else {
        return { ok: false, error: `Preview URL stayed unreachable (HTTP ${sw.lastStatus ?? '???'}).` };
      }
    }

    this._previewUrl = url;
    this._port = probePort;
    log('probe:ready', { previewUrl: url });
    return { ok: true };
  }

  async inspectPreview(
    pod: PodLike,
    port?: number,
  ): Promise<Record<string, unknown>> {
    const inspectPort = port ?? this._port ?? 5173;
    const url = this._previewUrl ?? pod.port(inspectPort) ?? `http://localhost:${inspectPort}`;
    try {
      const res = await pod.proxy.handleRequest(pod.instanceId, inspectPort, 'GET', '/', { accept: 'text/html,*/*' });
      return {
        url,
        title: 'YellowMind App',
        statusCode: res.statusCode ?? 0,
        healthy: (res.statusCode ?? 0) < 500,
      };
    } catch (err) {
      return {
        url,
        title: 'YellowMind App',
        statusCode: 0,
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
