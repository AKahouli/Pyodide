import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dispatchTool, MUTATING_TOOLS, buildFileTree, type ToolContext } from '../RuntimeToolHandlers';
import { WorkspaceRevisionStore } from '../WorkspaceRevisionStore';
import { SpawnTimeoutError, type SpawnResult } from '../NodepodRuntimeAdapter';
import type { NodepodRuntimeAdapter } from '../NodepodRuntimeAdapter';
import type { PreviewController } from '../PreviewController';
import { ToolError } from '../ToolError';
import { sha256 } from '../hashing';
import { RuntimeErrorCodes, type FileEntry, type FinalizeResult } from '../runtime.types';
import { MAX_FILE_SIZE, SEARCH_EXCERPT_CHARS } from '../limits';
import { conversationV2Api } from '../../api';

vi.mock('../../api', () => ({
  conversationV2Api: {
    commitWorkspaceRevision: vi.fn().mockResolvedValue({
      revisionId: 'rev_1',
      parentRevisionId: 'rev_0',
      manifestObjectKey: 'appbuilder/manifests/ws-1/rev_1.json',
      fileCount: 1,
    }),
  },
}));

const PACKAGE_JSON = '{\n  "name": "app"\n}\n';
const APP_TSX = ['import React from "react";', '', 'export const answer = 41;', ''].join('\n');

