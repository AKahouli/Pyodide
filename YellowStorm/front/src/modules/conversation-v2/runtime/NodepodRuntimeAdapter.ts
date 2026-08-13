import { Nodepod } from '@scelar/nodepod';
import { parseNpmAddedPackages } from '../utils/npm-install-output';
import {
  resolvePreviewPort,
  looksLikeDevServerReady,
  PREVIEW_PORTS,
  PreviewController,
} from './PreviewController';
import type { VfsFiles } from './RevisionHydrator';
import type { FileEntry } from './runtime.types';
import { sha256 } from './hashing';
import { toVfsPath } from './paths';
import {
  IGNORED_DIRS,
  RUN_OUTPUT_MAX_BYTES,
  RUN_TIMEOUT_DEFAULT,
  boundOutput,
} from './limits';

const LOG = '[NodepodAdapter]';

type NodepodInstance = Awaited<ReturnType<typeof Nodepod.boot>>;

const VITE_PKG_PATH = '/node_modules/vite';
const REACT_PKG_PATH = '/node_modules/react';
const ROLLDOWN_PKG_PATH = '/node_modules/rolldown';
const ROLLDOWN_WASM_PATH = '/node_modules/@rolldown/binding-wasm32-wasi';
const READY_SOFT_MS = 20_000;
const READY_HARD_MS = 90_000;
const MAX_CACHE_AGE_MS = 10 * 60 * 1000;

function log(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`${LOG} [${phase}]`, details);
  } else {
    console.log(`${LOG} [${phase}]`);
  }
}

// ---------------------------------------------------------------------------
// Module-level pod cache
// ---------------------------------------------------------------------------

interface PodCacheEntry {
  pod: NodepodInstance;
  previewUrl: string | null;
  files: VfsFiles | null;
  alive: boolean;
  lastAccessed: number;
  /** Manifest fingerprint at the time `node_modules` was last installed. */
  installFingerprint: string | null;
}

const podCache = new Map<string, PodCacheEntry>();

function cacheKey(sessionId: string, revision: string) {
  return `${sessionId}:${revision}`;
}

