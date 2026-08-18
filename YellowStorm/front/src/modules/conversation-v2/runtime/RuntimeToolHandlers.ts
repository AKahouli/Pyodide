import type { NodepodRuntimeAdapter } from './NodepodRuntimeAdapter';
import { SpawnTimeoutError } from './NodepodRuntimeAdapter';
import type { PreviewController } from './PreviewController';
import type { WorkspaceRevisionStore } from './WorkspaceRevisionStore';
import { conversationV2Api } from '../api';
import { ToolError } from './ToolError';
import { sha256 } from './hashing';
import { parseCommandLine, type CommandStep } from './command-line';
import { applyUnifiedPatch, createUnifiedDiff } from './unified-diff';
import { buildFilesTreeFromVfsPaths } from '../utils/files-tree';
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
  type DevServerResult,
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

type VerificationField = keyof VerificationEvidence;

/** Coerce agent-supplied verification values to plain strings. */
function normalizeVerificationField(value: unknown, field: VerificationField): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (field === 'build') {
    if (typeof value === 'number') return `exit ${value}`;
    if (typeof value === 'object') {
      const rec = value as Record<string, unknown>;
      const command = typeof rec.command === 'string' ? rec.command.trim() : '';
      const exitCode = rec.exitCode ?? rec.exit_code;
      if (command && exitCode != null) return `${command} exit ${exitCode}`;
      if (command) return command;
      if (exitCode != null) return `exit ${exitCode}`;
    }
  }
  if (field === 'preview' && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec.healthy === true) return 'inspected';
    if (typeof rec.status === 'string') return rec.status;
  }
  if (field === 'tests' && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec.passed === true) return 'passed';
    if (typeof rec.summary === 'string') return rec.summary;
  }
  return '';
}

function parseVerificationEvidence(raw: unknown): VerificationEvidence {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    build: normalizeVerificationField(obj.build, 'build'),
    preview: normalizeVerificationField(obj.preview, 'preview'),
    tests: normalizeVerificationField(obj.tests, 'tests'),
  };
}

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
  | DevServerResult
  | PreviewInspectResult
  | PreviewActionResult
  | FinalizeResult;