/** In-memory stand-in for the Nodepod adapter, keyed by absolute VFS path. */
function makeAdapter(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const markDepsDirty = vi.fn();
  const spawn = vi.fn<(cmd: string, args: string[], opts?: unknown) => Promise<SpawnResult>>(
    async () => ({ exitCode: 0, stdout: 'ok', stderr: '', truncated: false }),
  );

  const adapter = {
    files,
    markDepsDirty,
    spawn,
    startDevServer: vi.fn(async () => 'http://localhost/__virtual__/pod-1/5173/'),
    currentPod: { instanceId: 'pod-1' },

    async exists(path: string) {
      return files.has(path);
    },
    async readFile(path: string) {
      const found = files.get(path);
      if (found === undefined) throw new Error(`ENOENT: ${path}`);
      return found;
    },
    async writeFile(path: string, content: string) {
      files.set(path, content);
    },
    async deleteFile(path: string) {
      files.delete(path);
    },
    async listFiles(root = '/') {
      const prefix = root === '/' ? '/' : `${root}/`;
      return [...files.keys()].filter((p) => p.startsWith(prefix)).sort();
    },
    async listEntries(relativeRoot: string, depth: number): Promise<FileEntry[]> {
      const prefix = relativeRoot === '.' ? '' : `${relativeRoot}/`;
      const entries: FileEntry[] = [];
      const dirs = new Set<string>();
      for (const [full, content] of files) {
        const relative = full.replace(/^\//, '');
        if (prefix && !relative.startsWith(prefix)) continue;
        const rest = relative.slice(prefix.length);
        const parts = rest.split('/');
        if (parts.length > depth) {
          dirs.add(parts.slice(0, depth).join('/'));
        } else if (parts.length > 1) {
          dirs.add(parts[0]);
        } else {
          entries.push({
            name: rest,
            type: 'file',
            size: content.length,
            sha256: await sha256(content),
          });
        }
      }
      for (const name of dirs) entries.push({ name, type: 'dir', size: 0, sha256: null });
      entries.sort((a, b) =>
        a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name),
      );
      return entries;
    },
    async shaManifest() {
      const manifest = new Map<string, string>();
      for (const [full, content] of files) {
        manifest.set(full.replace(/^\//, ''), await sha256(content));
      }
      return manifest;
    },
    refreshFileCache: vi.fn(async () => {
      const snapshot: Record<string, string> = {};
      for (const [path, content] of files) snapshot[path] = content;
      return snapshot;
    }),
  };

  return adapter as unknown as NodepodRuntimeAdapter & typeof adapter;
}

function makePreviewCtrl() {
  return {
    previewUrl: 'http://localhost/__virtual__/pod-1/5173/',
    port: 5173,
    isInspectorAttached: vi.fn().mockReturnValue(true),
    getCachedHealthyInspect: vi.fn().mockReturnValue(null),
    inspectPreview: vi.fn().mockResolvedValue({
      url: 'http://localhost/__virtual__/pod-1/5173/',
      title: 'App',
      visibleText: 'Hello',
      domSummary: [{ tag: 'h1', text: 'Hello' }],
      console: [],
      runtimeErrors: [],
      screenshotArtifactId: null,
      capabilities: { screenshot: false, interaction: true },
    }),
    performAction: vi.fn().mockResolvedValue({ ok: true, action: 'click' }),
  } as unknown as PreviewController & {
    inspectPreview: ReturnType<typeof vi.fn>;
    performAction: ReturnType<typeof vi.fn>;
  };
}

async function makeContext(initial: Record<string, string> = {}) {
  const adapter = makeAdapter(initial);
  const previewCtrl = makePreviewCtrl();
  const revisions = new WorkspaceRevisionStore(await adapter.shaManifest());
  const onProgress = vi.fn();
  const ctx: ToolContext = {
    adapter,
    previewCtrl,
    revisions,
    workspaceId: 'ws-1',
    sessionId: 'sess-1',
    onProgress,
  };
  return { ctx, adapter, previewCtrl, revisions, onProgress };
}

async function expectToolError(promise: Promise<unknown>, code: number): Promise<ToolError> {
  const err = await promise.then(
    () => {
      throw new Error('expected a ToolError');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ToolError);
  expect((err as ToolError).code).toBe(code);
  return err as ToolError;
}

const BASE_FILES = {
  '/package.json': PACKAGE_JSON,
  '/src/App.tsx': APP_TSX,
  '/src/components/Button.tsx': 'export const Button = () => null;\n',
};

describe('dispatchTool', () => {
  it('rejects an unknown tool with METHOD_NOT_FOUND', async () => {
    const { ctx } = await makeContext();
    const err = await expectToolError(
      dispatchTool('nope', {}, ctx),
      RuntimeErrorCodes.METHOD_NOT_FOUND,
    );
    expect(err.data).toEqual({ tool: 'nope' });
  });

  it('marks exactly write/apply_patch/delete as mutating', () => {
    expect([...MUTATING_TOOLS].sort()).toEqual(['apply_patch', 'delete', 'write']);
  });

  it.each(['read', 'search', 'write', 'apply_patch', 'delete', 'run'])(
    'validates paths for %s',
    async (tool) => {
      const { ctx } = await makeContext(BASE_FILES);
      const args: Record<string, unknown> =
        tool === 'search'
          ? { query: 'x', path: '../escape' }
          : tool === 'run'
            ? { command: 'ls', cwd: '../escape' }
            : { path: '../escape', content: '', patch: 'p', expectedSha256: 'x' };
      await expectToolError(dispatchTool(tool, args, ctx), RuntimeErrorCodes.SECURITY_DENIED);
    },
  );
});

describe('list', () => {
  it('returns { path, entries } with FileEntry records', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('list', {}, ctx);

    expect(Object.keys(result).sort()).toEqual(['entries', 'path']);
    expect(result.path).toBe('.');
    const entries = result.entries as FileEntry[];
    expect(entries.every((e) => Object.keys(e).sort().join() === 'name,sha256,size,type')).toBe(
      true,
    );
    expect(entries[0].type).toBe('dir');
  });

  it('clamps depth into 1..10', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    const spy = vi.spyOn(adapter, 'listEntries');

    await dispatchTool('list', { depth: 99 }, ctx);
    expect(spy).toHaveBeenLastCalledWith('.', 10);

    await dispatchTool('list', { depth: 0 }, ctx);
    expect(spy).toHaveBeenLastCalledWith('.', 1);

    await dispatchTool('list', {}, ctx);
    expect(spy).toHaveBeenLastCalledWith('.', 2);
  });

  it('allows "." without path validation but still rejects absolute paths', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expect(dispatchTool('list', { path: '.' }, ctx)).resolves.toBeDefined();
    await expectToolError(
      dispatchTool('list', { path: '/etc' }, ctx),
      RuntimeErrorCodes.SECURITY_DENIED,
    );
  });
});

