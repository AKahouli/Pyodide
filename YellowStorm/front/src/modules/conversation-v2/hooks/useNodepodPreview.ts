import { useCallback, useEffect, useRef, useState } from 'react';
import { Nodepod } from '@scelar/nodepod';
import { conversationV2Api } from '../api';
import type { FilesTreeNode } from '../types';
import { isTextSourcePath } from '../utils/app-source';
import { flattenFilesTree } from '../utils/files-tree';
import { parseNpmAddedPackages } from '../utils/npm-install-output';

export type NodepodPreviewStatus =
  | 'idle'
  | 'loading'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error';

export interface UseNodepodPreviewArgs {
  sessionId: string | null;
  cephPath?: string | null;
  filesTree?: FilesTreeNode | null;
  /** Bump to force a full reboot (e.g. new agent generation). */
  revision?: string;
}

export interface UseNodepodPreviewResult {
  status: NodepodPreviewStatus;
  previewUrl: string | null;
  error: string | null;
  /** Downloaded project files (VFS paths like `/src/App.tsx`). Read-only for UI. */
  files: Record<string, string | Uint8Array> | null;
  retry: () => void;
}

const LOG = '[Nodepod]';
const VITE_PKG_PATH = '/node_modules/vite';
const REACT_PKG_PATH = '/node_modules/react';
const ROLLDOWN_PKG_PATH = '/node_modules/rolldown';
const ROLLDOWN_WASM_PATH = '/node_modules/@rolldown/binding-wasm32-wasi';
/** Vite usually binds quickly; keep a soft window then keep waiting if alive. */
const READY_SOFT_MS = 20_000;
const READY_HARD_MS = 90_000;
/** Prefer Vite's default, then common fallbacks. */
const PREVIEW_PORTS = [5173, 3000, 8080] as const;

type NodepodInstance = Awaited<ReturnType<typeof Nodepod.boot>>;

// ---------------------------------------------------------------------------
// Module-level pod cache
// ---------------------------------------------------------------------------

interface PodCacheEntry {
  pod: NodepodInstance;
  previewUrl: string | null;
  files: Record<string, string | Uint8Array> | null;
  alive: boolean;
  lastAccessed: number;
}

const MAX_CACHE_AGE_MS = 10 * 60 * 1000;

const podCache = new Map<string, PodCacheEntry>();

function cacheKey(sessionId: string, revision: string) {
  return `${sessionId}:${revision}`;
}

function invalidateSession(sessionId: string) {
  const prefix = `${sessionId}:`;
  for (const [key, entry] of podCache) {
    if (key.startsWith(prefix)) {
      entry.alive = false;
      try { entry.pod.teardown(); } catch { /* noop */ }
      podCache.delete(key);
    }
  }
}

