import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchTool, ToolError } from '../RuntimeToolHandlers';
import { RuntimeErrorCodes } from '../runtime.types';
import type { NodepodRuntimeAdapter } from '../NodepodRuntimeAdapter';
import type { PreviewController } from '../PreviewController';

function mockAdapter(overrides: Partial<NodepodRuntimeAdapter> = {}): NodepodRuntimeAdapter {
  return {
    readFile: vi.fn().mockResolvedValue('file content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    listFiles: vi.fn().mockResolvedValue(['/src/App.tsx', '/package.json']),
    spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' }),
    currentPod: null,
    ...overrides,
  } as unknown as NodepodRuntimeAdapter;
}

function mockPreview(): PreviewController {
  return {
    inspectPreview: vi.fn().mockResolvedValue({ url: 'http://localhost:5173', healthy: true }),
  } as unknown as PreviewController;
}

describe('RuntimeToolHandlers', () => {
  let adapter: NodepodRuntimeAdapter;
  let preview: PreviewController;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = mockAdapter();
    preview = mockPreview();
  });

  it('dispatches "list" tool', async () => {
    const result = await dispatchTool('list', { path: '/' }, adapter, preview);
    expect(result.entries).toEqual(['/src/App.tsx', '/package.json']);
    expect(result.count).toBe(2);
  });

  it('dispatches "read" tool', async () => {
    const result = await dispatchTool('read', { path: '/src/App.tsx' }, adapter, preview);
    expect(result.content).toBe('file content');
    expect(result.sha256).toBeDefined();
    expect(typeof result.sha256).toBe('string');
    expect((result.sha256 as string).length).toBe(64);
  });

  it('dispatches "write" tool with create', async () => {
    (adapter.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('not found'));
    const result = await dispatchTool(
      'write',
      { path: '/new.ts', content: 'hello', create: true },
      adapter,
      preview,
    );
    expect(result.created).toBe(true);
    expect(result.newSha256).toBeDefined();
    expect(adapter.writeFile).toHaveBeenCalledWith('/new.ts', 'hello');
  });

  it('dispatches "write" tool with SHA mismatch', async () => {
    (adapter.readFile as ReturnType<typeof vi.fn>).mockResolvedValue('existing');

    try {
      await dispatchTool(
        'write',
        { path: '/f.ts', content: 'new', expectedSha256: 'wrong' },
        adapter,
        preview,
      );
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe(RuntimeErrorCodes.REVISION_CONFLICT);
    }
  });

  it('dispatches "delete" tool', async () => {
    const result = await dispatchTool('delete', { path: '/old.ts' }, adapter, preview);
    expect(result.deletedSha256).toBeDefined();
    expect(adapter.deleteFile).toHaveBeenCalledWith('/old.ts');
  });

  it('dispatches "run" tool', async () => {
    const result = await dispatchTool('run', { command: 'npm test' }, adapter, preview);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
    expect(adapter.spawn).toHaveBeenCalledWith('npm', ['test'], { timeoutMs: 180000 });
  });

  it('dispatches "search" tool', async () => {
    (adapter.readFile as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
      if (p === '/src/App.tsx') return Promise.resolve('import React from "react";\nexport default App;');
      return Promise.resolve('{}');
    });

    const result = await dispatchTool('search', { query: 'React', path: '/' }, adapter, preview);
    expect(result.matches).toBeInstanceOf(Array);
    expect((result.matches as unknown[]).length).toBeGreaterThan(0);
  });

  it('rejects unknown tool', async () => {
    try {
      await dispatchTool('nonexistent', {}, adapter, preview);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe(-32601);
    }
  });

  it('dispatches "preview_action" with UNSUPPORTED_CAPABILITY', async () => {
    try {
      await dispatchTool('preview_action', {}, adapter, preview);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolError);
      expect((err as ToolError).code).toBe(RuntimeErrorCodes.UNSUPPORTED_CAPABILITY);
    }
  });

  it('dispatches "finalize" tool', async () => {
    const result = await dispatchTool('finalize', { revisionId: 'rev_1', title: 'My App' }, adapter, preview);
    expect(result.status).toBe('finalized');
    expect(result.revisionId).toBe('rev_1');
  });
});
