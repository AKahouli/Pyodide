import { useCallback, useEffect, useRef, useState } from 'react';
import { Nodepod } from '@scelar/nodepod';
import { conversationV2Api } from '../api';
import type { FilesTreeNode } from '../types';
import { isTextSourcePath } from '../utils/app-source';
import { flattenFilesTree } from '../utils/files-tree';
import { parseNpmAddedPackages } from '../utils/npm-install-output';
import { readNextVersionFromPackageJson } from '../utils/read-next-version';

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
  /** Downloaded project files (VFS paths like `/app/page.tsx`). Read-only for UI. */
  files: Record<string, string | Uint8Array> | null;
  retry: () => void;
}

const LOG = '[Nodepod]';
const SWC_WASM_PATH = '/node_modules/@next/swc-wasm-nodejs';
const SWC_WASM_JS = `${SWC_WASM_PATH}/wasm.js`;
const SWC_WASM_BIN = `${SWC_WASM_PATH}/wasm_bg.wasm`;
const NEXT_PKG_PATH = '/node_modules/next';
/** Try ports soon after spawn — Next+local SWC is typically ready in <15s. */
const READY_SOFT_MS = 20_000;
/** Absolute give-up if still no port and process has not exited. */
const READY_HARD_MS = 90_000;

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
        // Dotfiles / assets must not hard-fail the whole preview boot.
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