export function invalidateSession(sessionId: string): void {
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

async function readPackageVersion(pod: NodepodInstance, pkgJsonPath: string): Promise<string | null> {
  try {
    const raw = await pod.fs.readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function detectDevCommand(files: VfsFiles): { cmd: string; args: string[] } {
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

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface SpawnOpts {
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  onOutput?: (chunk: string, stream: 'stdout' | 'stderr') => void;
}

/** Thrown when a spawn exceeds its deadline; maps to `TOOL_TIMEOUT`. */
export class SpawnTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Command timed out after ${timeoutMs}ms`);
    this.name = 'SpawnTimeoutError';
  }
}

export type ProgressCallback = (phase: string, message: string) => void;

/** Lockfiles that, together with package.json, define the dependency set. */
const LOCKFILES = ['/package-lock.json', '/pnpm-lock.yaml', '/yarn.lock'];

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class NodepodRuntimeAdapter {
  private pod: NodepodInstance | null = null;
  private sessionId: string | null = null;
  private revision: string = 'rev_0';
  private _files: VfsFiles | null = null;
  private lastInstallFingerprint: string | null = null;

  get currentPod(): NodepodInstance | null {
    return this.pod;
  }

  get files(): VfsFiles | null {
    return this._files;
  }

  /**
   * Try restoring a cached pod.  Returns true if hit.
   */
  restoreFromCache(sessionId: string, revision: string): boolean {
    cleanupStaleEntries();
    const key = cacheKey(sessionId, revision);
    const entry = podCache.get(key);
    if (entry?.alive && entry.pod) {
      log('cache-hit', { key });
      this.pod = entry.pod;
      this._files = entry.files;
      this.sessionId = sessionId;
      this.revision = revision;
      this.lastInstallFingerprint = entry.installFingerprint;
      entry.lastAccessed = Date.now();
      return true;
    }
    return false;
  }

  async boot(
    files: VfsFiles,
    sessionId: string,
    revision: string,
    onServerReady?: (port: number, url: string | null) => void,
  ): Promise<void> {
    if (this.sessionId) invalidateSession(this.sessionId);
    this.sessionId = sessionId;
    this.revision = revision;
    this._files = files;

    log('boot:start', { fileCount: Object.keys(files).length });
    const pod = await Nodepod.boot({
      files,
      workdir: '/',
      watermark: false,
      onServerReady: (port: number, url: string) => {
        log('server-ready', { port, url });
        onServerReady?.(port, url);
      },
    });
    log('boot:done');
    this.pod = pod;

    const key = cacheKey(sessionId, revision);
    podCache.set(key, {
      pod,
      previewUrl: null,
      files,
      alive: true,
      lastAccessed: Date.now(),
      installFingerprint: null,
    });
  }

  // ---------------------------------------------------------------------------
  // Dependency install policy (MVP 10.3)
  // ---------------------------------------------------------------------------

  /**
   * Fingerprint of the dependency manifest set. Any change to package.json or a
   * lockfile invalidates the installed `node_modules`.
   */
  async installFingerprint(): Promise<string> {
    const pod = this.requirePod();
    const parts: string[] = [];
    for (const file of ['/package.json', ...LOCKFILES]) {
      try {
        if (!(await pod.fs.exists(file))) continue;
        parts.push(`${file}:${await pod.fs.readFile(file, 'utf-8')}`);
      } catch {
        // Unreadable manifest — treat as absent rather than failing the boot.
      }
    }
    return sha256(parts.join('\n\u0000\n'));
  }

  /**
   * Force the next `ensureDeps` to reinstall. Called when a `run` tool mutates
   * the dependency set (npm install / pnpm add / ...).
   */
  markDepsDirty(): void {
    this.lastInstallFingerprint = null;
    this.updateCacheFingerprint(null);
  }

  /**
   * Install dependencies only when they are actually stale: first boot, a
   * changed manifest fingerprint, or an explicit `force`.
   */
  async ensureDeps(
    opts: { force?: boolean; onProgress?: ProgressCallback } = {},
  ): Promise<{ installed: boolean }> {
    const pod = this.requirePod();
    const fingerprint = await this.installFingerprint();
    const hasModules = await pod.fs.exists('/node_modules');

    if (!opts.force && hasModules && fingerprint === this.lastInstallFingerprint) {
      log('npm-install:skip', { reason: 'fingerprint-unchanged' });
      return { installed: false };
    }

    await this.installDeps(opts.onProgress);
    this.lastInstallFingerprint = fingerprint;
    this.updateCacheFingerprint(fingerprint);
    return { installed: true };
  }

  async installDeps(onProgress?: ProgressCallback): Promise<void> {
    const pod = this.requirePod();
    log('npm-install:start');
    onProgress?.('installing', 'npm install');
    const install = await pod.spawn('npm', ['install']);
    install.on('output', (text: string) => console.log(`${LOG} [npm:stdout]`, text));
    install.on('error', (text: string) => console.warn(`${LOG} [npm:stderr]`, text));
    const result = await install.completion;
    const addedPackages = parseNpmAddedPackages(result.stdout);
    const hasVite = await pod.fs.exists(VITE_PKG_PATH);
    const hasReact = await pod.fs.exists(REACT_PKG_PATH);
    log('npm-install:verify', { exitCode: result.exitCode, addedPackages, hasVite, hasReact });

    if (result.exitCode !== 0) {
      throw new Error(`npm install failed (exit ${result.exitCode}).`);
    }
    if (!hasVite && !hasReact) {
      throw new Error(
        addedPackages === 0
          ? 'npm install added 0 packages and node_modules/vite (or react) is missing.'
          : 'node_modules/vite (or react) is missing after npm install.',
      );
    }

    await this.ensureRolldownWasi();
    log('npm-install:done');
  }

  private async ensureRolldownWasi(): Promise<boolean> {
    const pod = this.requirePod();
    const hasRolldown = await pod.fs.exists(ROLLDOWN_PKG_PATH);
    if (!hasRolldown) return false;
    const already = await pod.fs.exists(ROLLDOWN_WASM_PATH);
    if (already) return true;
    const version = (await readPackageVersion(pod, `${ROLLDOWN_PKG_PATH}/package.json`)) ?? 'latest';
    const spec = `@rolldown/binding-wasm32-wasi@${version}`;
    log('rolldown-wasm:install', { spec });
    const install = await pod.spawn('npm', ['install', spec, '--no-save', '--cpu=wasm32']);
    install.on('output', (text: string) => console.log(`${LOG} [rolldown:stdout]`, text));
    install.on('error', (text: string) => console.warn(`${LOG} [rolldown:stderr]`, text));
    const result = await install.completion;
    const present = await pod.fs.exists(ROLLDOWN_WASM_PATH);
    if (result.exitCode !== 0 || !present) {
      throw new Error(`Failed to install ${spec} for Nodepod.`);
    }
    if (typeof SharedArrayBuffer === 'undefined') {
      throw new Error('Vite/rolldown requires SharedArrayBuffer (COOP/COEP).');
    }
    return true;
  }

  /**
   * Start the dev server and wait for it to become ready.
   * Returns the preview URL once probed, or null on timeout.
   */
  async startDevServer(
    previewCtrl: PreviewController,
    isStale: () => boolean,
    onProgress?: ProgressCallback,
  ): Promise<string | null> {
    const pod = this.requirePod();
    const files = this._files ?? {};
    const { cmd, args } = detectDevCommand(files);
    const needsWasi = await pod.fs.exists(ROLLDOWN_WASM_PATH);
    const devEnv = needsWasi ? { NAPI_RS_FORCE_WASI: 'true', NAPI_RS_FORCE_WASM: '1' } : undefined;
    log('dev-server:spawn', { cmd, args, env: devEnv ?? null });
    onProgress?.('starting', `${cmd} ${args.join(' ')}`);

    let pendingPort: number | null = null;
    let pendingUrl: string | null = null;
    let devExited = false;
    let resolved = false;

    return new Promise<string | null>((resolve) => {
      const finish = (url: string | null) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(softTimer);
        clearTimeout(hardTimer);
        if (url) {
          previewCtrl.setPreview(url, pendingPort ?? 5173);
          this.updateCachePreview(url);
        }
        resolve(url);
      };

      const tryProbe = async (url: string, port: number, source: string) => {
        if (resolved || isStale()) return;
        log('promote:start', { source, url, port });
        const result = await previewCtrl.probeAndPromote(pod, url, port, isStale);
        if (result.ok) {
          finish(previewCtrl.previewUrl);
        } else if (result.error) {
          finish(null);
        }
      };

      const tryFallbackPorts = (): { url: string; port: number } | null => {
        const candidates = [
          resolvePreviewPort({ previewUrl: pendingUrl, reportedPort: pendingPort }),
          pendingPort,
          ...PREVIEW_PORTS,
        ];
        for (const port of candidates) {
          if (port == null) continue;
          const url = pod.port(port);
          if (url) return { url, port };
        }
        return pendingUrl && pendingPort != null ? { url: pendingUrl, port: pendingPort } : null;
      };

      void (async () => {
        const proc = await pod.spawn(cmd, args, devEnv ? { env: devEnv } : undefined);
        proc.on('output', (text: string) => {
          console.log(`${LOG} [dev:stdout]`, text);
          if (!resolved && !isStale() && looksLikeDevServerReady(text)) {
            const port = resolvePreviewPort({
              previewUrl: pendingUrl,
              reportedPort: pendingPort ?? 5173,
              stdoutText: text,
            }) ?? 5173;
            const url = pendingUrl || pod.port(port) || PREVIEW_PORTS.map((p) => pod.port(p)).find(Boolean) || null;
            if (url) void tryProbe(url, port, 'stdout-ready');
          }
        });
        proc.on('error', (text: string) => console.warn(`${LOG} [dev:stderr]`, text));
        proc.on('exit', (code: number) => {
          devExited = true;
          log('dev-server:exit', { code });
          if (!resolved) finish(null);
        });

        // Capture onServerReady port
        // (already set by boot's onServerReady → stored in pendingPort/pendingUrl above)
        // We need a bridge; the onServerReady from boot() should set pendingPort/pendingUrl
        // that we reference here. Since boot() already fired before startDevServer,
        // the consumer must wire them together via the host.
      })();

      const softTimer = setTimeout(() => {
        if (resolved || isStale()) return;
        const fallback = tryFallbackPorts();
        if (fallback) {
          void tryProbe(fallback.url, fallback.port, 'soft-timeout');
        } else if (devExited) {
          finish(null);
        }
      }, READY_SOFT_MS);

      const hardTimer = setTimeout(() => {
        if (resolved || isStale()) return;
        const fallback = tryFallbackPorts();
        if (fallback) {
          void tryProbe(fallback.url, fallback.port, 'hard-timeout');
        } else {
          finish(null);
        }
      }, READY_HARD_MS);
    });
  }

  private updateCachePreview(url: string): void {
    if (!this.sessionId) return;
    const key = cacheKey(this.sessionId, this.revision);
    const entry = podCache.get(key);
    if (entry) entry.previewUrl = url;
  }

  private updateCacheFingerprint(fingerprint: string | null): void {
    if (!this.sessionId) return;
    const entry = podCache.get(cacheKey(this.sessionId, this.revision));
    if (entry) entry.installFingerprint = fingerprint;
  }

  // ---------------------------------------------------------------------------
  // Filesystem API — used by RuntimeToolHandlers
  // ---------------------------------------------------------------------------

  async readFile(path: string): Promise<string> {
    return this.requirePod().fs.readFile(path, 'utf-8');
  }

  async exists(path: string): Promise<boolean> {
    return this.requirePod().fs.exists(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const pod = this.requirePod();
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir && dir !== '/') {
      try { await pod.fs.mkdir(dir, { recursive: true }); } catch { /* exists */ }
    }
    await pod.fs.writeFile(path, content);
  }

  async deleteFile(path: string): Promise<void> {
    await this.requirePod().fs.unlink(path);
  }

  /** Absolute VFS paths of every non-ignored file under `path`. */
  async listFiles(path = '/'): Promise<string[]> {
    const pod = this.requirePod();
    const entries: string[] = [];
    const walk = async (dir: string) => {
      const items = await pod.fs.readdir(dir);
      for (const item of items) {
        if (typeof item !== 'string') continue;
        const full = dir === '/' ? `/${item}` : `${dir}/${item}`;
        try {
          const stat = await pod.fs.stat(full);
          if (stat.isDirectory) {
            if (!IGNORED_DIRS.has(item)) await walk(full);
          } else {
            entries.push(full);
          }
        } catch {
          entries.push(full);
        }
      }
    };
    await walk(path);
    return entries;
  }

  /**
   * Contract-shaped directory listing for the `list` tool. `name` is relative
   * to `relativeRoot`; entries deeper than `depth` levels are omitted (their
   * ancestor directory is still reported).
   */
  async listEntries(relativeRoot: string, depth: number): Promise<FileEntry[]> {
    const pod = this.requirePod();
    const root = toVfsPath(relativeRoot);
    const results: FileEntry[] = [];

    const walk = async (dir: string, prefix: string, level: number) => {
      let items: string[];
      try {
        items = await pod.fs.readdir(dir);
      } catch {
        return;
      }
      for (const item of items) {
        if (typeof item !== 'string' || IGNORED_DIRS.has(item)) continue;
        const full = dir === '/' ? `/${item}` : `${dir}/${item}`;
        const name = prefix ? `${prefix}/${item}` : item;
        let stat;
        try {
          stat = await pod.fs.stat(full);
        } catch {
          continue;
        }
        if (stat.isDirectory) {
          results.push({ name, type: 'dir', size: 0, sha256: null });
          if (level < depth) await walk(full, name, level + 1);
        } else {
          let hash: string | null = null;
          try {
            hash = await sha256(await pod.fs.readFile(full, 'utf-8'));
          } catch {
            // Binary or unreadable file — the entry still exists, just unhashed.
          }
          results.push({ name, type: 'file', size: stat.size, sha256: hash });
        }
      }
    };

    await walk(root, '', 1);
    // Directories first, then lexicographic — matches the reference adapter.
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return results;
  }

  /** Path -> sha256 over the whole workspace, used to commit a revision. */
  async shaManifest(): Promise<Map<string, string>> {
    const manifest = new Map<string, string>();
    for (const full of await this.listFiles('/')) {
      try {
        manifest.set(full.replace(/^\//, ''), await sha256(await this.readFile(full)));
      } catch {
        // Binary files are excluded from revision manifests.
      }
    }
    return manifest;
  }

  /**
   * Run a command to completion. Output is bounded (tail-kept) and the process
   * is killed — not merely abandoned — when the deadline expires.
   *
   * @throws SpawnTimeoutError on deadline expiry
   */
  async spawn(cmd: string, args: string[], opts: SpawnOpts = {}): Promise<SpawnResult> {
    const pod = this.requirePod();
    const maxBytes = opts.maxOutputBytes ?? RUN_OUTPUT_MAX_BYTES;
    const timeoutMs = opts.timeoutMs ?? RUN_TIMEOUT_DEFAULT;

    const spawnOpts: { env?: Record<string, string>; cwd?: string } = {};
    if (opts.env) spawnOpts.env = opts.env;
    if (opts.cwd) spawnOpts.cwd = opts.cwd;

    const proc = await pod.spawn(cmd, args, spawnOpts);

    let stdout = '';
    let stderr = '';
    let truncated = false;
    // Trim as we go so a runaway build cannot pin megabytes of string per chunk.
    proc.on('output', (text: string) => {
      const bounded = boundOutput(stdout + text, maxBytes);
      stdout = bounded.text;
      truncated ||= bounded.truncated;
      opts.onOutput?.(text, 'stdout');
    });
    proc.on('error', (text: string) => {
      const bounded = boundOutput(stderr + text, maxBytes);
      stderr = bounded.text;
      truncated ||= bounded.truncated;
      opts.onOutput?.(text, 'stderr');
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        proc.completion,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            try {
              proc.kill();
            } catch {
              // Already exited between the deadline and the kill.
            }
            reject(new SpawnTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);

      // Fall back to the completion payload when no stream events fired.
      const boundedOut = boundOutput(stdout || result.stdout || '', maxBytes);
      const boundedErr = boundOutput(stderr || result.stderr || '', maxBytes);
      return {
        exitCode: result.exitCode,
        stdout: boundedOut.text,
        stderr: boundedErr.text,
        truncated: truncated || boundedOut.truncated || boundedErr.truncated,
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  teardown(): void {
    if (!this.pod) return;
    log('teardown:start');
    try {
      // Nodepod.teardown() is synchronous.
      this.pod.teardown();
    } catch (err) {
      log('teardown:error', { error: err instanceof Error ? err.message : String(err) });
    }
    this.pod = null;
    this.lastInstallFingerprint = null;
  }

  private requirePod(): NodepodInstance {
    if (!this.pod) throw new Error('Nodepod not booted');
    return this.pod;
  }
}