function cleanupStaleEntries() {
  const now = Date.now();
  for (const [key, entry] of podCache) {
    if (!entry.alive || now - entry.lastAccessed > MAX_CACHE_AGE_MS) {
      entry.alive = false;
      try { entry.pod.teardown(); } catch { /* noop */ }
      podCache.delete(key);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    for (const entry of podCache.values()) {
      entry.alive = false;
      try { entry.pod.teardown(); } catch { /* noop */ }
    }
    podCache.clear();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readPackageVersion(
  pod: NodepodInstance,
  packageJsonPath: string,
): Promise<string | null> {
  try {
    const raw = await pod.fs.readFile(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

async function ensureRolldownWasmBinding(pod: NodepodInstance): Promise<boolean> {
  const hasRolldown = await pod.fs.exists(ROLLDOWN_PKG_PATH);
  if (!hasRolldown) {
    logPhase('5.rolldown-wasm:skip', { reason: 'no-rolldown' });
    return false;
  }

  const already = await pod.fs.exists(ROLLDOWN_WASM_PATH);
  if (already) {
    logPhase('5.rolldown-wasm:skip', { reason: 'already-installed' });
    return true;
  }

  const version =
    (await readPackageVersion(pod, `${ROLLDOWN_PKG_PATH}/package.json`)) ?? 'latest';
  logPhase('5.rolldown-wasm:check', { version, alreadyInstalled: false });

  const spec = `@rolldown/binding-wasm32-wasi@${version}`;
  logPhase('5.rolldown-wasm:install', { spec });
  const install = await pod.spawn('npm', [
    'install',
    spec,
    '--no-save',
    '--cpu=wasm32',
  ]);
  install.on('output', (text: string) => {
    console.log(`${LOG} [5.rolldown-wasm:install:stdout]`, text);
  });
  install.on('error', (text: string) => {
    console.warn(`${LOG} [5.rolldown-wasm:install:stderr]`, text);
  });
  const result = await install.completion;
  const present = await pod.fs.exists(ROLLDOWN_WASM_PATH);
  logPhase('5.rolldown-wasm:install:done', {
    exitCode: result.exitCode,
    present,
  });
  if (result.exitCode !== 0 || !present) {
    throw new Error(
      `Failed to install ${spec} for Nodepod (Vite/rolldown needs the WASI binding).`,
    );
  }
  return true;
}

function logPhase(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

async function fetchProjectFiles(
  sessionId: string,
  cephPath: string,
  filesTree: FilesTreeNode,
): Promise<Record<string, string | Uint8Array>> {
  const flat = flattenFilesTree(filesTree);
  logPhase('1.flatten-tree', {
    fileCount: flat.length,
    samplePaths: flat.slice(0, 8).map((f) => f.path),
  });
  if (flat.length === 0) {
    throw new Error('No source files in tree');
  }

  const paths = flat.map((f) => f.path);
  logPhase('2.presign-urls:request', {
    sessionId,
    cephPath,
    pathCount: paths.length,
  });
  const { items } = await conversationV2Api.getAppSourceUrls(sessionId, cephPath, paths);
  logPhase('2.presign-urls:response', {
    itemCount: items.length,
    sample: items.slice(0, 3).map((i) => ({ path: i.path, urlHost: safeHost(i.url) })),
  });

  logPhase('3.download-sources:start', { itemCount: items.length });
  const files: Record<string, string | Uint8Array> = {};
  let textCount = 0;
  let binaryCount = 0;
  let skippedCount = 0;
  await Promise.all(
    items.map(async ({ path, url }) => {
      const res = await fetch(url);
      if (!res.ok) {
        const base = path.split('/').pop() ?? path;
        const required = base === 'package.json';
        if (!required) {
          skippedCount += 1;
          logPhase('3.download-sources:skip', { path, status: res.status });
          return;
        }
        throw new Error(`Failed to download ${path} (${res.status})`);
      }
      const vfsPath = path.startsWith('/') ? path : `/${path}`;
      if (isTextSourcePath(path)) {
        files[vfsPath] = await res.text();
        textCount += 1;
      } else {
        files[vfsPath] = new Uint8Array(await res.arrayBuffer());
        binaryCount += 1;
      }
    }),
  );
  logPhase('3.download-sources:done', {
    vfsFileCount: Object.keys(files).length,
    textCount,
    binaryCount,
    skippedCount,
    hasPackageJson: typeof files['/package.json'] === 'string',
  });
  return files;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid-url)';
  }
}

function detectDevCommand(files: Record<string, string | Uint8Array>): {
  cmd: string;
  args: string[];
} {
  const pkgRaw = files['/package.json'];
  if (typeof pkgRaw === 'string') {
    try {
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      const scripts = pkg.scripts ?? {};
      if (scripts.dev) return { cmd: 'npm', args: ['run', 'dev'] };
      if (scripts.start) return { cmd: 'npm', args: ['run', 'start'] };
    } catch {
      // fall through
    }
  }
  return { cmd: 'npm', args: ['run', 'dev'] };
}

function looksLikeDevServerReady(text: string): boolean {
  return (
    /ready in /i.test(text) ||
    /Local:\s+https?:\/\//i.test(text) ||
    /VITE\s+v?\d/i.test(text)
  );
}

async function waitUntilDirectServerReady(
  pod: NodepodInstance,
  port: number,
  isStale: () => boolean,
): Promise<boolean> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isStale()) return false;
    try {
      const res = await pod.proxy.handleRequest(pod.instanceId, port, 'GET', '/', {
        accept: 'text/html,*/*',
      });
      logPhase('6.direct-probe', {
        attempt,
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
      });
      if (res.statusCode && res.statusCode !== 503) return true;
    } catch (err) {
      logPhase('6.direct-probe:error', {
        attempt,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return false;
}

async function waitUntilPreviewReachable(
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
      logPhase('6.sw-probe', { attempt, lastStatus, bodyHint });
    } catch {
      // Transient network / SW race — retry.
    }
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return { ok: false, lastStatus, bodyHint };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Boots a Nodepod instance from Ceph-backed Vite/React app sources, installs
 * deps, and starts the app's dev server. The pod is cached at module level so
 * that navigating away and returning to the same session+revision restores the
 * preview instantly without re-booting.
 */
export function useNodepodPreview({
  sessionId,
  cephPath,
  filesTree,
  revision = '',
}: UseNodepodPreviewArgs): UseNodepodPreviewResult {
  const [status, setStatus] = useState<NodepodPreviewStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string | Uint8Array> | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const podRef = useRef<NodepodInstance | null>(null);
  const readyRef = useRef(false);
  const filesTreeRef = useRef(filesTree);
  filesTreeRef.current = filesTree;

  const HARD_REFRESH_ERRORS = [
    'Dev server started but did not answer HTTP requests inside Nodepod.',
  ] as const;

  const retry = useCallback(() => {
    if (error && HARD_REFRESH_ERRORS.some((msg) => error.startsWith(msg))) {
      logPhase('retry:hard-refresh', { sessionId, cephPath, revision, error });
      const key = sessionId && revision ? cacheKey(sessionId, revision) : null;
      if (key && sessionId) invalidateSession(sessionId);
      window.location.reload();
      return;
    }
    logPhase('retry', { sessionId, cephPath, revision });
    if (sessionId) invalidateSession(sessionId);
    setRetryToken((n) => n + 1);
  }, [sessionId, cephPath, revision, error]);

  useEffect(() => {
    const key = sessionId && revision ? cacheKey(sessionId, revision) : null;
    const tree = filesTreeRef.current;
    cleanupStaleEntries();

    // --- CACHE HIT ---
    if (key) {
      const entry = podCache.get(key);
      if (entry?.alive && entry.pod) {
        logPhase('cache-hit', { key });
        podRef.current = entry.pod;
        readyRef.current = entry.previewUrl != null;
        entry.lastAccessed = Date.now();
        setStatus(entry.previewUrl != null ? 'ready' : 'idle');
        setPreviewUrl(entry.previewUrl);
        setFiles(entry.files);
        setError(null);
        return () => {
          // Intentionally no teardown on unmount — keep the pod alive in cache.
        };
      }
    }

    // --- CACHE MISS: full boot ---
    let cancelled = false;
    let softTimer: number | undefined;
    let hardTimer: number | undefined;
    let devExited = false;
    readyRef.current = false;

    logPhase('0.effect-start', {
      sessionId,
      cephPath,
      revision,
      retryToken,
      hasFilesTree: !!tree,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
    });

    const clearReadyTimers = () => {
      if (softTimer !== undefined) {
        window.clearTimeout(softTimer);
        softTimer = undefined;
      }
      if (hardTimer !== undefined) {
        window.clearTimeout(hardTimer);
        hardTimer = undefined;
      }
    };

    const isStale = () => cancelled || podRef.current === null;

    const teardown = async () => {
      const pod = podRef.current;
      podRef.current = null;
      if (pod) {
        logPhase('9.teardown:start');
        try {
          await pod.teardown();
          logPhase('9.teardown:done');
        } catch (err) {
          logPhase('9.teardown:error', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };

    const fail = (message: string) => {
      if (cancelled || readyRef.current) return;
      clearReadyTimers();
      logPhase('8.error', { message });
      setError(message);
      setStatus('error');
    };

    const storeInCache = (
      pod: NodepodInstance,
      url: string | null,
      projectFiles: Record<string, string | Uint8Array> | null,
    ) => {
      if (key) {
        podCache.set(key, {
          pod,
          previewUrl: url,
          files: projectFiles,
          alive: true,
          lastAccessed: Date.now(),
        });
      }
    };

    let pendingPort: number | null = null;
    let pendingUrl: string | null = null;
    const promotingRef = { current: false };

    /** Promote preview only after the app answers directly AND the SW proxy works. */
    const promotePreview = (url: string, port: number, source: string) => {
      if (cancelled || readyRef.current || promotingRef.current) return;
      promotingRef.current = true;
      clearReadyTimers();
      void (async () => {
        try {
          const pod = podRef.current;
          if (!pod || cancelled) return;

          logPhase('6.promote:start', {
            source,
            url,
            port,
            swController: !!navigator.serviceWorker?.controller,
            crossOriginIsolated: globalThis.crossOriginIsolated === true,
          });

          const directOk = await waitUntilDirectServerReady(pod, port, isStale);
          if (cancelled || readyRef.current) return;
          if (!directOk) {
            fail('Dev server started but did not answer HTTP requests inside Nodepod.');
            return;
          }

          const sw = await waitUntilPreviewReachable(url, isStale);
          if (cancelled || readyRef.current) return;
          logPhase('6.promote:sw', sw);

          if (!sw.ok) {
            const isSwTransient =
              sw.bodyHint === 'nodepod-sw-initializing' ||
              sw.bodyHint === 'nodepod-sw-disconnected';

            if (isSwTransient) {
              logPhase('6.promote:sw-retry', { bodyHint: sw.bodyHint });
              await new Promise((r) => window.setTimeout(r, 1_000));
              const sw2 = await waitUntilPreviewReachable(url, isStale, 40);
              if (cancelled || readyRef.current) return;
              logPhase('6.promote:sw-retry-result', sw2);
              if (!sw2.ok) {
                fail(
                  sw2.bodyHint === 'nodepod-sw-initializing' ||
                    sw2.bodyHint === 'nodepod-sw-disconnected'
                    ? 'Nodepod service worker cannot reach this preview (503). Hard-refresh the page (Ctrl+Shift+R) so /__sw__.js reconnects.'
                    : `Preview URL stayed unreachable (HTTP ${sw2.lastStatus ?? '???'}). Check that /__sw__.js is served as JavaScript and COOP/COEP headers are present.`,
                );
                return;
              }
            } else {
              fail(
                `Preview URL stayed unreachable (HTTP ${sw.lastStatus ?? '???'}). Check that /__sw__.js is served as JavaScript and COOP/COEP headers are present.`,
              );
              return;
            }
          }

          readyRef.current = true;
          logPhase('6.ready', { source, previewUrl: url });
          setPreviewUrl(url);
          setStatus('ready');
          storeInCache(pod, url, downloadedFiles);
        } finally {
          promotingRef.current = false;
        }
      })();
    };

    let downloadedFiles: Record<string, string | Uint8Array> | null = null;

    const run = async () => {
      if (sessionId) invalidateSession(sessionId);
      setPreviewUrl(null);
      setFiles(null);
      setError(null);

      if (!sessionId || !cephPath || !tree) {
        logPhase('0.skip-missing-sources', {
          hasSessionId: !!sessionId,
          hasCephPath: !!cephPath,
          hasFilesTree: !!tree,
        });
        setStatus('idle');
        setError(
          !cephPath || !tree
            ? 'Source files are not available yet for in-browser preview.'
            : null,
        );
        return;
      }

      setStatus('loading');
      logPhase('flow:loading');
      try {
        const projectFiles = await fetchProjectFiles(sessionId, cephPath, tree);
        if (cancelled) {
          logPhase('cancelled:after-download');
          return;
        }
        setFiles(projectFiles);
        downloadedFiles = projectFiles;

        logPhase('4.boot:start', { fileCount: Object.keys(projectFiles).length });
        const pod = await Nodepod.boot({
          files: projectFiles,
          workdir: '/',
          watermark: false,
          onServerReady: (port, url) => {
            if (cancelled || podRef.current !== pod) {
              logPhase('6.server-ready:ignored-stale', {
                port,
                url,
                cancelled,
                samePod: podRef.current === pod,
              });
              return;
            }
            const resolved = url || pod.port(port) || null;
            logPhase('6.server-ready', { port, url, resolvedPreviewUrl: resolved });
            pendingPort = port;
            pendingUrl = resolved;
          },
        });
        logPhase('4.boot:done');
        if (cancelled) {
          logPhase('cancelled:after-boot');
          await pod.teardown();
          return;
        }
        podRef.current = pod;

        setStatus('installing');
        logPhase('5.npm-install:start');
        const install = await pod.spawn('npm', ['install']);
        install.on('output', (text: string) => {
          console.log(`${LOG} [5.npm-install:stdout]`, text);
        });
        install.on('error', (text: string) => {
          console.warn(`${LOG} [5.npm-install:stderr]`, text);
        });
        const installResult = await install.completion;
        const addedPackages = parseNpmAddedPackages(installResult.stdout);
        const hasVite = await pod.fs.exists(VITE_PKG_PATH);
        const hasReact = await pod.fs.exists(REACT_PKG_PATH);
        logPhase('5.npm-install:verify', {
          exitCode: installResult.exitCode,
          addedPackages,
          hasVite,
          hasReact,
        });
        if (installResult.exitCode !== 0) {
          throw new Error(`npm install failed (exit ${installResult.exitCode}).`);
        }
        if (!hasVite && !hasReact) {
          throw new Error(
            addedPackages === 0
              ? 'npm install added 0 packages and node_modules/vite (or react) is missing.'
              : 'node_modules/vite (or react) is missing after npm install.',
          );
        }
        if (addedPackages !== null && addedPackages === 0) {
          console.warn(
            `${LOG} [5.npm-install:warn] added 0 packages (cache/snapshot hit or empty install). hasVite=${hasVite} hasReact=${hasReact}`,
          );
        }
        const needsRolldownWasm = await ensureRolldownWasmBinding(pod);
        if (
          needsRolldownWasm &&
          typeof SharedArrayBuffer === 'undefined'
        ) {
          throw new Error(
            'Vite/rolldown requires SharedArrayBuffer (COOP/COEP). Hard-refresh after confirming Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.',
          );
        }
        logPhase('5.npm-install:done', {
          addedPackages,
          hasVite,
          hasReact,
          needsRolldownWasm,
        });
        if (cancelled) {
          logPhase('cancelled:after-install');
          return;
        }

        setStatus('starting');
        const { cmd, args } = detectDevCommand(projectFiles);
        const devEnv = needsRolldownWasm
          ? { NAPI_RS_FORCE_WASI: 'true', NAPI_RS_FORCE_WASM: '1' }
          : undefined;
        logPhase('6.dev-server:spawn', { cmd, args, env: devEnv ?? null });
        const proc = await pod.spawn(cmd, args, devEnv ? { env: devEnv } : undefined);
        proc.on('output', (text: string) => {
          console.log(`${LOG} [6.dev-server:stdout]`, text);
          if (!readyRef.current && !cancelled && looksLikeDevServerReady(text)) {
            const port = pendingPort ?? 5173;
            const url =
              pendingUrl ||
              pod.port(port) ||
              PREVIEW_PORTS.map((p) => pod.port(p)).find(Boolean) ||
              null;
            if (url) promotePreview(url, port, 'stdout-ready');
          }
        });
        proc.on('error', (text: string) => {
          console.warn(`${LOG} [6.dev-server:stderr]`, text);
        });
        proc.on('exit', (code: number) => {
          devExited = true;
          logPhase('6.dev-server:exit', { code, ready: readyRef.current });
          if (cancelled || readyRef.current) return;
          fail(`Dev server exited before becoming ready (code ${code}).`);
          void teardown();
        });

        const tryFallbackPorts = (
          phase: string,
        ): { url: string; port: number } | null => {
          for (const port of [pendingPort, ...PREVIEW_PORTS]) {
            if (port == null) continue;
            const url = pod.port(port);
            if (url) {
              logPhase(phase, { port, url, devExited });
              return { url, port };
            }
          }
          logPhase(phase, {
            pendingPort,
            pendingUrl,
            ports: Object.fromEntries(PREVIEW_PORTS.map((p) => [p, pod.port(p)])),
            devExited,
          });
          return pendingUrl && pendingPort != null
            ? { url: pendingUrl, port: pendingPort }
            : null;
        };

        softTimer = window.setTimeout(() => {
          if (cancelled || podRef.current !== pod || readyRef.current) {
            logPhase('7.soft-timeout:skipped', {
              cancelled,
              ready: readyRef.current,
              samePod: podRef.current === pod,
            });
            return;
          }
          const fallback = tryFallbackPorts('7.soft-timeout');
          if (fallback) {
            promotePreview(fallback.url, fallback.port, 'soft-timeout-port');
            return;
          }
          if (!devExited) {
            logPhase('7.soft-timeout:still-starting', {
              softMs: READY_SOFT_MS,
              hardMs: READY_HARD_MS,
            });
            return;
          }
          fail('Dev server exited without opening a preview port.');
        }, READY_SOFT_MS);

        hardTimer = window.setTimeout(() => {
          if (cancelled || podRef.current !== pod || readyRef.current) {
            logPhase('7.hard-timeout:skipped', {
              cancelled,
              ready: readyRef.current,
              samePod: podRef.current === pod,
            });
            return;
          }
          const fallback = tryFallbackPorts('7.hard-timeout');
          if (fallback) {
            promotePreview(fallback.url, fallback.port, 'hard-timeout-port');
            return;
          }
          fail(
            `Dev server did not become ready within ${READY_HARD_MS / 1000}s (no listening port).`,
          );
          void teardown();
        }, READY_HARD_MS);
      } catch (err) {
        if (cancelled) {
          logPhase('cancelled:after-error');
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        fail(message);
        await teardown();
      }
    };

    void run();

    return () => {
      logPhase('0.effect-cleanup', { sessionId, revision });
      cancelled = true;
      clearReadyTimers();
      // Intentionally no teardown — keep the pod alive in cache for instant
      // restore when the user navigates back to this session.
    };
  }, [sessionId, cephPath, revision, retryToken]);

  return { status, previewUrl, error, files, retry };
}
