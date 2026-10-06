import { InvalidParamsError, SecurityDeniedError } from './runtime-mcp.errors';
import type { RuntimeMcpToolName } from './runtime-mcp.tools';

export const MAX_FILE_SIZE = 5 * 1024 * 1024;

export interface VerificationEvidence {
  build: string;
  preview: string;
  tests: string;
}

function coerceEvidenceString(value: unknown, field: keyof VerificationEvidence): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (field === 'build' && typeof value === 'number') {
    return `exit ${value}`;
  }
  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>;
    if (field === 'build') {
      const command = typeof rec.command === 'string' ? rec.command.trim() : '';
      const exitCode = rec.exitCode ?? rec.exit_code;
      if (command && exitCode != null) return `${command} exit ${exitCode}`;
      if (command) return command;
      if (exitCode != null) return `exit ${exitCode}`;
    }
    if (field === 'preview') {
      if (rec.healthy === true) return 'inspected';
      if (typeof rec.status === 'string') return rec.status;
    }
    if (field === 'tests') {
      if (rec.passed === true) return 'passed';
      if (typeof rec.summary === 'string') return rec.summary;
    }
  }
  return '';
}

function normalizeVerification(raw: unknown): VerificationEvidence {
  let source: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          source = parsed as Record<string, unknown>;
        }
      } catch {
        /* treat as empty */
      }
    }
  } else if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    source = raw as Record<string, unknown>;
  }
  return {
    build: coerceEvidenceString(source.build, 'build'),
    preview: coerceEvidenceString(source.preview, 'preview'),
    tests: coerceEvidenceString(source.tests, 'tests'),
  };
}

export function validateToolPath(path: string): string {
  if (!path?.trim()) {
    throw new InvalidParamsError('path must be non-empty');
  }
  const normalized = path.replace(/\\/g, '/');
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) {
    throw new SecurityDeniedError(`Absolute paths are not allowed: ${path}`, path);
  }
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    throw new SecurityDeniedError(`Path traversal is not allowed: ${path}`, path);
  }
  if (path.includes('\0')) {
    throw new SecurityDeniedError('Null bytes are not allowed in paths', path);
  }
  return normalized;
}

export function validateToolPathOptional(path: string | undefined | null): string | undefined {
  if (path == null || path === '') return undefined;
  return validateToolPath(path);
}

export function resolveFinalizeRevision(requested: string | undefined, latest: string): string {
  const req = (requested ?? '').trim();
  if (!req) return latest;
  if (req !== latest) return latest;
  return req;
}

