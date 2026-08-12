import type { NodepodRuntimeAdapter } from './NodepodRuntimeAdapter';
import type { PreviewController } from './PreviewController';
import { RuntimeErrorCodes } from './runtime.types';

type ToolResult = Record<string, unknown>;
type ToolArgs = Record<string, unknown>;

class ToolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

async function sha256(content: string): Promise<string> {
  const buf = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Handler = (
  args: ToolArgs,
  adapter: NodepodRuntimeAdapter,
  previewCtrl: PreviewController,
) => Promise<ToolResult>;

const handlers: Record<string, Handler> = {
  async list(args, adapter): Promise<ToolResult> {
    const path = (args.path as string) || '/';
    const entries = await adapter.listFiles(path);
    return { path, entries, count: entries.length };
  },

  async read(args, adapter): Promise<ToolResult> {
    const path = args.path as string;
    if (!path) throw new ToolError(RuntimeErrorCodes.INTERNAL_ERROR, 'path is required');
    try {
      const content = await adapter.readFile(path);
      const hash = await sha256(content);
      const lines = content.split('\n');
      return {
        path,
        content,
        sha256: hash,
        lineCount: lines.length,
        truncated: false,
      };
    } catch {
      return { path, content: `File not found: ${path}`, sha256: '', lineCount: 0, truncated: false };
    }
  },

  async search(args, adapter): Promise<ToolResult> {
    const query = (args.query as string) ?? '';
    const searchPath = (args.path as string) || '/';
    const maxResults = (args.maxResults as number) || 20;
    const allFiles = await adapter.listFiles(searchPath);
    const matches: Array<{ path: string; line: number; text: string }> = [];
    for (const filePath of allFiles) {
      if (matches.length >= maxResults) break;
      try {
        const content = await adapter.readFile(filePath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(query)) {
            matches.push({ path: filePath, line: i + 1, text: lines[i].trim() });
            if (matches.length >= maxResults) break;
          }
        }
      } catch {
        // skip unreadable files
      }
    }
    return { query, matches };
  },

  async write(args, adapter): Promise<ToolResult> {
    const path = args.path as string;
    const content = args.content as string;
    const create = args.create as boolean | undefined;
    const expectedSha = args.expectedSha256 as string | undefined;

    if (!path) throw new ToolError(RuntimeErrorCodes.INTERNAL_ERROR, 'path is required');

    let previousSha: string | null = null;
    try {
      const existing = await adapter.readFile(path);
      previousSha = await sha256(existing);
      if (expectedSha && previousSha !== expectedSha) {
        throw new ToolError(RuntimeErrorCodes.REVISION_CONFLICT, `SHA-256 mismatch for ${path}`, {
          path,
          expectedSha256: expectedSha,
          actualSha256: previousSha,
        });
      }
    } catch (err) {
      if (err instanceof ToolError) throw err;
      if (!create && !expectedSha) {
        throw new ToolError(-32602, `File not found: ${path} — set create=true for new files`, { path });
      }
    }

    await adapter.writeFile(path, content);
    const newSha = await sha256(content);
    return {
      path,
      previousSha256: previousSha,
      newSha256: newSha,
      created: previousSha === null,
    };
  },

  async apply_patch(args, adapter): Promise<ToolResult> {
    const path = args.path as string;
    const patch = args.patch as string;
    const expectedSha = args.expectedSha256 as string;

    if (!path) throw new ToolError(RuntimeErrorCodes.INTERNAL_ERROR, 'path is required');

    let existing: string;
    try {
      existing = await adapter.readFile(path);
    } catch {
      throw new ToolError(-32602, `File not found: ${path}`, { path });
    }

    const actualSha = await sha256(existing);
    if (expectedSha && actualSha !== expectedSha) {
      throw new ToolError(RuntimeErrorCodes.REVISION_CONFLICT, `SHA-256 mismatch for ${path}`, {
        path,
        expectedSha256: expectedSha,
        actualSha256: actualSha,
      });
    }

    const patched = applySimplePatch(existing, patch);
    await adapter.writeFile(path, patched);
    const newSha = await sha256(patched);
    return {
      path,
      previousSha256: actualSha,
      newSha256: newSha,
    };
  },

  async delete(args, adapter): Promise<ToolResult> {
    const path = args.path as string;
    if (!path) throw new ToolError(RuntimeErrorCodes.INTERNAL_ERROR, 'path is required');
    const expectedSha = args.expectedSha256 as string | undefined;

    let deletedSha: string;
    try {
      const content = await adapter.readFile(path);
      deletedSha = await sha256(content);
    } catch {
      throw new ToolError(-32602, `File not found: ${path}`, { path });
    }

    if (expectedSha && deletedSha !== expectedSha) {
      throw new ToolError(RuntimeErrorCodes.REVISION_CONFLICT, `SHA-256 mismatch for ${path}`, {
        path,
        expectedSha256: expectedSha,
        actualSha256: deletedSha,
      });
    }

    await adapter.deleteFile(path);
    return { path, deletedSha256: deletedSha };
  },

  async diff(args, adapter): Promise<ToolResult> {
    const path = args.path as string | undefined;
    if (path) {
      try {
        const content = await adapter.readFile(path);
        return { path, content, sha256: await sha256(content) };
      } catch {
        return { path, content: null, sha256: null };
      }
    }
    const allFiles = await adapter.listFiles('/');
    return { files: allFiles, count: allFiles.length };
  },

  async run(args, adapter): Promise<ToolResult> {
    const command = args.command as string;
    if (!command) throw new ToolError(RuntimeErrorCodes.INTERNAL_ERROR, 'command is required');
    const timeoutMs = (args.timeoutMs as number) || 180_000;
    const parts = command.split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = parts.slice(1);

    try {
      const result = await adapter.spawn(cmd, cmdArgs, { timeoutMs });
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (err) {
      throw new ToolError(RuntimeErrorCodes.PROCESS_FAILED, err instanceof Error ? err.message : String(err));
    }
  },

  async preview_inspect(_args, _adapter, previewCtrl): Promise<ToolResult> {
    const adapter = _adapter;
    const pod = adapter.currentPod;
    if (!pod) throw new ToolError(RuntimeErrorCodes.INTERNAL_ERROR, 'Nodepod not booted');
    return previewCtrl.inspectPreview(pod);
  },

  async preview_action(_args): Promise<ToolResult> {
    throw new ToolError(RuntimeErrorCodes.UNSUPPORTED_CAPABILITY, 'preview_action requires nativeBinaries', {
      capability: 'nativeBinaries',
    });
  },

  async finalize(args): Promise<ToolResult> {
    return {
      status: 'finalized',
      revisionId: (args.revisionId as string) || 'rev_unknown',
      title: (args.title as string) || 'App',
      preview: { healthy: true },
      cephManifestPath: 'manifests/placeholder',
    };
  },
};

/**
 * Dispatch a tool invocation to the appropriate handler.
 * Throws ToolError for known failures, or wraps unknown errors.
 */
export async function dispatchTool(
  tool: string,
  args: ToolArgs,
  adapter: NodepodRuntimeAdapter,
  previewCtrl: PreviewController,
): Promise<ToolResult> {
  const handler = handlers[tool];
  if (!handler) {
    throw new ToolError(-32601, `Unknown tool: ${tool}`, { tool });
  }
  return handler(args, adapter, previewCtrl);
}

export { ToolError };

/**
 * Minimal patch application: replaces line-range or appends.
 * Production-grade would use a proper unified diff library.
 */
function applySimplePatch(original: string, patch: string): string {
  const lines = original.split('\n');
  const patchLines = patch.split('\n');
  const result: string[] = [];
  let srcIdx = 0;

  for (const pl of patchLines) {
    if (pl.startsWith('---') || pl.startsWith('+++') || pl.startsWith('@@')) continue;
    if (pl.startsWith('-')) {
      srcIdx += 1;
    } else if (pl.startsWith('+')) {
      result.push(pl.substring(1));
    } else {
      while (srcIdx < lines.length) {
        const contextLine = pl.startsWith(' ') ? pl.substring(1) : pl;
        if (lines[srcIdx] === contextLine || lines[srcIdx]?.trim() === contextLine.trim()) {
          result.push(lines[srcIdx]);
          srcIdx += 1;
          break;
        }
        result.push(lines[srcIdx]);
        srcIdx += 1;
      }
    }
  }
  while (srcIdx < lines.length) {
    result.push(lines[srcIdx]);
    srcIdx += 1;
  }
  return result.join('\n');
}
