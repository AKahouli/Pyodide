import type { NodepodRuntimeAdapter } from './NodepodRuntimeAdapter';
import { SpawnTimeoutError } from './NodepodRuntimeAdapter';
import type { PreviewController } from './PreviewController';
import type { WorkspaceRevisionStore } from './WorkspaceRevisionStore';
import { ToolError } from './ToolError';
import { sha256 } from './hashing';
import { applyUnifiedPatch, createUnifiedDiff } from './unified-diff';
import {
  validateToolPath,
  validateToolPathOptional,
  validateListPath,
  toVfsPath,
  toRelativePath,
} from './paths';
import {
  clamp,
  LIST_DEPTH_DEFAULT,
  LIST_MAX_DEPTH,
  LIST_MIN_DEPTH,
  MAX_FILE_SIZE,
  RUN_TIMEOUT_DEFAULT,
  RUN_TIMEOUT_MAX,
  RUN_TIMEOUT_MIN,
  SEARCH_EXCERPT_CHARS,
  SEARCH_MAX_RESULTS,
  SEARCH_MAX_RESULTS_DEFAULT,
} from './limits';
import {
  RuntimeErrorCodes,
  type ApplyPatchResult,
  type DeleteResult,
  type DiffResult,
  type FileTreeNode,
  type FinalizeResult,
  type ListResult,
  type PreviewActionName,
  type PreviewActionResult,
  type PreviewInspectResult,
  type ReadResult,
  type RunResult,
  type SearchMatch,
  type SearchResult,
  type ToolProgressReporter,
  type VerificationEvidence,
  type WriteResult,
} from './runtime.types';

type ToolArgs = Record<string, unknown>;

/** Every shape a tool handler may return, per `schemas.py`. */
export type AnyToolResult =
  | ListResult
  | ReadResult
  | SearchResult
  | WriteResult
  | ApplyPatchResult
  | DeleteResult
  | DiffResult
  | RunResult
  | PreviewInspectResult
  | PreviewActionResult
  | FinalizeResult;

/** Everything a handler is allowed to touch. */
export interface ToolContext {
  adapter: NodepodRuntimeAdapter;
  previewCtrl: PreviewController;
  revisions: WorkspaceRevisionStore;
  workspaceId: string;
  onProgress?: ToolProgressReporter;
}

const PREVIEW_ACTIONS: readonly PreviewActionName[] = [
  'reload',
  'click',
  'input',
  'press_key',
  'select',
  'scroll',
];

/** Commands that change the dependency set and invalidate `node_modules`. */
const DEPENDENCY_MUTATING_RE =
  /^\s*(npm\s+(install|i|ci|add|uninstall|remove)|pnpm\s+(install|i|add|remove)|yarn\s+(install|add|remove))\b/i;

export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'apply_patch',
  'delete',
]);

/* -------------------------------------------------------------------------
 * Argument coercion — the backend validates with Pydantic before dispatching,
 * but the browser is a trust boundary of its own.
 * ---------------------------------------------------------------------- */

function requireString(args: ToolArgs, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ToolError(
      RuntimeErrorCodes.INVALID_PARAMS,
      `${key} is required and must be a non-empty string`,
      { field: key },
    );
  }
  return value;
}