describe('read', () => {
  it('returns the exact contract keys', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('read', { path: 'src/App.tsx' }, ctx);

    expect(Object.keys(result).sort()).toEqual([
      'content',
      'lineCount',
      'path',
      'sha256',
      'truncated',
    ]);
    expect(result.content).toBe(APP_TSX);
    expect(result.sha256).toBe(await sha256(APP_TSX));
    expect(result.lineCount).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it('returns a placeholder instead of an error for a missing file', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('read', { path: 'src/Missing.tsx' }, ctx);
    expect(result).toEqual({
      path: 'src/Missing.tsx',
      content: '// File not found: src/Missing.tsx\n',
      sha256: '',
      lineCount: 0,
      truncated: false,
    });
  });

  it('slices with 1-based inclusive line bounds and reports truncation', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'read',
      { path: 'src/App.tsx', startLine: 3, endLine: 3 },
      ctx,
    );
    expect(result.content).toBe('export const answer = 41;');
    expect(result.lineCount).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('rejects endLine < startLine with INVALID_PARAMS', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('read', { path: 'src/App.tsx', startLine: 3, endLine: 1 }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });
});

describe('search', () => {
  it('returns { query, matches } with excerpt-shaped matches', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('search', { query: 'answer' }, ctx);

    expect(Object.keys(result).sort()).toEqual(['matches', 'query']);
    const matches = result.matches as Array<Record<string, unknown>>;
    expect(matches).toHaveLength(1);
    expect(Object.keys(matches[0]).sort()).toEqual(['excerpt', 'line', 'path', 'sha256']);
    expect(matches[0]).toMatchObject({
      path: 'src/App.tsx',
      line: 3,
      excerpt: 'export const answer = 41;',
    });
  });

  it('matches case-insensitively', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('search', { query: 'ANSWER' }, ctx);
    expect((result.matches as unknown[]).length).toBe(1);
  });

  it('caps the excerpt at 200 characters', async () => {
    const { ctx } = await makeContext({ '/long.txt': `   ${'x'.repeat(500)}   ` });
    const result = await dispatchTool('search', { query: 'xxx' }, ctx);
    const [match] = result.matches as Array<{ excerpt: string }>;
    expect(match.excerpt).toHaveLength(SEARCH_EXCERPT_CHARS);
  });

  it('honours maxResults', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `hit ${i}`).join('\n');
    const { ctx } = await makeContext({ '/many.txt': lines });
    const result = await dispatchTool('search', { query: 'hit', maxResults: 5 }, ctx);
    expect((result.matches as unknown[]).length).toBe(5);
  });

  it('scopes to a sub-path', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'search',
      { query: 'export', path: 'src/components' },
      ctx,
    );
    const matches = result.matches as Array<{ path: string }>;
    expect(matches.map((m) => m.path)).toEqual(['src/components/Button.tsx']);
  });
});

