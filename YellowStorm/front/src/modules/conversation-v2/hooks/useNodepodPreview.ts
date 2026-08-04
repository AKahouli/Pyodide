import { useCallback, useEffect, useRef, useState } from 'react';
import { Nodepod } from '@scelar/nodepod';
import { conversationV2Api } from '../api';
import type { FilesTreeNode } from '../types';
import { isTextSourcePath } from '../utils/app-source';
import { flattenFilesTree } from '../utils/files-tree';

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

  const retry = useCallback(() => {
    logPhase('retry', { sessionId, cephPath, revision });
    setRetryToken((n) => n + 1);
  }, [sessionId, cephPath, revision]);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: number | undefined;
    readyRef.current = false;

    logPhase('0.effect-start', {
      sessionId,
      cephPath,
      revision,
      retryToken,
      hasFilesTree: !!filesTree,
    });

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

    const run = async () => {
      await teardown();
      setPreviewUrl(null);
      setFiles(null);
      setError(null);

      if (!sessionId || !cephPath || !filesTree) {
        logPhase('0.skip-missing-sources', {
          hasSessionId: !!sessionId,
          hasCephPath: !!cephPath,
          hasFilesTree: !!filesTree,
        });
        setStatus('idle');
        setError(
          !cephPath || !filesTree
            ? 'Source files are not available yet for in-browser preview.'
            : null,
        );
        return;
      }

      setStatus('loading');
      logPhase('flow:loading');
      try {
        const projectFiles = await fetchProjectFiles(sessionId, cephPath, filesTree);
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
            if (cancelled) {
              logPhase('6.server-ready:ignored-cancelled', { port, url });
              return;
            }
            readyRef.current = true;
            const resolved = url || pod.port(port) || null;
            logPhase('6.server-ready', { port, url, resolvedPreviewUrl: resolved });
            setPreviewUrl(resolved);
            setStatus('ready');
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
        await install.completion;
        logPhase('5.npm-install:done');
        if (cancelled) {
          logPhase('cancelled:after-install');
          return;
        }

        setStatus('starting');
        const { cmd, args } = detectDevCommand(projectFiles);
        logPhase('6.dev-server:spawn', { cmd, args });
        const proc = await pod.spawn(cmd, args);
        proc.on('output', (text) => {
          console.log(`${LOG} [6.dev-server:stdout]`, text);
        });
        proc.on('error', (text) => {
          console.warn(`${LOG} [6.dev-server:stderr]`, text);
        });
        proc.on('exit', (code) => {
          logPhase('6.dev-server:exit', { code });
        });

        fallbackTimer = window.setTimeout(() => {
          if (cancelled || podRef.current !== pod || readyRef.current) {
            logPhase('7.fallback-url:skipped', {
              cancelled,
              ready: readyRef.current,
              samePod: podRef.current === pod,
            });
            return;
          }
          const fallback = pod.port(3000) || pod.port(5173) || pod.port(8080);
          logPhase('7.fallback-url', {
            port3000: pod.port(3000),
            port5173: pod.port(5173),
            port8080: pod.port(8080),
            fallback,
          });
          if (fallback) {
            readyRef.current = true;
            setPreviewUrl(fallback);
            setStatus('ready');
          }
        }, 15_000);
      } catch (err) {
        if (cancelled) {
          logPhase('cancelled:after-error');
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        logPhase('8.error', { message, err });
        setError(message);
        setStatus('error');
        await teardown();
      }
    };

    void run();

    return () => {
      logPhase('0.effect-cleanup', { sessionId, revision });
      cancelled = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      void teardown();
    };
  }, [sessionId, cephPath, filesTree, revision, retryToken]);

  return { status, previewUrl, error, files, retry };
}