function optionalString(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function optionalInt(args: ToolArgs, key: string): number | undefined {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

/* -------------------------------------------------------------------------
 * Shared filesystem helpers
 * ---------------------------------------------------------------------- */

async function readIfExists(
  adapter: NodepodRuntimeAdapter,
  vfsPath: string,
): Promise<string | null> {
  try {
    if (!(await adapter.exists(vfsPath))) return null;
    return await adapter.readFile(vfsPath);
  } catch {
    return null;
  }
}

/** Commit the current workspace state and return the freshly minted id. */
async function commitRevision(ctx: ToolContext): Promise<string> {
  return ctx.revisions.commit(await ctx.adapter.shaManifest());
}

function conflict(
  path: string,
  expectedSha256: string,
  actualSha256: string | null,
): ToolError {
  return new ToolError(
    RuntimeErrorCodes.REVISION_CONFLICT,
    `SHA-256 mismatch for ${path}`,
    { path, expectedSha256, actualSha256 },
  );
}

/* -------------------------------------------------------------------------
 * Handlers
 * ---------------------------------------------------------------------- */

type Handler = (args: ToolArgs, ctx: ToolContext) => Promise<AnyToolResult>;

const handlers: Record<string, Handler> = {
  async list(args, ctx): Promise<ListResult> {
    const rawPath = optionalString(args, 'path') ?? '.';
    const path = validateListPath(rawPath);
    const depth = clamp(
      optionalInt(args, 'depth') ?? LIST_DEPTH_DEFAULT,
      LIST_MIN_DEPTH,
      LIST_MAX_DEPTH,
    );
    return { path, entries: await ctx.adapter.listEntries(path, depth) };
  },

  async read(args, ctx): Promise<ReadResult> {
    const path = validateToolPath(requireString(args, 'path'));
    const startLine = optionalInt(args, 'startLine');
    const endLine = optionalInt(args, 'endLine');
    if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        'endLine must be >= startLine',
        { path, startLine, endLine },
      );
    }

    const full = await readIfExists(ctx.adapter, toVfsPath(path));
    // A missing file is a normal result, not an error — reference adapter parity.
    if (full === null) {
      return {
        path,
        content: `// File not found: ${path}\n`,
        sha256: '',
        lineCount: 0,
        truncated: false,
      };
    }

    const hash = await sha256(full);
    const lines = full.split('\n');
    const lineCount = lines.length;

    if (startLine === undefined && endLine === undefined) {
      return { path, content: full, sha256: hash, lineCount, truncated: false };
    }

    const from = (startLine ?? 1) - 1;
    const to = endLine ?? lineCount;
    return {
      path,
      content: lines.slice(from, to).join('\n'),
      sha256: hash,
      lineCount,
      truncated: to < lineCount || from > 0,
    };
  },

  async search(args, ctx): Promise<SearchResult> {
    const query = requireString(args, 'query');
    const scope = validateToolPathOptional(optionalString(args, 'path'));
    const maxResults = clamp(
      optionalInt(args, 'maxResults') ?? SEARCH_MAX_RESULTS_DEFAULT,
      1,
      SEARCH_MAX_RESULTS,
    );

    const needle = query.toLowerCase();
    const matches: SearchMatch[] = [];

    for (const vfsPath of await ctx.adapter.listFiles(toVfsPath(scope ?? '.'))) {
      if (matches.length >= maxResults) break;
      const relative = toRelativePath(vfsPath);
      let content: string;
      try {
        content = await ctx.adapter.readFile(vfsPath);
      } catch {
        continue; // Binary or unreadable file.
      }
      const hash = await sha256(content);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        matches.push({
          path: relative,
          line: i + 1,
          excerpt: lines[i].trim().slice(0, SEARCH_EXCERPT_CHARS),
          sha256: hash,
        });
        if (matches.length >= maxResults) break;
      }
    }

    return { query, matches };
  },

  async write(args, ctx): Promise<WriteResult> {
    const path = validateToolPath(requireString(args, 'path'));
    const content = typeof args.content === 'string' ? args.content : '';
    const create = args.create === true;
    const expectedSha256 = optionalString(args, 'expectedSha256');

    if (content.length > MAX_FILE_SIZE) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `content exceeds the ${MAX_FILE_SIZE} byte limit`,
        { path, size: content.length, limit: MAX_FILE_SIZE },
      );
    }

    const vfsPath = toVfsPath(path);
    const existing = await readIfExists(ctx.adapter, vfsPath);
    const previousSha256 = existing === null ? null : await sha256(existing);

    if (existing === null) {
      if (!create && !expectedSha256) {
        throw new ToolError(
          RuntimeErrorCodes.INVALID_PARAMS,
          `File not found: ${path} — set create=true for new files`,
          { path },
        );
      }
      if (expectedSha256) throw conflict(path, expectedSha256, null);
    } else if (expectedSha256 && previousSha256 !== expectedSha256) {
      throw conflict(path, expectedSha256, previousSha256);
    }

    await ctx.adapter.writeFile(vfsPath, content);
    if (path === 'package.json' || path.endsWith('lock.json') || path.endsWith('lock.yaml')) {
      ctx.adapter.markDepsDirty();
    }

    return {
      revisionId: await commitRevision(ctx),
      path,
      previousSha256,
      newSha256: await sha256(content),
      created: existing === null,
    };
  },

  async apply_patch(args, ctx): Promise<ApplyPatchResult> {
    const path = validateToolPath(requireString(args, 'path'));
    const patch = requireString(args, 'patch');
    const expectedSha256 = requireString(args, 'expectedSha256');

    if (patch.length > MAX_FILE_SIZE) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `patch exceeds the ${MAX_FILE_SIZE} byte limit`,
        { path, size: patch.length, limit: MAX_FILE_SIZE },
      );
    }

    const vfsPath = toVfsPath(path);
    const existing = await readIfExists(ctx.adapter, vfsPath);
    if (existing === null) {
      throw new ToolError(RuntimeErrorCodes.INVALID_PARAMS, `File not found: ${path}`, {
        path,
      });
    }

    const previousSha256 = await sha256(existing);
    if (previousSha256 !== expectedSha256) {
      throw conflict(path, expectedSha256, previousSha256);
    }

    const patched = applyUnifiedPatch(existing, patch, path);
    await ctx.adapter.writeFile(vfsPath, patched);
    if (path === 'package.json') ctx.adapter.markDepsDirty();

    return {
      revisionId: await commitRevision(ctx),
      path,
      previousSha256,
      newSha256: await sha256(patched),
      diff: createUnifiedDiff(path, existing, patched),
    };
  },

  async delete(args, ctx): Promise<DeleteResult> {
    const path = validateToolPath(requireString(args, 'path'));
    const expectedSha256 = optionalString(args, 'expectedSha256');

    const vfsPath = toVfsPath(path);
    const existing = await readIfExists(ctx.adapter, vfsPath);
    if (existing === null) {
      throw new ToolError(RuntimeErrorCodes.INVALID_PARAMS, `File not found: ${path}`, {
        path,
      });
    }

    const deletedSha256 = await sha256(existing);
    if (expectedSha256 && deletedSha256 !== expectedSha256) {
      throw conflict(path, expectedSha256, deletedSha256);
    }

    await ctx.adapter.deleteFile(vfsPath);
    return { revisionId: await commitRevision(ctx), path, deletedSha256 };
  },

  async diff(args, ctx): Promise<DiffResult> {
    const revisionId = optionalString(args, 'revisionId') ?? null;
    const path = validateToolPathOptional(optionalString(args, 'path'));
    return ctx.revisions.diffAgainst(await ctx.adapter.shaManifest(), revisionId, path);
  },

  async run(args, ctx): Promise<RunResult> {
    const command = requireString(args, 'command');
    const cwd = validateToolPathOptional(optionalString(args, 'cwd'));
    const timeoutMs = clamp(
      optionalInt(args, 'timeoutMs') ?? RUN_TIMEOUT_DEFAULT,
      RUN_TIMEOUT_MIN,
      RUN_TIMEOUT_MAX,
    );

    const [cmd, ...cmdArgs] = command.trim().split(/\s+/);
    ctx.onProgress?.({ phase: 'running', message: command });

    let lastProgressAt = 0;
    try {
      const result = await ctx.adapter.spawn(cmd, cmdArgs, {
        cwd: cwd ? toVfsPath(cwd) : undefined,
        timeoutMs,
        // Throttled so a chatty build does not flood the socket; each emission
        // re-arms the backend's per-call deadline.
        onOutput: (chunk) => {
          const now = Date.now();
          if (now - lastProgressAt < 1_000) return;
          lastProgressAt = now;
          ctx.onProgress?.({ phase: 'running', message: chunk.trim().slice(0, 500) });
        },
      });

      if (DEPENDENCY_MUTATING_RE.test(command)) ctx.adapter.markDepsDirty();

      // A non-zero exit code is a normal result the model must be able to read.
      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        truncated: result.truncated,
        command,
      };
    } catch (err) {
      if (err instanceof SpawnTimeoutError) {
        throw new ToolError(RuntimeErrorCodes.TOOL_TIMEOUT, err.message, {
          command,
          timeoutMs,
        });
      }
      // Reaching here means the process could not be started or the runtime
      // itself failed — distinct from the command exiting non-zero.
      throw new ToolError(
        RuntimeErrorCodes.PROCESS_FAILED,
        err instanceof Error ? err.message : String(err),
        { command },
      );
    }
  },

  async preview_inspect(_args, ctx): Promise<PreviewInspectResult> {
    const pod = ctx.adapter.currentPod;
    if (!pod) {
      throw new ToolError(
        RuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        'Nodepod is not booted; the preview cannot be inspected.',
        { requiredCapability: 'previewInspection' },
      );
    }
    return ctx.previewCtrl.inspectPreview(pod);
  },

  async preview_action(args, ctx): Promise<PreviewActionResult> {
    const action = requireString(args, 'action') as PreviewActionName;
    if (!PREVIEW_ACTIONS.includes(action)) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `Unsupported preview action: ${action}`,
        { action, supported: [...PREVIEW_ACTIONS] },
      );
    }
    return ctx.previewCtrl.performAction(action, {
      selector: optionalString(args, 'selector'),
      value: optionalString(args, 'value'),
      x: optionalInt(args, 'x'),
      y: optionalInt(args, 'y'),
    });
  },

  async finalize(args, ctx): Promise<FinalizeResult> {
    const revisionId = optionalString(args, 'revisionId') || ctx.revisions.latestRevisionId;
    const rawVerification = (args.verification ?? {}) as Partial<VerificationEvidence>;

    return {
      revisionId,
      cephManifestPath: `appbuilder/manifests/${ctx.workspaceId}/${revisionId}.json`,
      fileTree: buildFileTree(await ctx.adapter.listFiles('/')),
      preview: {
        runtime: 'browser',
        healthy: ctx.previewCtrl.previewUrl !== null,
      },
      verification: {
        build: typeof rawVerification.build === 'string' ? rawVerification.build : '',
        preview: typeof rawVerification.preview === 'string' ? rawVerification.preview : '',
        tests: typeof rawVerification.tests === 'string' ? rawVerification.tests : '',
      },
    };
  },
};

/** Nest a flat list of absolute VFS paths into the `finalize.fileTree` shape. */
export function buildFileTree(vfsPaths: string[]): FileTreeNode {
  const root: FileTreeNode = { name: '/', type: 'dir', children: [] };

  for (const vfsPath of [...vfsPaths].sort()) {
    const segments = toRelativePath(vfsPath).split('/').filter(Boolean);
    let cursor = root;
    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      cursor.children ??= [];
      let next = cursor.children.find((child) => child.name === segment);
      if (!next) {
        next = isLeaf
          ? { name: segment, type: 'file' }
          : { name: segment, type: 'dir', children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }

  return root;
}

/**
 * Dispatch a tool invocation. Unknown tools raise `METHOD_NOT_FOUND`; every
 * other failure surfaces as a `ToolError` the host forwards as `tool.failed`.
 */
export async function dispatchTool(
  tool: string,
  args: ToolArgs,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const handler = handlers[tool];
  if (!handler) {
    throw new ToolError(RuntimeErrorCodes.METHOD_NOT_FOUND, `Unknown tool: ${tool}`, {
      tool,
    });
  }
  return (await handler(args, ctx)) as unknown as Record<string, unknown>;
}

export { ToolError };