/** Everything a handler is allowed to touch. */
export interface ToolContext {
  adapter: NodepodRuntimeAdapter;
  previewCtrl: PreviewController;
  revisions: WorkspaceRevisionStore;
  workspaceId: string;
  /** Conversation V2 session id (Mongo) for revision APIs. */
  sessionId: string;
  toolCallId?: string;
  onProgress?: ToolProgressReporter;
  /** Attach off-screen preview iframe when the user panel is closed. */
  ensurePreviewAttached?: () => Promise<void>;
  /** Surface the live preview panel in the UI (best-effort). */
  openPreviewPanel?: () => void;
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

/** Commit the current workspace state, persist to Ceph, return the revision id. */
async function commitRevision(ctx: ToolContext): Promise<string> {
  const manifest = await ctx.adapter.shaManifest();
  const parentRevisionId = ctx.revisions.latestRevisionId;
  const revisionId = ctx.revisions.commit(manifest);

  const files: Array<{ path: string; content: string }> = [];
  for (const relPath of manifest.keys()) {
    const vfsPath = toVfsPath(relPath);
    const content = await ctx.adapter.readFile(vfsPath);
    if (typeof content === 'string') {
      files.push({ path: relPath, content });
    }
  }

  try {
    await conversationV2Api.commitWorkspaceRevision(ctx.sessionId, {
      revisionId,
      parentRevisionId,
      files,
      toolCallId: ctx.toolCallId ?? null,
    });
  } catch (err) {
    throw new ToolError(
      RuntimeErrorCodes.INTERNAL_ERROR,
      `Failed to persist revision ${revisionId} to Ceph: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { revisionId, parentRevisionId },
    );
  }

  return revisionId;
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
    const initialCwd = validateToolPathOptional(optionalString(args, 'cwd'));
    const timeoutMs = clamp(
      optionalInt(args, 'timeoutMs') ?? RUN_TIMEOUT_DEFAULT,
      RUN_TIMEOUT_MIN,
      RUN_TIMEOUT_MAX,
    );

    // Rejects shell-only constructs up front rather than handing `&&` or a
    // torn-apart quoted script to the binary as literal argv.
    const steps = parseCommandLine(command);
    ctx.onProgress?.({ phase: 'running', message: command });

    let lastProgressAt = 0;
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let exitCode = 0;
    let cwd = initialCwd;
    const deadline = Date.now() + timeoutMs;

    for (const step of steps) {
      // `;` runs regardless of the previous outcome, `&&` does not.
      if (step.joinedBy === '&&' && exitCode !== 0) break;

      // `cd` has to mutate this loop's cwd — spawning a `cd` binary would
      // not persist, which is exactly what models write (`cd src && npm run build`).
      if (step.cmd === 'cd') {
        cwd = resolveCd(cwd, step.args, command);
        exitCode = 0;
        continue;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new ToolError(
          RuntimeErrorCodes.TOOL_TIMEOUT,
          `Command timed out after ${timeoutMs}ms`,
          { command, timeoutMs },
        );
      }

      const stepResult = await runStep(step, ctx, {
        cwd,
        timeoutMs: remainingMs,
        command,
        onOutput: (chunk) => {
          const now = Date.now();
          if (now - lastProgressAt < 1_000) return;
          lastProgressAt = now;
          ctx.onProgress?.({ phase: 'running', message: chunk.slice(-200) });
        },
      });

      stdout += stepResult.stdout;
      stderr += stepResult.stderr;
      truncated ||= stepResult.truncated;
      exitCode = stepResult.exitCode;
    }

    return { exitCode, stdout, stderr, truncated, command };
  },

  async dev_server(args, ctx): Promise<DevServerResult> {
    const action = optionalString(args, 'action') ?? 'status';
    if (action !== 'status' && action !== 'restart') {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `Unknown dev_server action: ${action}`,
        { action },
      );
    }

    if (action === 'restart') {
      ctx.onProgress?.({ phase: 'starting', message: 'dev server restart' });
      // Boots the configured dev command, waits for the ready line and probes
      // the URL before returning — the same path the host uses at boot.
      await ctx.adapter.startDevServer(ctx.previewCtrl, () => false, (phase, message) =>
        ctx.onProgress?.({ phase, message }),
      );
      ctx.openPreviewPanel?.();
      await ctx.ensurePreviewAttached?.();
    }

    const url = ctx.previewCtrl.previewUrl;
    return {
      running: url !== null,
      url,
      port: ctx.previewCtrl.port,
      // The preview is served through a service worker, not a TCP port: probing
      // localhost from inside the pod always fails and means nothing.
      message: url
        ? 'Dev server is running. The preview is reachable only through this URL, not via localhost.'
        : 'Dev server is not running. Call dev_server with action "restart" to start it.',
    };
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
    await ctx.ensurePreviewAttached?.();
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
    const requestedRevision = optionalString(args, 'revisionId');
    let revisionId = requestedRevision || ctx.revisions.latestRevisionId;
    if (requestedRevision && requestedRevision !== ctx.revisions.latestRevisionId) {
      revisionId = ctx.revisions.latestRevisionId;
    }
    const title = requireString(args, 'title');
    const rawVerification = args.verification;
    const verification = parseVerificationEvidence(rawVerification);

    if (!verification.build.trim()) {
      const rawBuild =
        rawVerification && typeof rawVerification === 'object'
          ? (rawVerification as Record<string, unknown>).build
          : undefined;
      const objectHint =
        rawBuild != null && typeof rawBuild !== 'string'
          ? ' verification.build must be a string (e.g. "npm run build exit 0"), not an object.'
          : '';
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        `finalize requires verification.build evidence (e.g. npm run build exit 0).${objectHint}`,
        { revisionId },
      );
    }

    const pod = ctx.adapter.currentPod;
    if (!pod) {
      throw new ToolError(
        RuntimeErrorCodes.UNSUPPORTED_CAPABILITY,
        'Nodepod is not booted; cannot finalize',
        { revisionId },
      );
    }

    const cached = ctx.previewCtrl.getCachedHealthyInspect();
    if (!cached) {
      await ctx.ensurePreviewAttached?.();
    }
    const inspect = cached ?? (await ctx.previewCtrl.inspectPreview(pod));
    const previewHealthy =
      ctx.previewCtrl.previewUrl !== null &&
      inspect.domSummary.length > 0 &&
      inspect.visibleText.trim().length > 0 &&
      inspect.runtimeErrors.length === 0;

    if (!previewHealthy) {
      throw new ToolError(
        RuntimeErrorCodes.INVALID_PARAMS,
        'finalize requires a healthy preview inspection (attach the preview panel and verify the UI)',
        {
          revisionId,
          previewUrl: ctx.previewCtrl.previewUrl,
          domNodes: inspect.domSummary.length,
          runtimeErrors: inspect.runtimeErrors,
        },
      );
    }

    if (!verification.preview.trim()) {
      verification.preview = 'inspected';
    }

    ctx.openPreviewPanel?.();
    await ctx.adapter.refreshFileCache?.();

    return {
      revisionId,
      cephManifestPath: `appbuilder/manifests/${ctx.workspaceId}/${revisionId}.json`,
      fileTree: buildFileTree(await ctx.adapter.listFiles('/')),
      preview: {
        runtime: 'browser',
        healthy: true,
      },
      verification,
    };
  },
};

/** Apply a `cd` step to the current workspace-relative cwd. */
function resolveCd(cwd: string | null, args: string[], command: string): string {
  if (args.length !== 1 || !args[0]) {
    throw new ToolError(
      RuntimeErrorCodes.INVALID_PARAMS,
      '`cd` needs exactly one relative path. Absolute paths are rejected — the workspace root is already `/`.',
      { command, args },
    );
  }
  const joined = cwd && cwd !== '.' ? `${cwd}/${args[0]}` : args[0];
  return validateToolPath(joined);
}

/** Spawn one parsed step, mapping runtime failures onto tool error codes. */
async function runStep(
  step: CommandStep,
  ctx: ToolContext,
  opts: {
    cwd: string | null;
    timeoutMs: number;
    command: string;
    onOutput: (chunk: string) => void;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string; truncated: boolean }> {
  const stepCommand = [step.cmd, ...step.args].join(' ');
  try {
    const result = await ctx.adapter.spawn(step.cmd, step.args, {
      cwd: opts.cwd ? toVfsPath(opts.cwd) : undefined,
      timeoutMs: opts.timeoutMs,
      // Throttled so a chatty build does not flood the socket; each emission
      // re-arms the backend's per-call deadline.
      onOutput: opts.onOutput,
    });

    if (DEPENDENCY_MUTATING_RE.test(stepCommand)) ctx.adapter.markDepsDirty();

    // A non-zero exit code is a normal result the model must be able to read.
    return result;
  } catch (err) {
    if (err instanceof SpawnTimeoutError) {
      throw new ToolError(RuntimeErrorCodes.TOOL_TIMEOUT, err.message, {
        command: opts.command,
        step: stepCommand,
        timeoutMs: opts.timeoutMs,
      });
    }
    // Reaching here means the process could not be started or the runtime
    // itself failed — distinct from the command exiting non-zero.
    throw new ToolError(
      RuntimeErrorCodes.PROCESS_FAILED,
      err instanceof Error ? err.message : String(err),
      { command: opts.command, step: stepCommand },
    );
  }
}

/** @deprecated Use `buildFilesTreeFromVfsPaths` from `utils/files-tree`. */
export function buildFileTree(vfsPaths: string[]): FileTreeNode {
  return buildFilesTreeFromVfsPaths(vfsPaths) as FileTreeNode;
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