describe('write', () => {
  it('creates a file and mints a revision', async () => {
    const { ctx, revisions } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'write',
      { path: 'src/New.tsx', content: 'hello', create: true },
      ctx,
    );

    expect(Object.keys(result).sort()).toEqual([
      'created',
      'newSha256',
      'path',
      'previousSha256',
      'revisionId',
    ]);
    expect(result).toMatchObject({
      path: 'src/New.tsx',
      previousSha256: null,
      created: true,
      newSha256: await sha256('hello'),
    });
    expect(result.revisionId).toBe('rev_2');
    expect(revisions.latestRevisionId).toBe('rev_2');
  });

  it('overwrites when expectedSha256 matches', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'write',
      { path: 'src/App.tsx', content: 'new', expectedSha256: await sha256(APP_TSX) },
      ctx,
    );
    expect(result.created).toBe(false);
    expect(result.previousSha256).toBe(await sha256(APP_TSX));
  });

  it('raises REVISION_CONFLICT on a sha mismatch', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const err = await expectToolError(
      dispatchTool(
        'write',
        { path: 'src/App.tsx', content: 'new', expectedSha256: 'stale' },
        ctx,
      ),
      RuntimeErrorCodes.REVISION_CONFLICT,
    );
    expect(err.data).toMatchObject({
      path: 'src/App.tsx',
      expectedSha256: 'stale',
      actualSha256: await sha256(APP_TSX),
    });
  });

  it('refuses a new file without create or expectedSha256', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('write', { path: 'src/New.tsx', content: 'x' }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });

  it('rejects content beyond the 5 MiB cap', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool(
        'write',
        { path: 'big.txt', content: 'x'.repeat(MAX_FILE_SIZE + 1), create: true },
        ctx,
      ),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });

  it('omits binary files from the persisted revision snapshot', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await adapter.writeFile('/public/hero.png', 'not-a-real-png');
    await dispatchTool('write', { path: 'src/New.tsx', content: 'x', create: true }, ctx);
    const body = vi.mocked(conversationV2Api.commitWorkspaceRevision).mock.calls.at(-1)?.[1] as {
      files: Array<{ path: string }>;
    };
    expect(body.files.some((file) => file.path.endsWith('.png'))).toBe(false);
    expect(body.files.some((file) => file.path === 'src/New.tsx')).toBe(true);
  });

  it('rolls back the local revision when Ceph persist fails', async () => {
    vi.mocked(conversationV2Api.commitWorkspaceRevision).mockRejectedValueOnce(new Error('413'));
    const { ctx, revisions } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('write', { path: 'src/New.tsx', content: 'x', create: true }, ctx),
      RuntimeErrorCodes.INTERNAL_ERROR,
    );
    expect(revisions.latestRevisionId).toBe('rev_1');
  });

  it('invalidates the install fingerprint when package.json changes', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await dispatchTool(
      'write',
      { path: 'package.json', content: '{}', expectedSha256: await sha256(PACKAGE_JSON) },
      ctx,
    );
    expect(adapter.markDepsDirty).toHaveBeenCalled();
  });
});

describe('apply_patch', () => {
  const patch = [
    '--- a/src/App.tsx',
    '+++ b/src/App.tsx',
    '@@ -1,4 +1,4 @@',
    ' import React from "react";',
    ' ',
    '-export const answer = 41;',
    '+export const answer = 42;',
    ' ',
    '',
  ].join('\n');

  it('applies the patch and returns the contract keys', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'apply_patch',
      { path: 'src/App.tsx', patch, expectedSha256: await sha256(APP_TSX) },
      ctx,
    );

    expect(Object.keys(result).sort()).toEqual([
      'diff',
      'newSha256',
      'path',
      'previousSha256',
      'revisionId',
    ]);
    expect(adapter.files.get('/src/App.tsx')).toContain('answer = 42');
    expect(result.revisionId).toBe('rev_2');
    expect(result.diff).toContain('+++ b/src/App.tsx');
  });

  it('requires expectedSha256', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('apply_patch', { path: 'src/App.tsx', patch }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });

  it('raises REVISION_CONFLICT on a stale sha', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool(
        'apply_patch',
        { path: 'src/App.tsx', patch, expectedSha256: 'stale' },
        ctx,
      ),
      RuntimeErrorCodes.REVISION_CONFLICT,
    );
  });

  it('raises INVALID_PARAMS when the patch does not apply', async () => {
    const { ctx } = await makeContext({ '/src/App.tsx': 'totally different\n' });
    await expectToolError(
      dispatchTool(
        'apply_patch',
        {
          path: 'src/App.tsx',
          patch,
          expectedSha256: await sha256('totally different\n'),
        },
        ctx,
      ),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });

  it('raises INVALID_PARAMS for a missing file', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool(
        'apply_patch',
        { path: 'src/Missing.tsx', patch, expectedSha256: 'x' },
        ctx,
      ),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });
});

describe('delete', () => {
  it('deletes and returns { revisionId, path, deletedSha256 }', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    const result = await dispatchTool('delete', { path: 'src/App.tsx' }, ctx);

    expect(Object.keys(result).sort()).toEqual(['deletedSha256', 'path', 'revisionId']);
    expect(result.deletedSha256).toBe(await sha256(APP_TSX));
    expect(result.revisionId).toBe('rev_2');
    expect(adapter.files.has('/src/App.tsx')).toBe(false);
  });

  it('raises REVISION_CONFLICT on a stale sha', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('delete', { path: 'src/App.tsx', expectedSha256: 'stale' }, ctx),
      RuntimeErrorCodes.REVISION_CONFLICT,
    );
  });

  it('raises INVALID_PARAMS for a missing file', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('delete', { path: 'gone.txt' }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });
});