export function prepareToolArguments(
  tool: RuntimeMcpToolName,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  switch (tool) {
    case 'list': {
      const path = typeof raw.path === 'string' ? raw.path : '.';
      const depthRaw = raw.depth;
      const depth =
        typeof depthRaw === 'number' && Number.isFinite(depthRaw)
          ? Math.min(10, Math.max(1, Math.floor(depthRaw)))
          : 2;
      return { path: path === '.' ? '.' : validateToolPath(path), depth };
    }
    case 'read': {
      if (typeof raw.path !== 'string') throw new InvalidParamsError('path is required');
      const startLine = typeof raw.startLine === 'number' ? raw.startLine : undefined;
      const endLine = typeof raw.endLine === 'number' ? raw.endLine : undefined;
      if (startLine != null && endLine != null && endLine < startLine) {
        throw new InvalidParamsError('endLine must be >= startLine');
      }
      return {
        path: validateToolPath(raw.path),
        ...(startLine != null ? { startLine } : {}),
        ...(endLine != null ? { endLine } : {}),
      };
    }
    case 'search': {
      if (typeof raw.query !== 'string' || !raw.query.trim()) {
        throw new InvalidParamsError('query is required');
      }
      const maxResultsRaw = raw.maxResults;
      const maxResults =
        typeof maxResultsRaw === 'number' && Number.isFinite(maxResultsRaw)
          ? Math.min(200, Math.max(1, Math.floor(maxResultsRaw)))
          : 50;
      const path = validateToolPathOptional(
        typeof raw.path === 'string' ? raw.path : undefined,
      );
      return {
        query: raw.query,
        maxResults,
        ...(path ? { path } : {}),
      };
    }
    case 'write': {
      if (typeof raw.path !== 'string' || !raw.path) {
        throw new InvalidParamsError('path is required');
      }
      if (typeof raw.content !== 'string') {
        throw new InvalidParamsError('content is required');
      }
      if (raw.content.length > MAX_FILE_SIZE) {
        throw new InvalidParamsError(
          `File content exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
        );
      }
      return {
        path: validateToolPath(raw.path),
        content: raw.content,
        create: raw.create === true,
        ...(typeof raw.expectedSha256 === 'string'
          ? { expectedSha256: raw.expectedSha256 }
          : {}),
      };
    }
    case 'apply_patch': {
      if (typeof raw.path !== 'string' || !raw.path) {
        throw new InvalidParamsError('path is required');
      }
      if (typeof raw.expectedSha256 !== 'string' || !raw.expectedSha256) {
        throw new InvalidParamsError('expectedSha256 is required');
      }
      if (typeof raw.patch !== 'string' || !raw.patch) {
        throw new InvalidParamsError('patch is required');
      }
      if (raw.patch.length > MAX_FILE_SIZE) {
        throw new InvalidParamsError(
          `Patch size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
        );
      }
      return {
        path: validateToolPath(raw.path),
        expectedSha256: raw.expectedSha256,
        patch: raw.patch,
      };
    }
    case 'delete': {
      if (typeof raw.path !== 'string' || !raw.path) {
        throw new InvalidParamsError('path is required');
      }
      return {
        path: validateToolPath(raw.path),
        ...(typeof raw.expectedSha256 === 'string'
          ? { expectedSha256: raw.expectedSha256 }
          : {}),
      };
    }
    case 'diff': {
      const path = validateToolPathOptional(
        typeof raw.path === 'string' ? raw.path : undefined,
      );
      return {
        ...(typeof raw.revisionId === 'string' ? { revisionId: raw.revisionId } : {}),
        ...(path ? { path } : {}),
      };
    }
    case 'run': {
      if (typeof raw.command !== 'string' || !raw.command.trim()) {
        throw new InvalidParamsError('command is required');
      }
      const cwd =
        typeof raw.cwd === 'string' && raw.cwd ? validateToolPath(raw.cwd) : undefined;
      const timeoutMsRaw = raw.timeoutMs;
      const timeoutMs =
        typeof timeoutMsRaw === 'number' && Number.isFinite(timeoutMsRaw)
          ? Math.min(600_000, Math.max(1_000, Math.floor(timeoutMsRaw)))
          : 180_000;
      return {
        command: raw.command,
        timeoutMs,
        ...(cwd ? { cwd } : {}),
      };
    }
    case 'dev_server': {
      const action = raw.action === 'restart' ? 'restart' : 'status';
      return { action };
    }
    case 'preview_inspect':
      return typeof raw.url === 'string' && raw.url ? { url: raw.url } : {};
    case 'preview_action': {
      const allowed = [
        'reload',
        'click',
        'input',
        'press_key',
        'select',
        'scroll',
      ] as const;
      if (typeof raw.action !== 'string' || !allowed.includes(raw.action as (typeof allowed)[number])) {
        throw new InvalidParamsError('action is required');
      }
      return {
        action: raw.action,
        ...(typeof raw.selector === 'string' ? { selector: raw.selector } : {}),
        ...(typeof raw.value === 'string' ? { value: raw.value } : {}),
        ...(typeof raw.x === 'number' ? { x: raw.x } : {}),
        ...(typeof raw.y === 'number' ? { y: raw.y } : {}),
      };
    }
    case 'finalize': {
      if (typeof raw.title !== 'string' || !raw.title.trim()) {
        throw new InvalidParamsError('title is required');
      }
      return {
        title: raw.title.trim(),
        revisionId: typeof raw.revisionId === 'string' ? raw.revisionId : '',
        verification: normalizeVerification(raw.verification),
      };
    }
    default:
      return raw;
  }
}

export function prepareFinalizeDispatchArgs(
  args: Record<string, unknown>,
  latestRevisionId: string,
): Record<string, unknown> {
  const verification = args.verification as VerificationEvidence;
  const revisionId = resolveFinalizeRevision(
    typeof args.revisionId === 'string' ? args.revisionId : undefined,
    latestRevisionId,
  );
  return {
    title: args.title,
    revisionId,
    verification,
  };
}
