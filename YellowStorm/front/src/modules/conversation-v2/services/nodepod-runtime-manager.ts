import { Nodepod } from '@scelar/nodepod';
import { conversationV2Api } from '../api';
import type { FilesTreeNode, NodepodRuntimeSnapshot } from '../interfaces';
import { isTextSourcePath } from '../utils/app-source';
import { flattenFilesTree } from '../utils/files-tree';
import { parseNpmAddedPackages } from '../utils/npm-install-output';
import {
  buildRuntimeHealth,
  PREVIEW_PORTS,
  resolvePreviewPort,
  waitUntilDirectServerReady,
  waitUntilPreviewReachable,
} from './nodepod-runtime-health';
import {
  createRuntimeKey,
  nodepodRuntimeRegistry,
  type NodepodRuntimeEntry,
} from './nodepod-runtime-registry';

const LOG = '[Nodepod]';
const VITE_PKG_PATH = '/node_modules/vite';
const REACT_PKG_PATH = '/node_modules/react';
const ROLLDOWN_PKG_PATH = '/node_modules/rolldown';
const ROLLDOWN_WASM_PATH = '/node_modules/@rolldown/binding-wasm32-wasi';
const READY_SOFT_MS = 20_000;
const READY_HARD_MS = 90_000;
const MAX_ACTIVE_RUNTIMES = 3;
const MAX_CACHE_AGE_MS = 5 * 60 * 1000;

type NodepodInstance = Awaited<ReturnType<typeof Nodepod.boot>>;

export interface EnsureNodepodRuntimeArgs {
  sessionId: string;
  revision: string;
  cephPath: string;
  filesTree: FilesTreeNode;
}

interface RuntimeSourceArgs extends EnsureNodepodRuntimeArgs {}

const sourceArgsByRuntimeKey = new Map<string, RuntimeSourceArgs>();

function logPhase(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

function createEntry(args: EnsureNodepodRuntimeArgs): NodepodRuntimeEntry {
  const now = Date.now();
  return {
    runtimeKey: createRuntimeKey(args.sessionId, args.revision),
    sessionId: args.sessionId,
    revision: args.revision,
    pod: null,
    podInstanceId: null,
    previewUrl: null,
    detectedPort: null,
    status: 'queued',
    files: null,
    createdAt: now,
    lastAccessedAt: now,
    lastHealthcheckAt: null,
    health: null,
    bootPromise: null,
    error: null,
  };
}

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
  if (!hasRolldown) return false;

  const already = await pod.fs.exists(ROLLDOWN_WASM_PATH);
  if (already) return true;

  const version = (await readPackageVersion(pod, `${ROLLDOWN_PKG_PATH}/package.json`)) ?? 'latest';
  const spec = `@rolldown/binding-wasm32-wasi@${version}`;
  const install = await pod.spawn('npm', ['install', spec, '--no-save', '--cpu=wasm32']);
  const result = await install.completion;
  const present = await pod.fs.exists(ROLLDOWN_WASM_PATH);
  if (result.exitCode !== 0 || !present) {
    throw new Error(
      `Failed to install ${spec} for Nodepod (Vite/rolldown needs the WASI binding).`,
    );
  }
  return true;
}

