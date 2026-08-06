import type { Nodepod } from '@scelar/nodepod';
import type { NodepodRuntimeHealth } from '../interfaces';

type NodepodInstance = Awaited<ReturnType<typeof Nodepod.boot>>;

export const PREVIEW_PORTS = [5173, 3000, 8080] as const;

export function stripAnsi(text: string): string {
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

    if (
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
      parsed.port
    ) {
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

export async function waitUntilDirectServerReady(
  pod: NodepodInstance,
  port: number,
  isStale: () => boolean,
  onAttempt?: (details: { attempt: number; statusCode: number | null; statusMessage: string | null }) => void,
): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isStale()) return false;
    try {
      const res = await pod.proxy.handleRequest(pod.instanceId, port, 'GET', '/', {
        accept: 'text/html,*/*',
      });
      onAttempt?.({
        attempt,
        statusCode: res.statusCode ?? null,
        statusMessage: res.statusMessage ?? null,
      });
      if (res.statusCode && res.statusCode !== 503) return true;
    } catch {
      onAttempt?.({ attempt, statusCode: null, statusMessage: null });
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
      if (res.status !== 503) {
        return { ok: true, lastStatus, bodyHint };
      }
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
    } catch {
      // transient
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return { ok: false, lastStatus, bodyHint };
}

export function buildRuntimeHealth(args: {
  directProbeOk: boolean;
  swProbeOk: boolean;
  detectedPort: number | null;
  previewUrl: string | null;
  bodyHint?: string | null;
  lastStatus?: number | null;
}): NodepodRuntimeHealth {
  return {
    directProbeOk: args.directProbeOk,
    swProbeOk: args.swProbeOk,
    detectedPort: args.detectedPort,
    previewUrl: args.previewUrl,
    lastCheckedAt: Date.now(),
    bodyHint: args.bodyHint ?? null,
    lastStatus: args.lastStatus ?? null,
  };
}