describe('diff', () => {
  it('returns { revisionId, parentRevisionId, diff, changedFiles }', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await dispatchTool(
      'write',
      { path: 'src/App.tsx', content: 'changed', expectedSha256: await sha256(APP_TSX) },
      ctx,
    );

    const result = await dispatchTool('diff', { revisionId: 'rev_1' }, ctx);
    expect(Object.keys(result).sort()).toEqual([
      'changedFiles',
      'diff',
      'parentRevisionId',
      'revisionId',
    ]);
    expect(result.revisionId).toBe('rev_2');
    expect(result.parentRevisionId).toBe('rev_1');
    expect(result.changedFiles).toEqual(['src/App.tsx']);
  });

  it('reports no changes when the workspace is untouched', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('diff', { revisionId: 'rev_1' }, ctx);
    expect(result.changedFiles).toEqual([]);
    expect(result.diff).toBe('(no changes)');
  });
});

describe('run', () => {
  it('returns { exitCode, stdout, stderr, truncated, command }', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool('run', { command: 'npm run build' }, ctx);

    expect(Object.keys(result).sort()).toEqual([
      'command',
      'exitCode',
      'stderr',
      'stdout',
      'truncated',
    ]);
    expect(result.command).toBe('npm run build');
    expect(result.exitCode).toBe(0);
  });

  it('treats a non-zero exit as a normal result, not an error', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    adapter.spawn.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'build failed',
      truncated: false,
    });

    const result = await dispatchTool('run', { command: 'npm run build' }, ctx);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('build failed');
  });

  it('maps a spawn failure to PROCESS_FAILED', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    adapter.spawn.mockRejectedValue(new Error('command not found'));
    await expectToolError(
      dispatchTool('run', { command: 'nope' }, ctx),
      RuntimeErrorCodes.PROCESS_FAILED,
    );
  });

  it('maps a timeout to TOOL_TIMEOUT', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    adapter.spawn.mockRejectedValue(new SpawnTimeoutError(1_000));
    await expectToolError(
      dispatchTool('run', { command: 'sleep 999' }, ctx),
      RuntimeErrorCodes.TOOL_TIMEOUT,
    );
  });

  it('clamps timeoutMs into 1_000..600_000', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await dispatchTool('run', { command: 'ls', timeoutMs: 9_999_999 }, ctx);
    expect(adapter.spawn).toHaveBeenLastCalledWith(
      'ls',
      [],
      expect.objectContaining({ timeoutMs: 600_000 }),
    );
  });

  it('marks dependencies dirty after an install command', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await dispatchTool('run', { command: 'npm install lodash' }, ctx);
    expect(adapter.markDepsDirty).toHaveBeenCalled();
  });

  it('leaves dependencies alone for a plain command', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await dispatchTool('run', { command: 'npm run build' }, ctx);
    expect(adapter.markDepsDirty).not.toHaveBeenCalled();
  });

  it('emits a progress event before running', async () => {
    const { ctx, onProgress } = await makeContext(BASE_FILES);
    await dispatchTool('run', { command: 'npm run build' }, ctx);
    expect(onProgress).toHaveBeenCalledWith({
      phase: 'running',
      message: 'npm run build',
    });
  });

  it('keeps quoted arguments intact instead of splitting on spaces', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await dispatchTool('run', { command: `node -e "console.log('hi')"` }, ctx);
    expect(adapter.spawn).toHaveBeenCalledWith(
      'node',
      ['-e', "console.log('hi')"],
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('chains && and maps cd onto cwd instead of spawning a cd binary', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    await dispatchTool('run', { command: 'cd src && npm run build' }, ctx);
    expect(adapter.spawn).toHaveBeenCalledTimes(1);
    expect(adapter.spawn).toHaveBeenCalledWith(
      'npm',
      ['run', 'build'],
      expect.objectContaining({ cwd: '/src' }),
    );
  });

  it('stops a && chain after a non-zero exit', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    adapter.spawn.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'nope',
      truncated: false,
    });
    const result = await dispatchTool('run', { command: 'false && echo hi' }, ctx);
    expect(result.exitCode).toBe(1);
    expect(adapter.spawn).toHaveBeenCalledTimes(1);
  });

  it('runs both sides of `;` even when the first step fails', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    adapter.spawn
      .mockResolvedValueOnce({ exitCode: 1, stdout: 'a', stderr: '', truncated: false })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'b', stderr: '', truncated: false });
    const result = await dispatchTool('run', { command: 'echo a; echo b' }, ctx);
    expect(adapter.spawn).toHaveBeenCalledTimes(2);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ab');
  });

  it('rejects pipes, redirections and background jobs with a usable error', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const err = await expectToolError(
      dispatchTool('run', { command: 'npm run build > dist.log' }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
    expect(err.message).toMatch(/>/);
    expect(err.data).toMatchObject({ unsupported: '>' });

    await expectToolError(
      dispatchTool('run', { command: 'npm run dev &' }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });
});

describe('dev_server', () => {
  it('reports the current preview without spawning', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    const result = await dispatchTool('dev_server', { action: 'status' }, ctx);
    expect(adapter.startDevServer).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      running: true,
      url: 'http://localhost/__virtual__/pod-1/5173/',
      port: 5173,
    });
    expect(String(result.message)).toMatch(/inspector|URL|running/i);
  });

  it('restarts through startDevServer', async () => {
    const ensurePreviewAttached = vi.fn().mockResolvedValue(undefined);
    const openPreviewPanel = vi.fn();
    const { ctx, adapter, previewCtrl } = await makeContext(BASE_FILES);
    ctx.ensurePreviewAttached = ensurePreviewAttached;
    ctx.openPreviewPanel = openPreviewPanel;
    (previewCtrl as { previewUrl: string | null }).previewUrl = null;
    adapter.startDevServer.mockImplementation(async () => {
      (previewCtrl as { previewUrl: string | null }).previewUrl =
        'http://localhost/__virtual__/pod-1/5173/';
      (previewCtrl as { port: number | null }).port = 5173;
      return 'http://localhost/__virtual__/pod-1/5173/';
    });

    const result = await dispatchTool('dev_server', { action: 'restart' }, ctx);
    expect(adapter.startDevServer).toHaveBeenCalled();
    expect(openPreviewPanel).toHaveBeenCalled();
    expect(ensurePreviewAttached).toHaveBeenCalled();
    expect(result.running).toBe(true);
  });

  it('rejects an unknown action', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('dev_server', { action: 'stop' }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });
});