async function fetchProjectFiles(
  sessionId: string,
  cephPath: string,
  filesTree: FilesTreeNode,
): Promise<Record<string, string | Uint8Array>> {
  const flat = flattenFilesTree(filesTree);
  if (flat.length === 0) throw new Error('No source files in tree');

  const paths = flat.map((f) => f.path);
  const { items } = await conversationV2Api.getAppSourceUrls(sessionId, cephPath, paths);
  const files: Record<string, string | Uint8Array> = {};

  await Promise.all(
    items.map(async ({ path, url }) => {
      const res = await fetch(url);
      if (!res.ok) {
        const base = path.split('/').pop() ?? path;
        if (base !== 'package.json') return;
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
      // ignore parse issue, default below
    }
  }
  return { cmd: 'npm', args: ['run', 'dev'] };
}

function looksLikeDevServerReady(text: string): boolean {
  return /ready in /i.test(text) || /Local:\s+https?:\/\//i.test(text) || /VITE\s+v?\d/i.test(text);
}

async function teardownPod(pod: NodepodInstance | null): Promise<void> {
  if (!pod) return;
  try {
    await pod.teardown();
  } catch {
    // noop
  }
}

async function evictRuntimeInternal(runtimeKey: string): Promise<void> {
  const entry = nodepodRuntimeRegistry.getMutable(runtimeKey);
  if (!entry) return;
  const pod = entry.pod;
  nodepodRuntimeRegistry.delete(runtimeKey);
  sourceArgsByRuntimeKey.delete(runtimeKey);
  await teardownPod(pod);
}

async function evictOtherSessionRuntimes(sessionId: string, keepRuntimeKey: string): Promise<void> {
  const entries = nodepodRuntimeRegistry.listBySession(sessionId);
  for (const entry of entries) {
    if (entry.runtimeKey === keepRuntimeKey) continue;
    await evictRuntimeInternal(entry.runtimeKey);
  }
}

async function pruneInactiveRuntimesInternal(): Promise<void> {
  const now = Date.now();
  const allEntries = nodepodRuntimeRegistry.list();

  for (const entry of allEntries) {
    if (entry.bootPromise) continue;
    if (now - entry.lastAccessedAt > MAX_CACHE_AGE_MS) {
      await evictRuntimeInternal(entry.runtimeKey);
    }
  }

  const readyEntries = nodepodRuntimeRegistry
    .list()
    .filter((entry) => entry.status === 'ready')
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  while (readyEntries.length > MAX_ACTIVE_RUNTIMES) {
    const oldest = readyEntries.shift();
    if (!oldest) break;
    await evictRuntimeInternal(oldest.runtimeKey);
  }
}

function setRuntimePatch(runtimeKey: string, patch: Partial<NodepodRuntimeEntry>) {
  nodepodRuntimeRegistry.update(runtimeKey, (entry) => ({ ...entry, ...patch }));
}

async function bootRuntime(args: EnsureNodepodRuntimeArgs): Promise<NodepodRuntimeSnapshot> {
  const runtimeKey = createRuntimeKey(args.sessionId, args.revision);
  let pendingPort: number | null = null;
  let pendingUrl: string | null = null;
  let ready = false;
  let cancelled = false;
  let softTimer: number | undefined;
  let hardTimer: number | undefined;
  let devExited = false;

  const clearTimers = () => {
    if (softTimer !== undefined) window.clearTimeout(softTimer);
    if (hardTimer !== undefined) window.clearTimeout(hardTimer);
  };

  try {
    await evictOtherSessionRuntimes(args.sessionId, runtimeKey);
    setRuntimePatch(runtimeKey, {
      status: 'loading',
      error: null,
      previewUrl: null,
      detectedPort: null,
      files: null,
      health: null,
      lastHealthcheckAt: null,
      lastAccessedAt: Date.now(),
    });

    const projectFiles = await fetchProjectFiles(args.sessionId, args.cephPath, args.filesTree);
    setRuntimePatch(runtimeKey, { files: { ...projectFiles }, status: 'installing' });

    const pod = await Nodepod.boot({
      files: projectFiles,
      workdir: '/',
      watermark: false,
      onServerReady: (port, url) => {
        const current = nodepodRuntimeRegistry.getMutable(runtimeKey);
        if (!current || current.pod !== pod) return;
        pendingUrl = url || pod.port(port) || null;
        pendingPort = resolvePreviewPort({ previewUrl: pendingUrl, reportedPort: port }) ?? port;
        setRuntimePatch(runtimeKey, {
          previewUrl: pendingUrl,
          detectedPort: pendingPort,
        });
      },
    });

    setRuntimePatch(runtimeKey, {
      pod,
      podInstanceId: pod.instanceId,
      status: 'installing',
    });

    const install = await pod.spawn('npm', ['install']);
    const installResult = await install.completion;
    const addedPackages = parseNpmAddedPackages(installResult.stdout);
    const hasVite = await pod.fs.exists(VITE_PKG_PATH);
    const hasReact = await pod.fs.exists(REACT_PKG_PATH);
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

    const needsRolldownWasm = await ensureRolldownWasmBinding(pod);
    if (needsRolldownWasm && typeof SharedArrayBuffer === 'undefined') {
      throw new Error(
        'Vite/rolldown requires SharedArrayBuffer (COOP/COEP). Hard-refresh after confirming Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers.',
      );
    }

    setRuntimePatch(runtimeKey, { status: 'starting' });
    const { cmd, args: devArgs } = detectDevCommand(projectFiles);
    const devEnv = needsRolldownWasm
      ? { NAPI_RS_FORCE_WASI: 'true', NAPI_RS_FORCE_WASM: '1' }
      : undefined;
    const proc = await pod.spawn(cmd, devArgs, devEnv ? { env: devEnv } : undefined);

    const markReady = async (source: string) => {
      const entry = nodepodRuntimeRegistry.getMutable(runtimeKey);
      if (!entry || !entry.pod || ready) return;

      const probePort = resolvePreviewPort({
        previewUrl: pendingUrl,
        reportedPort: pendingPort,
      });
      const previewUrl = pendingUrl || (probePort != null ? pod.port(probePort) : null);
      if (!previewUrl || probePort == null) return;

      logPhase('6.promote:start', {
        runtimeKey,
        source,
        url: previewUrl,
        port: probePort,
        swController: !!navigator.serviceWorker?.controller,
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
      });

      const directOk = await waitUntilDirectServerReady(
        pod,
        probePort,
        () => cancelled,
        (details) => logPhase('6.direct-probe', details),
      );
      if (!directOk) {
        throw new Error('Dev server started but did not answer HTTP requests inside Nodepod.');
      }

      const sw = await waitUntilPreviewReachable(previewUrl, () => cancelled);
      const health = buildRuntimeHealth({
        directProbeOk: true,
        swProbeOk: sw.ok,
        detectedPort: probePort,
        previewUrl,
        bodyHint: sw.bodyHint,
        lastStatus: sw.lastStatus,
      });

      setRuntimePatch(runtimeKey, {
        health,
        lastHealthcheckAt: health.lastCheckedAt,
      });

      if (!sw.ok) {
        throw new Error(
          sw.bodyHint === 'nodepod-sw-initializing' || sw.bodyHint === 'nodepod-sw-disconnected'
            ? 'Nodepod service worker cannot reach this preview (503). Hard-refresh the page (Ctrl+Shift+R) so /__sw__.js reconnects.'
            : `Preview URL stayed unreachable (HTTP ${sw.lastStatus ?? '???'}). Check that /__sw__.js is served as JavaScript and COOP/COEP headers are present.`,
        );
      }

      ready = true;
      setRuntimePatch(runtimeKey, {
        status: 'ready',
        previewUrl,
        detectedPort: probePort,
        lastAccessedAt: Date.now(),
      });
      clearTimers();
      logPhase('runtime:ready', { runtimeKey, source, previewUrl, port: probePort });
    };

    proc.on('output', (text: string) => {
      console.log(`${LOG} [6.dev-server:stdout]`, text);
      if (!looksLikeDevServerReady(text) || ready) return;
      pendingPort = resolvePreviewPort({
        previewUrl: pendingUrl,
        reportedPort: pendingPort,
        stdoutText: text,
      });
      if (pendingPort != null && !pendingUrl) {
        pendingUrl = pod.port(pendingPort);
      }
      void markReady('stdout-ready').catch((error: Error) => {
        setRuntimePatch(runtimeKey, { status: 'error', error: error.message });
      });
    });

    proc.on('error', (text: string) => {
      console.warn(`${LOG} [6.dev-server:stderr]`, text);
    });

    proc.on('exit', (code: number) => {
      devExited = true;
      if (ready || cancelled) return;
      setRuntimePatch(runtimeKey, {
        status: 'error',
        error: `Dev server exited before becoming ready (code ${code}).`,
      });
    });

    const tryFallback = async (source: string) => {
      const candidates = [
        resolvePreviewPort({ previewUrl: pendingUrl, reportedPort: pendingPort }),
        pendingPort,
        ...PREVIEW_PORTS,
      ];
      for (const port of candidates) {
        if (port == null) continue;
        pendingPort = port;
        pendingUrl = pendingUrl || pod.port(port) || null;
        if (!pendingUrl) continue;
        try {
          await markReady(source);
          if (ready) return;
        } catch (error) {
          setRuntimePatch(runtimeKey, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (devExited && !ready) {
        setRuntimePatch(runtimeKey, {
          status: 'error',
          error: 'Dev server exited without opening a preview port.',
        });
      }
    };

    softTimer = window.setTimeout(() => {
      if (ready || cancelled) return;
      void tryFallback('soft-timeout-port');
    }, READY_SOFT_MS);

    hardTimer = window.setTimeout(() => {
      if (ready || cancelled) return;
      void tryFallback('hard-timeout-port');
    }, READY_HARD_MS);

    await new Promise<void>((resolve, reject) => {
      const interval = window.setInterval(() => {
        const current = nodepodRuntimeRegistry.getMutable(runtimeKey);
        if (!current) {
          window.clearInterval(interval);
          reject(new Error('Runtime disappeared while booting.'));
          return;
        }
        if (current.status === 'ready') {
          window.clearInterval(interval);
          resolve();
          return;
        }
        if (current.status === 'error') {
          window.clearInterval(interval);
          reject(new Error(current.error ?? 'Unknown Nodepod error.'));
        }
      }, 100);
    });

    const snapshot = nodepodRuntimeRegistry.get(runtimeKey);
    if (!snapshot) throw new Error('Runtime disappeared after boot.');
    return nodepodRuntimeRegistry.toSnapshot(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRuntimePatch(runtimeKey, { status: 'error', error: message });
    const pod = nodepodRuntimeRegistry.getMutable(runtimeKey)?.pod ?? null;
    await teardownPod(pod);
    setRuntimePatch(runtimeKey, { pod: null, podInstanceId: null });
    throw error;
  } finally {
    cancelled = true;
    clearTimers();
    const mutable = nodepodRuntimeRegistry.getMutable(runtimeKey);
    if (mutable) mutable.bootPromise = null;
    await pruneInactiveRuntimesInternal();
  }
}

export class NodepodRuntimeManager {
  ensureRuntime(args: EnsureNodepodRuntimeArgs): Promise<NodepodRuntimeSnapshot> {
    const runtimeKey = createRuntimeKey(args.sessionId, args.revision);
    sourceArgsByRuntimeKey.set(runtimeKey, { ...args });

    const existing = nodepodRuntimeRegistry.getMutable(runtimeKey);
    if (existing?.status === 'ready' && existing.previewUrl) {
      existing.lastAccessedAt = Date.now();
      return Promise.resolve(nodepodRuntimeRegistry.toSnapshot(existing));
    }
    if (existing?.bootPromise) {
      existing.lastAccessedAt = Date.now();
      return existing.bootPromise.then((entry) => nodepodRuntimeRegistry.toSnapshot(entry));
    }

    const entry = existing ?? createEntry(args);
    nodepodRuntimeRegistry.set(entry);

    const bootPromise = bootRuntime(args).then(() => {
      const current = nodepodRuntimeRegistry.getMutable(runtimeKey);
      if (!current) throw new Error('Runtime not found after boot.');
      return current;
    });

    setRuntimePatch(runtimeKey, { bootPromise });
    return bootPromise.then((current) => nodepodRuntimeRegistry.toSnapshot(current));
  }

  getRuntime(runtimeKey: string): NodepodRuntimeSnapshot | null {
    return nodepodRuntimeRegistry.getSnapshot(runtimeKey);
  }

  markAccessed(runtimeKey: string): void {
    nodepodRuntimeRegistry.touch(runtimeKey);
  }

  async retryRuntime(runtimeKey: string): Promise<NodepodRuntimeSnapshot> {
    const sourceArgs = sourceArgsByRuntimeKey.get(runtimeKey);
    if (!sourceArgs) throw new Error('Runtime source arguments are unavailable for retry.');
    await evictRuntimeInternal(runtimeKey);
    return this.ensureRuntime(sourceArgs);
  }

  async evictRuntime(runtimeKey: string): Promise<void> {
    await evictRuntimeInternal(runtimeKey);
  }

  async evictSessionRuntimes(sessionId: string, keepRuntimeKey?: string): Promise<void> {
    const entries = nodepodRuntimeRegistry.listBySession(sessionId);
    for (const entry of entries) {
      if (entry.runtimeKey === keepRuntimeKey) continue;
      await evictRuntimeInternal(entry.runtimeKey);
    }
  }

  async pruneInactiveRuntimes(): Promise<void> {
    await pruneInactiveRuntimesInternal();
  }
}

export const nodepodRuntimeManager = new NodepodRuntimeManager();
