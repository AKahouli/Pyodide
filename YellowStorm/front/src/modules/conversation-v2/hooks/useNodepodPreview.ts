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

async function fetchProjectFiles(
  sessionId: string,
  cephPath: string,
  filesTree: FilesTreeNode,
): Promise<Record<string, string | Uint8Array>> {
  const flat = flattenFilesTree(filesTree);
  if (flat.length === 0) {
    throw new Error('No source files in tree');
  }

  const { items } = await conversationV2Api.getAppSourceUrls(
    sessionId,
    cephPath,
    flat.map((f) => f.path),
  );

  const files: Record<string, string | Uint8Array> = {};
  await Promise.all(
    items.map(async ({ path, url }) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to download ${path} (${res.status})`);
      }
      const vfsPath = path.startsWith('/') ? path : `/${path}`;
      if (isTextSourcePath(path)) {
        files[vfsPath] = await res.text();
      } else {
        files[vfsPath] = new Uint8Array(await res.arrayBuffer());
      }
    }),
  );
  return files;
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

  const retry = useCallback(() => setRetryToken((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    let fallbackTimer: number | undefined;
    readyRef.current = false;

    const teardown = async () => {
      const pod = podRef.current;
      podRef.current = null;
      if (pod) {
        try {
          await pod.teardown();
        } catch {
          // ignore teardown races
        }
      }
    };

    const run = async () => {
      await teardown();
      setPreviewUrl(null);
      setFiles(null);
      setError(null);

      if (!sessionId || !cephPath || !filesTree) {
        setStatus('idle');
        setError(
          !cephPath || !filesTree
            ? 'Source files are not available yet for in-browser preview.'
            : null,
        );
        return;
      }

      setStatus('loading');
      try {
        const projectFiles = await fetchProjectFiles(sessionId, cephPath, filesTree);
        if (cancelled) return;
        setFiles(projectFiles);

        const pod = await Nodepod.boot({
          files: projectFiles,
          workdir: '/',
          watermark: false,
          onServerReady: (port, url) => {
            if (cancelled) return;
            readyRef.current = true;
            setPreviewUrl(url || pod.port(port) || null);
            setStatus('ready');
          },
        });
        if (cancelled) {
          await pod.teardown();
          return;
        }
        podRef.current = pod;

        setStatus('installing');
        const install = await pod.spawn('npm', ['install']);
        await install.completion;
        if (cancelled) return;

        setStatus('starting');
        const { cmd, args } = detectDevCommand(projectFiles);
        void pod.spawn(cmd, args);

        fallbackTimer = window.setTimeout(() => {
          if (cancelled || podRef.current !== pod || readyRef.current) return;
          const fallback = pod.port(3000) || pod.port(5173) || pod.port(8080);
          if (fallback) {
            readyRef.current = true;
            setPreviewUrl(fallback);
            setStatus('ready');
          }
        }, 15_000);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('error');
        await teardown();
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
      void teardown();
    };
  }, [sessionId, cephPath, filesTree, revision, retryToken]);

  return { status, previewUrl, error, files, retry };
}
