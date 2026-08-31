import { ToolError } from './ToolError';
import { RuntimeErrorCodes } from './runtime.types';

/**
 * Port of Python's `os.path.normpath` (POSIX flavour), also folding backslash
 * separators so `..\..\etc` still trips the traversal guard.
 */
export function normalizePath(input: string): string {
  const absolute = /^[/\\]/.test(input);
  const out: string[] = [];
  for (const part of input.split(/[/\\]+/)) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== '..') {
        out.pop();
      } else if (!absolute) {
        out.push('..');
      }
      continue;
    }
    out.push(part);
  }
  const joined = out.join('/');
  if (absolute) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

function isAbsolutePath(input: string): boolean {
  // POSIX root, plus Windows drive letters and UNC prefixes.
  return /^[/\\]/.test(input) || /^[A-Za-z]:[/\\]/.test(input);
}

/**
 * Port of `_validate_path` in runtime_tools/handlers.py. Checks run in the same
 * order as the backend so the browser rejects exactly what APImanus rejects.
 *
 * @returns the normalized, workspace-relative path
 * @throws ToolError `-32602` when blank, `-32008` on absolute / traversal / null byte
 */
export function validateToolPath(path: string): string {
  if (!path || !path.trim()) {
    throw new ToolError(
      RuntimeErrorCodes.INVALID_PARAMS,
      'path must be non-empty',
      { path },
    );
  }

  const normalized = normalizePath(path);

  if (isAbsolutePath(path)) {
    throw new ToolError(
      RuntimeErrorCodes.SECURITY_DENIED,
      `Absolute paths are not allowed: ${JSON.stringify(path)}`,
      { path, reason: 'absolute_path' },
    );
  }

  if (normalized.startsWith('..') || normalized.includes('/..')) {
    throw new ToolError(
      RuntimeErrorCodes.SECURITY_DENIED,
      `Path traversal is not allowed: ${JSON.stringify(path)}`,
      { path, reason: 'path_traversal' },
    );
  }

  if (path.includes('\0')) {
    throw new ToolError(
      RuntimeErrorCodes.SECURITY_DENIED,
      'Null bytes are not allowed in paths',
      { path, reason: 'null_byte' },
    );
  }

  return normalized;
}

export function validateToolPathOptional(
  path: string | null | undefined,
): string | null {
  if (path === null || path === undefined) return null;
  return validateToolPath(path);
}

/**
 * `list` accepts `"."` for the workspace root without validation (backend
 * handlers.py line 94 short-circuits the same way).
 */
export function validateListPath(path: string): string {
  return path === '.' ? '.' : validateToolPath(path);
}

/** Workspace-relative path -> absolute VFS path inside the Nodepod project. */
export function toVfsPath(relative: string, root = '/'): string {
  if (relative === '.' || relative === '') return root;
  const base = root.endsWith('/') ? root : `${root}/`;
  return `${base}${relative}`.replace(/\/{2,}/g, '/');
}

/** Absolute VFS path -> workspace-relative path (inverse of `toVfsPath`). */
export function toRelativePath(vfsPath: string, root = '/'): string {
  const base = root.endsWith('/') ? root : `${root}/`;
  return vfsPath.startsWith(base) ? vfsPath.slice(base.length) : vfsPath.replace(/^\//, '');
}