describe('preview tools', () => {
  it('delegates preview_inspect to the controller', async () => {
    const { ctx, previewCtrl } = await makeContext(BASE_FILES);
    const result = await dispatchTool('preview_inspect', {}, ctx);
    expect(previewCtrl.inspectPreview).toHaveBeenCalled();
    expect(Object.keys(result).sort()).toEqual([
      'capabilities',
      'console',
      'domSummary',
      'runtimeErrors',
      'screenshotArtifactId',
      'title',
      'url',
      'visibleText',
    ]);
  });

  it('raises UNSUPPORTED_CAPABILITY when Nodepod is not booted', async () => {
    const { ctx, adapter } = await makeContext(BASE_FILES);
    (adapter as unknown as { currentPod: unknown }).currentPod = null;
    await expectToolError(
      dispatchTool('preview_inspect', {}, ctx),
      RuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
    );
  });

  it('forwards preview_action arguments', async () => {
    const { ctx, previewCtrl } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'preview_action',
      { action: 'click', selector: '#go', value: 'v', x: 1, y: 2 },
      ctx,
    );
    expect(previewCtrl.performAction).toHaveBeenCalledWith('click', {
      selector: '#go',
      value: 'v',
      x: 1,
      y: 2,
    });
    expect(result).toEqual({ ok: true, action: 'click' });
  });

  it('rejects an unsupported action', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('preview_action', { action: 'teleport' }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });
});