function readNextVersion(files: Record<string, string | Uint8Array>): string | null {
  const pkgRaw = files['/package.json'];
  if (typeof pkgRaw !== 'string') return null;
  return readNextVersionFromPackageJson(pkgRaw);
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
      // 503 here means Nodepod registry has no server yet; keep waiting.
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
): Promise<{ ok: boolean; lastStatus: number | null; bodyHint: string | null }> {
  let lastStatus: number | null = null;
  let bodyHint: string | null = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (isStale()) return { ok: false, lastStatus, bodyHint };
    try {
      const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
      lastStatus = res.status;
      if (res.status !== 503) {
        return { ok: true, lastStatus, bodyHint };
      }
      // Diagnose Nodepod SW 503 pages vs ingress/generic 503.
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

type NodepodInstance = Awaited<ReturnType<typeof Nodepod.boot>>;

async function swcWasmFilesPresent(pod: NodepodInstance): Promise<{
  hasJs: boolean;
  hasBin: boolean;
  binBytes: number | null;
}> {
  const hasJs = await pod.fs.exists(SWC_WASM_JS);
  const hasBin = await pod.fs.exists(SWC_WASM_BIN);
  let binBytes: number | null = null;
  if (hasBin) {
    try {
      binBytes = (await pod.fs.stat(SWC_WASM_BIN)).size;
    } catch {
      binBytes = null;
    }
  }
  return { hasJs, hasBin, binBytes };
}

/** Ensure local WASM bindings exist and point Next at them (skip CDN/npm download). */
async function ensureLocalSwcWasm(
  pod: NodepodInstance,
  projectFiles: Record<string, string | Uint8Array>,
): Promise<string> {
  const nextVersion = readNextVersion(projectFiles);
  let files = await swcWasmFilesPresent(pod);
  logPhase('5.swc-wasm:check', { nextVersion, ...files });

  // Incomplete snapshot often leaves an empty package dir without the 28MB wasm.
  const incomplete =
    !files.hasJs || !files.hasBin || (files.binBytes != null && files.binBytes < 1_000_000);

  if (incomplete) {
    const spec = nextVersion
      ? `@next/swc-wasm-nodejs@${nextVersion}`
      : '@next/swc-wasm-nodejs';
    logPhase('5.swc-wasm:install', { spec });
    const install = await pod.spawn('npm', ['install', spec, '--no-save']);
    install.on('output', (text: string) => {
      console.log(`${LOG} [5.swc-wasm:install:stdout]`, text);
    });
    install.on('error', (text: string) => {
      console.warn(`${LOG} [5.swc-wasm:install:stderr]`, text);
    });
    const result = await install.completion;
    files = await swcWasmFilesPresent(pod);
    logPhase('5.swc-wasm:install:done', {
      exitCode: result.exitCode,
      ...files,
    });
    if (result.exitCode !== 0 || !files.hasJs || !files.hasBin) {
      throw new Error(
        `Failed to install ${spec} for Nodepod (need wasm.js + wasm_bg.wasm).`,
      );
    }
  }

  return SWC_WASM_PATH;
}

/**
 * Boots a Nodepod instance from Ceph-backed app sources, installs deps, and
 * starts the app's dev server. Teardown on unmount / revision change.
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
  const podRef = useRef<Awaited<ReturnType<typeof Nodepod.boot>> | null>(null);
  const readyRef = useRef(false);
  // Event polling rebuilds applicationComponent objects; keep the tree in a
  // ref so identity churn does not cancel an in-flight Nodepod boot.
  const filesTreeRef = useRef(filesTree);
  filesTreeRef.current = filesTree;

  const retry = useCallback(() => {
    logPhase('retry', { sessionId, cephPath, revision });
    setRetryToken((n) => n + 1);
  }, [sessionId, cephPath, revision]);

  useEffect(() => {
    let cancelled = false;
    let softTimer: number | undefined;
    let hardTimer: number | undefined;
    let devExited = false;
    readyRef.current = false;
    const tree = filesTreeRef.current;

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

    /** Promote preview only after Next answers directly AND the SW proxy works. */
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
            fail(
              'Next.js started but did not answer HTTP requests inside Nodepod.',
            );
            return;
          }

          const sw = await waitUntilPreviewReachable(url, isStale);
          if (cancelled || readyRef.current) return;
          logPhase('6.promote:sw', sw);
          if (!sw.ok) {
            fail(
              sw.bodyHint === 'nodepod-sw-initializing' ||
                sw.bodyHint === 'nodepod-sw-disconnected'
                ? 'Nodepod service worker cannot reach this preview (503). Hard-refresh the page (Ctrl+Shift+R) so /__sw__.js reconnects.'
                : `Preview URL stayed unreachable (HTTP ${sw.lastStatus ?? '???'}). Check that /__sw__.js is served as JavaScript and COOP/COEP headers are present.`,
            );
            return;
          }

          readyRef.current = true;
          logPhase('6.ready', { source, previewUrl: url });
          setPreviewUrl(url);
          setStatus('ready');
        } finally {
          promotingRef.current = false;
        }
      })();
    };

    let pendingPort: number | null = null;
    let pendingUrl: string | null = null;
    const promotingRef = { current: false };

    const run = async () => {
      await teardown();
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
            // Too early to iframe: Next often emits listen before "Ready".
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
        install.on('output', (text) => {
          console.log(`${LOG} [5.npm-install:stdout]`, text);
        });
        install.on('error', (text) => {
          console.warn(`${LOG} [5.npm-install:stderr]`, text);
        });
        const installResult = await install.completion;
        const addedPackages = parseNpmAddedPackages(installResult.stdout);
        const hasNext = await pod.fs.exists(NEXT_PKG_PATH);
        const hasSwcWasmDir = await pod.fs.exists(SWC_WASM_PATH);
        logPhase('5.npm-install:verify', {
          exitCode: installResult.exitCode,
          addedPackages,
          hasNext,
          hasSwcWasmDir,
          swcWasmPath: SWC_WASM_PATH,
        });
        if (installResult.exitCode !== 0) {
          throw new Error(`npm install failed (exit ${installResult.exitCode}).`);
        }
        if (!hasNext) {
          throw new Error(
            addedPackages === 0
              ? 'npm install added 0 packages and node_modules/next is missing.'
              : 'node_modules/next is missing after npm install.',
          );
        }
        if (addedPackages !== null && addedPackages === 0) {
          console.warn(
            `${LOG} [5.npm-install:warn] added 0 packages (cache/snapshot hit or empty install). hasNext=${hasNext}`,
          );
        }
        const swcWasmDir = await ensureLocalSwcWasm(pod, projectFiles);
        logPhase('5.npm-install:done', {
          addedPackages,
          hasNext,
          swcWasmDir,
        });
        if (cancelled) {
          logPhase('cancelled:after-install');
          return;
        }

        setStatus('starting');
        const { cmd, args } = detectDevCommand(projectFiles);
        // NEXT_TEST_WASM_DIR forces Next to load local wasm.js (skips CDN/registry download).
        const devEnv = {
          NEXT_TEST_WASM_DIR: swcWasmDir,
          NEXT_TELEMETRY_DISABLED: '1',
        };
        logPhase('6.dev-server:spawn', { cmd, args, env: devEnv });
        const proc = await pod.spawn(cmd, args, { env: devEnv });
        proc.on('output', (text: string) => {
          console.log(`${LOG} [6.dev-server:stdout]`, text);
          // Next finished booting — now wait for direct HTTP + SW proxy.
          if (!readyRef.current && !cancelled && /Ready in /i.test(text)) {
            const port = pendingPort ?? 3000;
            const url = pendingUrl || pod.port(port) || pod.port(3000);
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
          fail(
            `Dev server exited before becoming ready (code ${code}). ` +
              'Often caused by Next downloading SWC at runtime inside Nodepod.',
          );
          void teardown();
        });

        const tryFallbackPorts = (phase: string): { url: string; port: number } | null => {
          for (const port of [pendingPort, 3000, 5173, 8080]) {
            if (port == null) continue;
            const url = pod.port(port);
            if (url) {
              logPhase(phase, { port, url, devExited });
              return { url, port };
            }
          }
          logPhase(phase, {
            port3000: pod.port(3000),
            port5173: pod.port(5173),
            port8080: pod.port(8080),
            pendingPort,
            pendingUrl,
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
      void teardown();
    };
  }, [sessionId, cephPath, revision, retryToken]);

  return { status, previewUrl, error, files, retry };
}