describe('finalize', () => {
  it('returns the contract keys with a workspace-scoped manifest path', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'finalize',
      { revisionId: 'rev_1', title: 'My App', verification: { build: 'ok' } },
      ctx,
    );

    expect(Object.keys(result).sort()).toEqual([
      'cephManifestPath',
      'fileTree',
      'preview',
      'revisionId',
      'verification',
    ]);
    expect(result.cephManifestPath).toBe('appbuilder/manifests/ws-1/rev_1.json');
    expect(result.preview).toEqual({ runtime: 'browser', healthy: true });
    expect(result.verification).toEqual({ build: 'ok', preview: 'inspected', tests: '' });
  });

  it('rejects finalize without build verification', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expectToolError(
      dispatchTool('finalize', { revisionId: 'rev_1', title: 'My App', verification: {} }, ctx),
      RuntimeErrorCodes.INVALID_PARAMS,
    );
  });

  it('falls back to the latest local revision', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'finalize',
      { title: 'My App', verification: { build: 'exit 0' } },
      ctx,
    );
    expect(result.revisionId).toBe('rev_1');
  });

  it('coalesces a stale revisionId to the latest local revision', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = await dispatchTool(
      'finalize',
      { revisionId: 'rev_0', title: 'My App', verification: { build: 'exit 0' } },
      ctx,
    );
    expect(result.revisionId).toBe('rev_1');
  });

  it('reuses a cached healthy preview inspect during finalize', async () => {
    const { ctx, previewCtrl } = await makeContext(BASE_FILES);
    const cached = {
      url: 'http://localhost/__virtual__/pod-1/5173/',
      title: 'App',
      visibleText: 'Hello',
      domSummary: [{ tag: 'h1', text: 'Hello' }],
      console: [],
      runtimeErrors: [],
      screenshotArtifactId: null,
      capabilities: { screenshot: false, interaction: true },
    };
    previewCtrl.getCachedHealthyInspect = vi.fn().mockReturnValue(cached);

    const result = await dispatchTool(
      'finalize',
      { title: 'My App', verification: { build: 'exit 0' } },
      ctx,
    );

    expect(previewCtrl.inspectPreview).not.toHaveBeenCalled();
    expect(result.preview).toEqual({ runtime: 'browser', healthy: true });
  });

  it('coerces object build verification to a string', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    const result = (await dispatchTool(
      'finalize',
      {
        title: 'My App',
        verification: { build: { command: 'npm run build', exitCode: 0 } },
      },
      ctx,
    )) as unknown as FinalizeResult;
    expect(result.verification.build).toBe('npm run build exit 0');
  });

  it('opens the preview panel on successful finalize', async () => {
    const openPreviewPanel = vi.fn();
    const { ctx } = await makeContext(BASE_FILES);
    ctx.openPreviewPanel = openPreviewPanel;

    await dispatchTool(
      'finalize',
      { title: 'Addition App', verification: { build: 'exit 0' } },
      ctx,
    );

    expect(openPreviewPanel).toHaveBeenCalled();
  });

  it('reports a clear error when build verification is a non-coercible object', async () => {
    const { ctx } = await makeContext(BASE_FILES);
    await expect(
      dispatchTool(
        'finalize',
        { title: 'My App', verification: { build: { stdout: 'ok' } } },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: RuntimeErrorCodes.INVALID_PARAMS,
      message: expect.stringContaining('not an object'),
    });
  });
});

describe('buildFileTree', () => {
  it('nests flat VFS paths in Manus display shape', () => {
    expect(buildFileTree(['/package.json', '/src/App.tsx', '/src/lib/util.ts'])).toEqual({
      name: '',
      type: 'directory',
      children: [
        { name: 'package.json', type: 'file', path: 'package.json' },
        {
          name: 'src',
          type: 'directory',
          children: [
            { name: 'App.tsx', type: 'file', path: 'src/App.tsx' },
            {
              name: 'lib',
              type: 'directory',
              children: [{ name: 'util.ts', type: 'file', path: 'src/lib/util.ts' }],
            },
          ],
        },
      ],
    });
  });
});
